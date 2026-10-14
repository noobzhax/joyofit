/**
 * JoyoFit Pulse: design constants and the layout arithmetic (positions in 408 x 480 watch pixels).
 *
 * Palette = the dark palette of src/theme.ts: ink-teal primary `#58C4DE` is the steps colour and the only accent, heart is
 * rose, battery/link is green; chips use the theme's `*Soft` tints. The time is a warm paper white (JoyoRogo's warmth
 * against the cool teal), weekday and units use `mutedForeground`.
 *
 * Screen composition (y down):
 *
 *   36  ┌ weekday | date  (centred on x = 204: weekday right-aligned to the axis, date left-aligned from it)
 *   84  │ HH  (hero, two tabular cells)             ╭ steps ring  ╮  seconds tick orbits the ring
 *  206  │ MM                                         │  icon+steps │
 *  366  └ [♥ 72 bpm]  [⚡ 81 %]  chips               ╰─────────────╯
 *
 * AOD: outlined, dimmed hero digits only, centred on the screen (no date, no widgets, no seconds).
 */
import type { Catalogue } from "./sprites";

export const SCREEN = { w: 408, h: 480 } as const;

export const C = {
  bg: "#000000",
  ink: "#F5F1E8",
  muted: "#9BA6A8",
  steps: "#58C4DE",
  stepsTrack: "#12323C",
  heart: "#FF7B93",
  heartSoft: "#42202B",
  link: "#5FD08D",
  linkSoft: "#123324",
  aod: "#8A9395",
} as const;

export const FONT = { family: "Plus Jakarta Sans" } as const;

export const SIZE = {
  hero: 134,
  aodStroke: 3,
  date: 25,
  number: 30,
  stepsNumber: 27,
  icon: 26,
  stepsIcon: 28,
  unit: 17,
  /** The heart-rate chip is wider: three digits plus "bpm" must clear the icon (148 bpm). */
  chipHeartW: 176,
  chipBatteryW: 148,
  chipH: 56,
  chipR: 18,
} as const;

/** Steps ring (Arc_Res): compass degrees, 0 = 12 o'clock, clockwise; the 80 degree gap sits at the bottom. */
export const STEPS_RING = { size: 136, radius: 60, lineWidth: 10, startAngle: 220, endAngle: 500 } as const;

/** Seconds tick (Hand_Res): `bar` wide, spans radii `rIn`..`rOut` from the ring centre. */
export const TICK = { w: 6, h: 10, bar: 3, opacity: 0.85, rOut: 78 } as const;

export interface Point {
  x: number;
  y: number;
}

export interface Positions {
  hourX: number;
  hourY: number;
  minuteX: number;
  minuteY: number;
  /** AOD copies of the hero digits: centred on the screen (not left-aligned like the normal display). */
  aodHour: Point;
  aodMinute: Point;
  dateAxis: number;
  dateY: number;
  weekdayX: number;
  dateDigitsX: number;
  ringCenter: Point;
  ringRect: { x: number; y: number; width: number; height: number };
  stepsIcon: Point;
  stepsNumber: Point;
  tickRect: { x: number; y: number; width: number; height: number };
  tickPivot: Point;
  chips: { heart: Point; battery: Point };
  heartIcon: Point;
  heartNumber: Point;
  heartUnit: Point;
  batteryIcon: Point;
  batteryNumber: Point;
  batteryUnit: Point;
}

const MARGIN = 32;
const DATE_Y = 40;
const HERO_Y = 90;
const HERO_GAP = 10;
const RING_GAP = 24;
const CHIP_Y = 372;
const CHIP_GAP = 12;
const CHIP_PAD = 16;
const AXIS_GAP = 12;

export function layoutFor(cat: Catalogue): Positions {
  const { heroCell, smallCell, dateCell, weekdayW } = cat;
  const pairW = heroCell.w * 2;

  const hourX = MARGIN;
  const hourY = HERO_Y;
  const minuteY = hourY + heroCell.h + HERO_GAP;
  const stackBottom = minuteY + heroCell.h;

  const ringSize = STEPS_RING.size;
  const ringCx = MARGIN + pairW + RING_GAP + ringSize / 2;
  const ringCy = Math.round((hourY + stackBottom) / 2);
  const ringRect = { x: Math.round(ringCx - ringSize / 2), y: Math.round(ringCy - ringSize / 2), width: ringSize, height: ringSize };

  const dateAxis = SCREEN.w / 2;
  const aodY = Math.round((SCREEN.h - (heroCell.h * 2 + HERO_GAP)) / 2);

  const tickReach = TICK.rOut + 4;
  const chipHeartX = (SCREEN.w - SIZE.chipHeartW - SIZE.chipBatteryW - CHIP_GAP) / 2;
  const chipBatteryX = chipHeartX + SIZE.chipHeartW + CHIP_GAP;
  const chipCy = CHIP_Y + SIZE.chipH / 2;
  const smallY = Math.round(chipCy - smallCell.h / 2);
  const iconY = (size: number) => Math.round(chipCy - size / 2);

  const heartUnitX = chipHeartX + SIZE.chipHeartW - CHIP_PAD - cat.unitBpm.w;
  const batteryUnitX = chipBatteryX + SIZE.chipBatteryW - CHIP_PAD - cat.unitPercent.w;

  return {
    hourX,
    hourY,
    minuteX: hourX,
    minuteY,
    aodHour: { x: Math.round((SCREEN.w - pairW) / 2), y: aodY },
    aodMinute: { x: Math.round((SCREEN.w - pairW) / 2), y: aodY + heroCell.h + HERO_GAP },
    dateAxis,
    dateY: DATE_Y,
    weekdayX: dateAxis - AXIS_GAP / 2 - weekdayW,
    dateDigitsX: dateAxis + AXIS_GAP / 2,
    ringCenter: { x: ringCx, y: ringCy },
    ringRect,
    stepsIcon: { x: Math.round(ringCx - cat.iconSteps.w / 2), y: ringCy - 38 },
    stepsNumber: { x: Math.round(ringCx), y: ringCy - 6 },
    tickRect: { x: Math.round(ringCx - tickReach), y: Math.round(ringCy - tickReach), width: tickReach * 2, height: tickReach * 2 },
    tickPivot: { x: TICK.w / 2, y: TICK.rOut + 1 },
    chips: { heart: { x: chipHeartX, y: CHIP_Y }, battery: { x: chipBatteryX, y: CHIP_Y } },
    heartIcon: { x: chipHeartX + CHIP_PAD, y: iconY(cat.iconHeart.h) },
    heartNumber: { x: heartUnitX - 5, y: smallY },
    heartUnit: { x: heartUnitX, y: smallY },
    batteryIcon: { x: chipBatteryX + CHIP_PAD, y: iconY(cat.iconBattery.h) },
    batteryNumber: { x: batteryUnitX - 3, y: smallY },
    batteryUnit: { x: batteryUnitX, y: smallY },
  };
}
