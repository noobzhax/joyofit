import { DEFAULT_FONT } from "@/render/fonts";
import {
  PROJECT_VERSION,
  SCREEN_H,
  SCREEN_W,
  WIDGET_LABELS,
  type BackgroundElement,
  type DateElement,
  type Element,
  type ElementType,
  type HandElement,
  type HandKind,
  type ImageElement,
  type Project,
  type RingElement,
  type TimeElement,
  type WidgetElement,
  type WidgetSource,
} from "./types";

export function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

const INK = "#F2F7F8";
export const CENTER_X = SCREEN_W / 2;
export const CENTER_Y = SCREEN_H / 2;

export function newBackground(): BackgroundElement {
  return {
    id: uid(),
    type: "background",
    name: "Background",
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    fill: { kind: "solid", color: "#000000" },
  };
}

export function newTime(patch: Partial<TimeElement> = {}): TimeElement {
  return {
    id: uid(),
    type: "time",
    name: "Time",
    visible: true,
    locked: false,
    x: 58,
    y: 190,
    font: DEFAULT_FONT,
    size: 72,
    color: INK,
    outline: null,
    layout: "row",
    showColon: true,
    showSeconds: false,
    secondsScale: 0.4,
    ampm: false,
    tracking: 2,
    ...patch,
  };
}

export function newDate(patch: Partial<DateElement> = {}): DateElement {
  return {
    id: uid(),
    type: "date",
    name: "Date",
    visible: true,
    locked: false,
    x: 120,
    y: 110,
    font: DEFAULT_FONT,
    size: 26,
    color: "#A9C2C9",
    outline: null,
    parts: ["weekday", "day", "month"],
    upper: true,
    tracking: 1,
    ...patch,
  };
}

export function newHand(hand: HandKind, patch: Partial<HandElement> = {}): HandElement {
  const base: Record<HandKind, Pick<HandElement, "length" | "width" | "tail" | "color" | "shape" | "name">> = {
    hour: { length: 100, width: 14, tail: 18, color: "#F2F7F8", shape: "classic", name: "Hour hand" },
    minute: { length: 160, width: 10, tail: 22, color: "#F2F7F8", shape: "classic", name: "Minute hand" },
    second: { length: 175, width: 3, tail: 36, color: "#FF8FA4", shape: "needle", name: "Second hand" },
  };
  return {
    id: uid(),
    type: "hand",
    hand,
    visible: true,
    locked: false,
    x: CENTER_X,
    y: CENTER_Y,
    assetId: null,
    pivotX: 0,
    pivotY: 0,
    scale: 1,
    ...base[hand],
    ...patch,
  };
}

export function newImage(assetId: string | null, w: number, h: number, patch: Partial<ImageElement> = {}): ImageElement {
  return {
    id: uid(),
    type: "image",
    name: "Image",
    visible: true,
    locked: false,
    x: Math.round((SCREEN_W - w) / 2),
    y: Math.round((SCREEN_H - h) / 2),
    assetId,
    w,
    h,
    ...patch,
  };
}

export function newWidget(source: WidgetSource, patch: Partial<WidgetElement> = {}): WidgetElement {
  const colors: Record<WidgetSource, string> = {
    steps: "#5FD3EE",
    heartRate: "#FF8FA4",
    battery: "#6EE7A0",
    calories: "#F5B35A",
  };
  return {
    id: uid(),
    type: "widget",
    name: WIDGET_LABELS[source],
    visible: true,
    locked: false,
    x: 120,
    y: 360,
    source,
    font: DEFAULT_FONT,
    size: 34,
    color: INK,
    outline: null,
    showIcon: true,
    iconColor: colors[source],
    layout: "side",
    tracking: 1,
    ...patch,
  };
}

export function newRing(source: RingElement["source"], patch: Partial<RingElement> = {}): RingElement {
  return {
    id: uid(),
    type: "ring",
    name: source === "steps" ? "Steps ring" : "Battery ring",
    visible: true,
    locked: false,
    x: 12,
    y: 36,
    source,
    size: 384,
    thickness: 14,
    startAngle: 0,
    sweep: 360,
    color: source === "steps" ? "#5FD3EE" : "#6EE7A0",
    trackColor: "#24505E",
    roundCap: true,
    ...patch,
  };
}

export function newElement(type: ElementType): Element {
  switch (type) {
    case "background":
      return newBackground();
    case "time":
      return newTime();
    case "date":
      return newDate();
    case "hand":
      return newHand("minute");
    case "image":
      return newImage(null, 120, 120);
    case "widget":
      return newWidget("steps");
    case "ring":
      return newRing("steps");
  }
}

export function emptyProject(name = "My face"): Project {
  return {
    version: PROJECT_VERSION,
    name,
    author: "",
    elements: [newBackground(), newTime()],
  };
}

export const ELEMENT_LABELS: Record<ElementType, string> = {
  background: "Background",
  time: "Digital time",
  date: "Date",
  hand: "Analog hand",
  image: "Image or sticker",
  widget: "Data widget",
  ring: "Progress ring",
};

/** A `.hwt` file name: letters and digits only, as Huawei requires. */
export function hwtFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9]/g, "");
  return base.length > 0 ? base : "JoyoFitFace";
}
