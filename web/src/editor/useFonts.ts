import { useEffect, useState } from "react";
import type { Element, FontRef, Project } from "@/model/types";
import { ensureFont } from "@/render/fonts";

export function fontsOf(elements: Element[]): FontRef[] {
  const seen = new Map<string, FontRef>();
  for (const e of elements) {
    if (e.type === "time" || e.type === "date" || e.type === "widget") seen.set(`${e.font.family}@${e.font.weight}`, e.font);
  }
  return [...seen.values()];
}

/** Loads every font the project uses; the returned counter changes when new font files become usable. */
export function useFontEpoch(project: Project): number {
  const [epoch, setEpoch] = useState(0);
  const key = fontsOf(project.elements)
    .map((f) => `${f.family}@${f.weight}`)
    .sort()
    .join("|");
  useEffect(() => {
    let alive = true;
    void Promise.all(fontsOf(project.elements).map(ensureFont)).then(() => {
      if (alive) setEpoch((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // `key` captures the font set; the element list itself changes on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return epoch;
}
