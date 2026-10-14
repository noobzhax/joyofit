/**
 * Layout section: lossless protobuf tree plus schema-named views.
 *
 * - version 2 faces decode through {@link SCHEMA_V2} (vendor schema; every field of every v2 sample is covered).
 * - version 1 faces decode through {@link SCHEMA_V1} (reverse engineered, a handful of fields).
 * - anything a schema does not cover stays in the tree as raw fields and is reported as `$unknown` in named views.
 */
import { HwtError, hex, utf8Decode } from "./bytes";
import {
  toInt32,
  decodePb,
  encodePb,
  type PbField,
  type PbFieldSchema,
  type PbMessage,
  type PbSchema,
} from "./protobuf";
import { SCHEMA_V1 } from "./schema-v1";
import { SCHEMA_V2 } from "./schema-v2";
import type { WatchfaceBinary } from "./watchface";

export type LayoutKind = "v1" | "v2";

export interface Layout {
  kind: LayoutKind;
  /** Decoded tree. Mutate it freely; {@link encodeLayout} re-serialises it. */
  root: PbMessage;
}

export function schemaFor(kind: LayoutKind): { schema: PbSchema; root: string } {
  return kind === "v2" ? { schema: SCHEMA_V2, root: "Watchface" } : { schema: SCHEMA_V1, root: "Root" };
}

/** Header version 2 uses the v2 schema, everything else the v1 schema. */
export function layoutKindOf(version: number): LayoutKind {
  return version >= 2 ? "v2" : "v1";
}

export function decodeLayout(layoutBytes: Uint8Array, version: number): Layout {
  const kind = layoutKindOf(version);
  const { schema, root } = schemaFor(kind);
  return { kind, root: decodePb(layoutBytes, schema, root) };
}

export function encodeLayout(layout: Layout): Uint8Array {
  return encodePb(layout.root);
}

/** Decodes the layout of a parsed watchface binary. */
export function getLayout(wf: WatchfaceBinary): Layout {
  return decodeLayout(wf.layout, wf.version);
}

/** Re-encodes `layout` into the watchface binary (header lengths are recomputed by `writeWatchface`). */
export function setLayout(wf: WatchfaceBinary, layout: Layout): void {
  wf.layout = encodeLayout(layout);
}

// ---------------------------------------------------------------------------------------------------------------------
// Named view

export type NamedValue = number | string | boolean | null | NamedObject | NamedValue[];
export interface NamedObject {
  [key: string]: NamedValue;
}

function floatOf(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true);
}

function scalar(f: PbField, fs: PbFieldSchema, schema: PbSchema): NamedValue {
  if (f.wire === 0) {
    if (fs.kind === "bool") return f.value !== 0 && f.value !== 0n;
    if (fs.kind === "int32" || fs.kind === "int32w") return toInt32(f.value);
    if (fs.kind === "enum") {
      const names = fs.enum ? schema.enums[fs.enum] : undefined;
      const n = Number(f.value);
      return names?.[n] ?? n;
    }
    return typeof f.value === "bigint" ? f.value.toString() : f.value;
  }
  if (f.wire === 5 && fs.kind === "float") return floatOf(f.bytes);
  if (f.wire === 2) {
    if (fs.kind === "string") return utf8Decode(f.bytes);
    return hex(f.bytes);
  }
  return hex(f.bytes);
}

function rawOf(f: PbField): NamedObject {
  const base = { field: f.field, wire: f.wire };
  if (f.wire === 0) return { ...base, value: typeof f.value === "bigint" ? f.value.toString() : f.value };
  if (f.wire === 2 && f.message) return { ...base, hex: hex(encodePb(f.message)) };
  return { ...base, hex: hex(f.bytes) };
}

function wireMatches(f: PbField, fs: PbFieldSchema): boolean {
  switch (fs.kind) {
    case "varint":
    case "bool":
    case "enum":
    case "int32":
    case "int32w":
      return f.wire === 0;
    case "string":
    case "bytes":
    case "message":
      return f.wire === 2;
    case "float":
      return f.wire === 5;
  }
}

/**
 * Renders a message through its schema: field names from the schema, enums as names, repeated fields as arrays,
 * floats decoded, and everything the schema does not explain (unknown field number or mismatching wire type) under
 * `$unknown` as `{field, wire, value|hex}` so nothing is silently dropped.
 */
export function namedMessage(message: PbMessage, schema: PbSchema, name: string): NamedObject {
  const ms = schema.messages[name];
  const out: NamedObject = {};
  const unknown: NamedObject[] = [];
  for (const f of message.fields) {
    const fs = ms?.fields[f.field];
    if (!fs || !wireMatches(f, fs)) {
      unknown.push(rawOf(f));
      continue;
    }
    let value: NamedValue;
    if (fs.kind === "message" && fs.message) {
      value = f.wire !== 2 ? null : f.message ? namedMessage(f.message, schema, fs.message) : hex(f.bytes);
    } else {
      value = scalar(f, fs, schema);
    }
    if (fs.repeated) {
      const list = (out[fs.name] ??= []) as NamedValue[];
      list.push(value);
    } else if (fs.name in out) {
      // A singular field that occurs more than once (the v1 title pairs): keep every occurrence.
      const prev = out[fs.name]!;
      out[fs.name] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[fs.name] = value;
    }
  }
  if (unknown.length) out.$unknown = unknown;
  return out;
}

export function describeLayout(layout: Layout): NamedObject {
  const { schema, root } = schemaFor(layout.kind);
  return namedMessage(layout.root, schema, root);
}

// ---------------------------------------------------------------------------------------------------------------------
// Image references

/** A string field of the layout that names an image slot (a decimal reference such as "004"). */
export interface ImageRefField {
  /** Dotted schema path, e.g. `Element.layer.single_res.res_name`. */
  path: string;
  field: PbField & { wire: 2 };
  /** Reference text as stored (may be empty: an unused glyph slot). */
  ref: string;
}

const IMAGE_FIELD_NAME = /^res_|_res$|preview|^image$|^value_\d+$/;

/** Walks the layout and yields every string field that carries an image reference (decimal digits). Empty strings are skipped. */
export function collectImageRefs(layout: Layout): ImageRefField[] {
  const { schema, root } = schemaFor(layout.kind);
  const found: ImageRefField[] = [];
  const walk = (m: PbMessage, name: string, path: string) => {
    const ms = schema.messages[name];
    if (!ms) return;
    for (const f of m.fields) {
      const fs = ms.fields[f.field];
      if (!fs || f.wire !== 2) continue;
      const here = `${path}.${fs.name}`;
      if (fs.kind === "message" && fs.message && f.message) walk(f.message, fs.message, here);
      else if (fs.kind === "string" && IMAGE_FIELD_NAME.test(fs.name)) {
        const ref = utf8Decode(f.bytes);
        if (/^\d+$/.test(ref)) found.push({ path: here, field: f, ref });
      }
    }
  };
  walk(layout.root, root, root);
  return found;
}

/** Slot indices (0-based) referenced anywhere in the layout, ascending and unique. */
export function usedImageIndices(layout: Layout): number[] {
  return [...new Set(collectImageRefs(layout).map((r) => Number(r.ref) - 1))].sort((a, b) => a - b);
}

/** Rewrites every image reference through `map(oldIndex) -> newIndex` (both 0-based). Keeps the 3-digit padding. */
export function remapImageRefs(layout: Layout, map: (index: number) => number): void {
  for (const r of collectImageRefs(layout)) {
    const next = map(Number(r.ref) - 1);
    if (!Number.isInteger(next) || next < 0) throw new HwtError(`invalid remap of image ${r.ref} -> ${next}`);
    r.field.bytes = new TextEncoder().encode(String(next + 1).padStart(3, "0"));
    delete r.field.lenRaw;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Version 1 typed elements

export interface V1StaticImage {
  type: 0;
  kind: "image";
  /** Image reference ("002" = slot 1). */
  image: string;
  x: number;
  y: number;
}

export interface V1Hand {
  type: 1;
  kind: "hand";
  image: string;
  /** Rotation box. */
  rect: { x: number; y: number; width: number; height: number };
  /** Rotation pivot inside the hand image. */
  pivot: { x: number; y: number };
  /** Degrees, float32 (time hands 0 -> 360, gauges -150 -> 150 in samples). */
  startAngle: number;
  endAngle: number;
  valueType: number;
}

export interface V1Text {
  type: 3;
  kind: "text";
  rect: { x: number; y: number; width: number; height: number };
  color: { red: number; green: number; blue: number; alpha: number };
  font: number;
  align: number;
  valueType: number;
}

export interface V1Glyphs {
  type: 6;
  kind: "glyphs";
  x: number;
  y: number;
  valueType: number;
  /** `table[v]` is the image reference shown when the value is `v` ("" = none). 15 slots. */
  table: string[];
}

export interface V1Unknown {
  type: number;
  kind: "unknown";
  message: PbMessage;
}

export type V1Element = V1StaticImage | V1Hand | V1Text | V1Glyphs | V1Unknown;

function num(m: PbMessage, field: number): number {
  const f = m.fields.find((x) => x.field === field);
  return f && f.wire === 0 ? Number(f.value) : 0;
}

function str(m: PbMessage, field: number): string {
  const f = m.fields.find((x) => x.field === field);
  return f && f.wire === 2 ? utf8Decode(f.bytes) : "";
}

function flt(m: PbMessage, field: number): number {
  const f = m.fields.find((x) => x.field === field);
  return f && f.wire === 5 ? floatOf(f.bytes) : 0;
}

function sub(m: PbMessage, field: number): PbMessage | undefined {
  const f = m.fields.find((x) => x.field === field);
  return f && f.wire === 2 ? f.message : undefined;
}

/** Typed view of the elements of a version 1 layout, in draw order (first = bottom). */
export function readV1Elements(layout: Layout): V1Element[] {
  if (layout.kind !== "v1") throw new HwtError("readV1Elements: not a version 1 layout");
  const out: V1Element[] = [];
  for (const f of layout.root.fields) {
    if (f.field !== 1 || f.wire !== 2 || !f.message) continue;
    const e = f.message;
    const type = num(e, 1);
    const staticImage = sub(e, 2);
    const hand = sub(e, 3);
    const text = sub(e, 5);
    const glyphs = sub(e, 8);
    if (type === 0 && staticImage) {
      out.push({ type: 0, kind: "image", image: str(staticImage, 1), x: num(staticImage, 2), y: num(staticImage, 3) });
    } else if (type === 1 && hand) {
      out.push({
        type: 1,
        kind: "hand",
        image: str(hand, 1),
        rect: { x: num(hand, 2), y: num(hand, 3), width: num(hand, 4), height: num(hand, 5) },
        pivot: { x: num(hand, 6), y: num(hand, 7) },
        startAngle: flt(hand, 8),
        endAngle: flt(hand, 9),
        valueType: num(hand, 10),
      });
    } else if (type === 3 && text) {
      out.push({
        type: 3,
        kind: "text",
        rect: { x: num(text, 1), y: num(text, 2), width: num(text, 3), height: num(text, 4) },
        color: { red: num(text, 5), green: num(text, 6), blue: num(text, 7), alpha: num(text, 12) },
        font: num(text, 8),
        align: num(text, 9),
        valueType: num(text, 11),
      });
    } else if (type === 6 && glyphs) {
      const table = sub(glyphs, 10);
      out.push({
        type: 6,
        kind: "glyphs",
        x: num(glyphs, 1),
        y: num(glyphs, 2),
        valueType: num(glyphs, 3),
        table: Array.from({ length: 15 }, (_, i) => (table ? str(table, i + 1) : "")),
      });
    } else {
      out.push({ type, kind: "unknown", message: e });
    }
  }
  return out;
}
