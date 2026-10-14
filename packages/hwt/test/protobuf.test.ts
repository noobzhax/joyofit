import { describe, expect, test } from "bun:test";
import { HwtError, bytesEqual } from "../src/bytes";
import { buildMessage } from "../src/compose";
import { describeLayout, getLayout, schemaFor } from "../src/layout";
import { decodePb, encodePb, encodeVarint, fromInt32, inferMessage, toInt32, type PbField, type PbMessage } from "../src/protobuf";
import { SCHEMA_V2 } from "../src/schema-v2";
import { parsedFixtures, rng } from "./helpers";

function varintOf(m: PbMessage, index: number): number | bigint {
  const f = m.fields[index];
  if (!f || f.wire !== 0) throw new Error(`field ${index} is not a varint`);
  return f.value;
}
describe("varints", () => {
  test("canonical encodings", () => {
    expect([...encodeVarint(0)]).toEqual([0]);
    expect([...encodeVarint(127)]).toEqual([0x7f]);
    expect([...encodeVarint(128)]).toEqual([0x80, 0x01]);
    expect([...encodeVarint(300)]).toEqual([0xac, 0x02]);
    expect([...encodeVarint(2 ** 32 - 6)]).toEqual([0xfa, 0xff, 0xff, 0xff, 0x0f]);
    expect(encodeVarint(Number.MAX_SAFE_INTEGER).length).toBe(8);
    expect(encodeVarint(-1n).length).toBe(10);
  });

  test("non-canonical varints (tag, value, length) survive a round trip", () => {
    // field 1 varint with value 1 encoded as 0x81 0x00; tag encoded with a padding byte; length padded.
    const bytes = Uint8Array.from([0x88, 0x00, 0x81, 0x00, 0x12, 0x81, 0x00, 0x7a]);
    const m = decodePb(bytes);
    expect(m.fields[0]).toMatchObject({ field: 1, wire: 0, value: 1 });
    expect(m.fields[1]).toMatchObject({ field: 2, wire: 2 });
    expect(bytesEqual(encodePb(m), bytes)).toBe(true);
  });

  test("64-bit values and negative int32 (10 byte varint) keep their value", () => {
    const bytes = Uint8Array.from([0x08, 0xfb, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    const m = decodePb(bytes);
    const value = varintOf(m, 0);
    expect(typeof value).toBe("bigint");
    expect(toInt32(value)).toBe(-5);
    expect(bytesEqual(encodePb(m), bytes)).toBe(true);
    expect(fromInt32(-5, false)).toBe(BigInt.asUintN(64, -5n));
    expect(toInt32(fromInt32(-6, true))).toBe(-6);
    expect(fromInt32(-6, true)).toBe(4294967290);
  });

  test("malformed input throws HwtError", () => {
    expect(() => decodePb(Uint8Array.from([0x08]))).toThrow(HwtError); // truncated varint
    expect(() => decodePb(Uint8Array.from([0x12, 0x05, 0x61]))).toThrow(HwtError); // length overruns
    expect(() => decodePb(Uint8Array.from([0x0b]))).toThrow(/wire type/); // group
    expect(() => decodePb(Uint8Array.from([0x00, 0x00]))).toThrow(/field number/);
    expect(() => decodePb(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]))).toThrow(HwtError);
  });
});

function randomMessage(rand: () => number, depth: number): PbMessage {
  const fields: PbField[] = [];
  const n = Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    const field = 1 + Math.floor(rand() * 40);
    const kind = rand();
    if (kind < 0.35) fields.push({ field, wire: 0, value: Math.floor(rand() * 2 ** 40) });
    else if (kind < 0.45) fields.push({ field, wire: 5, bytes: Uint8Array.from({ length: 4 }, () => Math.floor(rand() * 256)) });
    else if (kind < 0.5) fields.push({ field, wire: 1, bytes: Uint8Array.from({ length: 8 }, () => Math.floor(rand() * 256)) });
    else if (kind < 0.75 || depth === 0) fields.push({ field, wire: 2, bytes: Uint8Array.from({ length: Math.floor(rand() * 200), }, () => 0x20 + Math.floor(rand() * 90)) });
    else {
      const inner = randomMessage(rand, depth - 1);
      fields.push({ field, wire: 2, bytes: encodePb(inner) });
    }
  }
  return { fields };
}

describe("tree round trip", () => {
  test("500 random messages (all wire types, nested, repeated and duplicate fields) re-encode identically", () => {
    const rand = rng(99);
    for (let i = 0; i < 500; i++) {
      const bytes = encodePb(randomMessage(rand, 3));
      const tree = decodePb(bytes);
      expect(bytesEqual(encodePb(tree), bytes)).toBe(true);
    }
  });

  test("inferMessage finds nested messages and skips text", () => {
    const inner = encodePb({ fields: [{ field: 1, wire: 0, value: 150 }, { field: 2, wire: 2, bytes: Uint8Array.from([0x61, 0x62]) }] });
    expect(inferMessage(inner)?.fields.length).toBe(2);
    expect(inferMessage(new TextEncoder().encode("SimpleItalic"))).toBeUndefined();
    expect(inferMessage(new Uint8Array(0))).toBeUndefined();
  });

  test("every layout of every sample round-trips through the generic tree and through its schema", () => {
    for (const f of parsedFixtures()) {
      const wf = f.pkg.watchface!;
      const generic = decodePb(wf.layout);
      expect(bytesEqual(encodePb(generic), wf.layout)).toBe(true);
      const schemaTree = getLayout(wf);
      expect(bytesEqual(encodePb(schemaTree.root), wf.layout)).toBe(true);
    }
  });
});

describe("version 2 schema", () => {
  const WIRE: Record<string, number> = { varint: 0, bool: 0, enum: 0, int32: 0, int32w: 0, string: 2, bytes: 2, message: 2, float: 5 };

  function check(m: PbMessage, name: string, path: string, problems: string[]): void {
    const ms = SCHEMA_V2.messages[name]!;
    for (const f of m.fields) {
      const fs = ms.fields[f.field];
      if (!fs) problems.push(`${path}: unknown field ${f.field}/${f.wire}`);
      else if (WIRE[fs.kind] !== f.wire) problems.push(`${path}.${fs.name}: wire ${f.wire} but schema says ${fs.kind}`);
      else if (f.wire === 2 && fs.kind === "message") {
        if (!f.message) problems.push(`${path}.${fs.name}: message not decoded`);
        else check(f.message, fs.message!, `${name}.${fs.name}`, problems);
      }
    }
  }

  test("covers every field of every version 2 sample (no unknown field numbers, no wire-type mismatches)", () => {
    let checked = 0;
    for (const f of parsedFixtures()) {
      const wf = f.pkg.watchface!;
      if (wf.version !== 2) continue;
      checked++;
      const problems: string[] = [];
      check(getLayout(wf).root, "Watchface", "root", problems);
      expect(problems).toEqual([]);
      expect(JSON.stringify(describeLayout(getLayout(wf)))).not.toContain("$unknown");
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  test("named JSON -> protobuf reproduces every version 2 layout byte-for-byte", () => {
    const { schema, root } = schemaFor("v2");
    for (const f of parsedFixtures()) {
      const wf = f.pkg.watchface!;
      if (wf.version !== 2) continue;
      const named = describeLayout(getLayout(wf));
      expect(bytesEqual(encodePb(buildMessage(schema, root, named)), wf.layout)).toBe(true);
    }
  });

  test("composer rejects unknown fields, bad enums and out of range values", () => {
    const { schema } = schemaFor("v2");
    expect(() => buildMessage(schema, "Point", { x: 1, z: 2 })).toThrow(/unknown field z/);
    expect(() => buildMessage(schema, "Element", { label: "NOPE", is_support_option: false })).toThrow(/enum/);
    expect(() => buildMessage(schema, "Hand_Res", { rotate_start_angel: 2 ** 31 })).toThrow(/int32/);
    const neg = buildMessage(schema, "Point", { x: -6, y: 0 });
    expect(neg.fields[0]).toMatchObject({ field: 1, wire: 0, value: 4294967290 }); // Huawei stores negatives as uint32
    const angle = buildMessage(schema, "Hand_Res", { rotate_start_angel: -140 });
    expect(typeof varintOf(angle, 0)).toBe("bigint"); // protobuf int32: 10 byte varint
  });
});
