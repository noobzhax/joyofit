import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import {
  listHeartRatesSince,
  listHrvReadingsSince,
  listRestingHeartRateByDay,
  listSleepSince,
  type HeartRateRow,
  type HrvReadingRow,
} from '@/db/queries';
import { errorMessage } from '@/format';
import { startOfLocalDay } from '@/features/today/stats';
import { addDays, dayBounds, dayStarts, type TrendRange } from '@/features/trends/series';
import type { SleepSegment } from '@/wear';

/** Days of HRV before the first charted day that recovery compares against. */
const BASELINE_DAYS = 31;

export interface TrendsData {
  range: TrendRange;
  /** Local midnights, oldest first, ending with today. */
  days: number[];
  /** Heart-rate readings from the day before the first day (sleep need follows the previous day's strain). */
  heart: HeartRateRow[];
  resting: Map<number, number>;
  hrv: HrvReadingRow[];
  sleep: SleepSegment[];
}

interface TrendsState {
  data: TrendsData | null;
  error: string | null;
}

/**
 * One query set per range, re-run when the screen gains focus or `dataVersion` changes (after a sync). The previous
 * range stays in `data` until the new one has loaded. Per-minute steps are never read: strain needs only heart rate
 * and resting heart rate is aggregated per day in SQL.
 */
export function useTrendsData(range: TrendRange, dataVersion: number): TrendsState {
  const db = useSQLiteContext();
  const [state, setState] = useState<TrendsState>({ data: null, error: null });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const days = dayStarts(startOfLocalDay(Math.floor(Date.now() / 1000)), range);
      Promise.all([
        listHeartRatesSince(db, addDays(days[0], -1)),
        listRestingHeartRateByDay(db, dayBounds(days)),
        listHrvReadingsSince(db, addDays(days[0], -BASELINE_DAYS)),
        // A night that ends on the first day started the evening before.
        listSleepSince(db, days[0] - 12 * 3600),
      ]).then(
        ([heart, resting, hrv, sleep]) => {
          if (!cancelled) setState({ data: { range, days, heart, resting, hrv, sleep }, error: null });
        },
        (e: unknown) => {
          if (!cancelled) setState({ data: null, error: errorMessage(e) });
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the queries after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, range, dataVersion]),
  );

  return state;
}
