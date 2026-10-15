import type { SleepScoreRow } from '@/db/queries';
import { SESSION_GAP_SEC, withoutStrayUnstaged } from '@/features/today/stats';
import type { SleepSegment, SleepStage } from '@/wear';

/** A decoded stage, or `asleep` for a segment the watch stored without one. */
export type NightStage = SleepStage | 'asleep';

export const NIGHT_STAGES: readonly NightStage[] = ['awake', 'rem', 'light', 'deep', 'asleep'];

export interface StagePeriod {
  start: number;
  end: number;
  stage: NightStage;
}

export interface Night {
  start: number;
  end: number;
  /** Local `YYYY-MM-DD` of the wake-up; nights are listed and picked by it. */
  day: string;
  /** Non-overlapping, oldest first; neighbours with the same stage are merged. */
  periods: StagePeriod[];
  seconds: Record<NightStage, number>;
  /** Everything recorded except awake. */
  asleepSeconds: number;
  /** Shorter than {@link MIN_NIGHT_SEC} of sleep: shown as a nap. */
  nap: boolean;
  /** Awake periods with sleep before and after them. */
  awakenings: number;
  /** The watch's own score for this night, null when it gave none. */
  score: SleepScoreRow | null;
}

/** The watch score whose span overlaps `start`..`end` the most; the watch scores the main sleep, not naps. */
export function scoreFor(start: number, end: number, scores: readonly SleepScoreRow[]): SleepScoreRow | null {
  let best: SleepScoreRow | null = null;
  let bestOverlap = 0;
  for (const s of scores) {
    const overlap = Math.min(end, s.end) - Math.max(start, s.start);
    if (overlap > bestOverlap) {
      best = s;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** Below this much sleep a session is a nap (`MIN_NIGHT_SEC` in SleepReport.kt). */
export const MIN_NIGHT_SEC = 3 * 3600;

function localDay(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Turns stored segments into sleep sessions, newest first. Overlaps are cut so every second belongs to
 * one stage (an earlier-starting segment keeps its time); sessions split where the gap exceeds
 * {@link SESSION_GAP_SEC}, the same rule the Today card and the watch's morning report use.
 */
export function buildNights(segments: readonly SleepSegment[], scores: readonly SleepScoreRow[]): Night[] {
  const sorted = withoutStrayUnstaged(segments).sort((a, b) => a.start - b.start || a.end - b.end);
  const periods: StagePeriod[] = [];
  let cursor = -Infinity;
  for (const seg of sorted) {
    const start = Math.max(seg.start, cursor);
    if (start >= seg.end) continue;
    const stage: NightStage = seg.stage ?? 'asleep';
    const last = periods[periods.length - 1];
    if (last && last.stage === stage && last.end >= start) last.end = seg.end;
    else periods.push({ start, end: seg.end, stage });
    cursor = seg.end;
  }

  const sessions: StagePeriod[][] = [];
  for (const period of periods) {
    const current = sessions[sessions.length - 1];
    if (current && period.start - current[current.length - 1].end <= SESSION_GAP_SEC) current.push(period);
    else sessions.push([period]);
  }

  return sessions
    .map((session): Night => {
      const seconds = Object.fromEntries(NIGHT_STAGES.map((stage) => [stage, 0])) as Record<NightStage, number>;
      for (const p of session) seconds[p.stage] += p.end - p.start;
      const asleepSeconds = NIGHT_STAGES.reduce((sum, stage) => (stage === 'awake' ? sum : sum + seconds[stage]), 0);
      const end = session[session.length - 1].end;
      return {
        start: session[0].start,
        end,
        day: localDay(end),
        periods: session,
        seconds,
        asleepSeconds,
        nap: asleepSeconds < MIN_NIGHT_SEC,
        awakenings: session.filter((p, i) => p.stage === 'awake' && i > 0 && i < session.length - 1).length,
        score: scoreFor(session[0].start, end, scores),
      };
    })
    .reverse();
}

export interface HourStages {
  /** Unix seconds of the hour's start (local clock hour). */
  hour: number;
  seconds: Record<NightStage, number>;
}

/** Seconds of each stage inside every local clock hour the night touches, earliest hour first. */
export function hourlyStages(night: Night): HourStages[] {
  const first = new Date(night.start * 1000);
  first.setMinutes(0, 0, 0);
  const hours: HourStages[] = [];
  // Step by wall-clock hour so a DST change still gives one bar per clock hour.
  for (const d = first; d.getTime() / 1000 < night.end; d.setHours(d.getHours() + 1)) {
    const from = d.getTime() / 1000;
    const to = from + 3600;
    const seconds = Object.fromEntries(NIGHT_STAGES.map((stage) => [stage, 0])) as Record<NightStage, number>;
    for (const p of night.periods) {
      const overlap = Math.min(p.end, to) - Math.max(p.start, from);
      if (overlap > 0) seconds[p.stage] += overlap;
    }
    hours.push({ hour: from, seconds });
  }
  return hours;
}
