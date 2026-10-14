import type { FontRef } from "@/model/types";

/**
 * Curated fonts for digit, date and widget sprites. They come from @fontsource (Google Fonts, SIL OFL),
 * bundled with the app so the sprites a face carries never depend on a third-party request, and each
 * weight is a separate lazily loaded CSS chunk.
 */
export interface FontChoice {
  family: string;
  label: string;
  weights: number[];
  /** Style character, for the picker. */
  note: string;
}

export const FONTS: FontChoice[] = [
  { family: "Plus Jakarta Sans Variable", label: "Plus Jakarta Sans", weights: [500, 700, 800], note: "Friendly sans" },
  { family: "Outfit", label: "Outfit", weights: [300, 500, 700], note: "Geometric" },
  { family: "Sora", label: "Sora", weights: [300, 600], note: "Wide, techy" },
  { family: "Oswald", label: "Oswald", weights: [400, 600], note: "Condensed" },
  { family: "Bebas Neue", label: "Bebas Neue", weights: [400], note: "Tall caps" },
  { family: "Anton", label: "Anton", weights: [400], note: "Heavy condensed" },
  { family: "Big Shoulders Display", label: "Big Shoulders", weights: [700, 900], note: "Sporty" },
  { family: "Orbitron", label: "Orbitron", weights: [500, 800], note: "Futuristic" },
  { family: "Rajdhani", label: "Rajdhani", weights: [500, 700], note: "Squared" },
  { family: "Chakra Petch", label: "Chakra Petch", weights: [500, 700], note: "Cut corners" },
  { family: "Russo One", label: "Russo One", weights: [400], note: "Bold industrial" },
  { family: "Unbounded", label: "Unbounded", weights: [400, 700], note: "Round, wide" },
  { family: "Audiowide", label: "Audiowide", weights: [400], note: "Retro digital" },
  { family: "DM Mono", label: "DM Mono", weights: [400, 500], note: "Monospace" },
  { family: "Playfair Display", label: "Playfair Display", weights: [400, 700], note: "Classic serif" },
];

export const DEFAULT_FONT: FontRef = { family: "Plus Jakarta Sans Variable", weight: 700 };

export function fontChoice(family: string): FontChoice | undefined {
  return FONTS.find((f) => f.family === family);
}

/** Nearest weight the family ships, so an element never asks for a file that does not exist. */
export function nearestWeight(family: string, weight: number): number {
  const choice = fontChoice(family);
  if (!choice) return weight;
  return choice.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
}

/** One lazily loaded stylesheet per family and weight, so a face only downloads the font files it uses. */
const FONT_CSS: Record<string, () => Promise<unknown>> = {
  "outfit-300": () => import("../../node_modules/@fontsource/outfit/latin-300.css"),
  "outfit-500": () => import("../../node_modules/@fontsource/outfit/latin-500.css"),
  "outfit-700": () => import("../../node_modules/@fontsource/outfit/latin-700.css"),
  "sora-300": () => import("../../node_modules/@fontsource/sora/latin-300.css"),
  "sora-600": () => import("../../node_modules/@fontsource/sora/latin-600.css"),
  "oswald-400": () => import("../../node_modules/@fontsource/oswald/latin-400.css"),
  "oswald-600": () => import("../../node_modules/@fontsource/oswald/latin-600.css"),
  "bebas-neue-400": () => import("../../node_modules/@fontsource/bebas-neue/latin-400.css"),
  "anton-400": () => import("../../node_modules/@fontsource/anton/latin-400.css"),
  "big-shoulders-display-700": () => import("../../node_modules/@fontsource/big-shoulders-display/latin-700.css"),
  "big-shoulders-display-900": () => import("../../node_modules/@fontsource/big-shoulders-display/latin-900.css"),
  "orbitron-500": () => import("../../node_modules/@fontsource/orbitron/latin-500.css"),
  "orbitron-800": () => import("../../node_modules/@fontsource/orbitron/latin-800.css"),
  "rajdhani-500": () => import("../../node_modules/@fontsource/rajdhani/latin-500.css"),
  "rajdhani-700": () => import("../../node_modules/@fontsource/rajdhani/latin-700.css"),
  "chakra-petch-500": () => import("../../node_modules/@fontsource/chakra-petch/latin-500.css"),
  "chakra-petch-700": () => import("../../node_modules/@fontsource/chakra-petch/latin-700.css"),
  "russo-one-400": () => import("../../node_modules/@fontsource/russo-one/latin-400.css"),
  "unbounded-400": () => import("../../node_modules/@fontsource/unbounded/latin-400.css"),
  "unbounded-700": () => import("../../node_modules/@fontsource/unbounded/latin-700.css"),
  "audiowide-400": () => import("../../node_modules/@fontsource/audiowide/latin-400.css"),
  "dm-mono-400": () => import("../../node_modules/@fontsource/dm-mono/latin-400.css"),
  "dm-mono-500": () => import("../../node_modules/@fontsource/dm-mono/latin-500.css"),
  "playfair-display-400": () => import("../../node_modules/@fontsource/playfair-display/latin-400.css"),
  "playfair-display-700": () => import("../../node_modules/@fontsource/playfair-display/latin-700.css"),
};

function packageName(family: string): string {
  return family.replace(/ Variable$/, "").toLowerCase().replace(/ /g, "-");
}

export function fontCss(font: FontRef): string {
  return `${font.weight} 100px "${font.family}"`;
}

const loading = new Map<string, Promise<void>>();
/** Fonts whose files finished loading. `document.fonts.check` says true for a family it has never heard of, so it cannot be trusted alone. */
const loaded = new Set<string>();

/**
 * Loads the font file and resolves once the canvas can draw with it. A family that is not installed
 * (or any failure) resolves quietly: the browser falls back, and the sprite is simply not cached.
 */
export function ensureFont(font: FontRef): Promise<void> {
  const key = `${font.family}@${font.weight}`;
  const existing = loading.get(key);
  if (existing) return existing;
  const task = (async () => {
    if (typeof document === "undefined") return;
    if (font.family !== "Plus Jakarta Sans Variable") {
      const loader = FONT_CSS[`${packageName(font.family)}-${font.weight}`];
      if (loader) await loader();
    }
    await document.fonts.load(fontCss(font), "0123456789:APMapm");
    loaded.add(key);
  })().catch(() => undefined);
  loading.set(key, task);
  return task;
}

/** True once the canvas can render this font without the fallback. */
export function fontReady(font: FontRef): boolean {
  if (typeof document === "undefined") return true;
  return loaded.has(`${font.family}@${font.weight}`) && document.fonts.check(fontCss(font), "0123456789");
}
