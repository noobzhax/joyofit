import { describe, expect, test } from "bun:test";
import { bytesEqual } from "../src/bytes";
import { collectImageRefs, decodeLayout, describeLayout, encodeLayout, getLayout, readV1Elements, remapImageRefs, usedImageIndices, type NamedObject } from "../src/layout";
import { parsedFixtures } from "./helpers";

const all = parsedFixtures();
const sample = (name: string) => all.find((f) => f.name === name)!.pkg;

function list(value: unknown): NamedObject[] {
  return Array.isArray(value) ? value.filter((v): v is NamedObject => typeof v === "object" && v !== null && !Array.isArray(v)) : [];
}

describe("version 1 layouts (typed elements)", () => {
  test("SimpleItalic: 2 static images, 8 glyph tables, 1 hand", () => {
    const els = readV1Elements(getLayout(sample("unlicensed/SimpleItalic.hwt").watchface!));
    expect(els.map((e) => e.kind)).toEqual(["image", "image", "glyphs", "glyphs", "glyphs", "glyphs", "glyphs", "glyphs", "glyphs", "glyphs", "hand"]);
    expect(els[0]).toEqual({ type: 0, kind: "image", image: "002", x: 0, y: 0 });
    const hourHigh = els[2]!;
    expect(hourHigh).toMatchObject({ kind: "glyphs", x: 136, y: 100, valueType: 59 });
    if (hourHigh.kind === "glyphs") expect(hourHigh.table.slice(0, 4)).toEqual(["004", "005", "006", ""]);
    const hand = els[10]!;
    expect(hand).toMatchObject({ kind: "hand", image: "055", valueType: 154, startAngle: 0, endAngle: 360, pivot: { x: 13, y: 226 } });
  });

  test("Carrera: static background, 4 text labels, 6 hands with float angles", () => {
    const els = readV1Elements(getLayout(sample("unlicensed/Carrera.hwt").watchface!));
    expect(els.filter((e) => e.kind === "text")).toHaveLength(4);
    const hands = els.filter((e) => e.kind === "hand");
    expect(hands).toHaveLength(6);
    expect(hands[0]).toMatchObject({ startAngle: -150, endAngle: 150, valueType: 157 });
    expect(els.find((e) => e.kind === "text")).toMatchObject({ rect: { x: 107, y: 253, width: 33, height: 18 }, color: { red: 255, green: 255, blue: 255, alpha: 255 }, valueType: 134 });
  });

  test("every v1 element of every v1 sample is covered by the schema (unexplained: Text field 10 = 1, Glyphs field 4 = 5)", () => {
    for (const f of all.filter((x) => x.pkg.watchface!.version === 1)) {
      const unknown = new Set<string>();
      const walk = (o: unknown, path: string) => {
        if (Array.isArray(o)) o.forEach((x) => walk(x, path));
        else if (o && typeof o === "object") {
          for (const [k, v] of Object.entries(o)) {
            if (k === "$unknown" && Array.isArray(v)) for (const u of v) unknown.add(`${path}:${JSON.stringify(u)}`);
            else walk(v, `${path}.${k}`);
          }
        }
      };
      walk(describeLayout(getLayout(f.pkg.watchface!)), "");
      for (const u of unknown) expect(u).toMatch(/^\.element\.text:\{"field":10,"wire":0,"value":1\}$|^\.element\.glyphs:\{"field":4,"wire":0,"value":5\}$/);
    }
  });

  test("v1 root repeats the title strings after every element", () => {
    const named = describeLayout(getLayout(sample("unlicensed/SimpleItalic.hwt").watchface!));
    expect(list(named.element)).toHaveLength(11);
    expect(named.title_en).toEqual(Array(11).fill("SimpleItalic"));
  });
});

describe("version 2 layouts (named view)", () => {
  test("SpaceRed: BACKGROUND, WIDGET, DATE, TIME with the schema's names", () => {
    const named = describeLayout(getLayout(sample("fit4pro/SpaceRed.hwt").watchface!));
    expect(list(named.element).map((e) => e.label)).toEqual(["ELEMENT_LABEL_BACKGROUND", "ELEMENT_LABEL_WIDGET", "ELEMENT_LABEL_DATE", "ELEMENT_LABEL_TIME"]);
    expect(named.title_en).toBe("SpaceRed");
    const bg = list(list(named.element)[0]!.layer)[0]!;
    expect(bg).toEqual({
      index: 0,
      draw_type: "DRAW_TYPE_SINGLE_RES",
      single_res: { res_name: "002", res_position: { x: 0, y: 171 }, ambient_mode: "NORMAL_ONLY" },
    });
  });

  test("negative coordinates stored as uint32 read back signed", () => {
    const named = describeLayout(getLayout(sample("fit4pro/NikeCombo.hwt").watchface!));
    const json = JSON.stringify(named);
    expect(json).toContain('"x":-6');
    expect(json).not.toContain("4294967290");
  });

  test("every sample uses AMBIENT_ONLY layers for the always-on display and never AMBIENT_NORMAL", () => {
    const modes = new Set<string>();
    const walk = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
          if (k === "ambient_mode" && typeof v === "string") modes.add(v);
          else walk(v);
        }
      }
    };
    for (const f of all.filter((x) => x.name.startsWith("fit4pro/"))) walk(describeLayout(getLayout(f.pkg.watchface!)));
    expect([...modes].sort()).toEqual(["AMBIENT_ONLY", "NORMAL_ONLY"]);
  });
});

describe("image references", () => {
  test("slot 0 is never referenced by a layout; every reference points at an existing, non-empty slot", () => {
    for (const f of all) {
      const wf = f.pkg.watchface!;
      const layout = getLayout(wf);
      const used = usedImageIndices(layout);
      expect(used.includes(0)).toBe(false);
      for (const i of used) {
        expect(i).toBeLessThan(wf.images.length);
        expect(wf.images[i]!.length).toBeGreaterThan(0);
      }
      expect(used.length).toBeGreaterThan(0);
    }
  });

  test("remapImageRefs rewrites every reference and keeps the layout decodable", () => {
    const wf = sample("fit4pro/NikeCombo.hwt").watchface!;
    const layout = decodeLayout(wf.layout, wf.version);
    const before = collectImageRefs(layout).map((r) => r.ref);
    remapImageRefs(layout, (i) => i + 1);
    const after = collectImageRefs(decodeLayout(encodeLayout(layout), wf.version)).map((r) => r.ref);
    expect(after).toEqual(before.map((r) => String(Number(r) + 1).padStart(3, "0")));
    expect(bytesEqual(encodeLayout(layout), wf.layout)).toBe(false);
  });

  test("references seen in v1 and v2 samples are 3-digit decimal strings", () => {
    for (const f of all) for (const r of collectImageRefs(getLayout(f.pkg.watchface!))) expect(r.ref).toMatch(/^\d{3}$/);
  });
});
