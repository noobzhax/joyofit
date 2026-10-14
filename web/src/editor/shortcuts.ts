import { useEffect } from "react";
import { useEditor } from "./store";

export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "Ctrl Z", action: "Undo" },
  { keys: "Ctrl Shift Z  /  Ctrl Y", action: "Redo" },
  { keys: "Del  /  Backspace", action: "Delete the selected layer" },
  { keys: "Ctrl D", action: "Duplicate" },
  { keys: "Arrow keys", action: "Nudge 1 px (hold Shift for 10 px)" },
  { keys: "Ctrl ]  /  Ctrl [", action: "Bring forward / send backward" },
  { keys: "H", action: "Hide or show the layer" },
  { keys: "L", action: "Lock or unlock the layer" },
  { keys: "+  /  -  /  0", action: "Zoom in / out / fit" },
  { keys: "Alt while dragging", action: "Bypass snapping" },
  { keys: "Esc", action: "Deselect" },
];

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && (target as HTMLInputElement).type !== "range";
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Global editor shortcuts. Ignored while a text field has focus. */
export function useShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const sel = s.project.elements.find((el) => el.id === s.selectedId);

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === "d" && sel) {
        e.preventDefault();
        s.duplicateElement(sel.id);
        return;
      }
      if (mod && (e.key === "]" || e.key === "[") && sel) {
        e.preventDefault();
        s.moveInStack(sel.id, e.key === "]" ? 1 : -1);
        return;
      }
      if (mod || e.altKey) return;

      if (key === "escape") s.select(null);
      else if ((key === "delete" || key === "backspace") && sel) {
        e.preventDefault();
        s.removeElement(sel.id);
      } else if (key === "h" && sel) s.updateElement(sel.id, { visible: !sel.visible });
      else if (key === "l" && sel) s.updateElement(sel.id, { locked: !sel.locked });
      else if (key === "0") s.setZoom("fit");
      else if (key === "+" || key === "=" || key === "-") {
        const current = s.zoom === "fit" ? 1 : s.zoom;
        const next = key === "-" ? [...ZOOM_STEPS].reverse().find((z) => z < current - 0.01) : ZOOM_STEPS.find((z) => z > current + 0.01);
        if (next) s.setZoom(next);
      } else if (sel && !sel.locked && key.startsWith("arrow")) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -d : key === "arrowright" ? d : 0;
        const dy = key === "arrowup" ? -d : key === "arrowdown" ? d : 0;
        s.updateElement(sel.id, { x: sel.x + dx, y: sel.y + dy }, `nudge:${sel.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
