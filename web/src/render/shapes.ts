import type { HandElement, IconName, RingElement } from "@/model/types";
import { newSprite, type Ctx2D, type Sprite } from "./canvas";

/** A decoded uploaded image: what the sprite renderer needs, independent of the DOM. */
export interface AssetImage {
  width: number;
  height: number;
  source: CanvasImageSource;
}

export interface HandSprite {
  sprite: Sprite;
  /** Rotation centre inside the sprite, px from its top left. */
  pivotX: number;
  pivotY: number;
}

const HAND_PAD = 3;

const CACHE_LIMIT = 96;

/** Small insertion-ordered cache so the 30 fps preview does not redraw every sprite each frame. */
function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = make();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
  return value;
}

const handCache = new Map<string, HandSprite>();
const iconCache = new Map<string, Sprite>();
const ringCache = new Map<string, RingSprite>();

function mix(hex: string, other: number, amount: number): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (other - c) * amount));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

/**
 * A hand sprite pointing straight up (12 o'clock). Built-in shapes are drawn here; `custom` scales the
 * uploaded PNG. The exporter rotates this exact bitmap around the pivot, as the watch does.
 */
export function renderHand(el: HandElement, asset: AssetImage | null): HandSprite {
  const key = JSON.stringify([el.shape, el.color, el.length, el.width, el.tail, el.assetId, el.pivotX, el.pivotY, el.scale, asset?.width, asset?.height]);
  return cached(handCache, key, () => drawHand(el, asset));
}

function drawHand(el: HandElement, asset: AssetImage | null): HandSprite {
  if (el.shape === "custom") {
    if (!asset) {
      const { sprite, ctx } = newSprite(8, 8);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 8, 8);
      return { sprite, pivotX: 4, pivotY: 4 };
    }
    const w = Math.max(1, Math.round(asset.width * el.scale));
    const h = Math.max(1, Math.round(asset.height * el.scale));
    const { sprite, ctx } = newSprite(w, h);
    ctx.drawImage(asset.source, 0, 0, w, h);
    // The pivot stays inside the image, whatever the numbers in the panel say.
    return {
      sprite,
      pivotX: Math.min(w, Math.max(0, Math.round(el.pivotX * el.scale))),
      pivotY: Math.min(h, Math.max(0, Math.round(el.pivotY * el.scale))),
    };
  }

  const w = Math.max(2, Math.round(el.width));
  const len = Math.max(8, Math.round(el.length));
  // The counterweight never reaches past the tip's distance: the exported rotation box is sized by the tip.
  const tail = Math.min(Math.max(0, Math.round(el.tail)), len);
  const sw = Math.max(w, Math.ceil(Math.max(w * 0.9, 4) * 2)) + HAND_PAD * 2;
  const sh = len + tail + HAND_PAD * 2;
  const cx = sw / 2;
  const py = HAND_PAD + len;
  const { sprite, ctx } = newSprite(sw, sh);
  ctx.fillStyle = el.color;
  ctx.strokeStyle = el.color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (el.shape === "classic") {
    ctx.beginPath();
    ctx.moveTo(cx, HAND_PAD);
    ctx.lineTo(cx + w / 2, py - len * 0.08);
    ctx.lineTo(cx + w * 0.3, py + tail);
    ctx.lineTo(cx - w * 0.3, py + tail);
    ctx.lineTo(cx - w / 2, py - len * 0.08);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  } else if (el.shape === "baton") {
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, HAND_PAD, w, len + tail, Math.min(w / 2, 6));
    ctx.fill();
    if (w >= 7) {
      ctx.fillStyle = mix(el.color, 255, 0.55);
      ctx.beginPath();
      ctx.roundRect(cx - w * 0.17, HAND_PAD + len * 0.12, w * 0.34, len * 0.62, w * 0.17);
      ctx.fill();
    }
  } else if (el.shape === "sword") {
    ctx.beginPath();
    ctx.moveTo(cx, HAND_PAD);
    ctx.lineTo(cx + w / 2, py - len * 0.62);
    ctx.lineTo(cx + w * 0.22, py);
    ctx.lineTo(cx + w * 0.22, py + tail);
    ctx.lineTo(cx - w * 0.22, py + tail);
    ctx.lineTo(cx - w * 0.22, py);
    ctx.lineTo(cx - w / 2, py - len * 0.62);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  } else {
    // needle: hairline with a round hub and a short counterweight
    ctx.lineWidth = Math.max(2, w * 0.45);
    ctx.beginPath();
    ctx.moveTo(cx, HAND_PAD);
    ctx.lineTo(cx, py + tail);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, py, Math.max(w * 0.9, 4), 0, Math.PI * 2);
    ctx.fill();
  }
  return { sprite, pivotX: Math.round(cx), pivotY: py };
}

export function renderIcon(name: IconName, size: number, color: string): Sprite {
  return cached(iconCache, `${name}|${Math.round(size)}|${color}`, () => drawIcon(name, size, color));
}

function drawIcon(name: IconName, size: number, color: string): Sprite {
  const px = Math.max(8, Math.round(size));
  const { sprite, ctx } = newSprite(px, px);
  const s = px / 24;
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Paths are from Lucide (ISC license), https://lucide.dev.
  if (name === "heart") {
    const p = new Path2D(
      "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
    );
    ctx.fill(p);
    ctx.stroke(p);
  } else if (name === "flame") {
    const p = new Path2D(
      "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4",
    );
    ctx.fill(p);
    ctx.stroke(p);
  } else if (name === "steps") {
    const parts = [
      "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
      "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
    ];
    for (const d of parts) {
      const p = new Path2D(d);
      ctx.fill(p);
      ctx.stroke(p);
    }
  } else {
    ctx.beginPath();
    ctx.roundRect(2.5, 7, 16, 10, 2.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(5, 9.5, 11, 5, 1);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(21.5, 10.5);
    ctx.lineTo(21.5, 13.5);
    ctx.stroke();
  }
  return sprite;
}

export interface RingSprite {
  /** The arc at 100 percent: the watch shows a fraction of it. */
  fill: Sprite;
  /** The full-length track behind it. */
  track: Sprite;
  /** Sprite size, equal for both. */
  size: number;
  /** Centre inside the sprite. */
  cx: number;
  cy: number;
  radius: number;
}

const RAD = Math.PI / 180;

/** Angle in degrees clockwise from 12 o'clock to canvas radians. */
export function clockAngle(deg: number): number {
  return (deg - 90) * RAD;
}

function arcPath(ctx: Ctx2D, cx: number, cy: number, r: number, start: number, sweep: number): void {
  ctx.beginPath();
  // A sweep of exactly 360 degrees is a zero-length arc to some canvas implementations; stop a hair short.
  ctx.arc(cx, cy, r, clockAngle(start), clockAngle(start + Math.min(sweep, 359.99)));
}

export function renderRing(el: RingElement): RingSprite {
  const key = JSON.stringify([el.size, el.thickness, el.startAngle, el.sweep, el.color, el.trackColor, el.roundCap]);
  return cached(ringCache, key, () => drawRing(el));
}

function drawRing(el: RingElement): RingSprite {
  const size = Math.round(el.size);
  const { sprite: track, ctx: tctx } = newSprite(size, size);
  const { sprite: fill, ctx: fctx } = newSprite(size, size);
  const radius = size / 2 - el.thickness / 2;
  const cx = size / 2;
  const cy = size / 2;
  for (const [ctx, color] of [
    [tctx, el.trackColor],
    [fctx, el.color],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = el.thickness;
    ctx.lineCap = el.roundCap ? "round" : "butt";
    arcPath(ctx, cx, cy, radius, el.startAngle, el.sweep);
    ctx.stroke();
  }
  return { fill, track, size, cx, cy, radius };
}

/** Draws only the first `fraction` of the ring's sweep from the full-length fill sprite. */
export function drawRingProgress(ctx: Ctx2D, ring: RingSprite, el: RingElement, x: number, y: number, fraction: number): void {
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  const sweep = el.sweep * f;
  // A pie wedge clips the full arc to the progress; a full ring needs no clip.
  if (f >= 1) {
    ctx.rect(0, 0, ring.size, ring.size);
  } else {
    ctx.moveTo(ring.cx, ring.cy);
    ctx.arc(ring.cx, ring.cy, ring.size, clockAngle(el.startAngle), clockAngle(el.startAngle + sweep));
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(ring.fill.surface as unknown as CanvasImageSource, 0, 0);
  ctx.restore();
}
