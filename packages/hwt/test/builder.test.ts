import { describe, expect, test } from "bun:test";
import { HwtError, bytesEqual } from "../src/bytes";
import { addImage, addStaticImage, replaceImage, verifyWatchface } from "../src/builder";
import { FaceBuilder } from "../src/face";
import { createHwt, readHwt, writeHwt } from "../src/hwt";
import { decodeImage, encodeImage, readImageHeader, type RgbaImage } from "../src/image";
import { describeLayout, getLayout, readV1Elements, type NamedObject } from "../src/layout";
import { checkFit4Limits } from "../src/limits";
import { encodePb } from "../src/protobuf";
import { VALUE_TYPE } from "../src/valuetypes";
import { imageRef, parseWatchface, writeWatchface } from "../src/watchface";
import { fixtures, rng, solidImage } from "./helpers";

function gradient(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([x & 255, y & 255, (x + y) & 255, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

/** Vertical bands of flat colour: compresses like a typical designed background (a noisy gradient would exceed the 750 KB image limit). */
function banded(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([(x >> 5) * 20, (y >> 5) * 16, 64, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
function fixture(name: string): Uint8Array {
  return fixtures((n) => n === name)[0]!.bytes;
}

function list(value: unknown): NamedObject[] {
  return Array.isArray(value) ? value.filter((v): v is NamedObject => typeof v === "object" && v !== null && !Array.isArray(v)) : [];
}

describe("replace a background and add a static image (Fit 4 Pro sample)", () => {
  const original = readHwt(fixture("fit4pro/SpaceRed.hwt"));
  const before = original.watchface!;
  const beforeBytes = writeWatchface(before);
  const beforeReport = verifyWatchface(beforeBytes);

  const pkg = readHwt(fixture("fit4pro/SpaceRed.hwt"));
  const wf = pkg.watchface!;
  const background = gradient(408, 480);
  const icon = solidImage(40, 40, [255, 0, 0, 255]);
  const replaced = replaceImage(wf, 1, background);
  const iconIndex = addImage(wf, icon);
  addStaticImage(wf, { x: 10, y: 20, image: iconIndex });

  const out = writeHwt(pkg);
  const reread = readHwt(out);
  const wf2 = reread.watchface!;
  const bytes2 = writeWatchface(wf2);
  const report = verifyWatchface(bytes2);

  test("replacement reports the size change", () => {
    expect(replaced.previousSize).toEqual({ width: 408, height: 255 });
    expect(replaced.size).toEqual({ width: 408, height: 480 });
    expect(replaced.resized).toBe(true);
  });

  test("the edited face re-reads, is regular and consistent", () => {
    expect(report.problems).toEqual([]);
    expect(wf2.irregular).toBeUndefined();
    expect(bytesEqual(writeHwt(reread), out)).toBe(true);
  });

  test("table length grows by 8, bin length by the byte delta of the images, layout length by the inserted element", () => {
    const oldBg = before.images[1]!;
    const newBg = wf.images[1]!;
    expect(report.header.tableLen).toBe(beforeReport.header.tableLen + 8);
    expect(report.header.binLen).toBe(beforeReport.header.binLen + (newBg.length - oldBg.length) + wf.images[iconIndex]!.length);
    const layout = getLayout(wf2);
    const inserted = encodePb({ fields: [layout.root.fields[0]!] }).length;
    expect(report.header.layoutLen).toBe(beforeReport.header.layoutLen + inserted);
  });

  test("images: replaced one decodes to the new pixels, all other old images are byte-identical, new one is last", () => {
    expect(bytesEqual(decodeImage(wf2.images[1]!).data, background.data)).toBe(true);
    for (let i = 0; i < before.images.length; i++) {
      if (i === 1) continue;
      expect(bytesEqual(wf2.images[i]!, before.images[i]!)).toBe(true);
    }
    expect(wf2.images.length).toBe(before.images.length + 1);
    expect(readImageHeader(wf2.images[iconIndex]!)).toMatchObject({ width: 40, height: 40 });
  });

  test("the layout gained a BACKGROUND element at the bottom that points at the new slot; everything else is unchanged", () => {
    const named = describeLayout(getLayout(wf2));
    const beforeNamed = describeLayout(getLayout(before));
    const elements = list(named.element);
    expect(elements).toHaveLength(list(beforeNamed.element).length + 1);
    expect(elements[0]).toEqual({
      label: "ELEMENT_LABEL_BACKGROUND",
      is_support_option: false,
      res_preview: "",
      layer: [{ index: 0, draw_type: "DRAW_TYPE_SINGLE_RES", single_res: { res_name: imageRef(iconIndex), res_position: { x: 10, y: 20 }, ambient_mode: "NORMAL_ONLY" } }],
    });
    expect(elements.slice(1)).toEqual(list(beforeNamed.element));
  });

  test("the package still carries the original previews byte-for-byte", () => {
    for (const e of original.archive.entries) {
      if (e.name === "com.huawei.watchface") continue;
      expect(bytesEqual(reread.archive.entries.find((x) => x.name === e.name)!.data, e.data)).toBe(true);
    }
  });
});

describe("static images on version 1 layouts", () => {
  test("SimpleItalic: bottom insert adds an element plus the title pair; top insert appends", () => {
    const pkg = readHwt(fixture("unlicensed/SimpleItalic.hwt"));
    const wf = pkg.watchface!;
    const count = readV1Elements(getLayout(wf)).length;
    const idx = addImage(wf, solidImage(20, 20, [1, 2, 3, 255]));
    addStaticImage(wf, { x: 5, y: 6, image: idx });
    addStaticImage(wf, { x: 7, y: 8, image: imageRef(idx), position: "top" });
    const wf2 = parseWatchface(writeWatchface(wf));
    const els = readV1Elements(getLayout(wf2));
    expect(els).toHaveLength(count + 2);
    expect(els[0]).toEqual({ type: 0, kind: "image", image: imageRef(idx), x: 5, y: 6 });
    expect(els[els.length - 1]).toEqual({ type: 0, kind: "image", image: imageRef(idx), x: 7, y: 8 });
    const named = describeLayout(getLayout(wf2));
    expect(named.title_en).toEqual(Array((count + 2)).fill("SimpleItalic"));
    expect(verifyWatchface(writeWatchface(wf2)).problems).toEqual([]);
  });

  test("a face without a full-screen background gets one the way the research doc injects it (A.323 style: element first)", () => {
    const wf = readHwt(fixture("other/Unnamed.hwhd02.hwt")).watchface!;
    const idx = addImage(wf, solidImage(454, 454, [10, 10, 10, 255]));
    addStaticImage(wf, { x: 0, y: 0, image: idx });
    const els = readV1Elements(getLayout(parseWatchface(writeWatchface(wf))));
    expect(els.map((e) => e.kind)).toEqual(["image", "image"]);
    expect(els[0]).toMatchObject({ image: imageRef(idx) });
  });
});

describe("guards", () => {
  test("unknown slots are rejected", () => {
    const wf = readHwt(fixture("fit4pro/NikeCombo.hwt")).watchface!;
    expect(() => addStaticImage(wf, { x: 0, y: 0, image: 9999 })).toThrow(HwtError);
    expect(() => addStaticImage(wf, { x: 0, y: 0, image: "abc" })).toThrow(HwtError);
    expect(() => replaceImage(wf, -1, solidImage(1, 1, [0, 0, 0, 0]))).toThrow(/no image slot/);
  });

  test("raw blobs are accepted when valid and rejected when not", () => {
    const wf = readHwt(fixture("fit4pro/NikeCombo.hwt")).watchface!;
    const blob = encodeImage(solidImage(3, 3, [9, 8, 7, 255]));
    expect(addImage(wf, blob)).toBe(wf.images.length - 1);
    expect(() => addImage(wf, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/magic/);
  });

  test("an irregular image table round-trips and refuses image edits", () => {
    const wf = readHwt(fixture("fit4pro/NikeCombo.hwt")).watchface!;
    const bytes = writeWatchface(wf);
    const broken = bytes.slice();
    const view = new DataView(broken.buffer);
    view.setUint32(8, view.getUint32(8, true) + 4, true); // binLen no longer matches the file
    const irregular = parseWatchface(broken);
    expect(irregular.irregular).toBeDefined();
    expect(bytesEqual(writeWatchface(irregular), broken)).toBe(true);
    expect(() => addImage(irregular, solidImage(1, 1, [0, 0, 0, 0]))).toThrow(/irregular/);
    expect(verifyWatchface(broken).ok).toBe(false);
  });
});

describe("FaceBuilder: a face from scratch", () => {
  function digits(width: number, height: number, seed: number): RgbaImage[] {
    const rand = rng(seed);
    return Array.from({ length: 10 }, (_, d) => {
      const img = solidImage(width, height, [0, 0, 0, 0]);
      for (let i = 0; i < 40; i++) img.data.set([255, 255, 255, 255], 4 * Math.floor(rand() * width * height));
      img.data.set([d * 20, 255, 255, 255], 0);
      return img;
    });
  }

  const cover = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const pkg = createHwt({ title: "Scratch", author: "me", cover, aod: cover, iconSmall: cover });
  const face = new FaceBuilder(pkg.watchface!);
  const bg = banded(408, 480);
  const clock = digits(58, 96, 1);
  const small = digits(22, 36, 2);
  face.element("background", (e) => e.singleImage({ image: bg, x: 0, y: 0, ambient: "normal" }), { preview: bg });
  face.element("time", (e) => {
    e.digits({ digits: clock, x: 30, y: 100, align: "right", valueType: VALUE_TYPE.hour, ambient: "both" });
    e.digits({ digits: clock, x: 60, y: 100, align: "left", valueType: VALUE_TYPE.minute, ambient: "both" });
    e.hand({ image: solidImage(15, 200, [255, 0, 0, 255]), rect: { x: 100, y: 100, width: 92, height: 92 }, pivot: { x: 7, y: 46 }, startAngle: 0, endAngle: 360, valueType: VALUE_TYPE.secondRatio, ambient: "normal" });
  });
  face.element("date", (e) => {
    e.selected({ images: [null, ...Array.from({ length: 7 }, (_, i) => solidImage(30, 20, [i * 30, 0, 0, 255]))], x: 10, y: 10, valueType: VALUE_TYPE.week });
  });
  face.element("widget", (e) => {
    e.container(
      (c) => {
        c.digits({ digits: small, x: 351, y: 409, align: "right", valueType: VALUE_TYPE.power, sign: solidImage(20, 36, [255, 255, 255, 255]) });
        c.arc({ image: solidImage(100, 100, [0, 255, 0, 255]), rect: { x: -6, y: 26, width: 100, height: 100 }, center: { x: 50, y: 50 }, radius: 45, lineWidth: 8, startAngle: 0, endAngle: 360, valueType: VALUE_TYPE.powerRatio, cap: "round" });
      },
      { dataType: 17, rect: { x: 256, y: 368, width: 140, height: 100 } },
    );
  });
  face.commit();

  const out = writeHwt(pkg);
  const reread = readHwt(out);
  const wf = reread.watchface!;

  test("package layout: entries, description and first image slot (thumbnail)", () => {
    expect(reread.archive.entries.map((e) => e.name)).toEqual(["com.huawei.watchface", "description.xml", "preview/", "preview/aod.jpg", "preview/cover.jpg", "preview/icon_small.jpg"]);
    expect(reread.description).toMatchObject({ title: "Scratch", screen: "HWHD13", version: "2.1.1", author: "me", designer: "me" });
    expect(readImageHeader(wf.images[0]!)).toMatchObject({ width: 228, height: 269 });
    expect(wf.version).toBe(2);
  });

  test("consistent, regular and stable under another read/write", () => {
    expect(verifyWatchface(writeWatchface(wf)).problems).toEqual([]);
    expect(bytesEqual(writeHwt(reread), out)).toBe(true);
  });

  test("elements, layers and AOD duplication come out as built", () => {
    const named = describeLayout(getLayout(wf));
    const elements = list(named.element);
    expect(elements.map((e) => e.label)).toEqual(["ELEMENT_LABEL_BACKGROUND", "ELEMENT_LABEL_TIME", "ELEMENT_LABEL_DATE", "ELEMENT_LABEL_WIDGET"]);
    expect(named.title_en).toBe("Scratch");
    const time = list(elements[1]!.layer);
    expect(time.map((l) => l.draw_type)).toEqual(["DRAW_TYPE_COMBINED_RES", "DRAW_TYPE_COMBINED_RES", "DRAW_TYPE_HAND_RES", "DRAW_TYPE_COMBINED_RES", "DRAW_TYPE_COMBINED_RES"]);
    // like the samples: normal layers 0..2, always-on layers from 4 (one number skipped)
    expect(time.map((l) => l.index)).toEqual([0, 1, 2, 4, 5]);
    const modes = time.map((l) => {
      const body = l.combined_res ?? l.hand_res;
      return typeof body === "object" && body !== null && !Array.isArray(body) ? body.ambient_mode : undefined;
    });
    expect(modes).toEqual(["NORMAL_ONLY", "NORMAL_ONLY", "NORMAL_ONLY", "AMBIENT_ONLY", "AMBIENT_ONLY"]);
    expect(elements[0]!.res_preview).toBe(imageRef(1)); // same pixels as the background layer: one slot
    const container = list(elements[3]!.container)[0]!;
    expect(container).toMatchObject({ data_type: 17, rect: { x: 256, y: 368, width: 140, height: 100 } });
    const arc = list(container.layer)[1]!.arc_res;
    expect(arc).toMatchObject({ rect: { x: -6, y: 26, width: 100, height: 100 }, radius: 45, line_width: 8, cap_type: "ROUND", value_type: 163 });
  });

  test("identical images share one slot (digit sets reused by hour and minute and by AOD)", () => {
    // thumbnail + bg + 10 clock digits + hand + 7 weekdays (slot for null skipped) + 10 small digits + sign + arc = 32
    expect(wf.images.length).toBe(1 + 1 + 10 + 1 + 7 + 10 + 1 + 1);
  });

  test("limits report is clean for this face", () => {
    const bin = writeWatchface(wf);
    const report = checkFit4Limits(wf, bin.length, out.length);
    expect(report.problems).toEqual([]);
    expect(report.layerBytes).toBeGreaterThan(0);
  });

  test("argument errors are loud", () => {
    const f2 = new FaceBuilder(createHwt({ title: "x", cover }).watchface!);
    expect(() => f2.element("time", (e) => e.digits({ digits: clock.slice(0, 9), x: 0, y: 0, align: "left", valueType: 12 }))).toThrow(/10 images/);
    expect(() => f2.element("time", (e) => e.singleImage({ image: 99, x: 0, y: 0 }))).toThrow(/does not name an existing slot/);
    expect(() => new FaceBuilder(readHwt(fixture("unlicensed/SimpleItalic.hwt")).watchface!)).toThrow(/version 2/);
  });
});

describe("FaceBuilder reproduces a real element", () => {
  test("SpaceRed's TIME element (hour digits, colon, minute digits, AOD copies) rebuilt from the same image slots is identical", () => {
    const pkg = readHwt(fixture("fit4pro/SpaceRed.hwt"));
    const wf = pkg.watchface!;
    const original = list(describeLayout(getLayout(wf)).element)[3]!;
    expect(original.label).toBe("ELEMENT_LABEL_TIME");
    const layers = list(original.layer);
    const body = (i: number) => {
      const b = layers[i]![Object.keys(layers[i]!).find((k) => k !== "index" && k !== "draw_type")!];
      if (typeof b !== "object" || b === null || Array.isArray(b)) throw new Error("no body");
      return b;
    };
    const slot = (ref: unknown) => Number(ref) - 1;
    const refsOf = (v: unknown) => (Array.isArray(v) ? v.map((r) => slot(r)) : []);
    const hour = body(0);
    const colon = body(1);
    const minute = body(2);
    const face = new FaceBuilder(wf);
    const position = (b: typeof hour) => (typeof b.res_position === "object" && b.res_position !== null && !Array.isArray(b.res_position) ? b.res_position : { x: 0, y: 0 });
    const at = (b: typeof hour) => {
      const p = position(b);
      return { x: Number(p.x), y: Number(p.y) };
    };
    const alignOf = (b: typeof hour) => (String(b.res_align) === "RIGHT" ? "right" : String(b.res_align) === "CENTER" ? "center" : "left");
    face.element("time", (e) => {
      e.digits({ digits: refsOf(hour.res_name), ...at(hour), align: alignOf(hour), valueType: 12, ambient: "both" });
      e.singleImage({ image: slot(colon.res_name), ...at(colon), ambient: "both" });
      e.digits({ digits: refsOf(minute.res_name), ...at(minute), align: alignOf(minute), valueType: 13, ambient: "both" });
    });
    face.commit();
    const rebuilt = list(describeLayout(getLayout(wf)).element).at(-1)!;
    expect(String(hour.res_align)).toBe("LEFT");
    expect(rebuilt).toEqual(original);
    expect(wf.images.length).toBe(readHwt(fixture("fit4pro/SpaceRed.hwt")).watchface!.images.length); // no new images
  });
});
