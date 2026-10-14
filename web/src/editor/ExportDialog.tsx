import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Download, FileJson, FileSearch, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { hwtFileName } from "@/model/defaults";
import { downloadBlob, serializeProject } from "@/model/projectFile";
import type { Project, Sim } from "@/model/types";
import { SCREEN_H, SCREEN_W } from "@/model/types";
import { buildHwt, type ExportResult } from "@/export/build";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Switch } from "@/ui/switch";
import { cn } from "@/ui/utils";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type State = { status: "building" } | { status: "ready"; result: ExportResult } | { status: "failed"; message: string };

function Check({ ok, children, detail }: { ok: "ok" | "warn" | "error"; children: React.ReactNode; detail?: React.ReactNode }) {
  const Icon = ok === "ok" ? CircleCheck : ok === "warn" ? TriangleAlert : CircleAlert;
  return (
    <li className="flex gap-3 py-2">
      <Icon className={cn("mt-0.5 size-[1.125rem] shrink-0", ok === "ok" && "text-battery", ok === "warn" && "text-warning", ok === "error" && "text-destructive")} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{children}</p>
        {detail && <p className="text-[0.8125rem] text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

export function ExportDialog({ open, onClose, project, sim }: { open: boolean; onClose: () => void; project: Project; sim: Sim }) {
  const [includeExperimental, setIncludeExperimental] = useState(true);
  const [state, setState] = useState<State>({ status: "building" });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ status: "building" });
    buildHwt(project, sim, { includeExperimental }).then(
      (result) => alive && setState({ status: "ready", result }),
      (err: unknown) => alive && setState({ status: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
  }, [open, project, sim, includeExperimental]);

  const result = state.status === "ready" ? state.result : null;
  const blocked = !result || result.notes.some((n) => n.level === "error");
  const fileBase = hwtFileName(project.name);
  const renamed = fileBase !== project.name.trim();

  const downloadHwt = () => {
    if (!result) return;
    downloadBlob(result.fileName, result.bytes, "application/octet-stream");
    toast.success(`${result.fileName} downloaded`, { description: "Install it from JoyoFit: Watch faces, Install from file." });
  };
  const downloadDebug = () => {
    if (!result) return;
    downloadBlob(`${fileBase}.layout.json`, JSON.stringify(result.debug, null, 2), "application/json");
  };
  const downloadProject = async () => {
    downloadBlob(`${fileBase}.project.json`, await serializeProject(project), "application/json");
  };

  const experimental = result?.elements.filter((e) => e.exported && e.level === "experimental") ?? [];
  const left = result?.elements.filter((e) => !e.exported) ?? [];
  const partial = result?.elements.filter((e) => e.exported && e.dropped.length > 0) ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export checklist"
      description="Read this before you download. The numbers are from the file that will be written."
      className="max-w-xl"
      testId="export-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void downloadProject()} data-testid="export-project-json">
            <FileJson /> Project JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadDebug} disabled={!result} data-testid="export-debug">
            <FileSearch /> Debug layout
          </Button>
          <Button onClick={downloadHwt} disabled={blocked} data-testid="download-hwt">
            {state.status === "building" ? <Loader2 className="animate-spin" /> : <Download />}
            Download .hwt
          </Button>
        </>
      }
    >
      {state.status === "failed" && (
        <div className="flex gap-2.5 rounded-2xl bg-destructive/10 p-3 text-sm" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            <span className="font-bold">The face could not be built.</span> {state.message}
          </p>
        </div>
      )}
      {state.status === "building" && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Rendering sprites and writing the package...
        </p>
      )}
      {result && (
        <>
          <ul className="divide-y divide-border" data-testid="checklist">
            <Check ok="ok" detail={`Watch Fit 4 and Fit 4 Pro, screen code HWHD13.`}>
              Resolution {SCREEN_W} × {SCREEN_H}
            </Check>
            <Check ok={renamed ? "warn" : "ok"} detail={renamed ? "Spaces and symbols are dropped from the name, as Huawei requires." : undefined}>
              File name {result.fileName}
            </Check>
            <Check
              ok={result.stats.images > 200 ? "warn" : "ok"}
              detail="The ten sample faces for this watch hold 44 to 164 images and weigh 154 to 448 KB."
            >
              {result.stats.images} images, {kb(result.stats.totalBytes)} in total
            </Check>
            <Check
              ok={result.notes.some((n) => n.text.includes("limit") && n.level === "error") ? "error" : "ok"}
              detail="Huawei Theme Studio limits: 750 KB per image, 4 MB image memory, 10 MB package."
            >
              Largest image {kb(result.stats.largestImageBytes)}, image memory {kb(result.stats.imageMemoryBytes)}
            </Check>
            <Check ok="ok" detail="Black screen with the time, date and the hour and minute hands at 45 percent brightness. Seconds, data and rings are not shown.">
              Always-on display
            </Check>
            {left.map((e) => (
              <Check key={e.id} ok="warn" detail={e.detail}>
                {e.name} left out
              </Check>
            ))}
            {experimental.map((e) => (
              <Check key={e.id} ok="warn" detail={e.detail}>
                {e.name} uses unconfirmed ids
              </Check>
            ))}
            {partial.map((e) => (
              <Check key={e.id} ok="warn" detail={`Preview only, not written: ${e.dropped.join(", ")}.`}>
                {e.name}: part of it is preview only
              </Check>
            ))}
            {result.notes
              .filter((n) => !n.text.startsWith("Huawei limit"))
              .map((n) => (
                <Check key={n.text} ok={n.level === "error" ? "error" : n.level === "warning" ? "warn" : "ok"}>
                  {n.text}
                </Check>
              ))}
            {result.notes
              .filter((n) => n.text.startsWith("Huawei limit"))
              .map((n) => (
                <Check key={n.text} ok="error">
                  {n.text}
                </Check>
              ))}
            <Check
              ok="warn"
              detail="Not yet tried on a real Fit 4: unsigned faces, how single-digit hours and days are padded, and the stacking order between different element types."
            >
              Unconfirmed on a watch
            </Check>
          </ul>

          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-muted p-4">
            <div className="min-w-0">
              <p className="text-sm font-bold">Include unconfirmed elements</p>
              <p className="text-[0.8125rem] text-muted-foreground" data-testid="experimental-summary">
                {experimental.length > 0
                  ? `${experimental.map((e) => e.name).join(", ")} use ids inferred from sample faces.`
                  : "Hands, rings, seconds and month names use ids inferred from sample faces."}
              </p>
            </div>
            <Switch label="Include unconfirmed elements" checked={includeExperimental} onCheckedChange={setIncludeExperimental} />
          </div>
        </>
      )}
    </Dialog>
  );
}
