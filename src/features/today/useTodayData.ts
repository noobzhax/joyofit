import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { listSleepSince, listStepSamplesSince } from '@/db/queries';
import { errorMessage } from '@/format';
import { startOfLocalDay } from '@/features/today/stats';
import type { SleepSegment, StepSample } from '@/wear';

/** Sleep older than this is not "last night"; the session picker only looks this far back. */
const SLEEP_LOOKBACK_SEC = 36 * 3600;

export interface TodayData {
  /** Local midnight (unix seconds) the samples were queried from. */
  dayStart: number;
  /** Samples from `dayStart` onwards, oldest first. */
  samples: StepSample[];
  sleep: SleepSegment[];
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
      Promise.all([
        listStepSamplesSince(db, dayStart),
        listSleepSince(db, nowSec - SLEEP_LOOKBACK_SEC),
      ]).then(
        ([samples, sleep]) => {
          if (!cancelled) setState({ data: { dayStart, samples, sleep }, error: null });
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
