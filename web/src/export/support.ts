import { VALUE_TYPE, valueTypeInfo } from "@joyofit/hwt";
import type { Element, HandKind, RingSource, WidgetSource } from "@/model/types";

/**
 * What the exporter can write for an element, from how well the codec knows the value ids it needs
 * (`packages/hwt` VALUE_TYPES, each marked verified / inferred / unknown from the Fit 4 Pro sample faces).
 *
 * - `verified`: written. The sample faces use exactly this construction and their previews confirm the meaning.
 * - `experimental`: written only when "include unconfirmed elements" is on. The id comes from the samples'
 *   structure, not from a preview that shows it: a strong hypothesis until a watch confirms it.
 * - `preview-only`: never written. The editor shows it, the export leaves it out and says so.
 */
export type SupportLevel = "verified" | "experimental" | "preview-only";

export interface Support {
  level: SupportLevel;
  /** Why the element is experimental or preview only. */
  note: string;
  /** Parts of an exported element that stay preview only (for example the AM/PM marker). */
  dropped: string[];
  /** Parts that make an element experimental (for example the seconds digits). */
  experimental: string[];
}

/** Value ids the exporter writes. Kept here so the support rules and the layout builder cannot drift apart. */
export const HAND_VALUE: Record<HandKind, number> = {
  hour: VALUE_TYPE.hourRatio,
  minute: VALUE_TYPE.minuteRatio,
  second: VALUE_TYPE.secondRatio,
};

export const RING_VALUE: Record<RingSource, number> = {
  steps: VALUE_TYPE.stepsRatio,
  battery: VALUE_TYPE.powerRatio,
};

/** Widgets with a known number id; calories has none in any sample. */
export const NUMBER_VALUE: Partial<Record<WidgetSource, number>> = {
  steps: VALUE_TYPE.steps,
  heartRate: VALUE_TYPE.heartRate,
  battery: VALUE_TYPE.power,
};

const ORDER: SupportLevel[] = ["verified", "experimental", "preview-only"];

export function levelOfId(id: number): SupportLevel {
  const evidence = valueTypeInfo(id)?.evidence;
  return evidence === "verified" ? "verified" : evidence === "inferred" ? "experimental" : "preview-only";
}

function worst(levels: SupportLevel[]): SupportLevel {
  return levels.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "verified");
}

const verified: Support = { level: "verified", note: "", dropped: [], experimental: [] };

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function fromIds(ids: number[], what: string): Support {
  const level = worst(ids.map(levelOfId));
  if (level === "verified") return verified;
  const names = ids.map((id) => `${valueTypeInfo(id)?.name ?? "?"} (${id})`).join(", ");
  return {
    ...verified,
    level,
    note:
      level === "experimental"
        ? `${capitalise(what)} uses ids inferred from the sample faces, not confirmed by a preview or a watch: ${names}.`
        : `No value id is known for ${what}.`,
    experimental: level === "experimental" ? [what] : [],
  };
}

export function elementSupport(el: Element): Support {
  switch (el.type) {
    case "background":
      return el.fill.kind === "image" && !el.fill.assetId ? { ...verified, level: "preview-only", note: "No photo chosen." } : verified;
    case "image":
      return el.assetId ? verified : { ...verified, level: "preview-only", note: "No image chosen." };
    case "time": {
      const base = fromIds([VALUE_TYPE.hour, VALUE_TYPE.minute], "the hour and minute digits");
      const seconds = el.showSeconds ? fromIds([VALUE_TYPE.secondHigh, VALUE_TYPE.secondLow], "the seconds digits") : verified;
      const dropped = el.ampm ? ["AM/PM marker (no known id)"] : [];
      const level = worst([base.level, seconds.level]);
      return { level, note: [base.note, seconds.note].filter(Boolean).join(" "), dropped, experimental: [...base.experimental, ...seconds.experimental] };
    }
    case "date": {
      const ids: number[] = [];
      if (el.parts.includes("weekday")) ids.push(VALUE_TYPE.week);
      if (el.parts.includes("day")) ids.push(VALUE_TYPE.date);
      if (el.parts.includes("month")) ids.push(VALUE_TYPE.month);
      return fromIds(ids, "the date");
    }
    case "hand":
      if (el.shape === "custom" && !el.assetId) return { ...verified, level: "preview-only", note: "No hand PNG chosen." };
      return fromIds([HAND_VALUE[el.hand]], `the ${el.hand} hand`);
    case "widget": {
      const id = NUMBER_VALUE[el.source];
      if (id === undefined) return { ...verified, level: "preview-only", note: "No value id for calories is known from the samples." };
      return fromIds([id], "the number");
    }
    case "ring":
      return fromIds([RING_VALUE[el.source]], "the progress arc");
  }
}

export function isExportable(el: Element, includeExperimental: boolean): boolean {
  const s = elementSupport(el);
  if (s.level === "preview-only") return false;
  return s.level === "verified" || includeExperimental;
}
