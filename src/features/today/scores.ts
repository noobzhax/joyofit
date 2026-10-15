import { readiness, type Readiness } from '@/features/today/readiness';
import { recovery } from '@/features/today/recovery';
import { lastSleepSession } from '@/features/today/stats';
import { dailyStrain, type DayStrain } from '@/features/today/strain';
import type { TodayData } from '@/features/today/useTodayData';
import { DEFAULT_AGE, maxHeartRate } from '@/features/workouts/substrate';
import { HuaweiWear } from '@/wear';

export interface Scores {
  maxHr: number;
  strain: DayStrain[];
  today: DayStrain | null;
  readiness: Readiness;
}

/** Strain per day and today's readiness (with recovery when HRV allows) from stored history; Today and the Readiness screen share it. */
export function computeScores(data: TodayData): Scores {
  const birthYear = HuaweiWear.getUserProfile()?.birthYear;
  const maxHr = maxHeartRate(birthYear ? new Date().getFullYear() - birthYear : DEFAULT_AGE);
  const strain = dailyStrain(data.historySamples, maxHr);
  return {
    maxHr,
    strain,
    today: strain.find((d) => d.day === data.dayStart) ?? null,
    readiness: readiness({
      dayStart: data.dayStart,
      samples: data.historySamples,
      strain,
      sleep: lastSleepSession(data.sleep),
      hrv: recovery(data.hrv, data.nowSec),
    }),
  };
}
