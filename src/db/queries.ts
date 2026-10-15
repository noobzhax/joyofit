import type { SQLiteDatabase } from 'expo-sqlite';

import type { DayHeartLoad } from '@/features/today/strain';
import type { SleepSegment, StepSample } from '@/wear';

export async function getLastSync(db: SQLiteDatabase, address: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ last_sync: number | null }>(
    'SELECT last_sync FROM device WHERE address = ?',
    address,
  );
  return row?.last_sync ?? null;
}

export function listStepSamplesSince(db: SQLiteDatabase, sinceSec: number): Promise<StepSample[]> {
  return db.getAllAsync<StepSample>(
    `SELECT timestamp, steps, calories, distance,
            heart_rate AS heartRate, spo2, resting_heart_rate AS restingHeartRate
     FROM step_samples WHERE timestamp >= ? ORDER BY timestamp`,
    sinceSec,
  );
}

/** The newest stored heart-rate reading of any day, or null when the watch never recorded one. */
export function getLatestHeartRate(db: SQLiteDatabase): Promise<{ bpm: number; timestamp: number } | null> {
  return db.getFirstAsync<{ bpm: number; timestamp: number }>(
    'SELECT heart_rate AS bpm, timestamp FROM step_samples WHERE heart_rate > 0 ORDER BY timestamp DESC LIMIT 1',
  );
}

/** Segments that end at or after `sinceSec`, oldest first. */
export function listSleepSince(db: SQLiteDatabase, sinceSec: number): Promise<SleepSegment[]> {
  return db.getAllAsync<SleepSegment>(
    'SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? ORDER BY start',
    sinceSec,
  );
}

/** Every stored segment, oldest first. A night is tens of rows, so the whole history stays small. */
export function listAllSleep(db: SQLiteDatabase): Promise<SleepSegment[]> {
  return db.getAllAsync<SleepSegment>('SELECT start, end, type, stage FROM sleep_segments ORDER BY start, end');
}

/** The watch's own score for one night (`sleep_scores`); `start` / `end` span the night it scored. */
export interface SleepScoreRow {
  start: number;
  end: number;
  score: number;
  /** Percent of the time in bed spent asleep, as the watch reports it. */
  efficiency: number | null;
}

export function listSleepScores(db: SQLiteDatabase): Promise<SleepScoreRow[]> {
  return db.getAllAsync<SleepScoreRow>('SELECT start, end, score, efficiency FROM sleep_scores ORDER BY start');
}

/** One HRV value (`hrv_readings`): `night` from the watch's own RMSSD records during sleep, `spot` from a 1-minute measurement. */
export interface HrvReadingRow {
  start: number;
  end: number;
  source: 'night' | 'spot';
  /** Milliseconds. */
  rmssd: number;
  beats: number;
}

export function listHrvReadingsSince(db: SQLiteDatabase, sinceSec: number): Promise<HrvReadingRow[]> {
  return db.getAllAsync<HrvReadingRow>(
    'SELECT start, end, source, rmssd, beats FROM hrv_readings WHERE end >= ? ORDER BY end',
    sinceSec,
  );
}

/** A `workouts` row. `complete` is false while a part of its download failed; the next sync retries. */
export interface WorkoutRow {
  id: number;
  workoutNumber: number;
  /** Unix seconds. */
  start: number;
  end: number;
  /** The raw Huawei sport type byte. */
  sportType: number;
  sportName: string;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  steps: number;
  complete: boolean;
}

/** One `workout_points` row: GPS points have lat/lon, data samples have hr and altitude. */
export interface WorkoutPointRow {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
}

const WORKOUT_COLUMNS = `id, workout_number AS workoutNumber, start, end, sport_type AS sportType,
  sport_name AS sportName, duration, distance, calories, avg_hr AS avgHr, max_hr AS maxHr, steps,
  complete != 0 AS complete`;

type RawWorkout = Omit<WorkoutRow, 'complete'> & { complete: number };

function toWorkout(row: RawWorkout): WorkoutRow {
  return { ...row, complete: row.complete !== 0 };
}

/** Newest first. */
export async function listWorkouts(db: SQLiteDatabase): Promise<WorkoutRow[]> {
  const rows = await db.getAllAsync<RawWorkout>(
    `SELECT ${WORKOUT_COLUMNS} FROM workouts ORDER BY start DESC`,
  );
  return rows.map(toWorkout);
}

export async function getWorkout(
  db: SQLiteDatabase,
  id: number,
): Promise<{ workout: WorkoutRow; summaryJson: string } | null> {
  const row = await db.getFirstAsync<RawWorkout & { summaryJson: string }>(
    `SELECT ${WORKOUT_COLUMNS}, summary_json AS summaryJson FROM workouts WHERE id = ?`,
    id,
  );
  if (!row) return null;
  const { summaryJson, ...rest } = row;
  return { workout: toWorkout(rest), summaryJson };
}

export function listWorkoutPoints(db: SQLiteDatabase, workoutId: number): Promise<WorkoutPointRow[]> {
  return db.getAllAsync<WorkoutPointRow>(
    'SELECT ts, lat, lon, alt, hr FROM workout_points WHERE workout_id = ? ORDER BY ts',
    workoutId,
  );
}

/**
 * Heart-rate load per local day, aggregated in SQL so long ranges never put per-minute rows through JS. It is
 * `dailyStrain`'s arithmetic: a reading counts until the next reading (of any day), at most 600 s, never past
 * `day + 86400`, and at least 1 s; seconds are summed per Edwards zone. `bounds` are consecutive local midnights (day `i`
 * spans `bounds[i]` up to `bounds[i + 1]`), and `thresholds` come from `zoneThresholds` (lowest bpm of zones 1..5).
 * Everything is integer arithmetic, so there is no division to truncate. Days without heart rate are absent.
 */
export async function listDayHeartLoad(
  db: SQLiteDatabase,
  bounds: readonly number[],
  thresholds: readonly number[],
): Promise<DayHeartLoad[]> {
  const days: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) days.push(bounds[i], bounds[i + 1]);
  if (days.length === 0) return [];
  // CROSS JOIN pins `days` as the outer loop, so each day is one range seek on the timestamp primary key. LEAD runs over
  // the joined rows of all days in timestamp order, so the last reading of a day sees the next day's first.
  const rows = await db.getAllAsync<{ day: number; covered: number; z1: number; z2: number; z3: number; z4: number; z5: number }>(
    `WITH days(d0, d1) AS (VALUES ${Array.from({ length: days.length / 2 }, () => '(?, ?)').join(', ')}),
     hr AS (
       SELECT s.timestamp AS ts, s.heart_rate AS bpm, d.d0 AS d0,
              LEAD(s.timestamp) OVER (ORDER BY s.timestamp) AS nxt
       FROM days d CROSS JOIN step_samples s
       WHERE s.timestamp >= d.d0 AND s.timestamp < d.d1 AND s.heart_rate > 0
     ),
     cover AS (
       SELECT d0, MAX(1, MIN(COALESCE(nxt, ts + 60), ts + 600, d0 + 86400) - ts) AS secs,
              (bpm >= ?) + (bpm >= ?) + (bpm >= ?) + (bpm >= ?) + (bpm >= ?) AS zone
       FROM hr
     )
     SELECT d0 AS day, SUM(secs) AS covered,
            COALESCE(SUM(CASE WHEN zone = 1 THEN secs END), 0) AS z1,
            COALESCE(SUM(CASE WHEN zone = 2 THEN secs END), 0) AS z2,
            COALESCE(SUM(CASE WHEN zone = 3 THEN secs END), 0) AS z3,
            COALESCE(SUM(CASE WHEN zone = 4 THEN secs END), 0) AS z4,
            COALESCE(SUM(CASE WHEN zone = 5 THEN secs END), 0) AS z5
     FROM cover GROUP BY d0 ORDER BY d0`,
    [...days, ...thresholds],
  );
  return rows.map((r) => ({ day: r.day, zoneSeconds: [r.z1, r.z2, r.z3, r.z4, r.z5], coveredSeconds: r.covered }));
}

/**
 * The watch's resting heart rate per day, (the lowest reported that day), aggregated in SQL.
 * `bounds` are consecutive local midnights; day `i` spans `bounds[i]` up to `bounds[i + 1]`, so the local calendar
 * (and daylight-saving days) stay with the caller. Days without a value are absent from the result.
 */
export async function listRestingHeartRateByDay(db: SQLiteDatabase, bounds: readonly number[]): Promise<Map<number, number>> {
  const days: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) days.push(bounds[i], bounds[i + 1]);
  if (days.length === 0) return new Map();
  const rows = await db.getAllAsync<{ day: number; bpm: number }>(
    `WITH days(d0, d1) AS (VALUES ${Array.from({ length: days.length / 2 }, () => '(?, ?)').join(', ')})
     SELECT d0 AS day, MIN(s.resting_heart_rate) AS bpm
     FROM days JOIN step_samples s ON s.timestamp >= d0 AND s.timestamp < d1
     WHERE s.resting_heart_rate > 0 GROUP BY d0`,
    days,
  );
  return new Map(rows.map((r) => [r.day, r.bpm]));
}
