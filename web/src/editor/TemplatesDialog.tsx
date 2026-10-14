import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { emptyProject } from "@/model/defaults";
import { SCREEN_H, SCREEN_W, type Project } from "@/model/types";
import type { Ctx2D } from "@/render/canvas";
import { drawProject } from "@/render/scene";
import { defaultSim } from "@/render/values";
import { TEMPLATES, type Template } from "@/templates";
import { Dialog } from "@/ui/dialog";
import { cn } from "@/ui/utils";
import { useEditor } from "./store";

const sim = defaultSim();

function Preview({ project }: { project: Project | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !project) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(canvas.width / SCREEN_W, 0, 0, canvas.height / SCREEN_H, 0, 0);
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.imageSmoothingQuality = "high";
    drawProject(ctx as Ctx2D, project, sim);
  }, [project]);
  return (
    <div className="mx-auto aspect-[408/480] w-full max-w-36 overflow-hidden rounded-[22%/18.5%] bg-black ring-1 ring-foreground/10">
      <canvas ref={ref} width={306} height={360} className="size-full" />
    </div>
  );
}

function Card({ template, project, onPick }: { template: Template | null; project: Project | null; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={template !== null && project === null}
      aria-busy={template !== null && project === null}
      data-testid={`template-${template?.id ?? "blank"}`}
      className={cn(
        "pressable flex flex-col items-stretch gap-3 rounded-2xl bg-muted p-3 text-left transition-colors duration-150 disabled:cursor-progress disabled:opacity-70 hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
      )}
    >
      {project ? (
        <Preview project={project} />
      ) : (
        <div className="mx-auto grid aspect-[408/480] w-full max-w-36 place-items-center rounded-[22%/18.5%] bg-black text-xs font-semibold text-white/50">
          {template ? <Loader2 className="size-4 animate-spin" /> : "Empty"}
        </div>
      )}
      <span>
        <span className="block text-sm font-bold">{template?.name ?? "Blank face"}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">{template?.blurb ?? "Black screen with a time. Add what you need."}</span>
      </span>
    </button>
  );
}

export function TemplatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loadProject = useEditor((s) => s.loadProject);
  const [built, setBuilt] = useState<Record<string, Project>>({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      for (const t of TEMPLATES) {
        if (built[t.id]) continue;
        try {
          const p = await t.build();
          if (alive) setBuilt((b) => ({ ...b, [t.id]: p }));
        } catch {
          // A template that fails to build simply stays a spinner; the others still work.
        }
      }
    })();
    return () => {
      alive = false;
    };
    // `built` only grows; re-running on its change would rebuild nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = (project: Project, name: string) => {
    loadProject(project);
    onClose();
    toast.success(`${name} loaded`, { description: "Press Ctrl+Z to go back to your previous face." });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start from a template"
      description="Each one is a normal face you can change. Loading it replaces the current face, and Undo brings yours back."
      className="max-w-3xl"
      testId="templates-dialog"
    >
      <div className="grid grid-cols-2 gap-3 pt-1 pb-2 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <Card key={t.id} template={t} project={built[t.id] ?? null} onPick={() => built[t.id] && apply(built[t.id]!, t.name)} />
        ))}
        <Card template={null} project={null} onPick={() => apply(emptyProject(), "Blank face")} />
      </div>
    </Dialog>
  );
}
