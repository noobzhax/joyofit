import type { FontRef, Outline } from "@/model/types";
import { fontCss, fontReady } from "./fonts";
import { context2d, createSurface, newSprite, type Ctx2D, type Sprite } from "./canvas";

/**
 * Glyph sprites: the digit images, colons and word images a watch face is made of. The preview draws
 * exactly these bitmaps, and the exporter encodes exactly these bitmaps, so what the editor shows is
 * what the watch is given.
 */

export interface GlyphStyle {
  font: FontRef;
  /** Height of a digit's ink, in px. */
  digitHeight: number;
  color: string;
  outline: Outline;
  /**
   * Extra px between digits. A digit sequence on the watch advances by each image's width and has no spacing
   * setting, so tracking is baked into the digit images (padding for positive values, trimming for negative ones).
   */
  tracking?: number;
}

export interface DigitSet {
  /** Every digit sprite has this size (tabular figures), so a digit sequence has one cell width. */
  cellW: number;
  cellH: number;
  /** Baseline offset inside a cell, px from the top. */
  baseline: number;
  digits: Sprite[];
  colon: Sprite;
}

export interface WordSet {
  cellW: number;
  cellH: number;
  baseline: number;
  words: Map<string, Sprite>;
}

const REF_SIZE = 200;
const ratioCache = new Map<string, { asc: number; desc: number }>();

function fontString(font: FontRef, px: number): string {
  return `${font.weight} ${px}px "${font.family}"`;
}

/** Ink ascent/descent of the digits per 1px of font size. */
function digitRatio(font: FontRef): { asc: number; desc: number } {
  const key = `${font.family}@${font.weight}`;
  const hit = ratioCache.get(key);
  if (hit) return hit;
  const ctx = context2d(createSurface(8, 8));
  ctx.font = fontString(font, REF_SIZE);
  let asc = 0;
  let desc = 0;
  for (const d of "0123456789") {
    const m = ctx.measureText(d);
    asc = Math.max(asc, m.actualBoundingBoxAscent);
    desc = Math.max(desc, m.actualBoundingBoxDescent);
  }
  const ratio = { asc: asc / REF_SIZE, desc: desc / REF_SIZE };
  if (fontReady(font)) ratioCache.set(key, ratio);
  return ratio;
}

export function fontSizeForDigitHeight(font: FontRef, digitHeight: number): number {
  const { asc, desc } = digitRatio(font);
  return digitHeight / Math.max(0.1, asc + desc);
}

function padFor(outline: Outline): number {
  return (outline ? Math.ceil(outline.width) : 0) + 2;
}

function drawGlyph(ctx: Ctx2D, text: string, x: number, baseline: number, style: GlyphStyle): void {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  if (style.outline && style.outline.width > 0) {
    ctx.strokeStyle = style.outline.color;
    ctx.lineWidth = style.outline.width * 2;
    ctx.strokeText(text, x, baseline);
  }
  ctx.fillStyle = style.color;
  ctx.fillText(text, x, baseline);
}

interface Metrics {
  px: number;
  pad: number;
  asc: number;
  desc: number;
}

function metrics(style: GlyphStyle): Metrics {
  const px = fontSizeForDigitHeight(style.font, style.digitHeight);
  const { asc, desc } = digitRatio(style.font);
  return { px, pad: padFor(style.outline), asc: asc * px, desc: desc * px };
}

const digitCache = new Map<string, DigitSet>();

function styleKey(style: GlyphStyle): string {
  return JSON.stringify([style.font.family, style.font.weight, Math.round(style.digitHeight), style.color, style.outline, style.tracking ?? 0]);
}

export function renderDigitSet(style: GlyphStyle): DigitSet {
  const key = styleKey(style);
  const hit = digitCache.get(key);
  if (hit) return hit;

  const m = metrics(style);
  const probe = context2d(createSurface(8, 8));
  probe.font = fontString(style.font, m.px);
  let advance = 0;
  for (const d of "0123456789") advance = Math.max(advance, probe.measureText(d).width);
  const colonAdvance = probe.measureText(":").width;
  let ink = 0;
  for (const d of "0123456789") {
    const t = probe.measureText(d);
    ink = Math.max(ink, t.actualBoundingBoxLeft + t.actualBoundingBoxRight);
  }

  const natural = Math.ceil(advance) + 2 * m.pad;
  // Never trim below the widest digit's ink, or tight tracking would clip it.
  const cellW = Math.max(natural + Math.round(style.tracking ?? 0), Math.ceil(ink) + 2 * m.pad);
  const cellH = Math.ceil(m.asc + m.desc) + 2 * m.pad;
  const baseline = Math.round(m.pad + m.asc);

  const digits: Sprite[] = [];
  for (let d = 0; d < 10; d++) {
    const { sprite, ctx } = newSprite(cellW, cellH);
    ctx.font = fontString(style.font, m.px);
    const w = ctx.measureText(String(d)).width;
    drawGlyph(ctx, String(d), (cellW - w) / 2, baseline, style);
    digits.push(sprite);
  }
  const colonW = Math.ceil(colonAdvance) + 2 * m.pad;
  const { sprite: colon, ctx: cctx } = newSprite(colonW, cellH);
  cctx.font = fontString(style.font, m.px);
  drawGlyph(cctx, ":", (colonW - cctx.measureText(":").width) / 2, baseline, style);

  const set: DigitSet = { cellW, cellH, baseline, digits, colon };
  if (fontReady(style.font)) digitCache.set(key, set);
  return set;
}

const wordCache = new Map<string, WordSet>();

/**
 * Word images that share one cell (a "selected by value" image set: weekday names, months, AM/PM).
 * The cell is the widest word, each word centred in it, with a common baseline.
 */
export function renderWordSet(words: string[], style: GlyphStyle): WordSet {
  const key = `${styleKey(style)}|${words.join(",")}`;
  const hit = wordCache.get(key);
  if (hit) return hit;

  const m = metrics(style);
  const probe = context2d(createSurface(8, 8));
  probe.font = fontString(style.font, m.px);
  let width = 0;
  let asc = m.asc;
  let desc = m.desc;
  for (const w of words) {
    const t = probe.measureText(w);
    width = Math.max(width, t.width);
    asc = Math.max(asc, t.actualBoundingBoxAscent);
    desc = Math.max(desc, t.actualBoundingBoxDescent);
  }
  const cellW = Math.ceil(width) + 2 * m.pad;
  const cellH = Math.ceil(asc + desc) + 2 * m.pad;
  const baseline = Math.round(m.pad + asc);

  const out = new Map<string, Sprite>();
  for (const w of words) {
    const { sprite, ctx } = newSprite(cellW, cellH);
    ctx.font = fontString(style.font, m.px);
    drawGlyph(ctx, w, (cellW - ctx.measureText(w).width) / 2, baseline, style);
    out.set(w, sprite);
  }
  const set: WordSet = { cellW, cellH, baseline, words: out };
  if (fontReady(style.font)) wordCache.set(key, set);
  return set;
}

/** Monday first: the watch counts weekdays 1 (Monday) to 7 (Sunday). */
export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

export function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function dateWords(kind: "weekday" | "month", upper: boolean): string[] {
  const base: readonly string[] = kind === "weekday" ? WEEKDAYS : MONTHS;
  return upper ? [...base] : base.map(titleCase);
}

export function clearGlyphCaches(): void {
  digitCache.clear();
  wordCache.clear();
  ratioCache.clear();
}

/** Digits of a non-negative integer padded to `count` places with zeros. */
export function digitsOf(value: number, count: number): number[] {
  const n = Math.max(0, Math.floor(value)) % 10 ** count;
  return String(n).padStart(count, "0").split("").map(Number);
}
