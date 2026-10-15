import type { FitnessTotals, SleepSegment, StepSample } from '@/wear';

/** Unix seconds of local midnight for the day containing `nowSec`. */
export function startOfLocalDay(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Totals in the watch's FitnessTotals units: calories in kcal (samples carry small calories). */
export function sumTotals(samples: readonly StepSample[]): FitnessTotals {
  const totals: FitnessTotals = { steps: 0, calories: 0, distance: 0 };
  for (const s of samples) {
    totals.steps += s.steps;
    totals.calories += s.calories;
    totals.distance += s.distance;
  }
  totals.calories = Math.round(totals.calories / 1000);
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

/** A live reading older than this no longer counts as live (the watch pushes about one a second). */
export const LIVE_FRESH_MS = 20_000;

export interface HeartReading {
  bpm: number;
  /** Unix seconds the reading was taken (stored sample) or received (live). */
  timestamp: number;
  /** Pushed by the watch within {@link LIVE_FRESH_MS}. */
  live: boolean;
}

/**
 * What the hero shows: the live reading while it is fresh, else the newest of the last live reading
 * and the newest stored one; null when there is neither. `live.ts` is unix milliseconds.
 */
export function pickHeartReading(
  live: { bpm: number; ts: number } | null,
  stored: { bpm: number; timestamp: number } | null,
  nowMs: number,
): HeartReading | null {
  const received = live ? { bpm: live.bpm, timestamp: Math.floor(live.ts / 1000) } : null;
  if (live && received && nowMs - live.ts < LIVE_FRESH_MS) return { ...received, live: true };
  const newest = received && (!stored || received.timestamp >= stored.timestamp) ? received : stored;
  return newest ? { bpm: newest.bpm, timestamp: newest.timestamp, live: false } : null;
}

/** Steps summed per local clock hour (index 0..23). */
export function hourlySteps(samples: readonly StepSample[]): number[] {
  const bins = new Array<number>(24).fill(0);
  for (const s of samples) bins[new Date(s.timestamp * 1000).getHours()] += s.steps;
  return bins;
}

/** Segments closer together than this belong to the same sleep session. */
export const SESSION_GAP_SEC = 3 * 3600;

/**
 * Drops unstaged segments within {@link SESSION_GAP_SEC} of a staged one: the watch stores short unstaged spans
 * around a staged night, and next to real stages they only stretch it. An unstaged nap far from staged sleep
 * stays. Same rule as `withoutStrayUnstaged` in SleepReport.kt.
 */
export function withoutStrayUnstaged<T extends SleepSegment>(segments: readonly T[]): T[] {
  const staged = segments.filter((s) => s.stage);
  return segments.filter(
    (s) => s.stage || !staged.some((t) => t.start - s.end <= SESSION_GAP_SEC && s.start - t.end <= SESSION_GAP_SEC),
  );
}

export interface SleepTypeSummary {
  /** Raw watch sleep-state byte; its meaning is not decoded here. */
  type: number;
  count: number;
  seconds: number;
}

export interface SleepStageSummary {
  stage: 'light' | 'deep' | 'rem' | 'awake';
  count: number;
  seconds: number;
}

const SLEEP_STAGES: readonly SleepStageSummary['stage'][] = ['light', 'deep', 'rem', 'awake'];

export interface SleepSummary {
  start: number;
  end: number;
  /** Sum of segment durations (gaps between segments excluded). */
  totalSeconds: number;
  byType: SleepTypeSummary[];
  /** Segments with a decoded stage, in light, deep, rem, awake order; empty when none carry one. */
  byStage: SleepStageSummary[];
}

/**
 * Summarises the most recent sleep session: the latest segment plus earlier segments chained to it
 * with gaps up to {@link SESSION_GAP_SEC}. Expects `segments` oldest-first.
 */
export function lastSleepSession(segments: readonly SleepSegment[]): SleepSummary | null {
  if (segments.length === 0) return null;
  const sorted = withoutStrayUnstaged(segments).sort((a, b) => a.start - b.start);
  let first = sorted.length - 1;
  let earliestStart = sorted[first].start;
  while (first > 0 && earliestStart - sorted[first - 1].end <= SESSION_GAP_SEC) {
    first--;
    earliestStart = Math.min(earliestStart, sorted[first].start);
  }
  const session = sorted.slice(first);
  const byType = new Map<number, SleepTypeSummary>();
  const byStage = Object.fromEntries(
    SLEEP_STAGES.map((stage) => [stage, { stage, count: 0, seconds: 0 }]),
  ) as Record<SleepStageSummary['stage'], SleepStageSummary>;
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
    if (seg.stage) {
      byStage[seg.stage].count += 1;
      byStage[seg.stage].seconds += seconds;
    }
  }
  return {
    start: earliestStart,
    end,
    totalSeconds,
    byType: [...byType.values()].sort((a, b) => a.type - b.type),
    byStage: SLEEP_STAGES.map((stage) => byStage[stage]).filter((entry) => entry.count > 0),
  };
}
