import { startOfLocalDay } from '@/features/today/stats';
import type { StepSample } from '@/wear';

/**
 * Daily strain, computed by JoyoFit from the watch's stored heart rate (the watch has no such number).
 *
 * Load is Edwards' summated-heart-rate-zone TRIMP (Edwards 1993): minutes in 50-60 / 60-70 / 70-80 / 80-90 / 90-100 % of
 * maximum heart rate count 1 / 2 / 3 / 4 / 5 times. Strain maps that load onto 0..21 with `21 * (1 - e^(-TRIMP / 250))`,
 * so easy minutes add a lot early in the day and the top is hard to reach. The 0..21 range copies the idea of WHOOP's
 * strain scale; the curve and its constant are JoyoFit's own and are not WHOOP's model. An hour of brisk walking
 * (zone 2, TRIMP 120) is about 8; an hour of steady running (zone 3, 180) about 11; two hard hours (480) about 18.
 */
export const STRAIN_MAX = 21;
const STRAIN_K = 250;

/** One reading stands for the time until the next one, at most this long: the watch reads heart rate every few minutes at rest. */
const MAX_READING_SEC = 10 * 60;

/** Edwards zone 0..5 at `heartRate`: 0 below 50 % of maximum, then one per 10 %. */
export function edwardsZone(heartRate: number, maxHr: number): number {
  const pct = (100 * heartRate) / maxHr;
  if (pct < 50) return 0;
  return Math.min(5, Math.floor((pct - 50) / 10) + 1);
}

export function strainFromTrimp(trimp: number): number {
  return STRAIN_MAX * (1 - Math.exp(-trimp / STRAIN_K));
}

export interface DayStrain {
  /** Local midnight, unix seconds. */
  day: number;
  trimp: number;
  /** 0..21. */
  strain: number;
  /** Minutes in Edwards zones 1..5 (index 0 is zone 1). */
  zoneMinutes: [number, number, number, number, number];
  /** Minutes the stored heart rate covers; strain is only as complete as this. */
  coveredMinutes: number;
}

/**
 * Strain per local day from per-minute samples (oldest first). Samples without heart rate are skipped; each reading
 * counts until the next reading or [MAX_READING_SEC], whichever is first, and never past its day's midnight.
 */
export function dailyStrain(samples: readonly StepSample[], maxHr: number): DayStrain[] {
  const withHr = samples.filter((s) => s.heartRate !== null && s.heartRate > 0);
  const days = new Map<number, DayStrain>();
  for (let i = 0; i < withHr.length; i++) {
    const sample = withHr[i];
    const day = startOfLocalDay(sample.timestamp);
    const next = withHr[i + 1]?.timestamp ?? sample.timestamp + 60;
    const until = Math.min(next, sample.timestamp + MAX_READING_SEC, day + 24 * 3600);
    const minutes = Math.max(1, until - sample.timestamp) / 60;
    let entry = days.get(day);
    if (!entry) {
      entry = { day, trimp: 0, strain: 0, zoneMinutes: [0, 0, 0, 0, 0], coveredMinutes: 0 };
      days.set(day, entry);
    }
    entry.coveredMinutes += minutes;
    const zone = edwardsZone(sample.heartRate as number, maxHr);
    if (zone > 0) {
      entry.zoneMinutes[zone - 1] += minutes;
      entry.trimp += zone * minutes;
    }
  }
  return [...days.values()]
    .map((entry) => ({ ...entry, strain: strainFromTrimp(entry.trimp) }))
    .sort((a, b) => a.day - b.day);
}
