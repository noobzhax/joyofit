import {
  FIT4_PREVIEW,
  FIT4_SCREEN,
  FaceBuilder,
  VALUE_TYPE,
  WIDGET_DATA_TYPE,
  checkFit4Limits,
  createHwt,
  describeLayout,
  encodeImage,
  getLayout,
  readHwt,
  readImageHeader,
  verifyWatchface,
  writeHwt,
  writeWatchface,
  FIT4_LIMITS,
  type ElementBuilder,
  type HwtPackage,
  type RgbaImage,
  type WatchfaceBinary,
} from "@joyofit/hwt";
import { getAsset } from "@/model/assets";
import { hwtFileName } from "@/model/defaults";
import { SCREEN_H, SCREEN_W, type Element, type HandElement, type Project, type Sim, type WidgetSource } from "@/model/types";
import { fontsOf } from "@/editor/useFonts";
import { context2d, createSurface, newSprite, scaleSprite, spriteRgba, surfaceToJpeg, type Sprite } from "@/render/canvas";
import { ensureFont } from "@/render/fonts";
import type { DigitSet } from "@/render/glyphs";
import { layoutOf, renderBackgroundSprite, drawProject } from "@/render/scene";
import type { Part } from "@/render/layout";
import type { DataRole } from "@/render/values";
import { renderHand, renderRing } from "@/render/shapes";
import { HAND_VALUE, NUMBER_VALUE, RING_VALUE, elementSupport, isExportable, type SupportLevel } from "./support";

export type NoteLevel = "info" | "warning" | "error";

export interface ExportNote {
  level: NoteLevel;
  text: string;
}

export interface ExportOptions {
  /** Write elements whose ids are inferred rather than confirmed (hands, rings, seconds, months). */
  includeExperimental: boolean;
}

export interface ExportedElement {
  id: string;
  name: string;
  type: Element["type"];
  exported: boolean;
  /** Why an element was left out, or what part of it was. */
  detail: string;
  /** How well the ids behind it are known. */
  level: SupportLevel;
  /** Parts of an exported element that stay preview only. */
  dropped: string[];
}

export interface ExportStats {
  images: number;
  /** Encoded bytes of all images in the face. */
  imageBytes: number;
  /** Bytes of the finished `.hwt`. */
  totalBytes: number;
  largestImageBytes: number;
  imageMemoryBytes: number;
  layerBytes: number;
}

export interface ExportResult {
  fileName: string;
  bytes: Uint8Array;
  notes: ExportNote[];
  elements: ExportedElement[];
  stats: ExportStats;
  /** Layout and image table as JSON, for the troubleshooting sidecar. */
  debug: Record<string, unknown>;
}

/** An element that cannot be placed on the watch's coordinate system (negative origin for a sprite). */
class OffScreen extends Error {}

const BLACK_AOD = "#000000";

function mixToBlack(hex: string, keep: number): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * keep));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Always-on display look: same layout, colors at 45 percent, no seconds. */
function dimmed(el: Element): Element {
  const keep = 0.45;
  switch (el.type) {
    case "time":
      return { ...el, color: mixToBlack(el.color, keep), outline: el.outline && { ...el.outline, color: mixToBlack(el.outline.color, keep) }, showSeconds: false, ampm: false };
    case "date":
      return { ...el, color: mixToBlack(el.color, keep), outline: el.outline && { ...el.outline, color: mixToBlack(el.outline.color, keep) } };
    case "hand":
      return el.shape === "custom" ? el : { ...el, color: mixToBlack(el.color, keep) };
    default:
      return el;
  }
}

function rgba(sprite: Sprite): RgbaImage {
  const { data, width, height } = spriteRgba(sprite);
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

function solid(width: number, height: number, color: string): Sprite {
  const { sprite, ctx } = newSprite(width, height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return sprite;
}

function digitImages(set: DigitSet): RgbaImage[] {
  return set.digits.map(rgba);
}

function ensureOnScreen(name: string, x: number, y: number): void {
  if (x < 0 || y < 0) throw new OffScreen(`${name} starts left of or above the screen, which the layout cannot express. Move it inside.`);
}

/** Copy of the part of `sprite` that lies on the screen, with its new origin, or null when none does. */
function cropToScreen(sprite: Sprite, x: number, y: number): { sprite: Sprite; x: number; y: number } | null {
  const left = Math.max(0, -x);
  const top = Math.max(0, -y);
  const right = Math.min(sprite.width, SCREEN_W - x);
  const bottom = Math.min(sprite.height, SCREEN_H - y);
  if (right <= left || bottom <= top) return null;
  if (left === 0 && top === 0 && right === sprite.width && bottom === sprite.height) return { sprite, x, y };
  const { sprite: out, ctx } = newSprite(right - left, bottom - top);
  ctx.drawImage(sprite.surface as unknown as CanvasImageSource, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
  return { sprite: out, x: x + left, y: y + top };
}

/** One image per call, split into horizontal bands when the encoded image would exceed Huawei's single image limit. */
function staticImage(e: ElementBuilder, sprite: Sprite, x: number, y: number, ambient: "normal" | "aod" | "both"): number {
  const placed = cropToScreen(sprite, x, y);
  if (!placed) return 0;
  const limit = FIT4_LIMITS.maxImageBytes * 0.92;
  const full = rgba(placed.sprite);
  if (encodeImage(full).length <= limit || placed.sprite.height < 2) {
    e.singleImage({ image: full, x: placed.x, y: placed.y, ambient });
    return 1;
  }
  let bands = 2;
  while (bands < placed.sprite.height) {
    const rows = Math.ceil(placed.sprite.height / bands);
    let fits = true;
    for (let top = 0; top < placed.sprite.height && fits; top += rows) {
      const h = Math.min(rows, placed.sprite.height - top);
      const slice = newSprite(placed.sprite.width, h);
      slice.ctx.drawImage(placed.sprite.surface as unknown as CanvasImageSource, 0, top, placed.sprite.width, h, 0, 0, placed.sprite.width, h);
      fits = encodeImage(rgba(slice.sprite)).length <= limit;
    }
    if (fits) break;
    bands++;
  }
  const rows = Math.ceil(placed.sprite.height / bands);
  let count = 0;
  for (let top = 0; top < placed.sprite.height; top += rows) {
    const h = Math.min(rows, placed.sprite.height - top);
    const slice = newSprite(placed.sprite.width, h);
    slice.ctx.drawImage(placed.sprite.surface as unknown as CanvasImageSource, 0, top, placed.sprite.width, h, 0, 0, placed.sprite.width, h);
    e.singleImage({ image: rgba(slice.sprite), x: placed.x, y: placed.y + top, ambient });
    count++;
  }
  return count;
}

const WIDGET_SLOT: Partial<Record<WidgetSource, number>> = {
  steps: WIDGET_DATA_TYPE.steps,
  heartRate: WIDGET_DATA_TYPE.heartRate,
  battery: WIDGET_DATA_TYPE.power,
};

type Mode = "normal" | "aod";

/** Emits the parts of a text-like element (time, date, widget). Returns what was left out. */
function emitParts(e: ElementBuilder, el: Element, parts: Part[], mode: Mode, notes: string[]): void {
  for (const part of parts) {
    const x = el.x + part.x;
    const y = el.y + part.y;
    if (part.kind === "icon") {
      ensureOnScreen(el.name, x, y);
      e.singleImage({ image: rgba(part.sprite), x, y, ambient: mode });
    } else if (part.kind === "colon") {
      ensureOnScreen(el.name, x, y);
      e.singleImage({ image: rgba(part.set.colon), x, y, ambient: mode });
    } else if (part.kind === "words") {
      if (part.role === "ampm") {
        if (!notes.includes("AM/PM marker")) notes.push("AM/PM marker");
        continue;
      }
      ensureOnScreen(el.name, x, y);
      const images = part.words.map((w) => rgba(part.set.words.get(w)!));
      // Index = value: 1..7 Monday..Sunday and 1..12 January..December; slot 0 repeats slot 1 as the samples do.
      e.selected({ images: [images[0]!, ...images], x, y, valueType: part.role === "weekday" ? VALUE_TYPE.week : VALUE_TYPE.month, ambient: mode });
    } else if (part.role === "second") {
      const lowX = x + part.set.cellW;
      ensureOnScreen(el.name, x, y);
      const imgs = digitImages(part.set);
      e.selected({ images: imgs.slice(0, 6), x, y, valueType: VALUE_TYPE.secondHigh, ambient: mode });
      e.selected({ images: imgs, x: lowX, y, valueType: VALUE_TYPE.secondLow, ambient: mode });
    } else {
      const valueType = valueTypeOf(part.role);
      if (valueType === undefined) throw new Error(`no value id for ${part.role}`);
      const cx = part.align === "center" ? Math.round(x) : x;
      ensureOnScreen(el.name, part.align === "center" ? cx - Math.round((part.count * part.set.cellW) / 2) : cx, y);
      e.digits({ digits: digitImages(part.set), x: cx, y, align: part.align, valueType, ambient: mode });
    }
  }
}

function valueTypeOf(role: DataRole): number | undefined {
  switch (role) {
    case "hour":
      return VALUE_TYPE.hour;
    case "minute":
      return VALUE_TYPE.minute;
    case "day":
      return VALUE_TYPE.date;
    case "steps":
    case "heartRate":
    case "battery":
      return NUMBER_VALUE[role];
    default:
      return undefined;
  }
}

function emitHand(e: ElementBuilder, el: HandElement, mode: Mode): void {
  const hs = renderHand(el, getAsset(el.assetId));
  // The rotation box is a square centred on the pivot, as far across as the tip is from it (as in the samples).
  const reach = Math.max(1, Math.round(Math.max(hs.pivotY, hs.sprite.height - hs.pivotY, hs.pivotX, hs.sprite.width - hs.pivotX)));
  e.hand({
    image: rgba(hs.sprite),
    rect: { x: Math.round(el.x) - reach, y: Math.round(el.y) - reach, width: reach * 2, height: reach * 2 },
    pivot: { x: hs.pivotX, y: hs.pivotY },
    startAngle: 0,
    endAngle: 360,
    valueType: HAND_VALUE[el.hand],
    ambient: mode,
  });
}

function emitElement(fb: FaceBuilder, el: Element): string[] {
  const left: string[] = [];
  switch (el.type) {
    case "background":
      break;
    case "image": {
      const img = getAsset(el.assetId)!;
      const sprite = newSprite(Math.round(el.w), Math.round(el.h));
      sprite.ctx.imageSmoothingQuality = "high";
      sprite.ctx.drawImage(img.source, 0, 0, sprite.sprite.width, sprite.sprite.height);
      fb.element("background", (e) => {
        staticImage(e, sprite.sprite, Math.round(el.x), Math.round(el.y), "normal");
      });
      break;
    }
    case "time":
    case "date": {
      fb.element(el.type, (e) => {
        emitParts(e, el, layoutOf(el)!.parts, "normal", left);
        const aod = dimmed(el);
        emitParts(e, aod, layoutOf(aod)!.parts, "aod", []);
      });
      break;
    }
    case "hand":
      fb.element("time", (e) => {
        emitHand(e, el, "normal");
        if (el.hand !== "second") emitHand(e, dimmed(el) as HandElement, "aod");
      });
      break;
    case "widget": {
      const layout = layoutOf(el)!;
      fb.element("widget", (e) =>
        e.container(
          (c) => emitParts(c, el, layout.parts, "normal", left),
          { dataType: WIDGET_SLOT[el.source], rect: { x: Math.round(el.x), y: Math.round(el.y), width: Math.round(layout.w), height: Math.round(layout.h) } },
        ),
      );
      break;
    }
    case "ring": {
      const ring = renderRing(el);
      const size = ring.size;
      const slot = el.source === "steps" ? WIDGET_DATA_TYPE.steps : WIDGET_DATA_TYPE.power;
      fb.element("widget", (e) =>
        e.container(
          (c) => {
            staticImage(c, ring.track, Math.round(el.x), Math.round(el.y), "normal");
            c.arc({
              image: rgba(ring.fill),
              rect: { x: Math.round(el.x), y: Math.round(el.y), width: size, height: size },
              center: { x: Math.round(ring.cx), y: Math.round(ring.cy) },
              radius: Math.round(ring.radius),
              lineWidth: Math.round(el.thickness),
              startAngle: Math.round(el.startAngle),
              endAngle: Math.round(el.startAngle + el.sweep),
              valueType: RING_VALUE[el.source],
              ambient: "normal",
            });
          },
          { dataType: slot, rect: { x: Math.round(el.x), y: Math.round(el.y), width: size, height: size } },
        ),
      );
      break;
    }
  }
  return left;
}

/** Face as the always-on display shows it: black, with time, date and the hour and minute hands dimmed. */
export function aodElements(elements: Element[]): Element[] {
  const kept = elements.filter((el) => el.type === "time" || el.type === "date" || (el.type === "hand" && el.hand !== "second"));
  return kept.map(dimmed);
}

const AOD_LIT_LIMIT = 0.2;

/** Share of pixels that are visibly lit (any channel above 16 of 255). */
function litFraction(sprite: Sprite): number {
  const { data } = spriteRgba(sprite);
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 16 || data[i + 1]! > 16 || data[i + 2]! > 16) lit++;
  return lit / (data.length / 4);
}

function renderPreview(elements: Element[], sim: Sim, width: number, height: number, background: string): Sprite {
  const surface = createSurface(width, height);
  const ctx = context2d(surface);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.scale(width / SCREEN_W, height / SCREEN_H);
  ctx.imageSmoothingQuality = "high";
  drawProject(ctx, { version: 1, name: "", author: "", elements }, sim);
  return { width, height, surface };
}

function binaryOf(pkg: HwtPackage): WatchfaceBinary {
  if (!pkg.watchface) throw new Error("The package has no watchface binary");
  return pkg.watchface;
}

const SKIP_REASON_HIDDEN = "Hidden layer";

export async function buildHwt(project: Project, sim: Sim, options: ExportOptions): Promise<ExportResult> {
  await Promise.all(fontsOf(project.elements).map(ensureFont));

  const notes: ExportNote[] = [];
  const report: ExportedElement[] = [];
  const toExport: Element[] = [];
  for (const el of project.elements) {
    const base = { id: el.id, name: el.name, type: el.type };
    const support = elementSupport(el);
    if (!el.visible) {
      report.push({ ...base, exported: false, detail: SKIP_REASON_HIDDEN, level: support.level, dropped: [] });
    } else if (!isExportable(el, options.includeExperimental)) {
      const why = support.level === "preview-only" ? `Preview only. ${support.note}` : "Unconfirmed element left out (setting is off).";
      report.push({ ...base, exported: false, detail: why, level: support.level, dropped: [] });
    } else {
      toExport.push(el);
    }
  }

  const coverSprite = renderPreview(toExport, sim, FIT4_PREVIEW.cover.width, FIT4_PREVIEW.cover.height, "#000000");
  const cover = await surfaceToJpeg(coverSprite.surface, 0.92);
  const aodSprite = renderPreview(aodElements(toExport), sim, FIT4_PREVIEW.aod.width, FIT4_PREVIEW.aod.height, BLACK_AOD);
  const aod = await surfaceToJpeg(aodSprite.surface, 0.92);
  const aodLit = litFraction(aodSprite);
  const iconSmall = await surfaceToJpeg(scaleSprite(coverSprite, FIT4_PREVIEW.iconSmall.width, FIT4_PREVIEW.iconSmall.height).surface, 0.92);
  const thumbnail = rgba(scaleSprite(coverSprite, FIT4_PREVIEW.thumbnail.width, FIT4_PREVIEW.thumbnail.height));

  const title = project.name.trim() || "My face";
  const pkg = createHwt({ title, titleCn: title.slice(0, 8), author: project.author.trim(), screen: FIT4_SCREEN, cover, aod, iconSmall, thumbnail });
  const fb = new FaceBuilder(binaryOf(pkg));

  const background = toExport.find((el) => el.type === "background");
  const bgFill = background?.type === "background" ? background.fill : { kind: "solid" as const, color: "#000000" };
  const bgSprite = renderBackgroundSprite(bgFill);
  const bgImage = rgba(bgSprite);
  // The samples point the background's customisation preview at the background image itself (one shared slot).
  const bgPreview = encodeImage(bgImage).length <= FIT4_LIMITS.maxImageBytes * 0.92 ? bgImage : undefined;
  fb.element(
    "background",
    (e) => {
      staticImage(e, bgSprite, 0, 0, "normal");
      staticImage(e, solid(SCREEN_W, SCREEN_H, BLACK_AOD), 0, 0, "aod");
    },
    bgPreview ? { preview: bgPreview } : {},
  );
  if (background) {
    report.push({ id: background.id, name: background.name, type: background.type, exported: true, detail: "Background image, plus a black one for the always-on display", level: "verified", dropped: [] });
  }

  for (const el of toExport) {
    if (el.type === "background") continue;
    const base = { id: el.id, name: el.name, type: el.type };
    try {
      const left = emitElement(fb, el);
      const support = elementSupport(el);
      const dropped = [...new Set(left)];
      report.push({ ...base, exported: true, detail: support.level === "experimental" ? support.note : "", level: support.level, dropped });
    } catch (err) {
      if (err instanceof OffScreen) {
        report.push({ ...base, exported: false, detail: err.message, level: elementSupport(el).level, dropped: [] });
        notes.push({ level: "warning", text: err.message });
      } else {
        throw err;
      }
    }
  }
  fb.commit();

  const bytes = writeHwt(pkg);
  const readBack = readHwt(bytes);
  const wfBytes = binaryOf(readBack);
  const binary = writeWatchface(wfBytes);
  const verify = verifyWatchface(binary);
  if (!verify.ok) throw new Error(`The exported face failed its own consistency check: ${verify.problems.join("; ")}`);

  const limits = checkFit4Limits(wfBytes, binary.length, bytes.length);
  notes.push({
    level: aodLit > AOD_LIT_LIMIT ? "warning" : "info",
    text: `Always-on display lights ${Math.round(aodLit * 100)} percent of the pixels${aodLit > AOD_LIT_LIMIT ? ", above the 20 percent Huawei's guide allows for this screen. Make the time smaller or its color darker." : " (Huawei's guide allows 20)."}`,
  });
  for (const problem of limits.problems) notes.push({ level: "error", text: `Huawei limit: ${problem}` });
  for (const warning of limits.warnings) notes.push({ level: "warning", text: warning });

  const images = wfBytes.images;
  const imageTable = images.map((blob, index) => {
    if (blob.length < 8) return { index, width: 0, height: 0, bytes: blob.length };
    const h = readImageHeader(blob);
    return { index, width: h.width, height: h.height, bytes: blob.length };
  });
  const stats: ExportStats = {
    images: images.length,
    imageBytes: images.reduce((n, b) => n + b.length, 0),
    totalBytes: bytes.length,
    largestImageBytes: limits.largestImageBytes,
    imageMemoryBytes: limits.imageMemoryBytes,
    layerBytes: limits.layerBytes,
  };

  return {
    fileName: `${hwtFileName(project.name)}.hwt`,
    bytes,
    notes,
    elements: report,
    stats,
    debug: {
      generator: "JoyoFit Studio",
      screen: FIT4_SCREEN,
      title,
      options,
      sim,
      elements: report,
      stats,
      images: imageTable,
      layout: describeLayout(getLayout(wfBytes)),
    },
  };
}
