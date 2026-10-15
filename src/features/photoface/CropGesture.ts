import { clampView, zoomTo, type CropView, type Size } from '@/features/photoface/cropMath';

interface Touch {
  pageX: number;
  pageY: number;
}

/** Distance between the first two touches. */
function distance(touches: readonly Touch[]): number {
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

/**
 * Turns the touches of one responder into changes of the [CropView]: one finger drags, two fingers zoom about the frame's
 * centre. It outlives renders (the responder is created once), so the editor feeds it the current view, picture and frame with
 * [sync] and receives every change through [onChange].
 */
export class CropGesture {
  private view: CropView;
  private source: Size;
  private frame: Size;
  private base: CropView;
  private startDx = 0;
  private startDy = 0;
  private pinch: { distance: number; scale: number } | null = null;
  private touches = 0;

  constructor(
    view: CropView,
    source: Size,
    frame: Size,
    private readonly onChange: (view: CropView) => void,
  ) {
    this.view = view;
    this.source = source;
    this.frame = frame;
    this.base = view;
  }

  sync(view: CropView, source: Size, frame: Size) {
    this.view = view;
    this.source = source;
    this.frame = frame;
  }

  start() {
    this.base = this.view;
    this.startDx = 0;
    this.startDy = 0;
    this.pinch = null;
    this.touches = 1;
  }

  /** [dx] / [dy] are the drag so far, as the responder reports them. */
  move(touches: readonly Touch[], dx: number, dy: number) {
    if (touches.length !== this.touches) {
      // A finger came or went: continue from where the picture is now.
      this.touches = touches.length;
      this.base = this.view;
      this.startDx = dx;
      this.startDy = dy;
      this.pinch = touches.length >= 2 ? { distance: distance(touches), scale: this.view.scale } : null;
      return;
    }
    if (touches.length >= 2 && this.pinch) {
      const scale = (this.pinch.scale * distance(touches)) / this.pinch.distance;
      this.change(zoomTo(this.view, scale, this.source, this.frame));
      return;
    }
    const next = { ...this.base, x: this.base.x + dx - this.startDx, y: this.base.y + dy - this.startDy };
    this.change(clampView(next, this.source, this.frame));
  }

  private change(next: CropView) {
    this.view = next;
    this.onChange(next);
  }
}
