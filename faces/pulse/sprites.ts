/**
 * JoyoFit Pulse sprite catalogue.
 *
 * Every sprite is plain SVG in 1x watch pixels (a `viewBox` of its 1x size), rasterised with @resvg/resvg-js and the
 * Plus Jakarta Sans TTFs from @expo-google-fonts. `render(scale)` re-rasterises the same SVG at `scale`x, which build.ts
 * uses for the 2x store previews; the package itself only ever contains the 1x renders.
 *
 * Digit sets are tabular: one fixed cell per set (widest ink + padding), each glyph centred by its ink in the cell, so
 * a `Combined_Res` run of N digits is exactly N cells wide and columns never wobble between 11:11 and 08:08.
 */
import { Resvg } from "@resvg/resvg-js";
import type { RgbaImage } from "../../packages/hwt/src/index";
import { C, FONT, SIZE, STEPS_RING, TICK } from "./design";

const FONT_DIR = new URL("../../node_modules/@expo-google-fonts/plus-jakarta-sans/", import.meta.url).pathname;
const FONT_FILES = {
  800: `${FONT_DIR}800ExtraBold/PlusJakartaSans_800ExtraBold.ttf`,
  700: `${FONT_DIR}700Bold/PlusJakartaSans_700Bold.ttf`,
} as const;

export interface Sprite {
  name: string;
  /** 1x size in pixels. */
  w: number;
  h: number;
  /** Inner SVG markup in 1x coordinates. */
  svg: string;
  render(scale?: number): RgbaImage;
}

/** Rasterises full SVG markup. resvg returns premultiplied RGBA; `.hwt` images are straight alpha, so demultiply. */
export function rasterize(svg: string, width: number, height: number): RgbaImage {
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [FONT_FILES[800], FONT_FILES[700]],
      loadSystemFonts: false,
      defaultFontFamily: FONT.family,
    },
    textRendering: 2,
    shapeRendering: 2,
    fitTo: { mode: "original" },
  });
  const out = resvg.render();
  if (out.width !== width || out.height !== height) throw new Error(`rasterize: got ${out.width}x${out.height}, expected ${width}x${height}`);
  const src = out.pixels;
  const data = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3]!;
    if (a === 0) continue;
    if (a === 255) {
      data[i] = src[i]!;
      data[i + 1] = src[i + 1]!;
      data[i + 2] = src[i + 2]!;
      data[i + 3] = 255;
    } else {
      data[i] = Math.min(255, Math.round((src[i]! * 255) / a));
      data[i + 1] = Math.min(255, Math.round((src[i + 1]! * 255) / a));
      data[i + 2] = Math.min(255, Math.round((src[i + 2]! * 255) / a));
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

function sprite(name: string, w: number, h: number, svg: string): Sprite {
  return {
    name,
    w,
    h,
    svg,
    render(scale = 1) {
      const W = Math.round(w * scale);
      const H = Math.round(h * scale);
      return rasterize(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}">${svg}</svg>`, W, H);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Text measurement

interface TextStyle {
  weight: 700 | 800;
  size: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

function textAttrs(s: TextStyle): string {
  const fill = s.fill ?? "none";
  const stroke = s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth ?? 1}" stroke-linejoin="round"` : "";
  const opacity = s.opacity !== undefined ? ` opacity="${s.opacity}"` : "";
  return `font-family="${FONT.family}" font-weight="${s.weight}" font-size="${s.size}" fill="${fill}"${stroke}${opacity}`;
}

const DIGITS = "0123456789".split("");

interface Ink {
  /** Offsets from the text origin (x start, baseline), in 1x pixels; `top` is negative above the baseline. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MEASURE = 4;

function measureInk(text: string, style: TextStyle): Ink {
  const size = style.size;
  const W = Math.ceil(size * (text.length * 1.2 + 0.6));
  const H = Math.ceil(size * 1.8);
  const ox = size * 0.3;
  const base = size * 1.2;
  const probe: TextStyle = { ...style, fill: style.fill ?? "none", opacity: 1 };
  const img = rasterize(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * MEASURE}" height="${H * MEASURE}" viewBox="0 0 ${W} ${H}"><text x="${ox}" y="${base}" ${textAttrs({ ...probe, fill: "#fff", stroke: probe.stroke ? "#fff" : undefined })}>${text}</text></svg>`,
    W * MEASURE,
    H * MEASURE,
  );
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error(`measureInk: "${text}" renders nothing`);
  return {
    left: x0 / MEASURE - ox,
    right: (x1 + 1) / MEASURE - ox,
    top: y0 / MEASURE - base,
    bottom: (y1 + 1) / MEASURE - base,
  };
}

/** Cell geometry shared by every sprite of a text family: one baseline, one height, one width. */
interface Cell {
  w: number;
  h: number;
  /** Baseline y inside the cell. */
  baseline: number;
}

function cellFor(strings: readonly string[], style: TextStyle, pad: { x: number; y: number }, fixedWidth: boolean): { cell: Cell; inks: Map<string, Ink> } {
  const inks = new Map<string, Ink>();
  let top = Infinity,
    bottom = -Infinity,
    maxW = 0;
  for (const s of strings) {
    const ink = measureInk(s, style);
    inks.set(s, ink);
    top = Math.min(top, ink.top);
    bottom = Math.max(bottom, ink.bottom);
    if (s.length === 1 && DIGITS.includes(s)) maxW = Math.max(maxW, ink.right - ink.left);
  }
  const h = Math.ceil(bottom - top) + pad.y * 2;
  const baseline = pad.y + Math.ceil(-top);
  const w = fixedWidth ? Math.ceil(maxW) + pad.x * 2 : 0;
  return { cell: { w, h, baseline }, inks };
}


/** Ten tabular digit sprites (0-9) of one colour. */
function digitSet(
  prefix: string,
  style: TextStyle,
  pad: { x: number; y: number },
  extraForMetrics: readonly string[] = [],
  reuse?: { cell: Cell; inks: Map<string, Ink> },
): { sprites: Sprite[]; cell: Cell; inks: Map<string, Ink> } {
  const { cell, inks } = reuse ?? cellFor([...DIGITS, ...extraForMetrics], style, pad, true);
  const sprites = DIGITS.map((d) => {
    const ink = inks.get(d)!;
    const x = cell.w / 2 - (ink.left + ink.right) / 2;
    return sprite(`${prefix}${d}`, cell.w, cell.h, `<text x="${x.toFixed(3)}" y="${cell.baseline}" ${textAttrs(style)}>${d}</text>`);
  });
  return { sprites, cell, inks };
}

/** Sprites for words that all share one baseline/height; width is fixed per call, ink aligned `right`/`left`/`center`. */
function wordSet(prefix: string, words: readonly string[], style: TextStyle, cell: Cell, align: "left" | "right" | "center", pad: number, fixedWidth: number | null): Sprite[] {
  const inks = new Map(words.map((w) => [w, measureInk(w, style)]));
  const width = fixedWidth ?? Math.max(...words.map((w) => Math.ceil(inks.get(w)!.right - inks.get(w)!.left))) + pad * 2;
  return words.map((word, i) => {
    const ink = inks.get(word)!;
    const inkW = ink.right - ink.left;
    const x = align === "right" ? width - pad - ink.right : align === "left" ? pad - ink.left : (width - inkW) / 2 - ink.left;
    return sprite(`${prefix}${i}`, width, cell.h, `<text x="${x.toFixed(3)}" y="${cell.baseline}" ${textAttrs(style)}>${word}</text>`);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Icons (24 x 24 units)

const ICONS = {
  heart: (fill: string, pulse: string) =>
    `<path d="M12 20.6C5.2 15.4 2.8 12 2.8 8.7 2.8 6 4.9 4 7.5 4c1.8 0 3.4.9 4.5 2.4C13.1 4.9 14.7 4 16.5 4c2.6 0 4.7 2 4.7 4.7 0 3.3-2.4 6.7-9.2 11.9z" fill="${fill}"/>` +
    `<path d="M6.6 11.6h3l1.4-2.9 2.4 5.6 1.5-2.7h2.5" fill="none" stroke="${pulse}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  battery: (fill: string) =>
    `<rect x="1.6" y="5.6" width="17.6" height="12.8" rx="3.4" fill="none" stroke="${fill}" stroke-width="2"/>` +
    `<rect x="20.8" y="9.6" width="2" height="4.8" rx="1" fill="${fill}"/>` +
    `<path d="M11.4 7.6 7.4 12.9h3.4l-1 3.9 4.8-5.5h-3.4z" fill="${fill}"/>`,
  // Two footprints, the left one lower: sole + heel as separate rounded shapes.
  steps: (fill: string) =>
    `<g fill="${fill}"><ellipse cx="7.4" cy="13.6" rx="3.5" ry="4.8" transform="rotate(-8 7.4 13.6)"/><ellipse cx="6.8" cy="20.6" rx="2.6" ry="2.3"/>` +
    `<ellipse cx="16.6" cy="7.6" rx="3.5" ry="4.8" transform="rotate(8 16.6 7.6)"/><ellipse cx="17.2" cy="14.6" rx="2.6" ry="2.3"/></g>`,
} as const;

function iconSprite(name: string, size: number, body: string): Sprite {
  return {
    ...sprite(name, size, size, `<g transform="scale(${size / 24})">${body}</g>`),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Arc geometry

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
}

/** Clockwise arc from compass angle `a0` to `a1` (0 = 12 o'clock) as an SVG path. */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(3)} ${y0.toFixed(3)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalogue

export interface Catalogue {
  all: Sprite[];
  byName: Map<string, Sprite>;
  heroDigits: Sprite[];
  heroDigitsAod: Sprite[];
  heroCell: Cell;
  smallDigits: Sprite[];
  smallCell: Cell;
  stepsDigits: Sprite[];
  stepsCell: Cell;
  dateDigits: Sprite[];
  dateCell: Cell;
  /** Index 0 duplicates Monday (the watch's weekday 0 is unused), 1 = Monday .. 7 = Sunday. */
  weekdays: Sprite[];
  weekdayW: number;
  unitBpm: Sprite;
  unitPercent: Sprite;
  iconHeart: Sprite;
  iconBattery: Sprite;
  iconSteps: Sprite;
  chipHeart: Sprite;
  chipBattery: Sprite;
  ringTrack: Sprite;
  ringFill: Sprite;
  tick: Sprite;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function makeCatalogue(): Catalogue {
  const all: Sprite[] = [];
  const add = <T extends Sprite | Sprite[]>(s: T): T => {
    for (const x of Array.isArray(s) ? s : [s]) all.push(x);
    return s;
  };

  const heroStyle: TextStyle = { weight: 800, size: SIZE.hero, fill: C.ink };
  const hero = digitSet("hero-", heroStyle, { x: 3, y: 2 });
  const heroAodStyle: TextStyle = { weight: 800, size: SIZE.hero, stroke: C.aod, strokeWidth: SIZE.aodStroke };
  // Same cell and the same ink centres as the filled digits (the stroke only adds half its width around the glyph and fits
  // the padding), so one set of positions serves both display modes.
  const heroAod = digitSet("hero-aod-", heroAodStyle, { x: 3, y: 2 }, [], hero);

  const dateStyle: TextStyle = { weight: 700, size: SIZE.date, fill: C.ink };
  const dateDigits = digitSet("date-", dateStyle, { x: 1, y: 2 }, WEEKDAYS);
  const weekdayStyle: TextStyle = { weight: 700, size: SIZE.date, fill: C.muted };
  const weekdayW = 56;
  const weekdayWords = wordSet("weekday-", WEEKDAYS, weekdayStyle, dateDigits.cell, "right", 1, weekdayW);
  const weekdays = [weekdayWords[0]!, ...weekdayWords];

  const smallStyle: TextStyle = { weight: 700, size: SIZE.number, fill: C.ink };
  const small = digitSet("num-", smallStyle, { x: 1, y: 2 }, ["bpm", "%"]);
  const stepsStyle: TextStyle = { weight: 700, size: SIZE.stepsNumber, fill: C.ink };
  const stepsDigits = digitSet("steps-", stepsStyle, { x: 1, y: 2 });
  const unitStyle: TextStyle = { weight: 700, size: SIZE.unit, fill: C.muted };
  const [unitBpm] = wordSet("unit-bpm", ["bpm"], unitStyle, small.cell, "left", 1, null);
  const [unitPercent] = wordSet("unit-pct", ["%"], unitStyle, small.cell, "left", 1, null);

  const iconHeart = iconSprite("icon-heart", SIZE.icon, ICONS.heart(C.heart, C.heartSoft));
  const iconBattery = iconSprite("icon-battery", SIZE.icon, ICONS.battery(C.link));
  const iconSteps = iconSprite("icon-steps", SIZE.stepsIcon, ICONS.steps(C.steps));

  const { chipH, chipR } = SIZE;
  const chip = (name: string, w: number, fill: string) => sprite(name, w, chipH, `<rect width="${w}" height="${chipH}" rx="${chipR}" fill="${fill}"/>`);
  const chipHeart = chip("chip-heart", SIZE.chipHeartW, C.heartSoft);
  const chipBattery = chip("chip-battery", SIZE.chipBatteryW, C.linkSoft);

  const { size, radius, lineWidth, startAngle, endAngle } = STEPS_RING;
  const c = size / 2;
  const arcSvg = (stroke: string) => `<path d="${arcPath(c, c, radius, startAngle, endAngle)}" fill="none" stroke="${stroke}" stroke-width="${lineWidth}" stroke-linecap="round"/>`;
  const ringTrack = sprite("ring-track", size, size, arcSvg(C.stepsTrack));
  const ringFill = sprite("ring-fill", size, size, arcSvg(C.steps));

  const tick = sprite("tick-seconds", TICK.w, TICK.h, `<rect x="${(TICK.w - TICK.bar) / 2}" y="1" width="${TICK.bar}" height="${TICK.h - 2}" rx="${TICK.bar / 2}" fill="${C.ink}" fill-opacity="${TICK.opacity}"/>`);

  add(hero.sprites);
  add(heroAod.sprites);
  add(dateDigits.sprites);
  add(weekdayWords);
  add(small.sprites);
  add(stepsDigits.sprites);
  add([unitBpm!, unitPercent!, iconHeart, iconBattery, iconSteps, chipHeart, chipBattery, ringTrack, ringFill, tick]);

  return {
    all,
    byName: new Map(all.map((s) => [s.name, s])),
    heroDigits: hero.sprites,
    heroDigitsAod: heroAod.sprites,
    heroCell: hero.cell,
    smallDigits: small.sprites,
    smallCell: small.cell,
    stepsDigits: stepsDigits.sprites,
    stepsCell: stepsDigits.cell,
    dateDigits: dateDigits.sprites,
    dateCell: dateDigits.cell,
    weekdays,
    weekdayW,
    unitBpm: unitBpm!,
    unitPercent: unitPercent!,
    iconHeart,
    iconBattery,
    iconSteps,
    chipHeart,
    chipBattery,
    ringTrack,
    ringFill,
    tick,
  };
}
