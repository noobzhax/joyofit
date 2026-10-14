import type { IconName } from '@/components/IconChip';
import type { Tint } from '@/theme';

/** How one `health_metrics.type` is named, shown and coloured. Types not listed here use a generic card. */
export interface MetricMeta {
  label: string;
  icon: IconName;
  tint: Tint;
  /** Unit written after the number; empty when `format` already says it. */
  unit: string;
  /** Short line under the value: what the number is. */
  hint?: string;
  format: (value: number) => string;
}

const oneDecimal = (v: number) => v.toFixed(1);
const whole = (v: number) => String(Math.round(v));

/** Known metrics; key order is the display order. The raw ones (value = null) only need a title. */
const META: Record<string, MetricMeta | undefined> = {
  skin_temperature: { label: 'Skin temperature', icon: 'thermometer', tint: 'workouts', unit: '\u00B0C', format: oneDecimal },
  hrv: { label: 'HRV', icon: 'pulse', tint: 'heart', unit: 'ms', hint: 'RMSSD', format: whole },
  emotion: { label: 'Stress / emotion', icon: 'happy', tint: 'sleep', unit: '', hint: 'Status 0 to 100', format: whole },
  sleep_apnea: { label: 'Sleep apnea', icon: 'moon', tint: 'sleep', unit: '', hint: 'Level 1 to 4', format: (v) => `Level ${Math.round(v)}` },
  arterial_stiffness: { label: 'Arterial stiffness', icon: 'fitness', tint: 'heart', unit: '', format: whole },
  blood_pressure: { label: 'Blood pressure', icon: 'water', tint: 'heart', unit: '', format: whole },
  altitude: { label: 'Altitude', icon: 'trending-up', tint: 'steps', unit: '', format: whole },
  ams: { label: 'Altitude sickness', icon: 'warning', tint: 'workouts', unit: '', format: whole },
  arrhythmia: { label: 'Arrhythmia', icon: 'heart-half', tint: 'heart', unit: '', format: whole },
};

/** Known types in display order; unknown types sort after them. */
export const METRIC_ORDER = Object.keys(META);

/** A type nobody knows gets this generic look and is titled by the caller. */
const FALLBACK: MetricMeta = {
  label: '',
  icon: 'analytics',
  tint: 'steps',
  unit: '',
  format: (v) => String(Math.round(v * 100) / 100),
};

export function metaOrFallback(type: string): MetricMeta {
  return META[type] ?? FALLBACK;
}

export const WEEK_DAYS = 7;

/** Local midnights (unix seconds) of the last `WEEK_DAYS` days, oldest first; the last one is today. */
export function weekDayStarts(nowSec: number): number[] {
  const today = new Date(nowSec * 1000);
  const starts: number[] = [];
  for (let back = WEEK_DAYS - 1; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    starts.push(Math.floor(d.getTime() / 1000));
  }
  return starts;
}

export interface WeekPoint {
  /** Unix seconds of local midnight of that day. */
  dayStart: number;
  /** Mean of that day's values, or null when the day has none. */
  mean: number | null;
}

/** Daily means over the last seven local days from rows with a value. */
export function dailyMeans(rows: readonly { ts: number; value: number }[], nowSec: number): WeekPoint[] {
  const starts = weekDayStarts(nowSec);
  const sums = new Array<number>(starts.length).fill(0);
  const counts = new Array<number>(starts.length).fill(0);
  for (const row of rows) {
    for (let i = starts.length - 1; i >= 0; i--) {
      if (row.ts >= starts[i]) {
        sums[i] += row.value;
        counts[i] += 1;
        break;
      }
    }
  }
  return starts.map((dayStart, i) => ({ dayStart, mean: counts[i] > 0 ? sums[i] / counts[i] : null }));
}

/** Parsed `values_json` as label/value pairs; anything that is not a JSON object comes back as one raw line. */
export function rawPairs(valuesJson: string): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(valuesJson);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ]);
    }
  } catch {
    // Not JSON: show the text as it is below.
  }
  return [['raw', valuesJson]];
}
