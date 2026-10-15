import type { Recovery, RecoveryState } from '@/features/today/recovery';
import { type SleepSummary } from '@/features/today/stats';
import type { DayStrain } from '@/features/today/strain';

/**
 * "Should you push today?" from your own history. Each signal is shown with its numbers, and a signal without enough
 * history is left out instead of guessed.
 *
 *  - HRV against your 30-day baseline (see `recovery.ts`), from the watch's own RMSSD during last night's sleep or a 1-minute reading.
 *  - Resting heart rate against your own 30-day average (Lamberts: a resting heart rate a few beats above baseline
 *    goes with fatigue or illness).
 *  - Last night's sleep against a need of 7 h 30 min plus up to 1 h after a hard day (yesterday's strain / 21).
 *  - Training load balance: the average strain of the last 7 days against the last 28 (acute:chronic workload ratio,
 *    Gabbett 2016; above 1.5 raises injury risk, below 0.8 is detraining).
 */
export const BASE_SLEEP_NEED_SEC = 7.5 * 3600;
const EXTRA_NEED_SEC = 3600;
/** Days of history the resting heart rate needs before it is compared. */
const MIN_BASELINE_DAYS = 7;
/** Days with heart rate the load balance needs. */
const MIN_LOAD_DAYS = 14;
export const LOAD_DAYS = 28;

export type SignalTone = 'good' | 'neutral' | 'bad';
export interface Signal {
  key: 'hrv' | 'rhr' | 'sleep' | 'load';
  title: string;
  value: string;
  detail: string;
  tone: SignalTone;
  /** The number behind `value`: HRV z-score, bpm above baseline, share of sleep need (0..), or the load ratio. */
  amount: number;
}

export type ReadinessHeadline = 'Primed' | 'Balanced' | 'Strained' | 'Run down';

export interface Readiness {
  headline: ReadinessHeadline | null;
  signals: Signal[];
  /** Signals that could not be computed yet, with the reason. */
  missing: string[];
  /** HRV against your baseline, when there is a reading and a baseline. */
  recovery: Recovery | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sleepNeedSec(yesterdayStrain: number | null): number {
  return BASE_SLEEP_NEED_SEC + EXTRA_NEED_SEC * Math.min(1, Math.max(0, (yesterdayStrain ?? 0) / 21));
}

function hm(sec: number): string {
  const min = Math.round(sec / 60);
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export function readiness(input: {
  dayStart: number;
  /** The watch's resting heart rate per local day (the lowest it reported that day; `listRestingHeartRateByDay`). */
  resting: ReadonlyMap<number, number>;
  strain: readonly DayStrain[];
  sleep: SleepSummary | null;
  hrv: RecoveryState;
}): Readiness {
  const { dayStart, resting, strain, sleep, hrv } = input;
  const signals: Signal[] = [];
  const missing: string[] = [];

  if ('recovery' in hrv) {
    const r = hrv.recovery;
    signals.push({
      key: 'hrv',
      title: r.source === 'night' ? 'HRV last night' : 'HRV (1-minute reading)',
      value: `${Math.round(r.rmssd)} ms`,
      detail: `${r.z >= 0 ? '+' : ''}${r.z.toFixed(1)} SD against your usual ${Math.round(r.baselineRmssd)} ms (${r.baselineCount} ${r.source === 'night' ? 'nights' : 'readings'})`,
      tone: r.z >= 0.5 ? 'good' : r.z <= -1 ? 'bad' : 'neutral',
      amount: r.z,
    });
  } else {
    missing.push(hrv.missing);
  }

  const today = resting.get(dayStart);
  const history = [...resting.entries()].filter(([day]) => day < dayStart && day >= dayStart - 30 * 86400).map(([, v]) => v);
  if (today === undefined) {
    missing.push('Resting heart rate: the watch has not reported one today.');
  } else if (history.length < MIN_BASELINE_DAYS) {
    missing.push(`Resting heart rate: ${history.length} of ${MIN_BASELINE_DAYS} days of history so far.`);
  } else {
    const baseline = mean(history);
    const delta = today - baseline;
    signals.push({
      key: 'rhr',
      title: 'Resting heart rate',
      value: `${today} bpm`,
      detail: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} against your ${history.length}-day average of ${baseline.toFixed(0)}`,
      tone: delta >= 5 ? 'bad' : delta <= -2 ? 'good' : 'neutral',
      amount: delta,
    });
  }

  const yesterday = strain.find((d) => d.day < dayStart && d.day >= dayStart - 26 * 3600)?.strain ?? null;
  if (!sleep) {
    missing.push('Sleep: nothing stored for last night.');
  } else {
    const awake = sleep.byStage.find((s) => s.stage === 'awake')?.seconds ?? 0;
    const slept = sleep.byStage.length > 0 ? sleep.totalSeconds - awake : sleep.totalSeconds;
    const need = sleepNeedSec(yesterday);
    const share = slept / need;
    signals.push({
      key: 'sleep',
      title: 'Sleep',
      value: `${Math.round(share * 100)} %`,
      detail: `${hm(slept)} of the ${hm(need)} you needed${yesterday !== null ? ` after strain ${yesterday.toFixed(1)}` : ''}`,
      tone: share >= 0.9 ? 'good' : share >= 0.75 ? 'neutral' : 'bad',
      amount: share,
    });
  }

  const loadDays = strain.filter((d) => d.day < dayStart && d.day >= dayStart - LOAD_DAYS * 86400);
  if (loadDays.length < MIN_LOAD_DAYS) {
    missing.push(`Training load: ${loadDays.length} of ${MIN_LOAD_DAYS} days with heart rate so far.`);
  } else {
    // Days without stored heart rate count as 0 strain over the window, like rest days.
    const sum = (from: number) => loadDays.filter((d) => d.day >= from).reduce((a, d) => a + d.strain, 0);
    const acute = sum(dayStart - 7 * 86400) / 7;
    // Over the days since the first one with heart rate, so a short history is not diluted by days before it.
    const span = Math.min(LOAD_DAYS, Math.round((dayStart - loadDays[0].day) / 86400));
    const chronic = sum(dayStart - LOAD_DAYS * 86400) / span;
    if (chronic <= 0) {
      missing.push('Training load: no strain in the last 28 days.');
    } else {
      const ratio = acute / chronic;
      signals.push({
        key: 'load',
        title: 'Training load',
        value: ratio.toFixed(2),
        detail: `last 7 days average ${acute.toFixed(1)} against 28 days ${chronic.toFixed(1)}${ratio > 1.5 ? ', a sharp rise' : ratio < 0.8 ? ', lighter than usual' : ''}`,
        tone: ratio > 1.5 ? 'bad' : ratio < 0.8 ? 'neutral' : 'good',
        amount: ratio,
      });
    }
  }

  return { headline: headline(signals), signals, missing, recovery: 'recovery' in hrv ? hrv.recovery : null };
}

function headline(signals: readonly Signal[]): ReadinessHeadline | null {
  if (signals.length === 0) return null;
  const bad = signals.filter((s) => s.tone === 'bad').length;
  const good = signals.filter((s) => s.tone === 'good').length;
  if (bad >= 2) return 'Run down';
  if (bad === 1) return 'Strained';
  if (good === signals.length && signals.length >= 2) return 'Primed';
  return 'Balanced';
}
