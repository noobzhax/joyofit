import { startOfLocalDay } from '@/features/today/stats';
import type { StepSample } from '@/wear';

/**
 * Daily strain, computed by JoyoFit from the watch's stored heart rate (the watch has no such number).
 *
 * Load is Edwards' summated-heart-rate-zone TRIMP (Edwards 1993): minutes in 50-60 / 60-70 / 70-80 / 80-90 / 90-100 % of
 * maximum heart rate count 1 / 2 / 3 / 4 / 5 times. Strain maps that load onto 0..21 with `21 * (1 - e^(-TRIMP / 250))`,
 * so easy minutes add a lot early in the day and the top is hard to reach. The 0..21 range copies the idea of WHOOP's
 * strain scale; the curve and its constant are JoyoFit's own and are not WHOOP's model. An hour of brisk walking
 * (zone 2, TRIMP 120) is about 8; an hour of steady running (zone 3, 180) about 11; two hard hours (480) about 18.
 */
export const STRAIN_MAX = 21;
const STRAIN_K = 250;

/** One reading stands for the time until the next one, at most this long: the watch reads heart rate every few minutes at rest. */
const MAX_READING_SEC = 10 * 60;

/** Edwards zone 0..5 at `heartRate`: 0 below 50 % of maximum, then one per 10 %. */
export function edwardsZone(heartRate: number, maxHr: number): number {
  const pct = (100 * heartRate) / maxHr;
  if (pct < 50) return 0;
  return Math.min(5, Math.floor((pct - 50) / 10) + 1);
}

export function strainFromTrimp(trimp: number): number {
  return STRAIN_MAX * (1 - Math.exp(-trimp / STRAIN_K));
}

export interface DayStrain {
  /** Local midnight, unix seconds. */
  day: number;
  trimp: number;
  /** 0..21. */
  strain: number;
  /** Minutes in Edwards zones 1..5 (index 0 is zone 1). */
  zoneMinutes: [number, number, number, number, number];
  /** Minutes the stored heart rate covers; strain is only as complete as this. */
  coveredMinutes: number;
}

/** Per local day: seconds in Edwards zones 1..5 and seconds covered by any heart-rate reading (zone 0 included). */
export interface DayHeartLoad {
  /** Local midnight, unix seconds. */
  day: number;
  zoneSeconds: [number, number, number, number, number];
  coveredSeconds: number;
}

/** Whole seconds are summed and divided by 60 once, so the SQL aggregate and the JS loop below give identical floats. */
function dayStrainOf(load: DayHeartLoad): DayStrain {
  const zoneMinutes = load.zoneSeconds.map((s) => s / 60) as DayStrain['zoneMinutes'];
  const trimp = load.zoneSeconds.reduce((sum, s, i) => sum + ((i + 1) * s) / 60, 0);
  return { day: load.day, trimp, strain: strainFromTrimp(trimp), zoneMinutes, coveredMinutes: load.coveredSeconds / 60 };
}

/** Strain per day from per-day aggregates (`listDayHeartLoad`), oldest first. */
export function strainFromLoads(loads: readonly DayHeartLoad[]): DayStrain[] {
  return loads.map(dayStrainOf).sort((a, b) => a.day - b.day);
}

/**
 * The lowest whole heart rate in Edwards zones 1..5 at `maxHr`, found with `edwardsZone` itself so the SQL zone test
 * (`bpm >= threshold`) cannot drift from it. A zone no plausible heart rate reaches gets Infinity-like 1e9.
 */
export function zoneThresholds(maxHr: number): [number, number, number, number, number] {
  const out: number[] = [];
  for (let zone = 1; zone <= 5; zone++) {
    let hr = 1;
    while (hr <= 400 && edwardsZone(hr, maxHr) < zone) hr++;
    out.push(hr <= 400 ? hr : 1e9);
  }
  return out as [number, number, number, number, number];
}

/**
 * Strain per local day from per-minute samples (oldest first). Samples without heart rate are skipped; each reading
 * counts until the next reading or [MAX_READING_SEC], whichever is first, and never past its day's midnight.
 * `listDayHeartLoad` does the same arithmetic in SQL for long ranges; keep the two in step.
 */
export function dailyStrain(samples: readonly Pick<StepSample, 'timestamp' | 'heartRate'>[], maxHr: number): DayStrain[] {
  const withHr = samples.filter((s) => s.heartRate !== null && s.heartRate > 0);
  const days = new Map<number, DayHeartLoad>();
  for (let i = 0; i < withHr.length; i++) {
    const sample = withHr[i];
    const day = startOfLocalDay(sample.timestamp);
    const next = withHr[i + 1]?.timestamp ?? sample.timestamp + 60;
    const until = Math.min(next, sample.timestamp + MAX_READING_SEC, day + 24 * 3600);
    const seconds = Math.max(1, until - sample.timestamp);
    let entry = days.get(day);
    if (!entry) {
      entry = { day, zoneSeconds: [0, 0, 0, 0, 0], coveredSeconds: 0 };
      days.set(day, entry);
    }
    entry.coveredSeconds += seconds;
    const zone = edwardsZone(sample.heartRate as number, maxHr);
    if (zone > 0) entry.zoneSeconds[zone - 1] += seconds;
  }
  return strainFromLoads([...days.values()]);
}

/** A gap longer than this between a workout's heart-rate samples is a pause; it counts for nothing (as in `splitWorkout`). */
const MAX_WORKOUT_GAP_SEC = 120;

export interface WorkoutStrain {
  trimp: number;
  /** 0..21, this workout on its own (as if it were the only effort of the day). */
  strain: number;
  /** Minutes in Edwards zones 1..5 (index 0 is zone 1). */
  zoneMinutes: [number, number, number, number, number];
  /** Minutes the heart-rate samples cover, pauses left out. */
  coveredMinutes: number;
}

/**
 * Strain of one workout from its own heart-rate samples: each sample counts until the next one, gaps over two minutes are
 * pauses and count for nothing. Null when there is no stretch of consecutive samples to work from.
 */
export function workoutStrain(points: readonly { ts: number; hr: number | null }[], maxHr: number): WorkoutStrain | null {
  const samples = points.filter((p) => p.hr !== null && p.hr > 0).sort((a, b) => a.ts - b.ts);
  const result: WorkoutStrain = { trimp: 0, strain: 0, zoneMinutes: [0, 0, 0, 0, 0], coveredMinutes: 0 };
  for (let i = 0; i + 1 < samples.length; i++) {
    const dt = samples[i + 1].ts - samples[i].ts;
    if (dt <= 0 || dt > MAX_WORKOUT_GAP_SEC) continue;
    const minutes = dt / 60;
    result.coveredMinutes += minutes;
    const zone = edwardsZone(samples[i].hr as number, maxHr);
    if (zone > 0) {
      result.zoneMinutes[zone - 1] += minutes;
      result.trimp += zone * minutes;
    }
  }
  if (result.coveredMinutes <= 0) return null;
  result.strain = strainFromTrimp(result.trimp);
  return result;
}

export interface WorkoutDayShare {
  /** The day's strain with the workout. */
  dayStrain: number;
  /** What the workout added to it: the day's strain with the workout minus the day's strain without. */
  added: number;
}

/**
 * What a workout added to its day's strain. The day without the workout is the day's stored per-minute heart rate with
 * the workout's own minutes left out; the day with it adds the workout's TRIMP (from its heart-rate samples, which are
 * denser than the per-minute ones) on top. Strain is a saturating curve, so the same workout adds less on a day that
 * already carried load. `samples` must be oldest first and contain the day of `workout.start`.
 */
export function strainAddedToDay(
  samples: readonly StepSample[],
  workout: { start: number; end: number },
  workoutTrimp: number,
  maxHr: number,
): WorkoutDayShare {
  const day = startOfLocalDay(workout.start);
  const outside = samples.filter((s) => s.timestamp < workout.start - 59 || s.timestamp > workout.end);
  // A zone-0 reading at the start ends the coverage of the last reading before the workout, which would otherwise
  // stretch across the workout's minutes (up to 10 min) and count them twice.
  outside.push({ timestamp: workout.start, steps: 0, calories: 0, distance: 0, heartRate: 1, spo2: null, restingHeartRate: null });
  outside.sort((a, b) => a.timestamp - b.timestamp);
  const without = dailyStrain(outside, maxHr).find((d) => d.day === day)?.trimp ?? 0;
  const dayStrain = strainFromTrimp(without + workoutTrimp);
  return { dayStrain, added: dayStrain - strainFromTrimp(without) };
}
