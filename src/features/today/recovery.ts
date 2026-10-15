import type { HrvReadingRow } from '@/db/queries';

/**
 * Recovery from HRV against your own baseline, after Plews and Buchheit: work on ln(RMSSD), compare today's value with
 * the mean and standard deviation of the previous 30 days, and treat about half a standard deviation as the smallest
 * change worth noticing. Night readings (the watch's own per-minute RMSSD from its stress records, averaged over sleep) and 1-minute spot readings
 * differ in level, so a reading is only compared with earlier readings of the same kind.
 *
 * Recovery % = 50 + 25 * z, clamped to 1..99: your usual HRV is 50 %, one standard deviation above is 75 %. Bands follow
 * the familiar green / yellow / red split at 67 and 34. The mapping is JoyoFit's; it is not WHOOP's model.
 */
const BASELINE_DAYS = 30;
/** Earlier readings of the same kind needed before today's is compared. */
export const MIN_BASELINE_READINGS = 4;
/** A spot reading counts for "today" when taken since this many hours before now. */
const SPOT_FRESH_SEC = 18 * 3600;
/** A night counts when it ended this recently. */
const NIGHT_FRESH_SEC = 20 * 3600;

export type RecoveryBand = 'green' | 'yellow' | 'red';

export interface Recovery {
  percent: number;
  band: RecoveryBand;
  rmssd: number;
  source: HrvReadingRow['source'];
  /** ln(RMSSD) baseline mean back in milliseconds, for display. */
  baselineRmssd: number;
  z: number;
  baselineCount: number;
}

export type RecoveryState = { recovery: Recovery } | { missing: string };

export function bandOf(percent: number): RecoveryBand {
  return percent >= 67 ? 'green' : percent >= 34 ? 'yellow' : 'red';
}

/** Today's recovery from `readings` (oldest first). Prefers last night over a spot reading. */
export function recovery(readings: readonly HrvReadingRow[], nowSec: number): RecoveryState {
  const latest = (source: HrvReadingRow['source'], freshSec: number) =>
    [...readings].reverse().find((r) => r.source === source && r.end >= nowSec - freshSec) ?? null;
  const today = latest('night', NIGHT_FRESH_SEC) ?? latest('spot', SPOT_FRESH_SEC);
  if (!today) {
    return readings.length === 0
      ? { missing: 'HRV: no readings yet. Measure HRV for a minute, or sync after a night with the watch on.' }
      : { missing: 'HRV: no reading from last night or today yet.' };
  }
  const history = readings.filter(
    (r) => r.source === today.source && r.end < today.start && r.end >= today.end - BASELINE_DAYS * 86400 && r.rmssd > 0,
  );
  if (history.length < MIN_BASELINE_READINGS) {
    return {
      missing: `HRV: ${history.length} of ${MIN_BASELINE_READINGS} earlier ${today.source === 'night' ? 'nights' : 'readings'} needed for your baseline.`,
    };
  }
  const logs = history.map((r) => Math.log(r.rmssd));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1));
  // A few near-identical readings give a tiny spread that would make every change look extreme; 0.1 in ln units is
  // about a 10 % change in RMSSD, a typical day-to-day spread.
  const z = (Math.log(today.rmssd) - mean) / Math.max(sd, 0.1);
  const percent = Math.round(Math.min(99, Math.max(1, 50 + 25 * z)));
  return {
    recovery: {
      percent,
      band: bandOf(percent),
      rmssd: today.rmssd,
      source: today.source,
      baselineRmssd: Math.exp(mean),
      z,
      baselineCount: history.length,
    },
  };
}
