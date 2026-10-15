import type { WorkoutPointRow } from '@/db/queries';

/**
 * Fat and carbohydrate burned, estimated by JoyoFit (the watch reports neither). Same model as the live screen
 * (`SubstrateEstimator` in LiveWorkoutCodec.kt): %HRmax to %VO2max after Swain (1994), a respiratory exchange ratio curve
 * through typical values (Romijn 1993, Achten 2003), fat share of energy `(1 - RER) / 0.3`, 9 kcal per gram of fat and 4
 * per gram of carbohydrate.
 */
const RER_POINTS: readonly [number, number][] = [
  [25, 0.78],
  [45, 0.83],
  [65, 0.88],
  [85, 0.95],
  [100, 1.0],
];

export const KCAL_PER_G_FAT = 9;
export const KCAL_PER_G_CARB = 4;
/** Used for the maximum heart rate when no profile is saved (220 - 35 = 185 bpm); the native side uses the same. */
export const DEFAULT_AGE = 35;
/** Heart rate taken as rest when weighting where in the workout the calories were burned. */
const REST_HR = 60;
/** A gap longer than this between heart-rate samples is a pause; it gets no weight. */
const MAX_GAP_SEC = 120;

export function maxHeartRate(age: number): number {
  return Math.min(220, Math.max(120, 220 - age));
}

/** Share of energy from fat (0..1) at `heartRate`. */
export function fatShare(heartRate: number, maxHr: number): number {
  const pctHrMax = (100 * heartRate) / maxHr;
  const pctVo2 = Math.min(100, Math.max(25, (pctHrMax - 37) / 0.64));
  let rer = RER_POINTS[RER_POINTS.length - 1][1];
  for (let i = 1; i < RER_POINTS.length; i++) {
    const [x1, y1] = RER_POINTS[i];
    if (pctVo2 <= x1) {
      const [x0, y0] = RER_POINTS[i - 1];
      rer = y0 + ((y1 - y0) * (pctVo2 - x0)) / (x1 - x0);
      break;
    }
  }
  return Math.min(1, Math.max(0, (1 - rer) / 0.3));
}

/** Time and burn in one heart-rate zone (Huawei's: 50/60/70/80/90 % of maximum; zone 0 is below 50 %). */
export interface ZoneBurn {
  zone: number;
  label: string;
  seconds: number;
  fatGrams: number;
  carbGrams: number;
}

export interface SubstrateSplit {
  fatGrams: number;
  carbGrams: number;
  /** Share of the workout's energy from fat, 0..1. */
  fatShare: number;
  /** Zones the workout spent time in, lowest first. */
  zones: ZoneBurn[];
}

const ZONE_LABELS = ['Below zones', 'Warm-up', 'Fat burning', 'Aerobic', 'Anaerobic', 'Extreme'];

/** Huawei's zones by share of maximum heart rate: 50, 60, 70, 80, 90 %. */
export function zoneOf(heartRate: number, maxHr: number): number {
  const pct = heartRate / maxHr;
  if (pct < 0.5) return 0;
  return Math.min(5, Math.floor((pct - 0.5) / 0.1) + 1);
}

/**
 * Splits a finished workout's `calories` (kcal) between fat and carbohydrate from the time actually spent at each heart
 * rate: every heart-rate sample covers the time to the next one (gaps over two minutes are pauses and count for nothing),
 * gets the calories of that slice in proportion to the effort above rest, then the fat share at that heart rate. Null
 * when there are no heart-rate samples to work from; an average is never used.
 */
export function splitWorkout(calories: number, points: readonly WorkoutPointRow[], maxHr: number): SubstrateSplit | null {
  if (calories <= 0) return null;
  const samples = points.filter((p) => p.hr !== null && p.hr > 0).sort((a, b) => a.ts - b.ts);
  const slices: { hr: number; dt: number; weight: number }[] = [];
  let weightSum = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const dt = samples[i + 1].ts - samples[i].ts;
    if (dt <= 0 || dt > MAX_GAP_SEC) continue;
    const hr = samples[i].hr as number;
    const weight = Math.max(hr - REST_HR, 1) * dt;
    slices.push({ hr, dt, weight });
    weightSum += weight;
  }
  if (weightSum <= 0) return null;
  const zones = new Map<number, ZoneBurn>();
  let fatKcal = 0;
  for (const s of slices) {
    const kcal = (calories * s.weight) / weightSum;
    const fat = kcal * fatShare(s.hr, maxHr);
    fatKcal += fat;
    const z = zoneOf(s.hr, maxHr);
    const entry = zones.get(z) ?? { zone: z, label: ZONE_LABELS[z], seconds: 0, fatGrams: 0, carbGrams: 0 };
    entry.seconds += s.dt;
    entry.fatGrams += fat / KCAL_PER_G_FAT;
    entry.carbGrams += (kcal - fat) / KCAL_PER_G_CARB;
    zones.set(z, entry);
  }
  return {
    fatGrams: fatKcal / KCAL_PER_G_FAT,
    carbGrams: (calories - fatKcal) / KCAL_PER_G_CARB,
    fatShare: fatKcal / calories,
    zones: [...zones.values()].sort((a, b) => a.zone - b.zone),
  };
}
