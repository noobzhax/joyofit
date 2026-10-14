import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { assetsVersion, getAsset, subscribeAssets } from "@/model/assets";
import { SCREEN_H, SCREEN_W, type Element } from "@/model/types";
import { drawProject, elementBounds, type Rect } from "@/render/scene";
import type { Ctx2D } from "@/render/canvas";
import { cn } from "@/ui/utils";
import { useEditor } from "./store";
import { hitTest, isScalable, otherBounds, scaleElement, snapMove, snapTargets, type Corner, type SnapTargets } from "./geometry";
import { useFontEpoch } from "./useFonts";

/** The Fit 4 Pro screen is a rounded rectangle; this corner radius is an approximation for the mask. */
export const SCREEN_RADIUS = 76;
const STAGE_PAD = 40;
const SNAP_PX = 6;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

type Drag =
  | { kind: "move"; id: string; px: number; py: number; x: number; y: number; bounds: Rect; others: SnapTargets }
  | { kind: "scale"; el: Element; corner: Corner; anchor: { x: number; y: number }; corner0: { x: number; y: number } }
  | { kind: "bgpan"; id: string; px: number; py: number; offsetX: number; offsetY: number };

export function useStageZoom(container: React.RefObject<HTMLElement | null>): number {
  const zoom = useEditor((s) => s.zoom);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      setFit(Math.max(0.3, Math.min(2.5, Math.min((r.width - STAGE_PAD * 2) / SCREEN_W, (r.height - STAGE_PAD * 2) / SCREEN_H))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [container]);
  return zoom === "fit" ? fit : zoom;
}

export function Stage({ zoom: z }: { zoom: number }) {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const sim = useEditor((s) => s.sim);
  const snapping = useEditor((s) => s.snapping);
  const select = useEditor((s) => s.select);
  const updateElement = useEditor((s) => s.updateElement);
  const beginDrag = useEditor((s) => s.beginDrag);
  const endDrag = useEditor((s) => s.endDrag);

  const assetV = useSyncExternalStore(subscribeAssets, assetsVersion);
  const fontEpoch = useFontEpoch(project);

  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [, setTick] = useState(0);

  // Ctrl or Cmd + wheel zooms the preview (pinch on a trackpad sends the same event).
  const setZoom = useEditor((s) => s.setZoom);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(Math.max(0.3, Math.min(4, Math.round(z * (1 - e.deltaY * 0.002) * 100) / 100)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [z, setZoom]);

  const effectiveSim = useCallback(() => (sim.live ? { ...sim, timeMs: Date.now() } : sim), [sim]);

  const paint = useCallback(() => {
    const node = canvas.current;
    if (!node) return;
    const scale = z * Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(SCREEN_W * scale);
    const h = Math.round(SCREEN_H * scale);
    if (node.width !== w || node.height !== h) {
      node.width = w;
      node.height = h;
    }
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.imageSmoothingQuality = "high";
    drawProject(ctx as Ctx2D, project, effectiveSim());
  }, [project, z, effectiveSim]);

  // One paint per state change; a steady loop only while the clock is live.
  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, assetV, fontEpoch]);

  useEffect(() => {
    if (!sim.live) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 45) {
        last = t;
        paint();
        setTick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim.live, paint]);

  const toStage = (e: { clientX: number; clientY: number }) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  };

  const selected = project.elements.find((e) => e.id === selectedId) ?? null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toStage(e);
    const s = effectiveSim();
    const hit = hitTest(project.elements, p.x, p.y, s, 4 / z);
    if (!hit) {
      select(null);
      return;
    }
    select(hit.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (hit.type === "background") {
      if (hit.fill.kind === "image" && getAsset(hit.fill.assetId)) {
        drag.current = { kind: "bgpan", id: hit.id, px: p.x, py: p.y, offsetX: hit.fill.offsetX, offsetY: hit.fill.offsetY };
        beginDrag();
      }
      return;
    }
    const b = elementBounds(hit, s);
    const bounds: Rect = hit.type === "hand" ? { x: hit.x, y: hit.y, w: 0, h: 0 } : b;
    drag.current = {
      kind: "move",
      id: hit.id,
      px: p.x,
      py: p.y,
      x: hit.x,
      y: hit.y,
      bounds,
      others: snapTargets(otherBounds(project.elements, hit.id, s)),
    };
    beginDrag();
  };

  const startScale = (e: React.PointerEvent, corner: Corner) => {
    if (!selected) return;
    e.stopPropagation();
    (scroller.current as HTMLElement).setPointerCapture(e.pointerId);
    const b = elementBounds(selected, effectiveSim());
    const pick = (c: Corner) => ({ x: c.includes("w") ? b.x : b.x + b.w, y: c.includes("n") ? b.y : b.y + b.h });
    const opposite: Record<Corner, Corner> = { nw: "se", ne: "sw", sw: "ne", se: "nw" };
    drag.current = { kind: "scale", el: selected, corner, anchor: pick(opposite[corner]), corner0: pick(corner) };
    beginDrag();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toStage(e);
    if (d.kind === "move") {
      let dx = Math.round(p.x - d.px);
      let dy = Math.round(p.y - d.py);
      if (snapping && !e.altKey) {
        const snap = snapMove({ ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy }, d.others, SNAP_PX / z);
        dx += Math.round(snap.dx);
        dy += Math.round(snap.dy);
        setGuides({ x: snap.guideX, y: snap.guideY });
      } else {
        setGuides({ x: null, y: null });
      }
      updateElement(d.id, { x: d.x + dx, y: d.y + dy });
    } else if (d.kind === "scale") {
      const vx = d.corner0.x - d.anchor.x;
      const vy = d.corner0.y - d.anchor.y;
      const k = ((p.x - d.anchor.x) * vx + (p.y - d.anchor.y) * vy) / (vx * vx + vy * vy || 1);
      const next = scaleElement(d.el, Math.max(0.05, k), d.corner, effectiveSim());
      updateElement(d.el.id, next);
    } else {
      const bg = project.elements.find((el) => el.id === d.id);
      const img = bg?.type === "background" && bg.fill.kind === "image" ? getAsset(bg.fill.assetId) : null;
      if (!bg || bg.type !== "background" || bg.fill.kind !== "image" || !img) return;
      const scale = Math.max(SCREEN_W / img.width, SCREEN_H / img.height) * Math.max(1, bg.fill.zoom);
      const freeX = (img.width * scale - SCREEN_W) / 2;
      const freeY = (img.height * scale - SCREEN_H) / 2;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      updateElement(d.id, {
        fill: {
          ...bg.fill,
          offsetX: freeX > 0 ? clamp(d.offsetX + (p.x - d.px) / freeX) : 0,
          offsetY: freeY > 0 ? clamp(d.offsetY + (p.y - d.py) / freeY) : 0,
        },
      });
    }
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    endDrag();
    setGuides({ x: null, y: null });
  };

  const bounds = selected && selected.type !== "background" ? elementBounds(selected, effectiveSim()) : null;
  const px = (v: number) => v * z;

  return (
    <div
      ref={scroller}
      data-testid="stage"
      className="relative flex size-full touch-none items-center justify-center overflow-auto select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        ref={frame}
        className="relative m-auto shrink-0"
        style={{ width: px(SCREEN_W), height: px(SCREEN_H), margin: STAGE_PAD }}
      >
        <div
          className="absolute inset-0 overflow-hidden bg-black"
          style={{
            borderRadius: px(SCREEN_RADIUS),
            boxShadow: `0 0 0 ${Math.max(6, px(9))}px #121a1d, 0 0 0 ${Math.max(7, px(10))}px rgb(255 255 255 / 9%), 0 24px 60px rgb(0 0 0 / 55%)`,
          }}
        >
          <canvas ref={canvas} data-testid="face-canvas" role="img" aria-label="Watch face preview" className="block size-full" />
        </div>

        {/* Overlay: selection, handles, guides. Not clipped, so handles near the corners stay reachable. */}
        <div className="pointer-events-none absolute inset-0">
          {guides.x !== null && <div className="absolute inset-y-[-24px] w-px bg-[#FF8FA4]" style={{ left: px(guides.x) }} />}
          {guides.y !== null && <div className="absolute inset-x-[-24px] h-px bg-[#FF8FA4]" style={{ top: px(guides.y) }} />}
          {selected?.type === "hand" && (
            <>
              <div
                className="absolute rounded-full border border-dashed border-[#5FD3EE]/70"
                style={{
                  left: px(selected.x - selected.length),
                  top: px(selected.y - selected.length),
                  width: px(selected.length * 2),
                  height: px(selected.length * 2),
                }}
              />
              <div
                className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#5FD3EE] bg-black"
                style={{ left: px(selected.x), top: px(selected.y) }}
              />
            </>
          )}
          {selected && bounds && selected.type !== "hand" && (
            <div
              className={cn("absolute border-[1.5px] border-[#5FD3EE]", selected.locked && "border-dashed")}
              style={{ left: px(bounds.x), top: px(bounds.y), width: px(bounds.w), height: px(bounds.h) }}
            >
              {isScalable(selected) &&
                !selected.locked &&
                CORNERS.map((c) => (
                  <span
                    key={c}
                    data-handle={c}
                    onPointerDown={(e) => startScale(e, c)}
                    className={cn(
                      "pointer-events-auto absolute size-3 rounded-[4px] border-[1.5px] border-[#5FD3EE] bg-white",
                      c === "nw" && "-top-1.5 -left-1.5 cursor-nwse-resize",
                      c === "ne" && "-top-1.5 -right-1.5 cursor-nesw-resize",
                      c === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                      c === "se" && "-right-1.5 -bottom-1.5 cursor-nwse-resize",
                    )}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
