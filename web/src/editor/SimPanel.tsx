import { Maximize, Magnet, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/ui/utils";
import { useEditor } from "./store";
import { SliderField } from "./fields";

const pad = (n: number) => String(n).padStart(2, "0");

export function SimPanel() {
  const sim = useEditor((s) => s.sim);
  const setSim = useEditor((s) => s.setSim);

  const d = new Date(sim.timeMs);
  const minutesOfDay = d.getHours() * 60 + d.getMinutes();

  const setClock = (minutes: number, seconds: number) => {
    const next = new Date(sim.timeMs);
    next.setHours(Math.floor(minutes / 60), minutes % 60, seconds, 0);
    setSim({ timeMs: next.getTime(), live: false });
  };

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 p-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="sim-panel">
      <div className="sm:col-span-2 xl:col-span-3 flex items-center justify-between gap-3 pb-1">
        <div>
          <h2 className="text-base font-bold tracking-tight">Simulated watch</h2>
          <p className="text-xs text-muted-foreground">Preview values only. The exported face reads the real ones from the watch.</p>
        </div>
        <button
          type="button"
          aria-pressed={sim.live}
          onClick={() => setSim({ live: !sim.live })}
          className={cn(
            "pressable flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            sim.live ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)]",
          )}
        >
          {sim.live ? <Pause className="size-4" /> : <Play className="size-4" />}
          {sim.live ? "Running clock" : "Run clock"}
        </button>
      </div>
      <SliderField
        label="Time of day"
        value={minutesOfDay}
        min={0}
        max={1439}
        format={(v) => `${pad(Math.floor(v / 60))}:${pad(v % 60)}`}
        onChange={(v) => setClock(v, d.getSeconds())}
      />
      <SliderField label="Seconds" value={d.getSeconds()} min={0} max={59} format={(v) => pad(v)} onChange={(v) => setClock(minutesOfDay, v)} />
      <SliderField label="Steps" value={sim.steps} min={0} max={30000} step={50} color="var(--steps)" onChange={(steps) => setSim({ steps })} />
      <SliderField label="Step goal" value={sim.stepGoal} min={2000} max={30000} step={500} color="var(--steps)" onChange={(stepGoal) => setSim({ stepGoal })} />
      <SliderField label="Heart rate" value={sim.heartRate} min={40} max={200} unit="bpm" color="var(--heart)" onChange={(heartRate) => setSim({ heartRate })} />
      <SliderField label="Battery" value={sim.battery} min={0} max={100} unit="%" color="var(--battery)" onChange={(battery) => setSim({ battery })} />
      <SliderField label="Calories" value={sim.calories} min={0} max={1500} step={5} unit="kcal" color="var(--calories)" onChange={(calories) => setSim({ calories })} />
    </div>
  );
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function StageControls({ currentZoom }: { currentZoom: number }) {
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const snapping = useEditor((s) => s.snapping);
  const setSnapping = useEditor((s) => s.setSnapping);

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > currentZoom + 0.01) : [...ZOOMS].reverse().find((z) => z < currentZoom - 0.01);
    if (next) setZoom(next);
  };
  const btn =
    "grid size-9 place-items-center rounded-full text-stage-foreground/80 transition-colors duration-150 hover:bg-white/10 hover:text-stage-foreground focus-visible:ring-[3px] focus-visible:ring-white/40 focus-visible:outline-none";

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-full bg-black/45 p-1 backdrop-blur-md">
      <button type="button" className={btn} aria-label="Zoom out" title="Zoom out (-)" onClick={() => step(-1)}>
        <ZoomOut className="size-4" />
      </button>
      <span className="w-12 text-center text-xs font-semibold text-stage-foreground tabular-nums" data-testid="zoom-label">
        {Math.round(currentZoom * 100)}%
      </span>
      <button type="button" className={btn} aria-label="Zoom in" title="Zoom in (+)" onClick={() => step(1)}>
        <ZoomIn className="size-4" />
      </button>
      <button
        type="button"
        className={cn(btn, zoom === "fit" && "bg-white/15 text-stage-foreground")}
        aria-label="Fit to window"
        aria-pressed={zoom === "fit"}
        title="Fit (0)"
        onClick={() => setZoom("fit")}
      >
        <Maximize className="size-4" />
      </button>
      <span className="mx-0.5 h-5 w-px bg-white/15" />
      <button
        type="button"
        className={cn(btn, snapping && "bg-white/15 text-stage-foreground")}
        aria-label="Snap to guides"
        aria-pressed={snapping}
        title="Snapping (hold Alt to bypass while dragging)"
        onClick={() => setSnapping(!snapping)}
      >
        <Magnet className="size-4" />
      </button>
    </div>
  );
}
