import { create } from "zustand";
import { emptyProject, newElement, uid } from "@/model/defaults";
import type { Element, ElementType, Project, Sim } from "@/model/types";
import { PROJECT_VERSION, SCREEN_W } from "@/model/types";
import { elementBounds } from "@/render/scene";
import { defaultSim } from "@/render/values";

const STORAGE_KEY = "joyofit-studio:project:v1";
const HISTORY_LIMIT = 100;
const COALESCE_MS = 700;

export interface EditorState {
  project: Project;
  selectedId: string | null;
  past: Project[];
  future: Project[];
  sim: Sim;
  /** `fit` fills the stage; a number is an explicit zoom factor. */
  zoom: "fit" | number;
  snapping: boolean;
  /** Last coalesced edit, so a slider drag becomes one undo step. */
  lastEdit: { key: string; at: number } | null;
  /** True while a pointer drag owns a single undo entry. */
  dragging: boolean;

  select: (id: string | null) => void;
  setSim: (patch: Partial<Sim>) => void;
  setZoom: (zoom: "fit" | number) => void;
  setSnapping: (on: boolean) => void;

  commit: (next: Project, coalesceKey?: string) => void;
  patchProject: (patch: Partial<Pick<Project, "name" | "author">>, coalesceKey?: string) => void;
  addElement: (type: ElementType) => void;
  addCustom: (el: Element) => void;
  updateElement: (id: string, patch: Partial<Element>, coalesceKey?: string) => void;
  removeElement: (id: string) => void;
  duplicateElement: (id: string) => void;
  /** Move an element within the stack (positive = towards the top). */
  moveInStack: (id: string, delta: number) => void;
  reorder: (id: string, toIndex: number) => void;

  beginDrag: () => void;
  endDrag: () => void;

  undo: () => void;
  redo: () => void;
  loadProject: (project: Project) => void;
}

function normalise(project: Project): Project {
  // The background is always the bottom layer and there is only one.
  const bg = project.elements.filter((e) => e.type === "background");
  const rest = project.elements.filter((e) => e.type !== "background");
  return { ...project, elements: [...bg.slice(0, 1), ...rest] };
}

/** New text-like elements land centred left to right; their width is only known once laid out. */
function centredHorizontally(el: Element, sim: Sim): Element {
  if (el.type !== "time" && el.type !== "date" && el.type !== "widget") return el;
  const b = elementBounds(el, sim);
  return { ...el, x: Math.round((SCREEN_W - b.w) / 2) };
}

function readSaved(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Project;
    return parsed.version === PROJECT_VERSION && Array.isArray(parsed.elements) ? parsed : null;
  } catch {
    return null;
  }
}

export const useEditor = create<EditorState>((set, get) => ({
  project: readSaved() ?? emptyProject(),
  selectedId: null,
  past: [],
  future: [],
  sim: defaultSim(),
  zoom: "fit",
  snapping: true,
  lastEdit: null,
  dragging: false,

  select: (id) => set({ selectedId: id }),
  setSim: (patch) => set((s) => ({ sim: { ...s.sim, ...patch } })),
  setZoom: (zoom) => set({ zoom }),
  setSnapping: (snapping) => set({ snapping }),

  commit: (next, coalesceKey) => {
    const s = get();
    const now = Date.now();
    const coalesce = coalesceKey && s.lastEdit?.key === coalesceKey && now - s.lastEdit.at < COALESCE_MS;
    const skipHistory = coalesce || s.dragging;
    set({
      project: normalise(next),
      past: skipHistory ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: skipHistory ? s.future : [],
      lastEdit: coalesceKey ? { key: coalesceKey, at: now } : null,
    });
  },

  patchProject: (patch, coalesceKey) => get().commit({ ...get().project, ...patch }, coalesceKey ?? `project:${Object.keys(patch).join()}`),

  addElement: (type) => get().addCustom(newElement(type)),

  addCustom: (el) => {
    const placed = centredHorizontally(el, get().sim);
    get().commit({ ...get().project, elements: [...get().project.elements, placed] });
    set({ selectedId: placed.id });
  },

  updateElement: (id, patch, coalesceKey) => {
    const { project } = get();
    const elements = project.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as Element) : e));
    get().commit({ ...project, elements }, coalesceKey ?? `el:${id}:${Object.keys(patch).join()}`);
  },

  removeElement: (id) => {
    const { project, selectedId } = get();
    const target = project.elements.find((e) => e.id === id);
    if (!target || target.type === "background") return;
    get().commit({ ...project, elements: project.elements.filter((e) => e.id !== id) });
    if (selectedId === id) set({ selectedId: null });
  },

  duplicateElement: (id) => {
    const { project } = get();
    const index = project.elements.findIndex((e) => e.id === id);
    const src = project.elements[index];
    if (!src || src.type === "background") return;
    const copy = { ...src, id: uid(), name: `${src.name} copy`, x: src.x + 12, y: src.y + 12 } as Element;
    const elements = [...project.elements];
    elements.splice(index + 1, 0, copy);
    get().commit({ ...project, elements });
    set({ selectedId: copy.id });
  },

  moveInStack: (id, delta) => {
    const { project } = get();
    const index = project.elements.findIndex((e) => e.id === id);
    if (index < 0) return;
    get().reorder(id, index + delta);
  },

  reorder: (id, toIndex) => {
    const { project } = get();
    const from = project.elements.findIndex((e) => e.id === id);
    if (from < 0 || project.elements[from]?.type === "background") return;
    const to = Math.max(1, Math.min(project.elements.length - 1, toIndex));
    if (to === from) return;
    const elements = [...project.elements];
    const [moved] = elements.splice(from, 1);
    elements.splice(to, 0, moved!);
    get().commit({ ...project, elements });
  },

  beginDrag: () => {
    const s = get();
    if (s.dragging) return;
    set({ past: [...s.past, s.project].slice(-HISTORY_LIMIT), future: [], dragging: true, lastEdit: null });
  },
  endDrag: () => set({ dragging: false }),

  undo: () => {
    const s = get();
    const previous = s.past[s.past.length - 1];
    if (!previous) return;
    set({
      project: previous,
      past: s.past.slice(0, -1),
      future: [s.project, ...s.future],
      lastEdit: null,
      selectedId: previous.elements.some((e) => e.id === s.selectedId) ? s.selectedId : null,
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      project: next,
      past: [...s.past, s.project],
      future: s.future.slice(1),
      lastEdit: null,
      selectedId: next.elements.some((e) => e.id === s.selectedId) ? s.selectedId : null,
    });
  },

  loadProject: (project) =>
    set((s) => ({
      project: normalise(project),
      past: [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      selectedId: null,
      lastEdit: null,
    })),
}));

/** Autosave to localStorage, debounced. Called once from the app root. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
      } catch {
        // Storage can be full or blocked; the project stays in memory and can still be exported.
      }
    }, 300);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

export function selectedElement(state: EditorState): Element | null {
  return state.project.elements.find((e) => e.id === state.selectedId) ?? null;
}
