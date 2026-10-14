/**
 * Layout simulator: draws a `.hwt` the way the watch is documented to, using ONLY the package (layout + image blobs).
 * It never looks at the design source, so a wrong image reference, position, value type or ambient mode shows up here.
 *
 *   bun faces/pulse/simulate.ts [file.hwt] [--out /tmp/pulse-sim.png] [--seconds 25]
 *
 * Draw rules implemented (all as read from the fixtures, see packages/hwt/README.md):
 *  - Elements in file order; inside an element `layer[]` then `container[]` (each container's `layer[]`).
 *  - Normal display = `NORMAL_ONLY` layers, always-on display = `AMBIENT_ONLY` layers.
 *  - `SINGLE_RES` at (x, y) top-left. `SELECTED_RES`: image `res_name[value]`. `COMBINED_RES`: digits of the value, 2-digit
 *    zero padded for hour/minute, aligned LEFT/CENTER/RIGHT on x, y = top. `ARC_RES`: the image is revealed as a sector
 *    around `center_point` (compass degrees, 0 = 12 o'clock, clockwise) from `start_angle` towards `end_angle` by the ratio.
 *    `HAND_RES`: the image rotates about `rotate_point_hand` (a point in image coordinates), which sits on the centre of
 *    `rotate_rect`, by start + (end - start) * ratio degrees clockwise.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodeImage, describeLayout, encodePng, getLayout, imageIndex, readHwt, type NamedObject, type RgbaImage, type WatchfaceBinary } from "../../packages/hwt/src/index";

export interface SampleData {
  hour: number;
  minute: number;
  second: number;
  day: number;
  /** 1 = Monday .. 7 = Sunday (the order of the fixtures' week glyph tables). */
  weekday: number;
  steps: number;
  stepsGoal: number;
  heartRate: number;
  battery: number;
}

export const SAMPLE: SampleData = { hour: 10, minute: 9, second: 25, day: 14, weekday: 3, steps: 6420, stepsGoal: 8000, heartRate: 72, battery: 81 };

export interface RenderOptions {
  mode?: "normal" | "aod";
  data?: SampleData;
  /** Output scale; positions are multiplied, so `images` must then supply `scale`x sprites. */
  scale?: number;
  /** Image source by 0-based slot index. Default: decode the blob from the package. */
  images?: (index: number) => RgbaImage;
}

const RAW: Record<number, (d: SampleData) => number> = {
  12: (d) => d.hour,
  13: (d) => d.minute,
  17: (d) => d.day,
  52: (d) => d.weekday,
  0: (d) => d.steps,
  2: (d) => d.heartRate,
  9: (d) => d.battery,
};
const RATIO: Record<number, (d: SampleData) => number> = {
  154: (d) => d.second / 60,
  161: (d) => Math.min(1, d.steps / d.stepsGoal),
};
const PADDED_TWO = new Set([12, 13]);

function asList(v: unknown): NamedObject[] {
  return Array.isArray(v) ? (v as NamedObject[]) : [];
}
const num = (v: unknown): number => Number(v ?? 0);
const point = (v: unknown): { x: number; y: number } => {
  const o = (v ?? {}) as NamedObject;
  return { x: num(o.x), y: num(o.y) };
};
const rectOf = (v: unknown): { x: number; y: number; width: number; height: number } => {
  const o = (v ?? {}) as NamedObject;
  return { x: num(o.x), y: num(o.y), width: num(o.width), height: num(o.height) };
};

export interface FaceSurface {
  width: number;
  height: number;
  /** Opaque RGBA, straight (alpha is always 255). */
  data: Uint8Array;
}

function over(dst: Uint8Array, di: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  if (a >= 255) {
    dst[di] = r;
    dst[di + 1] = g;
    dst[di + 2] = b;
    return;
  }
  const t = a / 255;
  dst[di] = Math.round(r * t + dst[di]! * (1 - t));
  dst[di + 1] = Math.round(g * t + dst[di + 1]! * (1 - t));
  dst[di + 2] = Math.round(b * t + dst[di + 2]! * (1 - t));
}

function blit(s: FaceSurface, img: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < img.height; y++) {
    const sy = dy + y;
    if (sy < 0 || sy >= s.height) continue;
    for (let x = 0; x < img.width; x++) {
      const sx = dx + x;
      if (sx < 0 || sx >= s.width) continue;
      const si = (y * img.width + x) * 4;
      over(s.data, (sy * s.width + sx) * 4, img.data[si]!, img.data[si + 1]!, img.data[si + 2]!, img.data[si + 3]!);
    }
  }
}

function blitSector(s: FaceSurface, img: RgbaImage, dx: number, dy: number, cx: number, cy: number, start: number, end: number, ratio: number): void {
  const dir = end >= start ? 1 : -1;
  const limit = Math.abs(end - start) * Math.min(1, Math.max(0, ratio));
  for (let y = 0; y < img.height; y++) {
    const sy = dy + y;
    if (sy < 0 || sy >= s.height) continue;
    for (let x = 0; x < img.width; x++) {
      const sx = dx + x;
      if (sx < 0 || sx >= s.width) continue;
      const si = (y * img.width + x) * 4;
      const a = img.data[si + 3]!;
      if (a === 0) continue;
      const vx = x + 0.5 - cx;
      const vy = y + 0.5 - cy;
      const ang = ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360;
      const t = dir > 0 ? (ang - start + 720) % 360 : (start - ang + 720) % 360;
      const r = Math.hypot(vx, vy);
      const cover = Math.min(1, Math.max(0, ((limit - t) * Math.PI * r) / 180 + 0.5));
      if (cover <= 0) continue;
      over(s.data, (sy * s.width + sx) * 4, img.data[si]!, img.data[si + 1]!, img.data[si + 2]!, a * cover);
    }
  }
}

function blitRotated(s: FaceSurface, img: RgbaImage, pivotX: number, pivotY: number, cx: number, cy: number, deg: number): void {
  const th = (deg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const reach = Math.ceil(Math.hypot(Math.max(pivotX, img.width - pivotX), Math.max(pivotY, img.height - pivotY))) + 2;
  const x0 = Math.floor(cx) - reach;
  const y0 = Math.floor(cy) - reach;
  for (let y = y0; y <= y0 + reach * 2; y++) {
    if (y < 0 || y >= s.height) continue;
    for (let x = x0; x <= x0 + reach * 2; x++) {
      if (x < 0 || x >= s.width) continue;
      const ux = x + 0.5 - cx;
      const uy = y + 0.5 - cy;
      const sx = ux * cos + uy * sin + pivotX - 0.5;
      const sy = -ux * sin + uy * cos + pivotY - 0.5;
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      let pr = 0,
        pg = 0,
        pb = 0,
        pa = 0;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const px = ix + i;
          const py = iy + j;
          if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
          const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
          const k = (py * img.width + px) * 4;
          const a = (img.data[k + 3]! / 255) * w;
          pr += img.data[k]! * a;
          pg += img.data[k + 1]! * a;
          pb += img.data[k + 2]! * a;
          pa += a;
        }
      }
      if (pa <= 0) continue;
      over(s.data, (y * s.width + x) * 4, pr / pa, pg / pa, pb / pa, pa * 255);
    }
  }
}

/** Renders one display mode of a parsed watch face binary onto a black surface. Throws on anything it does not know. */
export function renderFace(wf: WatchfaceBinary, options: RenderOptions = {}): FaceSurface {
  const mode = options.mode ?? "normal";
  const data = options.data ?? SAMPLE;
  const k = options.scale ?? 1;
  const want = mode === "normal" ? "NORMAL_ONLY" : "AMBIENT_ONLY";
  const cache = new Map<number, RgbaImage>();
  const image = (ref: unknown): RgbaImage => {
    const idx = imageIndex(String(ref));
    let img = cache.get(idx);
    if (!img) {
      if (!wf.images[idx]?.length) throw new Error(`layer references empty/missing image slot ${String(ref)}`);
      img = options.images ? options.images(idx) : decodeImage(wf.images[idx]!);
      cache.set(idx, img);
    }
    return img;
  };

  const width = Math.round(408 * k);
  const height = Math.round(480 * k);
  const surface: FaceSurface = { width, height, data: new Uint8Array(width * height * 4) };
  for (let i = 3; i < surface.data.length; i += 4) surface.data[i] = 255;

  const raw = (vt: number): number => {
    const f = RAW[vt];
    if (!f) throw new Error(`simulator has no data for value_type ${vt}`);
    return f(data);
  };
  const ratio = (vt: number): number => {
    const f = RATIO[vt];
    if (!f) throw new Error(`simulator has no ratio for value_type ${vt}`);
    return f(data);
  };

  const draw = (layer: NamedObject): void => {
    if (layer.draw_type === undefined) throw new Error("layer without draw_type");
    switch (layer.draw_type) {
      case "DRAW_TYPE_SINGLE_RES": {
        const b = layer.single_res as NamedObject;
        if (b.ambient_mode !== want) return;
        const p = point(b.res_position);
        blit(surface, image(b.res_name), Math.round(p.x * k), Math.round(p.y * k));
        return;
      }
      case "DRAW_TYPE_SELECTED_RES": {
        const b = layer.selected_res as NamedObject;
        if (b.ambient_mode !== want) return;
        const names = b.res_name as string[];
        const v = raw(num(b.value_type));
        const ref = names[v];
        if (ref === undefined) throw new Error(`selected_res value ${v} outside ${names.length} images`);
        if (ref === "") return;
        const p = point(b.res_position);
        blit(surface, image(ref), Math.round(p.x * k), Math.round(p.y * k));
        return;
      }
      case "DRAW_TYPE_COMBINED_RES": {
        const b = layer.combined_res as NamedObject;
        if (b.ambient_mode !== want) return;
        const vt = num(b.value_type);
        const names = b.res_name as string[];
        if (names.length !== 10) throw new Error(`combined_res needs 10 digit images, has ${names.length}`);
        let text = String(Math.abs(raw(vt)));
        if (PADDED_TWO.has(vt)) text = text.padStart(2, "0");
        const imgs = [...text].map((ch) => image(names[Number(ch)]));
        const total = imgs.reduce((n, im) => n + im.width, 0);
        const p = point(b.res_position);
        const align = String(b.res_align);
        let x = Math.round(p.x * k);
        if (align === "RIGHT") x -= total;
        else if (align === "CENTER") x -= Math.round(total / 2);
        else if (align !== "LEFT") throw new Error(`unknown res_align ${align}`);
        for (const im of imgs) {
          blit(surface, im, x, Math.round(p.y * k));
          x += im.width;
        }
        return;
      }
      case "DRAW_TYPE_ARC_RES": {
        const b = layer.arc_res as NamedObject;
        if (b.ambient_mode !== want) return;
        const r = rectOf(b.rect);
        const c = point(b.center_point);
        blitSector(surface, image(b.res_name), Math.round(r.x * k), Math.round(r.y * k), c.x * k, c.y * k, num(b.start_angle), num(b.end_angle), ratio(num(b.value_type)));
        return;
      }
      case "DRAW_TYPE_HAND_RES": {
        const b = layer.hand_res as NamedObject;
        if (b.ambient_mode !== want) return;
        const r = rectOf(b.rotate_rect);
        const pv = point(b.rotate_point_hand);
        const start = num(b.rotate_start_angel);
        const end = num(b.rotate_end_angel);
        const deg = start + (end - start) * ratio(num(b.value_type));
        blitRotated(surface, image(b.res_name), pv.x * k, pv.y * k, (r.x + r.width / 2) * k, (r.y + r.height / 2) * k, deg);
        return;
      }
      default:
        throw new Error(`simulator does not know ${String(layer.draw_type)}`);
    }
  };

  const named = describeLayout(getLayout(wf));
  for (const element of asList(named.element)) {
    for (const layer of asList(element.layer)) draw(layer);
    for (const container of asList(element.container)) for (const layer of asList(container.layer)) draw(layer);
  }
  return surface;
}

/** Share of pixels that are not pure black. */
export function litFraction(s: FaceSurface): number {
  let lit = 0;
  for (let i = 0; i < s.data.length; i += 4) if (s.data[i]! | s.data[i + 1]! | s.data[i + 2]!) lit++;
  return lit / (s.width * s.height);
}

export function toPng(s: FaceSurface): Uint8Array {
  return encodePng({ width: s.width, height: s.height, data: s.data });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--"))) ?? new URL("./dist/JoyoFitPulse.hwt", import.meta.url).pathname;
  const out = flag("--out") ?? "/tmp/pulse-sim.png";
  const data: SampleData = { ...SAMPLE, second: Number(flag("--seconds") ?? SAMPLE.second) };
  const pkg = readHwt(new Uint8Array(readFileSync(file)));
  const wf = pkg.watchface!;
  const normal = renderFace(wf, { mode: "normal", data });
  const aod = renderFace(wf, { mode: "aod", data });
  const gap = 24;
  const sheet: FaceSurface = { width: normal.width * 2 + gap, height: normal.height, data: new Uint8Array((normal.width * 2 + gap) * normal.height * 4) };
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
  for (let y = 0; y < normal.height; y++) {
    for (let x = 0; x < normal.width; x++) {
      const a = (y * normal.width + x) * 4;
      const n = (y * sheet.width + x) * 4;
      const o = (y * sheet.width + normal.width + gap + x) * 4;
      for (let c = 0; c < 3; c++) {
        sheet.data[n + c] = normal.data[a + c]!;
        sheet.data[o + c] = aod.data[a + c]!;
      }
    }
  }
  writeFileSync(out, toPng(sheet));
  writeFileSync(out.replace(/\.png$/, "-normal.png"), toPng(normal));
  writeFileSync(out.replace(/\.png$/, "-aod.png"), toPng(aod));
  console.log(`simulated ${file} -> ${out} (left: normal, right: AOD); also ${out.replace(/\.png$/, "-normal.png")}, ${out.replace(/\.png$/, "-aod.png")}`);
  console.log(`sample: ${JSON.stringify(data)}`);
  console.log(`lit pixels: normal ${(litFraction(normal) * 100).toFixed(1)}%, AOD ${(litFraction(aod) * 100).toFixed(2)}%`);
}
