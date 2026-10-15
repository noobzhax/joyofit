import { readiness, type Readiness } from '@/features/today/readiness';
import { recovery } from '@/features/today/recovery';
import { lastSleepSession } from '@/features/today/stats';
import { type DayStrain } from '@/features/today/strain';
import type { TodayData } from '@/features/today/useTodayData';

export interface Scores {
  maxHr: number;
  strain: DayStrain[];
  today: DayStrain | null;
  readiness: Readiness;
}

/** Strain per day and today's readiness (with recovery when HRV allows) from stored history; Today and the Readiness screen share it. */
export function computeScores(data: TodayData): Scores {
  const { maxHr, strain } = data;
  return {
    maxHr,
    strain,
    today: strain.find((d) => d.day === data.dayStart) ?? null,
    readiness: readiness({
      dayStart: data.dayStart,
      resting: data.resting,
      strain,
      sleep: lastSleepSession(data.sleep),
      hrv: recovery(data.hrv, data.nowSec),
    }),
  };
}
