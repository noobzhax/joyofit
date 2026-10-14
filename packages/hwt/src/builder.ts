/**
 * Low-level edit helpers on a parsed {@link WatchfaceBinary}: add/replace images and insert static image elements.
 *
 * Header fix-ups are not done by hand here: `writeWatchface` derives layout length (`xmllen`), table length (`maplen`),
 * bin length (`binlen`, which counts the 8 byte signature) and every table offset from the model, so a face edited
 * through these helpers is consistent by construction. `verifyWatchface` re-parses serialised bytes and checks exactly
 * the rules of the community research doc (see README, "Header rules").
 */
import { HwtError, utf8Encode, view } from "./bytes";
import { buildMessage } from "./compose";
import { IMAGE_HEADER_SIZE, IMAGE_MAGIC_ARGB8888, encodeImage, readImageHeader, type RgbaImage } from "./image";
import { decodeLayout, encodeLayout, schemaFor, type Layout } from "./layout";
import { encodePb, type PbField, type PbMessage } from "./protobuf";
import { SIGNATURE_SIZE, TABLE_ENTRY_SIZE, WATCHFACE_HEADER_SIZE, assertEditable, imageRef, type WatchfaceBinary } from "./watchface";

/** An image given either as pixels (encoded for you) or as an already encoded blob (8 byte header + data). */
export type ImageSource = RgbaImage | Uint8Array;

function toBlob(source: ImageSource): Uint8Array {
  if (source instanceof Uint8Array) {
    const h = readImageHeader(source);
    if (h.magic !== IMAGE_MAGIC_ARGB8888) throw new HwtError(`image blob has unsupported magic 0x${h.magic.toString(16)}`);
    return source.slice();
  }
  return encodeImage(source);
}

/** Appends an image and returns its slot index (0-based). Its layout reference is `imageRef(index)`. */
export function addImage(wf: WatchfaceBinary, source: ImageSource): number {
  assertEditable(wf);
  wf.images.push(toBlob(source));
  return wf.images.length - 1;
}

export interface ReplaceResult {
  previousSize: { width: number; height: number };
  size: { width: number; height: number };
  /** True when the new image has other dimensions than the old one: layout positions/rects that assumed the old size are stale. */
  resized: boolean;
}

/** Replaces the image in slot `index`; every layout reference to it keeps working. */
export function replaceImage(wf: WatchfaceBinary, index: number, source: ImageSource): ReplaceResult {
  assertEditable(wf);
  if (!Number.isInteger(index) || index < 0 || index >= wf.images.length) throw new HwtError(`no image slot ${index}`);
  const old = wf.images[index]!;
  const blob = toBlob(source);
  const previousSize = old.length >= IMAGE_HEADER_SIZE ? readImageHeader(old) : { width: 0, height: 0 };
  const next = readImageHeader(blob);
  wf.images[index] = blob;
  return {
    previousSize: { width: previousSize.width, height: previousSize.height },
    size: { width: next.width, height: next.height },
    resized: previousSize.width !== next.width || previousSize.height !== next.height,
  };
}

export interface StaticImageOptions {
  x: number;
  y: number;
  /** Slot index (number) or layout reference ("004"). */
  image: number | string;
  /** `bottom` (default): drawn before everything else, i.e. behind the existing elements. `top`: drawn last. */
  position?: "bottom" | "top";
}

function resolveRef(wf: WatchfaceBinary, image: number | string): string {
  const index = typeof image === "number" ? image : /^\d+$/.test(image) ? Number(image) - 1 : -1;
  if (!Number.isInteger(index) || index < 0 || index >= wf.images.length) throw new HwtError(`image ${image} does not name an existing slot (0..${wf.images.length - 1})`);
  return imageRef(index);
}

function firstString(layout: Layout, field: number): Uint8Array {
  const f = layout.root.fields.find((x) => x.field === field && x.wire === 2);
  return f && f.wire === 2 ? f.bytes : new Uint8Array(0);
}

/**
 * Inserts a static image element at (x, y) and re-encodes the layout.
 *
 * - version 1 layouts: `{type 0, {image, x, y}}` plus the `title_en`/`title_cn` pair that follows every element in that
 *   format (copied from the first element), as the research doc describes for the A.323 template.
 * - version 2 layouts: an `Element` labelled BACKGROUND (bottom) or WIDGET (top) holding one NORMAL_ONLY `Single_Res` layer.
 */
export function addStaticImage(wf: WatchfaceBinary, options: StaticImageOptions): void {
  const ref = resolveRef(wf, options.image);
  const layout = decodeLayout(wf.layout, wf.version);
  const position = options.position ?? "bottom";
  const fields: PbField[] = [];
  if (layout.kind === "v1") {
    const inner: PbMessage = {
      fields: [
        { field: 1, wire: 2, bytes: utf8Encode(ref) },
        { field: 2, wire: 0, value: options.x },
        { field: 3, wire: 0, value: options.y },
      ],
    };
    const element: PbMessage = {
      fields: [
        { field: 1, wire: 0, value: 0 },
        { field: 2, wire: 2, bytes: encodePb(inner), message: inner },
      ],
    };
    fields.push({ field: 1, wire: 2, bytes: encodePb(element), message: element });
    fields.push({ field: 2, wire: 2, bytes: firstString(layout, 2).slice() });
    fields.push({ field: 3, wire: 2, bytes: firstString(layout, 3).slice() });
  } else {
    const { schema } = schemaFor("v2");
    const element = buildMessage(schema, "Element", {
      label: position === "bottom" ? "ELEMENT_LABEL_BACKGROUND" : "ELEMENT_LABEL_WIDGET",
      is_support_option: false,
      ...(position === "bottom" ? { res_preview: "" } : {}),
      layer: [
        {
          index: 0,
          draw_type: "DRAW_TYPE_SINGLE_RES",
          single_res: { res_name: ref, res_position: { x: options.x, y: options.y }, ambient_mode: "NORMAL_ONLY" },
        },
      ],
    });
    fields.push({ field: 1, wire: 2, bytes: encodePb(element), message: element });
  }

  if (position === "bottom") {
    layout.root.fields.unshift(...fields);
  } else if (layout.kind === "v1") {
    layout.root.fields.push(...fields);
  } else {
    let at = 0;
    layout.root.fields.forEach((f, i) => {
      if (f.field === 1) at = i + 1;
    });
    layout.root.fields.splice(at, 0, ...fields);
  }
  wf.layout = encodeLayout(layout);
}

// ---------------------------------------------------------------------------------------------------------------------
// Consistency check

export interface WatchfaceReport {
  ok: boolean;
  problems: string[];
  header: { version: number; layoutLen: number; tableLen: number; binLen: number; reserved: number };
  images: number;
}

/**
 * Re-parses serialised watchface bytes and checks the header rules: `layoutLen` = protobuf bytes, `tableLen` = 8 x images,
 * `binLen` = bytes to end of file = 8 (signature) + image bytes, table offsets contiguous starting at 8, and every image
 * blob starts with the ARGB8888 magic and decodes to the size in its header.
 */
export function verifyWatchface(bytes: Uint8Array): WatchfaceReport {
  const problems: string[] = [];
  const dv = view(bytes);
  const header = {
    version: dv.getUint16(0, true),
    layoutLen: dv.getUint16(2, true),
    tableLen: dv.getUint32(4, true),
    binLen: dv.getUint32(8, true),
    reserved: dv.getUint32(12, true),
  };
  const tableStart = WATCHFACE_HEADER_SIZE + header.layoutLen;
  const binStart = tableStart + header.tableLen;
  if (binStart > bytes.length) problems.push(`layout+table (${binStart}) overrun the file (${bytes.length})`);
  if (header.tableLen % TABLE_ENTRY_SIZE !== 0) problems.push(`table length ${header.tableLen} is not a multiple of ${TABLE_ENTRY_SIZE}`);
  if (header.binLen !== bytes.length - binStart) problems.push(`binLen ${header.binLen} != bytes after the table ${bytes.length - binStart}`);
  const count = Math.floor(header.tableLen / TABLE_ENTRY_SIZE);
  let running = SIGNATURE_SIZE;
  for (let i = 0; i < count && binStart + SIGNATURE_SIZE <= bytes.length; i++) {
    const off = dv.getUint32(tableStart + i * 8, true);
    const size = dv.getUint32(tableStart + i * 8 + 4, true);
    if (off !== running) problems.push(`image ${i}: offset ${off}, expected ${running}`);
    running = off + size;
    if (size > 0) {
      const blob = bytes.subarray(binStart + off, binStart + off + size);
      if (blob.length !== size) {
        problems.push(`image ${i}: runs past the end of the file`);
        continue;
      }
      const h = readImageHeader(blob);
      if (h.magic !== IMAGE_MAGIC_ARGB8888) problems.push(`image ${i}: unexpected magic 0x${h.magic.toString(16)}`);
    }
  }
  if (running !== header.binLen) problems.push(`images end at ${running}, binLen is ${header.binLen}`);
  try {
    const layoutBytes = bytes.subarray(WATCHFACE_HEADER_SIZE, tableStart);
    decodeLayout(layoutBytes, header.version);
  } catch (e) {
    problems.push(`layout does not decode: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: problems.length === 0, problems, header, images: count };
}
