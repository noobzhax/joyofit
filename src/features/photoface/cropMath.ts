export interface Size {
  width: number;
  height: number;
}

/**
 * Where the picture sits in the crop frame. `scale` is frame pixels per source pixel; `x` / `y` are the offset of the picture's
 * centre from the frame's centre, in frame pixels.
 */
export interface CropView {
  scale: number;
  x: number;
  y: number;
}

/** A crop in source pixels, the shape `expo-image-manipulator` takes. */
export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** How far the picture may be zoomed in beyond filling the frame. */
export const MAX_ZOOM = 6;

/** The smallest scale at which the picture still covers the whole frame. */
export function coverScale(image: Size, frame: Size): number {
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/** Keeps the zoom within [cover, cover * MAX_ZOOM] and the picture over the whole frame. */
export function clampView(view: CropView, image: Size, frame: Size): CropView {
  const min = coverScale(image, frame);
  const scale = Math.min(Math.max(view.scale, min), min * MAX_ZOOM);
  const slackX = Math.max(0, (image.width * scale - frame.width) / 2);
  const slackY = Math.max(0, (image.height * scale - frame.height) / 2);
  return {
    scale,
    x: Math.min(Math.max(view.x, -slackX), slackX),
    y: Math.min(Math.max(view.y, -slackY), slackY),
  };
}

/** The view that shows the middle of the picture at the smallest zoom. */
export function initialView(image: Size, frame: Size): CropView {
  return { scale: coverScale(image, frame), x: 0, y: 0 };
}

/**
 * Zooms to [scale] about the frame's centre: the point of the picture under the centre stays there, so the offset scales with
 * the zoom.
 */
export function zoomTo(view: CropView, scale: number, image: Size, frame: Size): CropView {
  const ratio = scale / view.scale;
  return clampView({ scale, x: view.x * ratio, y: view.y * ratio }, image, frame);
}

/** The part of the source picture that lies inside the frame, in whole pixels and inside the picture. */
export function cropRect(view: CropView, image: Size, frame: Size): CropRect {
  const v = clampView(view, image, frame);
  const width = Math.min(image.width, Math.max(1, Math.round(frame.width / v.scale)));
  const height = Math.min(image.height, Math.max(1, Math.round(frame.height / v.scale)));
  const left = (image.width * v.scale) / 2 - frame.width / 2 - v.x;
  const top = (image.height * v.scale) / 2 - frame.height / 2 - v.y;
  return {
    originX: Math.min(Math.max(0, Math.round(left / v.scale)), image.width - width),
    originY: Math.min(Math.max(0, Math.round(top / v.scale)), image.height - height),
    width,
    height,
  };
}

/** The largest frame of the target's aspect ratio that fits in [maxWidth] x [maxHeight]. */
export function frameSize(target: Size, maxWidth: number, maxHeight: number): Size {
  const byWidth = { width: maxWidth, height: (maxWidth * target.height) / target.width };
  if (byWidth.height <= maxHeight) return byWidth;
  return { width: (maxHeight * target.width) / target.height, height: maxHeight };
}
