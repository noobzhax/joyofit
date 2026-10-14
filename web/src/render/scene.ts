import { getAsset } from "@/model/assets";
import {
  SCREEN_H,
  SCREEN_W,
  type BackgroundFill,
  type Element,
  type HandElement,
  type ImageElement,
  type Project,
  type RingElement,
  type Sim,
} from "@/model/types";
import { context2d, createSurface, drawSprite, newSprite, type Ctx2D, type Sprite } from "./canvas";
import { layoutDate, layoutTime, layoutWidget, type Layout, type Part } from "./layout";
import { drawRingProgress, renderHand, renderRing, type HandSprite } from "./shapes";
import { clockFields, digitList, numericValue, ringFraction, type DataRole } from "./values";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RAD = Math.PI / 180;

export function drawBackground(ctx: Ctx2D, fill: BackgroundFill, w = SCREEN_W, h = SCREEN_H): void {
  if (fill.kind === "solid") {
    ctx.fillStyle = fill.color;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (fill.kind === "gradient") {
    const a = fill.angle * RAD;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
    g.addColorStop(0, fill.from);
    g.addColorStop(1, fill.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  const img = getAsset(fill.assetId);
  if (img) {
    const scale = Math.max(w / img.width, h / img.height) * Math.max(1, fill.zoom);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const x = (w - dw) / 2 + fill.offsetX * ((dw - w) / 2);
    const y = (h - dh) / 2 + fill.offsetY * ((dh - h) / 2);
    ctx.drawImage(img.source, x, y, dw, dh);
  }
  if (fill.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${fill.dim})`;
    ctx.fillRect(0, 0, w, h);
  }
}

export function renderBackgroundSprite(fill: BackgroundFill): Sprite {
  const { sprite, ctx } = newSprite(SCREEN_W, SCREEN_H);
  drawBackground(ctx, fill);
  return sprite;
}

export function layoutOf(el: Element): Layout | null {
  if (el.type === "time") return layoutTime(el);
  if (el.type === "date") return layoutDate(el);
  if (el.type === "widget") return layoutWidget(el);
  return null;
}

/** Hand angle in degrees clockwise from 12 o'clock for the simulated time. */
export function handAngle(kind: HandElement["hand"], timeMs: number): number {
  const f = clockFields(timeMs, false);
  const ms = timeMs % 1000;
  const s = f.second + ms / 1000;
  if (kind === "second") return s * 6;
  if (kind === "minute") return (f.minute + s / 60) * 6;
  return ((f.hour % 12) + f.minute / 60 + s / 3600) * 30;
}

function handSprite(el: HandElement): HandSprite {
  return renderHand(el, getAsset(el.assetId));
}

function ringSprite(el: RingElement) {
  return renderRing(el);
}

/** Bounds on screen (hands: the box of the rotated sprite at the simulated time). */
export function elementBounds(el: Element, sim: Sim): Rect {
  switch (el.type) {
    case "background":
      return { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
    case "image":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case "ring":
      return { x: el.x, y: el.y, w: Math.round(el.size), h: Math.round(el.size) };
    case "hand": {
      const hs = handSprite(el);
      const a = handAngle(el.hand, sim.timeMs) * RAD;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const corners: Array<[number, number]> = [
        [-hs.pivotX, -hs.pivotY],
        [hs.sprite.width - hs.pivotX, -hs.pivotY],
        [-hs.pivotX, hs.sprite.height - hs.pivotY],
        [hs.sprite.width - hs.pivotX, hs.sprite.height - hs.pivotY],
      ];
      const xs = corners.map(([cx, cy]) => cx * cos - cy * sin);
      const ys = corners.map(([cx, cy]) => cx * sin + cy * cos);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: el.x + minX, y: el.y + minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
    }
    default: {
      const l = layoutOf(el);
      return { x: el.x, y: el.y, w: l?.w ?? 0, h: l?.h ?? 0 };
    }
  }
}

function drawDigits(ctx: Ctx2D, part: Extract<Part, { kind: "digits" }>, ox: number, oy: number, values: number[]): void {
  const n = values.length;
  const width = n * part.set.cellW;
  const left = part.align === "center" ? ox + part.x - width / 2 : ox + part.x;
  for (let i = 0; i < n; i++) {
    drawSprite(ctx, part.set.digits[values[i] ?? 0]!, Math.round(left + i * part.set.cellW), oy + part.y);
  }
}

function valueOf(role: DataRole, sim: Sim, ampm: boolean): number {
  const f = clockFields(sim.timeMs, ampm);
  switch (role) {
    case "hour":
      return f.hour;
    case "minute":
      return f.minute;
    case "second":
      return f.second;
    case "day":
      return f.day;
    case "weekday":
      return f.weekday;
    case "month":
      return f.month;
    case "ampm":
      return f.pm ? 1 : 0;
    default:
      return numericValue(role, sim);
  }
}

function drawLayout(ctx: Ctx2D, layout: Layout, ox: number, oy: number, sim: Sim, ampm: boolean): void {
  for (const part of layout.parts) {
    if (part.kind === "icon") drawSprite(ctx, part.sprite, ox + part.x, oy + part.y);
    else if (part.kind === "colon") drawSprite(ctx, part.set.colon, ox + part.x, oy + part.y);
    else if (part.kind === "words") {
      const index = valueOf(part.role, sim, ampm);
      const word = part.words[index] ?? part.words[0]!;
      drawSprite(ctx, part.set.words.get(word)!, ox + part.x, oy + part.y);
    } else {
      const v = valueOf(part.role, sim, ampm);
      drawDigits(ctx, part, ox, oy, digitList(v, part.zeroPad ? part.count : 1).slice(-part.count));
    }
  }
}

function drawMissing(ctx: Ctx2D, r: Rect): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.restore();
}

export function drawImageElement(ctx: Ctx2D, el: ImageElement): void {
  const img = getAsset(el.assetId);
  if (img) ctx.drawImage(img.source, el.x, el.y, el.w, el.h);
  else drawMissing(ctx, { x: el.x, y: el.y, w: el.w, h: el.h });
}

export function drawElement(ctx: Ctx2D, el: Element, sim: Sim): void {
  if (!el.visible) return;
  switch (el.type) {
    case "background":
      drawBackground(ctx, el.fill);
      return;
    case "image":
      drawImageElement(ctx, el);
      return;
    case "ring": {
      const ring = ringSprite(el);
      drawSprite(ctx, ring.track, el.x, el.y);
      drawRingProgress(ctx, ring, el, el.x, el.y, ringFraction(el.source, sim));
      return;
    }
    case "hand": {
      const hs = handSprite(el);
      ctx.save();
      ctx.translate(el.x, el.y);
      ctx.rotate(handAngle(el.hand, sim.timeMs) * RAD);
      drawSprite(ctx, hs.sprite, -hs.pivotX, -hs.pivotY);
      ctx.restore();
      return;
    }
    case "time":
    case "date":
    case "widget": {
      const layout = layoutOf(el);
      if (layout) drawLayout(ctx, layout, el.x, el.y, sim, el.type === "time" && el.ampm);
      return;
    }
  }
}

export function drawProject(ctx: Ctx2D, project: Project, sim: Sim): void {
  for (const el of project.elements) drawElement(ctx, el, sim);
}

/** Whole face at 1x as pixels, used by previews and the export check. */
export function renderProjectSprite(project: Project, sim: Sim): Sprite {
  const surface = createSurface(SCREEN_W, SCREEN_H);
  drawProject(context2d(surface), project, sim);
  return { width: SCREEN_W, height: SCREEN_H, surface };
}
