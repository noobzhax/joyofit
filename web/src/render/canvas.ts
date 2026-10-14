/**
 * Canvas access for the sprite renderer. The browser uses OffscreenCanvas; tests (node) install
 * `@napi-rs/canvas` through `setCanvasFactory` so sprite rendering and export run without a browser.
 */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Surface = { width: number; height: number; getContext(type: "2d"): Ctx2D | null };

type Factory = (width: number, height: number) => Surface;

let factory: Factory = (width, height) => new OffscreenCanvas(width, height) as unknown as Surface;

export function setCanvasFactory(next: Factory): void {
  factory = next;
}

export function createSurface(width: number, height: number): Surface {
  return factory(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
}

export function context2d(surface: Surface): Ctx2D {
  const ctx = (surface as { getContext(type: "2d", options?: { willReadFrequently: boolean }): Ctx2D | null }).getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas is not available");
  return ctx;
}

/** A rendered bitmap that the preview can draw and the exporter can read as RGBA. */
export interface Sprite {
  width: number;
  height: number;
  surface: Surface;
}

export function newSprite(width: number, height: number): { sprite: Sprite; ctx: Ctx2D } {
  const surface = createSurface(width, height);
  return { sprite: { width: surface.width, height: surface.height, surface }, ctx: context2d(surface) };
}

/** Non-premultiplied RGBA pixels, the layout `@joyofit/hwt` image encoding takes. */
export function spriteRgba(sprite: Sprite): { width: number; height: number; data: Uint8ClampedArray } {
  const data = context2d(sprite.surface).getImageData(0, 0, sprite.width, sprite.height).data;
  return { width: sprite.width, height: sprite.height, data };
}

export function drawSprite(ctx: Ctx2D, sprite: Sprite, x: number, y: number): void {
  ctx.drawImage(sprite.surface as unknown as CanvasImageSource, x, y);
}

interface EncodableSurface {
  convertToBlob?: (options: { type: string; quality: number }) => Promise<Blob>;
  encode?: (format: "jpeg", quality: number) => Promise<Uint8Array>;
}

/** JPEG bytes of a surface, from either the browser (`convertToBlob`) or `@napi-rs/canvas` (`encode`). */
export async function surfaceToJpeg(surface: Surface, quality = 0.92): Promise<Uint8Array> {
  const s = surface as unknown as EncodableSurface;
  if (s.convertToBlob) {
    const blob = await s.convertToBlob({ type: "image/jpeg", quality });
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (s.encode) return new Uint8Array(await s.encode("jpeg", Math.round(quality * 100)));
  throw new Error("This canvas cannot encode JPEG");
}

/** A copy of `source` scaled to `width` x `height` with smoothing. */
export function scaleSprite(source: Sprite, width: number, height: number): Sprite {
  const { sprite, ctx } = newSprite(width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source.surface as unknown as CanvasImageSource, 0, 0, sprite.width, sprite.height);
  return sprite;
}

/** PNG bytes of a surface (transparency kept), from the browser or `@napi-rs/canvas`. */
export async function surfaceToPng(surface: Surface): Promise<Uint8Array> {
  const s = surface as unknown as {
    convertToBlob?: (options: { type: string }) => Promise<Blob>;
    encode?: (format: "png") => Promise<Uint8Array>;
  };
  if (s.convertToBlob) return new Uint8Array(await (await s.convertToBlob({ type: "image/png" })).arrayBuffer());
  if (s.encode) return new Uint8Array(await s.encode("png"));
  throw new Error("This canvas cannot encode PNG");
}
