/**
 * Generic protobuf wire-format reader/writer producing a lossless field tree.
 *
 * Lossless means: `encodePb(decodePb(bytes, schema?))` is byte-identical to `bytes`, including non-canonical
 * varints (tag, value and length varints keep their original bytes in `raw`/`tagRaw`/`lenRaw` only when the
 * canonical re-encoding would differ), field order, repeated/duplicate singular fields and unknown fields.
 *
 * Length-delimited fields are opaque `bytes` unless a {@link PbSchema} says the field is a nested message,
 * in which case they are decoded recursively (`message`). Groups (wire types 3/4) are not supported.
 */
import { HwtError, bytesEqual, concat } from "./bytes";

export type PbWire = 0 | 1 | 2 | 5;

interface PbBase {
  /** Field number. */
  field: number;
  /** Original tag bytes when they are not the canonical varint encoding of `(field << 3) | wire`. */
  tagRaw?: Uint8Array;
}

export interface PbVarint extends PbBase {
  wire: 0;
  /** Unsigned 64-bit value; a `bigint` only when it exceeds 2^53-1 (e.g. negative int32/int64 are 10-byte varints). */
  value: number | bigint;
  /** Original bytes when not canonical. */
  raw?: Uint8Array;
}

export interface PbFixed64 extends PbBase {
  wire: 1;
  bytes: Uint8Array;
}

export interface PbFixed32 extends PbBase {
  wire: 5;
  bytes: Uint8Array;
}

export interface PbBytes extends PbBase {
  wire: 2;
  /** Raw payload (string, bytes, or an undecoded nested message). */
  bytes: Uint8Array;
  /** Original length varint when not canonical. */
  lenRaw?: Uint8Array;
  /** Decoded nested message; when present it is authoritative and `bytes` is ignored on encode. */
  message?: PbMessage;
}

export type PbField = PbVarint | PbFixed64 | PbFixed32 | PbBytes;

export interface PbMessage {
  fields: PbField[];
}

/**
 * Scalar interpretation of a field, used only by typed views; the wire tree never depends on it.
 * `int32` is a protobuf int32 (negative = 10 byte varint); `int32w` is a signed value Huawei stores as uint32 (negative = 5 byte varint).
 */
export type PbKind = "varint" | "bool" | "enum" | "int32" | "int32w" | "string" | "bytes" | "float" | "message";

export interface PbFieldSchema {
  name: string;
  kind: PbKind;
  /** Message schema name (key in {@link PbSchema.messages}) when `kind === "message"`. */
  message?: string;
  repeated?: boolean;
  /** Enum name (key in {@link PbSchema.enums}) when `kind === "enum"`. */
  enum?: string;
}

export interface PbMessageSchema {
  fields: Record<number, PbFieldSchema>;
}

export interface PbSchema {
  messages: Record<string, PbMessageSchema>;
  enums: Record<string, Record<number, string>>;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_DEPTH = 32;

class Reader {
  pos = 0;
  constructor(
    readonly bytes: Uint8Array,
    readonly end: number,
  ) {}

  varint(): { value: number | bigint; raw: Uint8Array } {
    const start = this.pos;
    let lo = 0;
    let mul = 1;
    let big: bigint | undefined;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new HwtError(`protobuf: truncated varint at ${start}`);
      const b = this.bytes[this.pos++]!;
      if (big === undefined && i < 7) {
        lo += (b & 0x7f) * mul;
        mul *= 128;
      } else {
        if (big === undefined) big = BigInt(lo);
        big |= BigInt(b & 0x7f) << BigInt(shift);
      }
      shift += 7;
      if (!(b & 0x80)) {
        const raw = this.bytes.subarray(start, this.pos);
        if (big === undefined) return { value: lo, raw };
        return { value: big <= BigInt(MAX_SAFE) ? Number(big) : BigInt.asUintN(64, big), raw };
      }
    }
    throw new HwtError(`protobuf: varint longer than 10 bytes at ${start}`);
  }
}

export function encodeVarint(value: number | bigint): Uint8Array {
  if (typeof value === "bigint") {
    let v = BigInt.asUintN(64, value);
    const out: number[] = [];
    do {
      const b = Number(v & 0x7fn);
      v >>= 7n;
      out.push(v > 0n ? b | 0x80 : b);
    } while (v > 0n);
    return Uint8Array.from(out);
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new HwtError(`protobuf: cannot encode varint ${value}`);
  const out: number[] = [];
  let v = value;
  while (v >= 128) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Uint8Array.from(out);
}

function decodeRange(bytes: Uint8Array, start: number, end: number, schema: PbSchema | undefined, msgName: string | undefined, depth: number): PbMessage {
  if (depth > MAX_DEPTH) throw new HwtError("protobuf: nesting too deep");
  const r = new Reader(bytes, end);
  r.pos = start;
  const fields: PbField[] = [];
  const msgSchema = schema && msgName ? schema.messages[msgName] : undefined;
  while (r.pos < end) {
    const tag = r.varint();
    const tagValue = typeof tag.value === "bigint" ? Number(tag.value) : tag.value;
    const field = Math.floor(tagValue / 8);
    const wire = tagValue % 8;
    if (field < 1) throw new HwtError(`protobuf: invalid field number ${field} at ${r.pos}`);
    const canonicalTag = encodeVarint(tagValue);
    const tagRaw = bytesEqual(canonicalTag, tag.raw) ? undefined : tag.raw.slice();
    const base = tagRaw ? { field, tagRaw } : { field };
    if (wire === 0) {
      const v = r.varint();
      const f: PbVarint = { ...base, wire: 0, value: v.value };
      if (!bytesEqual(encodeVarint(v.value), v.raw)) f.raw = v.raw.slice();
      fields.push(f);
    } else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      if (r.pos + n > end) throw new HwtError(`protobuf: truncated fixed field ${field} at ${r.pos}`);
      fields.push({ ...base, wire, bytes: bytes.slice(r.pos, r.pos + n) });
      r.pos += n;
    } else if (wire === 2) {
      const len = r.varint();
      const n = Number(len.value);
      if (typeof len.value === "bigint" || r.pos + n > end) throw new HwtError(`protobuf: field ${field} length ${len.value} overruns message at ${r.pos}`);
      const f: PbBytes = { ...base, wire: 2, bytes: bytes.slice(r.pos, r.pos + n) };
      if (!bytesEqual(encodeVarint(n), len.raw)) f.lenRaw = len.raw.slice();
      const fs = msgSchema?.fields[field];
      if (fs?.kind === "message" && fs.message) f.message = decodeRange(bytes, r.pos, r.pos + n, schema, fs.message, depth + 1);
      fields.push(f);
      r.pos += n;
    } else {
      throw new HwtError(`protobuf: unsupported wire type ${wire} (field ${field}) at ${r.pos}`);
    }
  }
  return { fields };
}

/** Decodes `bytes` as a message. With `schema` + `rootMessage`, fields the schema marks as messages are decoded recursively. */
export function decodePb(bytes: Uint8Array, schema?: PbSchema, rootMessage?: string): PbMessage {
  return decodeRange(bytes, 0, bytes.length, schema, rootMessage, 0);
}

export function encodePb(message: PbMessage): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of message.fields) {
    parts.push(f.tagRaw ?? encodeVarint(f.field * 8 + f.wire));
    if (f.wire === 0) {
      parts.push(f.raw ?? encodeVarint(f.value));
    } else if (f.wire === 2) {
      const payload = f.message ? encodePb(f.message) : f.bytes;
      parts.push(f.lenRaw ?? encodeVarint(payload.length), payload);
    } else {
      parts.push(f.bytes);
    }
  }
  return concat(parts);
}

/**
 * Best-effort structural guess for an undecoded length-delimited payload: returns a decoded message when the bytes
 * parse completely as protobuf, are non-empty, and do not look like printable text. Used for dumps of unknown fields.
 */
export function inferMessage(bytes: Uint8Array): PbMessage | undefined {
  if (bytes.length === 0) return undefined;
  if (bytes.every((b) => b >= 0x20 && b < 0x7f)) return undefined;
  try {
    const m = decodePb(bytes);
    for (const f of m.fields) if (f.field > 4096) return undefined;
    return m;
  } catch {
    return undefined;
  }
}

/**
 * Signed 32-bit interpretation of a varint. Handles both encodings found in samples: protobuf's own (negative int32 =
 * sign-extended 10 byte varint, a `bigint` here) and Huawei's `uint32` wrap (e.g. -6 stored as 4294967290).
 */
export function toInt32(value: number | bigint): number {
  if (typeof value === "bigint") return Number(BigInt.asIntN(64, value));
  return value >= 0x80000000 && value < 0x100000000 ? value - 0x100000000 : value;
}

/** Varint value for a signed number: `wrap32` stores it as uint32 two's complement, otherwise as a sign-extended 64-bit varint. */
export function fromInt32(value: number, wrap32: boolean): number | bigint {
  if (value >= 0) return value;
  return wrap32 ? value + 0x100000000 : BigInt.asUintN(64, BigInt(value));
}
