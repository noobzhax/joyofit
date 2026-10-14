import type { SQLiteDatabase } from 'expo-sqlite';

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
