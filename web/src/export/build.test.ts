import { mkdirSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import {
  FIT4_PREVIEW,
  FIT4_SCREEN,
  VALUE_TYPE,
  decodeImage,
  getEntry,
  getLayout,
  describeLayout,
  parseWatchface,
  readHwt,
  verifyWatchface,
  writeWatchface,
  type NamedObject,
} from "@joyofit/hwt";
import { describe, expect, it } from "vitest";
import { emptyProject, newDate, newHand, newImage, newRing, newTime, newWidget } from "@/model/defaults";
import type { Element, Project } from "@/model/types";
import { defaultSim } from "@/render/values";
import { TEMPLATES } from "@/templates";
import { registerTestAsset } from "@/test/node-canvas";
import { buildHwt } from "./build";

const out = process.env.RENDER_OUT;
const sim = defaultSim();

function list(value: unknown): NamedObject[] {
  return Array.isArray(value) ? (value as NamedObject[]) : [];
}

/** Every layer of the layout in file order, flattening containers, with the element label it sits in. */
function layers(bytes: Uint8Array): Array<{ label: string; layer: NamedObject }> {
  const pkg = readHwt(bytes);
  const named = describeLayout(getLayout(pkg.watchface!));
  const result: Array<{ label: string; layer: NamedObject }> = [];
  for (const element of list(named.element)) {
    const label = String(element.label);
    for (const layer of list(element.layer)) result.push({ label, layer });
    for (const container of list(element.container)) for (const layer of list(container.layer)) result.push({ label, layer });
  }
  return result;
}

function bodyOf(layer: NamedObject): NamedObject {
  const key = Object.keys(layer).find((k) => k !== "index" && k !== "draw_type")!;
  return layer[key] as NamedObject;
}

function withElements(elements: Element[]): Project {
  const base = emptyProject("Test face");
  return { ...base, elements: [base.elements[0]!, ...elements] };
}

describe("export assembly", () => {
  for (const template of TEMPLATES) {
    it(`${template.name}: re-reads with consistent header, image table and layout`, async () => {
      const project = await template.build();
      const result = await buildHwt(project, sim, { includeExperimental: true });
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/${result.fileName}`, result.bytes);
        writeFileSync(`${out}/${result.fileName}.layout.json`, JSON.stringify(result.debug, null, 2));
      }

      const pkg = readHwt(result.bytes);
      expect(pkg.description.screen).toBe(FIT4_SCREEN);
      expect(pkg.description.title).toBe(project.name);
      expect(getEntry(pkg, "preview/cover.jpg")?.length).toBeGreaterThan(1000);
      expect(getEntry(pkg, "preview/aod.jpg")?.length).toBeGreaterThan(500);
      expect(getEntry(pkg, "preview/icon_small.jpg")?.length).toBeGreaterThan(500);

      const wf = pkg.watchface!;
      const binary = writeWatchface(wf);
      const report = verifyWatchface(binary);
      expect(report.problems).toEqual([]);
      expect(report.header.tableLen).toBe(wf.images.length * 8);
      expect(report.images).toBe(wf.images.length);
      expect(parseWatchface(binary).images.length).toBe(wf.images.length);

      // Slot 0 is the picker thumbnail.
      const thumb = decodeImage(wf.images[0]!);
      expect({ w: thumb.width, h: thumb.height }).toEqual({ w: FIT4_PREVIEW.thumbnail.width, h: FIT4_PREVIEW.thumbnail.height });

      // Every image reference in the layout names a real slot and decodes.
      const refs = new Set<number>();
      for (const { layer } of layers(result.bytes)) {
        const body = bodyOf(layer);
        const names = ([] as string[]).concat((body.res_name as string[] | string | undefined) ?? [], (body.res_sign as string | undefined) ?? []);
        for (const ref of names) if (ref) refs.add(Number(ref) - 1);
      }
      expect(refs.size).toBeGreaterThan(0);
      for (const index of refs) {
        expect(index).toBeGreaterThan(0);
        const img = decodeImage(wf.images[index]!);
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
        expect(img.width).toBeLessThanOrEqual(816);
      }

      expect(result.stats.images).toBe(wf.images.length);
      expect(result.notes.filter((n) => n.level === "error")).toEqual([]);
    });
  }

  it("writes a time element as hour and minute digit sequences with ten 0-9 images", async () => {
    const result = await buildHwt(withElements([newTime({ x: 40, y: 120 })]), sim, { includeExperimental: false });
    const time = layers(result.bytes).filter(({ label, layer }) => label === "ELEMENT_LABEL_TIME" && layer.draw_type === "DRAW_TYPE_COMBINED_RES");
    const normal = time.filter(({ layer }) => bodyOf(layer).ambient_mode === "NORMAL_ONLY").map(({ layer }) => bodyOf(layer));
    expect(normal.map((b) => b.value_type)).toEqual([VALUE_TYPE.hour, VALUE_TYPE.minute]);
    for (const body of normal) {
      expect((body.res_name as string[]).length).toBe(10);
      expect(body.res_align).toBe("LEFT");
    }
    // The AOD copy exists too, with its own dimmed sprites.
    expect(time.some(({ layer }) => bodyOf(layer).ambient_mode === "AMBIENT_ONLY")).toBe(true);

    const wf = readHwt(result.bytes).watchface!;
    const sizes = new Set((normal[0]!.res_name as string[]).map((r) => { const i = decodeImage(wf.images[Number(r) - 1]!); return `${i.width}x${i.height}`; }));
    expect(sizes.size).toBe(1);
  });

  it("encodes weekday, day and month, and keeps seconds out unless unconfirmed elements are on", async () => {
    const date = newDate({ x: 60, y: 60, parts: ["weekday", "day", "month"] });
    const time = newTime({ showSeconds: true });
    const project = withElements([date, time]);

    const strict = await buildHwt(project, sim, { includeExperimental: false });
    const strictTypes = layers(strict.bytes).map(({ layer }) => bodyOf(layer).value_type);
    expect(strictTypes).toEqual(expect.arrayContaining([VALUE_TYPE.week, VALUE_TYPE.date, VALUE_TYPE.month]));
    expect(strictTypes).not.toContain(VALUE_TYPE.secondLow);
    expect(strict.elements.filter((e) => !e.exported).map((e) => e.id)).toEqual([time.id]);

    const loose = await buildHwt(project, sim, { includeExperimental: true });
    const looseTypes = layers(loose.bytes).map(({ layer }) => bodyOf(layer).value_type);
    expect(looseTypes).toEqual(expect.arrayContaining([VALUE_TYPE.week, VALUE_TYPE.date, VALUE_TYPE.month, VALUE_TYPE.secondHigh, VALUE_TYPE.secondLow]));
    const week = layers(loose.bytes).find(({ layer }) => bodyOf(layer).value_type === VALUE_TYPE.week)!;
    const monthLayer = layers(loose.bytes).find(({ layer }) => bodyOf(layer).value_type === VALUE_TYPE.month)!;
    expect((bodyOf(week.layer).res_name as string[]).length).toBe(8);
    expect((bodyOf(monthLayer.layer).res_name as string[]).length).toBe(13);
  });

  it("leaves preview-only elements out and says so", async () => {
    const calories = newWidget("calories");
    const ampm = newTime({ ampm: true, name: "Clock" });
    const result = await buildHwt(withElements([calories, ampm]), sim, { includeExperimental: true });
    const left = result.elements.find((e) => e.id === calories.id)!;
    expect(left.exported).toBe(false);
    expect(left.detail).toMatch(/Preview only/);
    const clock = result.elements.find((e) => e.id === ampm.id)!;
    expect(clock.exported).toBe(true);
    expect(clock.dropped.join(" ")).toMatch(/AM\/PM/);
    expect(layers(result.bytes).some(({ layer }) => bodyOf(layer).value_type === undefined && layer.draw_type === "DRAW_TYPE_SELECTED_RES")).toBe(false);
  });

  it("writes the second hand (verified id) in strict mode and leaves the inferred hour hand out", async () => {
    const hour = newHand("hour");
    const second = newHand("second");
    const strict = await buildHwt(withElements([hour, second]), sim, { includeExperimental: false });
    const ids = layers(strict.bytes).filter(({ layer }) => layer.draw_type === "DRAW_TYPE_HAND_RES").map(({ layer }) => bodyOf(layer).value_type);
    expect(ids).toEqual([VALUE_TYPE.secondRatio]);
    expect(strict.elements.find((e) => e.id === hour.id)!.exported).toBe(false);
  });

  it("builds hands whose rotation box is centred on the pivot", async () => {
    const hand = newHand("minute", { x: 204, y: 240, length: 150 });
    const result = await buildHwt(withElements([hand]), sim, { includeExperimental: true });
    const handLayer = layers(result.bytes).find(({ layer }) => layer.draw_type === "DRAW_TYPE_HAND_RES" && bodyOf(layer).ambient_mode === "NORMAL_ONLY")!;
    const body = bodyOf(handLayer.layer);
    const rect = body.rotate_rect as { x: number; y: number; width: number; height: number };
    const pivot = body.rotate_point_hand as { x: number; y: number };
    expect(body.value_type).toBe(VALUE_TYPE.minuteRatio);
    expect(rect.x + rect.width / 2).toBe(204);
    expect(rect.y + rect.height / 2).toBe(240);
    expect(rect.width / 2).toBe(pivot.y);
    const wf = readHwt(result.bytes).watchface!;
    const img = decodeImage(wf.images[Number(body.res_name) - 1]!);
    expect(pivot.x).toBeLessThan(img.width);
    expect(pivot.y).toBeLessThan(img.height);
  });

  it("builds a ring as a track image plus an arc layer with the sweep as angles", async () => {
    const ring = newRing("battery", { startAngle: 225, sweep: 270, size: 300, thickness: 12 });
    const result = await buildHwt(withElements([ring]), sim, { includeExperimental: true });
    const arc = layers(result.bytes).find(({ layer }) => layer.draw_type === "DRAW_TYPE_ARC_RES")!;
    const body = bodyOf(arc.layer);
    expect(body.value_type).toBe(VALUE_TYPE.powerRatio);
    expect(body.start_angle).toBe(225);
    expect(body.end_angle).toBe(495);
    expect(body.radius).toBe(144);
    expect(body.line_width).toBe(12);
  });

  it("crops images that hang off the screen instead of writing negative positions", async () => {
    await registerTestAsset("sticker", Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP4z8Dwn4EBCBgYGBgYGAAAFgAC/yvH4gAAAABJRU5ErkJggg==",
      "base64",
    ));
    const sticker = newImage("sticker", 100, 100, { x: -30, y: 20 });
    const result = await buildHwt(withElements([sticker]), sim, { includeExperimental: true });
    const single = layers(result.bytes).filter(({ layer }) => layer.draw_type === "DRAW_TYPE_SINGLE_RES");
    const placed = single.map(({ layer }) => bodyOf(layer).res_position as { x: number; y: number });
    expect(placed.every((p) => p.x >= 0 && p.y >= 0)).toBe(true);
  });

  it("splits a photo background that would exceed the single image limit into bands", async () => {
    const noise = createCanvas(480, 560);
    const nctx = noise.getContext("2d");
    const pixels = nctx.createImageData(480, 560);
    let seed = 12345;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >> 8) & 255;
      pixels.data[i + 2] = (seed >> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    nctx.putImageData(pixels, 0, 0);
    await registerTestAsset("noise", noise.toBuffer("image/png"));

    const project = withElements([]);
    project.elements[0] = { ...project.elements[0]!, fill: { kind: "image", assetId: "noise", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as Element;
    const result = await buildHwt(project, sim, { includeExperimental: true });
    const wf = readHwt(result.bytes).watchface!;
    expect(wf.images.every((b) => b.length <= 750 * 1024)).toBe(true);
    const normal = layers(result.bytes).filter(({ label, layer }) => label === "ELEMENT_LABEL_BACKGROUND" && bodyOf(layer).ambient_mode === "NORMAL_ONLY");
    expect(normal.length).toBeGreaterThanOrEqual(2);
    // The bands tile the whole screen: positions ascend and heights sum to 480.
    const rows = normal.map(({ layer }) => {
      const body = bodyOf(layer);
      const img = decodeImage(wf.images[Number(body.res_name) - 1]!);
      return { y: (body.res_position as { y: number }).y, h: img.height, w: img.width };
    });
    expect(rows[0]!.y).toBe(0);
    expect(rows.reduce((n, r) => n + r.h, 0)).toBe(480);
    expect(rows.every((r) => r.w === 408)).toBe(true);
    expect(result.notes.filter((n) => n.level === "error")).toEqual([]);
  });

  it("reports an element left out when it cannot be placed", async () => {
    const time = newTime({ x: -40, y: 100, name: "Clock" });
    const result = await buildHwt(withElements([time]), sim, { includeExperimental: true });
    const entry = result.elements.find((e) => e.id === time.id)!;
    expect(entry.exported).toBe(false);
    expect(result.notes.some((n) => n.level === "warning" && /Clock/.test(n.text))).toBe(true);
  });

  it("names the file with letters and digits only", async () => {
    const result = await buildHwt({ ...emptyProject("My cool face #1!"), name: "My cool face #1!" }, sim, { includeExperimental: true });
    expect(result.fileName).toBe("Mycoolface1.hwt");
  });
});
