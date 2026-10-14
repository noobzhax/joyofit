/**
 * Inverse of `namedMessage`: builds a protobuf tree from a schema-named plain object.
 *
 * Fields are emitted in ascending field-number order with repeated values grouped, which is how the vendor tool
 * writes them (every v2 sample re-composes byte-identically; see test/layout.test.ts).
 */
import { HwtError, utf8Encode } from "./bytes";
import { encodePb, fromInt32, type PbField, type PbFieldSchema, type PbMessage, type PbSchema } from "./protobuf";
import type { NamedObject, NamedValue } from "./layout";

function enumNumber(schema: PbSchema, fs: PbFieldSchema, value: NamedValue): number {
  if (typeof value === "number") return value;
  const names = fs.enum ? schema.enums[fs.enum] : undefined;
  if (typeof value === "string" && names) {
    for (const [n, name] of Object.entries(names)) if (name === value) return Number(n);
  }
  throw new HwtError(`field ${fs.name}: ${JSON.stringify(value)} is not a value of enum ${fs.enum}`);
}

function toField(schema: PbSchema, number: number, fs: PbFieldSchema, value: NamedValue): PbField {
  switch (fs.kind) {
    case "varint": {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new HwtError(`field ${fs.name}: expected unsigned integer, got ${JSON.stringify(value)}`);
      return { field: number, wire: 0, value };
    }
    case "int32":
    case "int32w": {
      if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new HwtError(`field ${fs.name}: expected int32, got ${JSON.stringify(value)}`);
      return { field: number, wire: 0, value: fromInt32(value, fs.kind === "int32w") };
    }
    case "bool":
      if (typeof value !== "boolean") throw new HwtError(`field ${fs.name}: expected boolean`);
      return { field: number, wire: 0, value: value ? 1 : 0 };
    case "enum":
      return { field: number, wire: 0, value: enumNumber(schema, fs, value) };
    case "string":
      if (typeof value !== "string") throw new HwtError(`field ${fs.name}: expected string`);
      return { field: number, wire: 2, bytes: utf8Encode(value) };
    case "bytes":
      throw new HwtError(`field ${fs.name}: bytes fields cannot be composed from named values`);
    case "float": {
      if (typeof value !== "number") throw new HwtError(`field ${fs.name}: expected number`);
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setFloat32(0, value, true);
      return { field: number, wire: 5, bytes };
    }
    case "message": {
      if (typeof value !== "object" || value === null || Array.isArray(value) || !fs.message) throw new HwtError(`field ${fs.name}: expected object`);
      const message = buildMessage(schema, fs.message, value);
      return { field: number, wire: 2, bytes: encodePb(message), message };
    }
  }
}

/** Builds a message from `value`; unknown keys are an error (typos must not silently vanish). */
export function buildMessage(schema: PbSchema, name: string, value: NamedObject): PbMessage {
  const ms = schema.messages[name];
  if (!ms) throw new HwtError(`unknown message ${name}`);
  const known = new Map(Object.entries(ms.fields).map(([n, fs]) => [fs.name, Number(n)]));
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new HwtError(`${name}: unknown field ${key}`);
  }
  const fields: PbField[] = [];
  const numbers = Object.keys(ms.fields)
    .map(Number)
    .sort((a, b) => a - b);
  for (const n of numbers) {
    const fs = ms.fields[n]!;
    const v = value[fs.name];
    if (v === undefined) continue;
    if (fs.repeated) {
      if (!Array.isArray(v)) throw new HwtError(`${name}.${fs.name}: expected array`);
      for (const item of v) fields.push(toField(schema, n, fs, item));
    } else {
      fields.push(toField(schema, n, fs, v));
    }
  }
  return { fields };
}
