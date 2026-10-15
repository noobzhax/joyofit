import type { HrvReadingRow } from '@/db/queries';
import { sleepNeedSec } from '@/features/today/readiness';
import { recovery } from '@/features/today/recovery';
import { startOfLocalDay } from '@/features/today/stats';
import type { DayStrain } from '@/features/today/strain';
import type { Night } from '@/features/sleep/nights';

/** One value per day, aligned with the day list; null where the day has no data (never filled in). */
export type DaySeries = (number | null)[];

export const TREND_RANGES = [30, 90] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

/** Local midnight `n` calendar days from `day` (negative goes back); computed at noon so a daylight-saving shift cannot land on the wrong date. */
export function addDays(day: number, n: number): number {
  const d = new Date((day + 12 * 3600) * 1000);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** The last `count` local days ending with the one that starts at `todayStart`, oldest first. */
export function dayStarts(todayStart: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => addDays(todayStart, i + 1 - count));
}

/** Day starts plus the midnight after the last one: the bounds of every day in the list. */
export function dayBounds(days: readonly number[]): number[] {
  return days.length === 0 ? [] : [...days, addDays(days[days.length - 1], 1)];
}

function indexByDay(days: readonly number[]): Map<number, number> {
  return new Map(days.map((day, i) => [day, i]));
}

/**
 * Recovery % per day, from `recovery()` itself. A day's reading is the night that ended on it, or when there is none
 * the last 1-minute reading of the day. It is compared with earlier readings of the same kind only, so the same
 * baseline rules (30 days, at least four readings) hold on every day as on Today. `readings` oldest first, and it must
 * reach 30 days before the first day for the first days to have a baseline.
 */
export function recoverySeries(days: readonly number[], readings: readonly HrvReadingRow[]): DaySeries {
  return days.map((day, i) => {
    const dayEnd = i + 1 < days.length ? days[i + 1] : addDays(day, 1);
    const ofDay = readings.filter((r) => r.end >= day && r.end < dayEnd && r.rmssd > 0);
    const chosen = [...ofDay].reverse().find((r) => r.source === 'night') ?? ofDay[ofDay.length - 1];
    if (!chosen) return null;
    const history = readings.filter((r) => r.source === chosen.source && r.end < day);
    const state = recovery([...history, chosen], chosen.end);
    return 'recovery' in state ? state.recovery.percent : null;
  });
}

/** Mean RMSSD (ms) per day of the readings of one kind that ended on that day. */
export function hrvSeries(days: readonly number[], readings: readonly HrvReadingRow[], source: HrvReadingRow['source']): DaySeries {
  const index = indexByDay(days);
  const sums = days.map(() => ({ total: 0, count: 0 }));
  for (const r of readings) {
    if (r.source !== source || r.rmssd <= 0) continue;
    const i = index.get(startOfLocalDay(r.end));
    if (i === undefined) continue;
    sums[i].total += r.rmssd;
    sums[i].count += 1;
  }
  return sums.map((s) => (s.count === 0 ? null : s.total / s.count));
}

/** A value per day from a map keyed by local midnight. */
export function seriesFromMap(days: readonly number[], byDay: ReadonlyMap<number, number>): DaySeries {
  return days.map((day) => byDay.get(day) ?? null);
}

export function strainSeries(days: readonly number[], strain: readonly DayStrain[]): DaySeries {
  return seriesFromMap(days, new Map(strain.map((d) => [d.day, d.strain])));
}

export interface SleepSeries {
  /** Hours asleep in the night that ended on each day (naps left out, several sessions added up). */
  hours: DaySeries;
  /** Hours needed per day: the base need plus the extra after the previous day's strain; the base alone when that day has no strain. */
  need: number[];
}

export function sleepSeries(days: readonly number[], nights: readonly Night[], strain: readonly DayStrain[]): SleepSeries {
  const index = indexByDay(days);
  const hours: DaySeries = days.map(() => null);
  for (const night of nights) {
    if (night.nap) continue;
    const i = index.get(startOfLocalDay(night.end));
    if (i === undefined) continue;
    hours[i] = (hours[i] ?? 0) + night.asleepSeconds / 3600;
  }
  const strainByDay = new Map(strain.map((d) => [d.day, d.strain]));
  return {
    hours,
    need: days.map((day) => sleepNeedSec(strainByDay.get(addDays(day, -1)) ?? null) / 3600),
  };
}

export interface SeriesSummary {
  latest: number;
  /** Days between the latest value and the last day of the series (0 = today). */
  daysAgo: number;
  average: number;
  /** Days that have a value. */
  count: number;
}

/** Latest value, mean and number of days with data, or null when the series is empty. */
export function summarize(values: DaySeries): SeriesSummary | null {
  let total = 0;
  let count = 0;
  let last = -1;
  values.forEach((v, i) => {
    if (v === null) return;
    total += v;
    count += 1;
    last = i;
  });
  if (count === 0) return null;
  return { latest: values[last] as number, daysAgo: values.length - 1 - last, average: total / count, count };
}
