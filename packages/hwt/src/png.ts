/** Minimal PNG writer (8-bit RGBA, no interlace, filter 0) and matching reader, for tooling and tests. */
import { unzlibSync, zlibSync } from "fflate";
import { HwtError, concat, crc32, view } from "./bytes";
import type { RgbaImage } from "./image";

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = view(out);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const ihdr = new Uint8Array(13);
  const dv = view(ihdr);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))]);
}

/** Decodes PNGs written by {@link encodePng} (8-bit RGBA, non-interlaced; all five filter types are handled). */
export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new HwtError("not a PNG");
  const dv = view(bytes);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view(body).getUint32(0);
      height = view(body).getUint32(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new HwtError("only 8-bit non-interlaced RGBA PNGs are supported");
    } else if (type === "IDAT") idat.push(body);
    pos += 12 + len;
  }
  const raw = unzlibSync(concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= 4 ? out[y * stride + x - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      let v: number;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + a;
      else if (filter === 2) v = cur + b;
      else if (filter === 3) v = cur + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}
