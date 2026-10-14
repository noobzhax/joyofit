import { addGeneratedAsset } from "@/model/assets";
import { newBackground, newDate, newHand, newRing, newTime, newWidget, CENTER_X, CENTER_Y } from "@/model/defaults";
import { PROJECT_VERSION, SCREEN_H, SCREEN_W, type Element, type Project } from "@/model/types";
import { fontsOf } from "@/editor/useFonts";
import { newSprite } from "@/render/canvas";
import { ensureFont } from "@/render/fonts";
import { layoutOf } from "@/render/scene";

/**
 * Starter faces designed for 408 x 480. Each is built from the same element factories the editor uses, so a
 * template is an ordinary project the user can change freely. Palette: JoyoFit's ink teal with per-metric colors.
 */
export interface Template {
  id: string;
  name: string;
  blurb: string;
  build: () => Promise<Project>;
}

const INK = "#F2F7F8";
const MUTED = "#8FA9B1";
const TEAL = "#5FD3EE";
const ROSE = "#FF8FA4";
const GREEN = "#6EE7A0";
const AMBER = "#F5B35A";
const TRACK = "#1D4250";

function project(name: string, elements: Element[]): Project {
  return { version: PROJECT_VERSION, name, author: "", elements };
}

async function ready(elements: Element[]): Promise<void> {
  await Promise.all(fontsOf(elements).map(ensureFont));
}

/** Sets x so the element's layout is centred on `cx`. Needs the fonts loaded. */
function centreX<T extends Element>(el: T, cx = CENTER_X): T {
  const w = layoutOf(el)?.w ?? 0;
  return { ...el, x: Math.round(cx - w / 2) };
}

function bounds(el: Element): { w: number; h: number } {
  const l = layoutOf(el);
  return { w: l?.w ?? 0, h: l?.h ?? 0 };
}

const quiet: Template = {
  id: "quiet",
  name: "Quiet",
  blurb: "Time and date on black. Nothing else.",
  build: async () => {
    const bg = { ...newBackground(), fill: { kind: "solid" as const, color: "#000000" } };
    let time = newTime({ name: "Time", font: { family: "Outfit", weight: 300 }, size: 88, color: INK, tracking: 0, y: 0 });
    let date = newDate({ name: "Date", font: { family: "Outfit", weight: 500 }, size: 24, color: MUTED, parts: ["weekday", "day"], tracking: -3 });
    await ready([time, date]);
    time = centreX({ ...time, y: Math.round(CENTER_Y - bounds(time).h / 2 + 8) });
    date = centreX({ ...date, y: time.y - 46 });
    return project("Quiet", [bg, time, date]);
  },
};

const stackRing: Template = {
  id: "stack-ring",
  name: "Stack",
  blurb: "Big stacked digits inside a steps ring.",
  build: async () => {
    const bg = { ...newBackground(), fill: { kind: "gradient" as const, from: "#0F2F3A", to: "#02080A", angle: 180 } };
    const ring = newRing("steps", { x: 20, y: 48, size: 368, thickness: 16, color: TEAL, trackColor: TRACK });
    let time = newTime({
      name: "Time",
      layout: "stack",
      font: { family: "Big Shoulders Display", weight: 900 },
      size: 100,
      color: INK,
      tracking: -4,
    });
    let steps = newWidget("steps", { font: { family: "Big Shoulders Display", weight: 700 }, size: 30, color: TEAL, iconColor: TEAL, layout: "side" });
    await ready([time, steps]);
    time = centreX({ ...time, y: Math.round(CENTER_Y - bounds(time).h / 2 - 30) });
    steps = centreX({ ...steps, y: time.y + bounds(time).h + 12 });
    return project("Stack", [bg, ring, time, steps]);
  },
};

/** Dial artwork: hour and minute ticks and four numerals, drawn once and used as the background photo. */
async function dialAsset(): Promise<string> {
  const { sprite, ctx } = newSprite(SCREEN_W, SCREEN_H);
  ctx.fillStyle = "#050B0D";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const cx = CENTER_X;
  const cy = CENTER_Y;
  ctx.lineCap = "round";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const hour = i % 5 === 0;
    const outer = 200;
    const inner = hour ? 176 : 190;
    ctx.strokeStyle = hour ? INK : "#4B6A73";
    ctx.lineWidth = hour ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    ctx.lineTo(cx + Math.sin(a) * outer, cy - Math.cos(a) * outer);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.font = '700 40px "Plus Jakarta Sans Variable"';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [label, a] of [["12", 0], ["3", 90], ["9", 270]] as const) {
    const r = 132;
    ctx.fillText(label, cx + Math.sin((a * Math.PI) / 180) * r, cy - Math.cos((a * Math.PI) / 180) * r + 2);
  }
  return addGeneratedAsset(sprite.surface, "classic-dial.png");
}

const classic: Template = {
  id: "classic",
  name: "Classic",
  blurb: "Analog dial with three hands and a date.",
  build: async () => {
    const assetId = await dialAsset();
    const bg = { ...newBackground(), fill: { kind: "image" as const, assetId, zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } };
    let date = newDate({ font: { family: "Plus Jakarta Sans Variable", weight: 700 }, size: 22, color: AMBER, parts: ["weekday", "day"], tracking: -2 });
    await ready([date]);
    date = centreX({ ...date, y: 340 });
    const hour = newHand("hour", { length: 96, width: 14, tail: 16, color: INK, shape: "classic" });
    const minute = newHand("minute", { length: 156, width: 10, tail: 20, color: INK, shape: "classic" });
    const second = newHand("second", { length: 178, width: 3, tail: 38, color: AMBER, shape: "needle" });
    return project("Classic", [bg, date, hour, minute, second]);
  },
};

/** A dusk landscape drawn in code: sky gradient, a low sun and two ridges. Stands in until the user adds a photo. */
async function backdropAsset(): Promise<string> {
  const w = SCREEN_W * 2;
  const h = SCREEN_H * 2;
  const { sprite, ctx } = newSprite(w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#1B2A52");
  sky.addColorStop(0.55, "#B6577A");
  sky.addColorStop(0.78, "#F3A66B");
  sky.addColorStop(1, "#F7D08A");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sun = ctx.createRadialGradient(w * 0.68, h * 0.72, 10, w * 0.68, h * 0.72, w * 0.55);
  sun.addColorStop(0, "rgba(255,244,214,0.95)");
  sun.addColorStop(0.25, "rgba(255,200,140,0.55)");
  sun.addColorStop(1, "rgba(255,160,120,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  const ridge = (base: number, amp: number, phase: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = base + Math.sin(x / 190 + phase) * amp + Math.sin(x / 71 + phase * 2) * amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  ridge(h * 0.8, 46, 1.2, "#4A2F4F");
  ridge(h * 0.88, 38, 3.4, "#241632");
  return addGeneratedAsset(sprite.surface, "dusk-backdrop.png");
}

const photo: Template = {
  id: "photo",
  name: "Photo",
  blurb: "Your photo behind bold time. Swap the sample backdrop.",
  build: async () => {
    const assetId = await backdropAsset();
    const bg = { ...newBackground(), fill: { kind: "image" as const, assetId, zoom: 1, offsetX: 0, offsetY: 0, dim: 0.12 } };
    let date = newDate({ font: { family: "Outfit", weight: 700 }, size: 26, color: "#FFFFFF", parts: ["weekday", "day"], tracking: -2, outline: { color: "#2A1633", width: 2 } });
    let time = newTime({ font: { family: "Outfit", weight: 700 }, layout: "stack", size: 104, color: "#FFFFFF", tracking: 0, outline: { color: "#2A1633", width: 3 } });
    await ready([time, date]);
    time = { ...time, x: 36, y: 62 };
    date = { ...date, x: 44, y: time.y + bounds(time).h + 16 };
    return project("Photo", [bg, date, time]);
  },
};

const sport: Template = {
  id: "sport",
  name: "Sport",
  blurb: "Time on top, steps, heart rate and battery in view.",
  build: async () => {
    const bg = { ...newBackground(), fill: { kind: "solid" as const, color: "#070D0F" } };
    let time = newTime({ font: { family: "Oswald", weight: 600 }, size: 92, color: INK, tracking: 2 });
    let date = newDate({ font: { family: "Oswald", weight: 400 }, size: 24, color: MUTED, parts: ["weekday", "day"], tracking: -1 });
    const font = { family: "Oswald", weight: 600 };
    let steps = newWidget("steps", { font, size: 28, color: INK, iconColor: TEAL, layout: "stack" });
    let heart = newWidget("heartRate", { font, size: 44, color: INK, iconColor: ROSE });
    let battery = newWidget("battery", { font, size: 44, color: INK, iconColor: GREEN });
    const ring = newRing("steps", { size: 168, thickness: 14, color: TEAL, trackColor: TRACK, x: 0, y: 0 });
    await ready([time, date, steps, heart, battery]);
    time = centreX({ ...time, y: 76 });
    date = centreX({ ...date, y: 40 });
    heart = { ...heart, x: 52, y: 262 };
    battery = { ...battery, x: 52, y: 340 };
    const ringX = 214;
    const ringY = 246;
    steps = centreX({ ...steps, y: ringY + Math.round((ring.size - bounds(steps).h) / 2) }, ringX + ring.size / 2);
    return project("Sport", [bg, { ...ring, x: ringX, y: ringY }, time, date, steps, heart, battery]);
  },
};

const orbit: Template = {
  id: "orbit",
  name: "Orbit",
  blurb: "Analog hands inside steps and battery rings.",
  build: async () => {
    const bg = { ...newBackground(), fill: { kind: "gradient" as const, from: "#10242C", to: "#03090B", angle: 160 } };
    const outer = newRing("steps", { x: 16, y: 52, size: 376, thickness: 14, startAngle: 225, sweep: 270, color: TEAL, trackColor: TRACK });
    const inner = newRing("battery", { x: 44, y: 80, size: 320, thickness: 10, startAngle: 225, sweep: 270, color: GREEN, trackColor: TRACK });
    let date = newDate({ font: { family: "Plus Jakarta Sans Variable", weight: 700 }, size: 22, color: INK, parts: ["weekday", "day"], tracking: -2 });
    let time = newTime({ font: { family: "Plus Jakarta Sans Variable", weight: 700 }, size: 34, color: MUTED, tracking: 0 });
    await ready([date, time]);
    date = centreX({ ...date, y: 150 });
    time = centreX({ ...time, y: 396 });
    const hour = newHand("hour", { length: 84, width: 12, tail: 14, color: INK, shape: "baton" });
    const minute = newHand("minute", { length: 130, width: 9, tail: 18, color: INK, shape: "baton" });
    const second = newHand("second", { length: 146, width: 3, tail: 30, color: AMBER, shape: "needle" });
    return project("Orbit", [bg, outer, inner, date, time, hour, minute, second]);
  },
};

export const TEMPLATES: Template[] = [quiet, stackRing, classic, photo, sport, orbit];
