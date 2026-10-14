import type { FitnessTotals, SleepSegment, StepSample } from '@/wear';

/** Unix seconds of local midnight for the day containing `nowSec`. */
export function startOfLocalDay(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function sumTotals(samples: readonly StepSample[]): FitnessTotals {
  const totals: FitnessTotals = { steps: 0, calories: 0, distance: 0 };
  for (const s of samples) {
    totals.steps += s.steps;
    totals.calories += s.calories;
    totals.distance += s.distance;
  }
  return totals;
}

export interface HeartRateStats {
  latest: { bpm: number; timestamp: number };
  min: number;
  max: number;
}

/** Heart-rate summary over samples that carry a reading (non-null, positive); null when none do. */
export function heartRateStats(samples: readonly StepSample[]): HeartRateStats | null {
  let stats: HeartRateStats | null = null;
  for (const s of samples) {
    const bpm = s.heartRate;
    if (bpm === null || bpm <= 0) continue;
    if (!stats) {
      stats = { latest: { bpm, timestamp: s.timestamp }, min: bpm, max: bpm };
      continue;
    }
    if (s.timestamp >= stats.latest.timestamp) stats.latest = { bpm, timestamp: s.timestamp };
    stats.min = Math.min(stats.min, bpm);
    stats.max = Math.max(stats.max, bpm);
  }
  return stats;
}

/** Steps summed per local clock hour (index 0..23). */
export function hourlySteps(samples: readonly StepSample[]): number[] {
  const bins = new Array<number>(24).fill(0);
  for (const s of samples) bins[new Date(s.timestamp * 1000).getHours()] += s.steps;
  return bins;
}

/** Segments closer together than this belong to the same sleep session. */
const SESSION_GAP_SEC = 3 * 3600;

export interface SleepTypeSummary {
  /** Raw watch sleep-state byte; its meaning is not decoded here. */
  type: number;
  count: number;
  seconds: number;
}

export interface SleepSummary {
  start: number;
  end: number;
  /** Sum of segment durations (gaps between segments excluded). */
  totalSeconds: number;
  byType: SleepTypeSummary[];
}

/**
 * Summarises the most recent sleep session: the latest segment plus earlier segments chained to it
 * with gaps up to {@link SESSION_GAP_SEC}. Expects `segments` oldest-first.
 */
export function lastSleepSession(segments: readonly SleepSegment[]): SleepSummary | null {
  if (segments.length === 0) return null;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let first = sorted.length - 1;
  let earliestStart = sorted[first].start;
  while (first > 0 && earliestStart - sorted[first - 1].end <= SESSION_GAP_SEC) {
    first--;
    earliestStart = Math.min(earliestStart, sorted[first].start);
  }
  const session = sorted.slice(first);
  const byType = new Map<number, SleepTypeSummary>();
  let totalSeconds = 0;
  let end = 0;
  for (const seg of session) {
    const seconds = Math.max(0, seg.end - seg.start);
    totalSeconds += seconds;
    end = Math.max(end, seg.end);
    const entry = byType.get(seg.type) ?? { type: seg.type, count: 0, seconds: 0 };
    entry.count += 1;
    entry.seconds += seconds;
    byType.set(seg.type, entry);
  }
  return {
    start: earliestStart,
    end,
    totalSeconds,
    byType: [...byType.values()].sort((a, b) => a.type - b.type),
  };
}
