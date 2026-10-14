import type { Sim } from "@/model/types";

/** What a digit sequence or a selected-by-value image shows. */
export type DataRole =
  | "hour"
  | "minute"
  | "second"
  | "ampm"
  | "weekday"
  | "day"
  | "month"
  | "steps"
  | "heartRate"
  | "battery"
  | "calories";

export interface ClockFields {
  hour: number;
  minute: number;
  second: number;
  pm: boolean;
  weekday: number;
  day: number;
  month: number;
}

export function clockFields(timeMs: number, ampm: boolean): ClockFields {
  const d = new Date(timeMs);
  const h = d.getHours();
  return {
    hour: ampm ? h % 12 || 12 : h,
    minute: d.getMinutes(),
    second: d.getSeconds(),
    pm: h >= 12,
    /** 0 = Monday ... 6 = Sunday. */
    weekday: (d.getDay() + 6) % 7,
    day: d.getDate(),
    month: d.getMonth(),
  };
}

export function digitList(value: number, minDigits: number): number[] {
  return String(Math.max(0, Math.floor(value))).padStart(minDigits, "0").split("").map(Number);
}

export function defaultSim(now = Date.now()): Sim {
  const d = new Date(now);
  d.setHours(10, 9, 36, 0);
  return { timeMs: d.getTime(), live: false, steps: 6842, stepGoal: 10000, heartRate: 72, battery: 78, calories: 412 };
}

/** Value of a numeric data source, clamped to what the watch can show. */
export function numericValue(role: "steps" | "heartRate" | "battery" | "calories", sim: Sim): number {
  if (role === "battery") return Math.max(0, Math.min(100, Math.round(sim.battery)));
  return Math.max(0, Math.round(sim[role]));
}

export function ringFraction(source: "steps" | "battery", sim: Sim): number {
  const f = source === "battery" ? sim.battery / 100 : sim.steps / Math.max(1, sim.stepGoal);
  return Math.max(0, Math.min(1, f));
}
