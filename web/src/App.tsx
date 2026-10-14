import { useEffect, useRef, useState } from "react";
import { CircleHelp, Download, FolderOpen, LayoutTemplate, Moon, Redo2, Save, Sun, Undo2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { ExportDialog } from "@/editor/ExportDialog";
import { HelpDialog } from "@/editor/HelpDialog";
import { LayerPanel } from "@/editor/LayerPanel";
import { PropertyPanel } from "@/editor/PropertyPanel";
import { SimPanel, StageControls } from "@/editor/SimPanel";
import { Stage, useStageZoom } from "@/editor/Stage";
import { TemplatesDialog } from "@/editor/TemplatesDialog";
import { startAutosave, useEditor } from "@/editor/store";
import { useShortcuts } from "@/editor/shortcuts";
import { loadAllAssets } from "@/model/assets";
import { downloadBlob, parseProjectFile, ProjectFileError, serializeProject } from "@/model/projectFile";
import { hwtFileName } from "@/model/defaults";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/ui/utils";

const HELP_SEEN = "joyofit-studio:help-seen";
type Panel = "layers" | "stage" | "props";

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("joyofit-studio:theme");
      return saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return [
    dark,
    () => {
      // Flipping every color at once would smear through their transitions; switch them off for the frame.
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{transition:none !important}";
      document.head.append(style);
      setDark((d) => {
        try {
          localStorage.setItem("joyofit-studio:theme", d ? "light" : "dark");
        } catch {
          // Theme still switches for this session.
        }
        return !d;
      });
      requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
    },
  ];
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="18" fill="var(--primary)" />
        <rect x="19" y="14" width="26" height="36" rx="9" fill="#0F2F3A" />
        <path d="M32 22v10l6 4" stroke="#5FD3EE" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span className="hidden text-[0.9375rem] font-extrabold tracking-tight sm:inline">
        JoyoFit <span className="text-primary">Studio</span>
      </span>
    </div>
  );
}

function StageArea() {
  const holder = useRef<HTMLDivElement>(null);
  const zoom = useStageZoom(holder);
  return (
    <div ref={holder} className="relative min-h-0 flex-1 overflow-hidden rounded-3xl bg-stage">
      <StageControls currentZoom={zoom} />
      <Stage zoom={zoom} />
    </div>
  );
}

export function App() {
  const project = useEditor((s) => s.project);
  const sim = useEditor((s) => s.sim);
  const patchProject = useEditor((s) => s.patchProject);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const loadProject = useEditor((s) => s.loadProject);

  const [help, setHelp] = useState(() => {
    try {
      return !localStorage.getItem(HELP_SEEN);
    } catch {
      return true;
    }
  });
  const [templates, setTemplates] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [panel, setPanel] = useState<Panel>("stage");
  // Below lg the panel is collapsed so the preview keeps its height; from lg up it is always shown.
  const [simOpen, setSimOpen] = useState(false);
  const [dark, toggleTheme] = useTheme();
  const openInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadAllAssets();
    return startAutosave();
  }, []);
  useShortcuts(!help && !templates && !exporting);

  const closeHelp = () => {
    setHelp(false);
    try {
      localStorage.setItem(HELP_SEEN, "1");
    } catch {
      // The help simply shows again next visit.
    }
  };

  const saveProject = async () => {
    downloadBlob(`${hwtFileName(project.name)}.project.json`, await serializeProject(project), "application/json");
  };

  const openProject = async (file: File) => {
    try {
      loadProject(await parseProjectFile(await file.text()));
      toast.success(`Opened ${file.name}`);
    } catch (err) {
      toast.error(err instanceof ProjectFileError ? err.message : "That file could not be opened.");
    }
  };

  const iconBtn = "size-10";

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="flex items-center gap-1 px-1 sm:gap-2">
        <Logo />
        <Input
          aria-label="Face name"
          data-testid="face-name"
          value={project.name}
          maxLength={40}
          onChange={(e) => patchProject({ name: e.currentTarget.value })}
          className="ml-1 h-10 w-28 min-w-0 rounded-full px-4 text-sm font-bold sm:w-56"
        />
        <div className="ml-1 flex">
          <Button variant="ghost" size="icon" className={iconBtn} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" className={iconBtn} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            <Redo2 />
          </Button>
        </div>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" className="h-10" onClick={() => setTemplates(true)} data-testid="open-templates">
          <LayoutTemplate />
          <span className="hidden md:inline">Templates</span>
        </Button>
        <input
          ref={openInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void openProject(f);
          }}
        />
        <Button variant="ghost" size="icon" className={cn(iconBtn, "hidden sm:inline-flex")} aria-label="Open project JSON" title="Open project JSON" onClick={() => openInput.current?.click()}>
          <FolderOpen />
        </Button>
        <Button variant="ghost" size="icon" className={cn(iconBtn, "hidden sm:inline-flex")} aria-label="Save project JSON" title="Save project JSON" onClick={() => void saveProject()}>
          <Save />
        </Button>
        <Button variant="ghost" size="icon" className={cn(iconBtn, "max-sm:hidden")} aria-label={dark ? "Light theme" : "Dark theme"} title={dark ? "Light theme" : "Dark theme"} onClick={toggleTheme}>
          {dark ? <Sun /> : <Moon />}
        </Button>
        <Button variant="ghost" size="icon" className={iconBtn} aria-label="Help and install guide" title="Help and install guide" onClick={() => setHelp(true)} data-testid="open-help">
          <CircleHelp />
        </Button>
        <Button className="h-10 px-3 sm:px-4" onClick={() => setExporting(true)} data-testid="export-hwt" aria-label="Export .hwt">
          <Download />
          <span className="max-sm:hidden">Export .hwt</span>
        </Button>
      </header>

      <main className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)_21rem]">
        <aside className={cn("min-h-0 overflow-hidden rounded-3xl bg-card", panel === "layers" ? "block" : "hidden lg:block")} aria-label="Layers">
          <LayerPanel />
        </aside>

        <section className={cn("min-h-0 flex-col gap-3", panel === "stage" ? "flex" : "hidden lg:flex")} aria-label="Preview">
          <StageArea />
          <div className="shrink-0 rounded-3xl bg-card">
            <button
              type="button"
              aria-expanded={simOpen}
              onClick={() => setSimOpen((o) => !o)}
              className="flex w-full items-center justify-between rounded-3xl px-5 py-3 text-left text-sm font-bold lg:hidden"
            >
              Simulated watch
              <span className="text-xs font-semibold text-muted-foreground">{simOpen ? "Hide" : "Show"}</span>
            </button>
            <div className={cn(simOpen ? "block" : "hidden", "lg:block")}>
              <SimPanel />
            </div>
          </div>
        </section>

        <aside className={cn("panel-scroll min-h-0 overflow-y-auto rounded-3xl bg-card", panel === "props" ? "block" : "hidden lg:block")} aria-label="Properties">
          <PropertyPanel />
        </aside>
      </main>

      <nav className="grid grid-cols-3 gap-1 rounded-full bg-card p-1 lg:hidden" aria-label="Editor panels">
        {(["layers", "stage", "props"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={panel === p}
            onClick={() => setPanel(p)}
            className={cn(
              "h-10 rounded-full text-sm font-semibold transition-colors duration-150",
              panel === p ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {p === "layers" ? "Layers" : p === "stage" ? "Preview" : "Properties"}
          </button>
        ))}
      </nav>

      <HelpDialog open={help} onClose={closeHelp} />
      <TemplatesDialog open={templates} onClose={() => setTemplates(false)} />
      <ExportDialog open={exporting} onClose={() => setExporting(false)} project={project} sim={sim} />
      <Toaster position="bottom-center" theme={dark ? "dark" : "light"} />
    </div>
  );
}
