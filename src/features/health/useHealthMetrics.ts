import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { dailyMeans, METRIC_ORDER, weekDayStarts, type WeekPoint } from '@/features/health/metrics';
import { errorMessage } from '@/format';
import type { HealthMetricRow, HealthMetricStatusRow } from '@/wear';

export interface HealthMetricData {
  type: string;
  /** The last gate check or sync for this type; null when only stored rows exist. */
  status: HealthMetricStatusRow | null;
  /** Newest stored row by `ts`; null when nothing is stored. */
  latest: HealthMetricRow | null;
  /** Daily means of the last seven local days, oldest first; empty when no row has a `value`. */
  week: WeekPoint[];
}

export interface HealthData {
  /** True when no status row exists: the watch was never connected and synced with this feature. */
  neverChecked: boolean;
  metrics: HealthMetricData[];
}

interface HealthState {
  data: HealthData | null;
  error: string | null;
}

/**
 * Reads `health_metric_status` and, for every type with a status row or stored rows, the newest
 * row plus the last seven days. Re-queries when the tab gains focus and when `dataVersion` changes
 * (after a sync).
 */
export function useHealthMetrics(dataVersion: number): HealthState {
  const db = useSQLiteContext();
  const [state, setState] = useState<HealthState>({ data: null, error: null });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const load = async (): Promise<HealthData> => {
        const nowSec = Math.floor(Date.now() / 1000);
        const weekStart = weekDayStarts(nowSec)[0];
        const statuses = await db.getAllAsync<HealthMetricStatusRow>(
          `SELECT type, dict_class, title, supported, gate, checked_at, synced_at, rows_added, note
           FROM health_metric_status ORDER BY dict_class`,
        );
        const stored = await db.getAllAsync<{ type: string }>('SELECT DISTINCT type FROM health_metrics');
        const types = [...new Set([...statuses.map((s) => s.type), ...stored.map((s) => s.type)])];
        const order = (type: string) => {
          const i = METRIC_ORDER.indexOf(type);
          return i === -1 ? METRIC_ORDER.length : i;
        };
        types.sort((a, b) => order(a) - order(b) || a.localeCompare(b));

        const metrics = await Promise.all(
          types.map(async (type): Promise<HealthMetricData> => {
            const latest = await db.getFirstAsync<HealthMetricRow>(
              'SELECT type, ts, last_ts, value, values_json FROM health_metrics WHERE type = ? ORDER BY ts DESC LIMIT 1',
              type,
            );
            const rows = await db.getAllAsync<{ ts: number; value: number }>(
              'SELECT ts, value FROM health_metrics WHERE type = ? AND ts >= ? AND value IS NOT NULL ORDER BY ts',
              type,
              weekStart,
            );
            return {
              type,
              status: statuses.find((s) => s.type === type) ?? null,
              latest,
              week: rows.length > 0 ? dailyMeans(rows, nowSec) : [],
            };
          }),
        );
        return { neverChecked: statuses.length === 0, metrics };
      };
      load().then(
        (data) => {
          if (!cancelled) setState({ data, error: null });
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
    }, [db, dataVersion]),
  );

  return state;
}
