/**
 * `.hwt` image blob codec.
 *
 * Blob layout (evidence: every sample, plus three independent decoders — see README):
 *
 *   0..3  magic  45 23 88 88   (u32le 0x88882345: "ARGB8888 + RLE")
 *   4..5  u16le  width
 *   6..7  u16le  height
 *   8..   pixels in 4-byte units, stored B,G,R,A. A unit equal to the escape `89 67 45 23` introduces a run:
 *         escape(4) + B,G,R,A(4) + u32le count (4)  =>  `count` copies of that pixel.
 *
 * The decoders by wzsx150 additionally know 45 23 65 F5 (RGB565), 45 23 55 F5 (RGB555) and 45 23 88 F8 (RGB888)
 * variants; none of the samples uses them, so this codec only decodes/encodes ARGB8888 and leaves other
 * formats as opaque blobs.
 */
import { HwtError, view } from "./bytes";

export const IMAGE_MAGIC_ARGB8888 = 0x88882345;
export const RLE_ESCAPE = [0x89, 0x67, 0x45, 0x23] as const;
export const IMAGE_HEADER_SIZE = 8;

/** ImageData-like pixel buffer: RGBA, row-major, 4 bytes per pixel, non-premultiplied. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ImageHeader {
  /** The first four header bytes as u32le. `IMAGE_MAGIC_ARGB8888` for the only supported format. */
  magic: number;
  width: number;
  height: number;
}

export function readImageHeader(blob: Uint8Array): ImageHeader {
  if (blob.length < IMAGE_HEADER_SIZE) throw new HwtError(`image blob too short (${blob.length} bytes)`);
  const dv = view(blob);
  return { magic: dv.getUint32(0, true), width: dv.getUint16(4, true), height: dv.getUint16(6, true) };
}

export function isEscape(blob: Uint8Array, at: number): boolean {
  return blob[at] === 0x89 && blob[at + 1] === 0x67 && blob[at + 2] === 0x45 && blob[at + 3] === 0x23;
}

/** Decodes an ARGB8888+RLE blob. Throws on other magics, truncated data, runs past the pixel count, or trailing bytes. */
export function decodeImage(blob: Uint8Array): RgbaImage {
  const { magic, width, height } = readImageHeader(blob);
  if (magic !== IMAGE_MAGIC_ARGB8888) throw new HwtError(`unsupported image magic 0x${magic.toString(16)}`);
  const total = width * height;
  const out = new Uint8Array(total * 4);
  const dv = view(blob);
  let pos = IMAGE_HEADER_SIZE;
  let px = 0;
  while (px < total) {
    if (pos + 4 > blob.length) throw new HwtError("image data truncated");
    if (isEscape(blob, pos)) {
      if (pos + 12 > blob.length) throw new HwtError("image RLE run truncated");
      const count = dv.getUint32(pos + 8, true);
      if (px + count > total) throw new HwtError("image RLE run exceeds pixel count");
      const r = blob[pos + 6]!;
      const g = blob[pos + 5]!;
      const b = blob[pos + 4]!;
      const a = blob[pos + 7]!;
      for (let i = 0, o = px * 4; i < count; i++, o += 4) {
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
      px += count;
      pos += 12;
    } else {
      const o = px * 4;
      out[o] = blob[pos + 2]!;
      out[o + 1] = blob[pos + 1]!;
      out[o + 2] = blob[pos]!;
      out[o + 3] = blob[pos + 3]!;
      px++;
      pos += 4;
    }
  }
  if (pos !== blob.length) throw new HwtError(`image has ${blob.length - pos} trailing bytes after ${total} pixels`);
  return { width, height, data: out };
}

export interface EncodeOptions {
  /**
   * Shortest run emitted as an RLE record. A run of n pixels costs 12 bytes as RLE and 4n as literals, so 4 is the
   * first length where RLE is strictly smaller; at 3 it ties. A single pixel equal to the escape value is always
   * emitted as a run of 1 because a literal would be read as an escape. Default {@link DEFAULT_MIN_RUN}.
   */
  minRun?: number;
  /** Longest single run (the count field is u32). Default {@link DEFAULT_MAX_RUN}. */
  maxRun?: number;
}

/**
 * With these defaults (minRun 4, runs unbounded) re-encoding reproduces the original bytes of 1162 of the 1168 non-empty
 * sample images: every Fit 4 Pro, GT6, Band 9 and GT3 sample and SimpleItalic. The six others (Carrera, Unnamed) come from an
 * older encoder that turns every run of 2+ pixels into a record: `minRun: 2` reproduces them byte-for-byte as well.
 * No sample splits runs, so `maxRun` stays at the u32 maximum.
 */
export const DEFAULT_MIN_RUN = 4;
export const DEFAULT_MAX_RUN = 0xffffffff;

export function encodeImage(image: RgbaImage, options: EncodeOptions = {}): Uint8Array {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
    throw new HwtError(`invalid image size ${width}x${height}`);
  }
  const total = width * height;
  if (data.length !== total * 4) throw new HwtError(`pixel buffer is ${data.length} bytes, expected ${total * 4}`);
  const minRun = options.minRun ?? DEFAULT_MIN_RUN;
  const maxRun = options.maxRun ?? DEFAULT_MAX_RUN;

  // Worst case: every pixel literal (4 bytes) plus the header; escape-valued singles cost 12.
  let out = new Uint8Array(IMAGE_HEADER_SIZE + total * 4 + 16);
  const dv = view(out);
  dv.setUint32(0, IMAGE_MAGIC_ARGB8888, true);
  dv.setUint16(4, width, true);
  dv.setUint16(6, height, true);
  let w = IMAGE_HEADER_SIZE;
  const ensure = (n: number) => {
    if (w + n > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, w + n));
      grown.set(out);
      out = grown;
    }
  };

  let i = 0;
  while (i < total) {
    const o = i * 4;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    const a = data[o + 3]!;
    let run = 1;
    while (run < maxRun && i + run < total) {
      const q = (i + run) * 4;
      if (data[q] !== r || data[q + 1] !== g || data[q + 2] !== b || data[q + 3] !== a) break;
      run++;
    }
    const isEscapeColor = b === 0x89 && g === 0x67 && r === 0x45 && a === 0x23;
    if (run >= minRun || isEscapeColor) {
      ensure(12);
      out[w] = 0x89;
      out[w + 1] = 0x67;
      out[w + 2] = 0x45;
      out[w + 3] = 0x23;
      out[w + 4] = b;
      out[w + 5] = g;
      out[w + 6] = r;
      out[w + 7] = a;
      new DataView(out.buffer).setUint32(w + 8, run, true);
      w += 12;
      i += run;
    } else {
      // Emit the pixels of this short run as literals. (They are identical, so `run` of them.)
      ensure(run * 4);
      for (let k = 0; k < run; k++) {
        out[w] = b;
        out[w + 1] = g;
        out[w + 2] = r;
        out[w + 3] = a;
        w += 4;
      }
      i += run;
    }
  }
  return out.slice(0, w);
}
