import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import {
  getLatestHeartRate,
  listDayHeartLoad,
  listHrvReadingsSince,
  listRestingHeartRateByDay,
  listSleepScores,
  listSleepSince,
  listStepSamplesSince,
  type HrvReadingRow,
  type SleepScoreRow,
} from '@/db/queries';
import { errorMessage } from '@/format';
import { startOfLocalDay } from '@/features/today/stats';
import { strainFromLoads, zoneThresholds, type DayStrain } from '@/features/today/strain';
import { dayBounds, dayStarts } from '@/features/trends/series';
import { userMaxHr } from '@/features/workouts/useWorkoutStrain';
import type { SleepSegment, StepSample } from '@/wear';

/** Sleep older than this is not "last night"; the session picker only looks this far back. */
const SLEEP_LOOKBACK_SEC = 36 * 3600;

/** Strain bars show today and the six days before it. */
export const STRAIN_DAYS = 7;
/** History for readiness: the 30-day resting heart-rate baseline and 28-day training load. */
export const HISTORY_DAYS = 30;

export interface TodayData {
  /** Local midnight (unix seconds) the samples were queried from. */
  dayStart: number;
  /** Samples from `dayStart` onwards, oldest first. Only today's per-minute rows are read; history is aggregated in SQL. */
  samples: StepSample[];
  maxHr: number;
  /** Strain per day from `HISTORY_DAYS` days before `dayStart` through today, oldest first; days without heart rate are absent. */
  strain: DayStrain[];
  /** The watch's resting heart rate per local day over the same span (readiness baseline). */
  resting: Map<number, number>;
  sleep: SleepSegment[];
  /** The watch's sleep scores; Today picks the one for last night. */
  sleepScores: SleepScoreRow[];
  /** Newest stored heart-rate reading of any day; the hero falls back to it when today has none. */
  latestHeart: { bpm: number; timestamp: number } | null;
  /** HRV readings of the last `HISTORY_DAYS + 1` days, oldest first (recovery). */
  hrv: HrvReadingRow[];
  /** Unix seconds the data was read. */
  nowSec: number;
}

interface TodayState {
  data: TodayData | null;
  error: string | null;
}

/** Re-queries stored data whenever the tab gains focus or `dataVersion` changes (after a sync). */
export function useTodayData(dataVersion: number): TodayState {
  const db = useSQLiteContext();
  const [state, setState] = useState<TodayState>({ data: null, error: null });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const nowSec = Math.floor(Date.now() / 1000);
      const dayStart = startOfLocalDay(nowSec);
      const maxHr = userMaxHr();
      const bounds = dayBounds(dayStarts(dayStart, HISTORY_DAYS + 1));
      Promise.all([
        listStepSamplesSince(db, dayStart),
        listDayHeartLoad(db, bounds, zoneThresholds(maxHr)),
        listRestingHeartRateByDay(db, bounds),
        listSleepSince(db, nowSec - SLEEP_LOOKBACK_SEC),
        getLatestHeartRate(db),
        listSleepScores(db),
        listHrvReadingsSince(db, dayStart - (HISTORY_DAYS + 1) * 86400),
      ]).then(
        ([samples, loads, resting, sleep, latestHeart, sleepScores, hrv]) => {
          if (!cancelled) {
            const strain = strainFromLoads(loads);
            setState({ data: { dayStart, nowSec, samples, maxHr, strain, resting, sleep, sleepScores, latestHeart, hrv }, error: null });
          }
        },
        (e: unknown) => {
          if (!cancelled) setState({ data: null, error: errorMessage(e) });
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  return state;
}
