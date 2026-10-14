import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Cloud upload bookkeeping. Migration 4 gives `step_samples`, `sleep_segments` and `workouts` a `rev`
 * column that triggers set to the table's next `cloud_cursor.seq` on every insert and update (JS and
 * native writers alike), so "everything not uploaded yet" is `rev > cloud_cursor.uploaded`.
 */
export type CloudTable = 'step_samples' | 'sleep_segments' | 'workouts';

export const CLOUD_TABLES: readonly CloudTable[] = ['step_samples', 'sleep_segments', 'workouts'];

export interface CloudState {
  userId: string | null;
  email: string | null;
  /** Unix seconds of the last upload run that finished without error. */
  lastSyncAt: number | null;
  lastError: string | null;
}

export async function getCloudState(db: SQLiteDatabase): Promise<CloudState> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM cloud_state');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const last = Number(map.get('last_sync_at'));
  return {
    userId: map.get('user_id') ?? null,
    email: map.get('email') ?? null,
    lastSyncAt: Number.isFinite(last) && last > 0 ? last : null,
    lastError: map.get('last_error') ?? null,
  };
}

/** Sets the given keys; a `null` value deletes the key. */
export async function setCloudState(db: SQLiteDatabase, entries: Record<string, string | null>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === null) await db.runAsync('DELETE FROM cloud_state WHERE key = ?', key);
      else
        await db.runAsync(
          'INSERT INTO cloud_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          key,
          value,
        );
    }
  });
}

export async function getUploaded(db: SQLiteDatabase, table: CloudTable): Promise<number> {
  const row = await db.getFirstAsync<{ uploaded: number }>('SELECT uploaded FROM cloud_cursor WHERE tbl = ?', table);
  return row?.uploaded ?? 0;
}

export async function setUploaded(db: SQLiteDatabase, table: CloudTable, rev: number): Promise<void> {
  await db.runAsync('UPDATE cloud_cursor SET uploaded = MAX(uploaded, ?) WHERE tbl = ?', rev, table);
}

/** A different JoyoRogo account signed in: everything has to go to the new account. */
export async function resetCloudCursors(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('UPDATE cloud_cursor SET uploaded = 0');
}

/** Rows written locally that the cloud does not have yet, across all synced tables. */
export async function countPending(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM step_samples WHERE rev > (SELECT uploaded FROM cloud_cursor WHERE tbl = 'step_samples')) +
       (SELECT COUNT(*) FROM sleep_segments WHERE rev > (SELECT uploaded FROM cloud_cursor WHERE tbl = 'sleep_segments')) +
       (SELECT COUNT(*) FROM workouts WHERE rev > (SELECT uploaded FROM cloud_cursor WHERE tbl = 'workouts')) AS n`,
  );
  return row?.n ?? 0;
}

export interface PendingStepSample {
  rev: number;
  timestamp: number;
  steps: number;
  calories: number;
  distance: number;
  heartRate: number | null;
  spo2: number | null;
  restingHeartRate: number | null;
}

export function listStepSamplesAfter(db: SQLiteDatabase, rev: number, limit: number): Promise<PendingStepSample[]> {
  return db.getAllAsync<PendingStepSample>(
    `SELECT rev, timestamp, steps, calories, distance, heart_rate AS heartRate, spo2,
            resting_heart_rate AS restingHeartRate
     FROM step_samples WHERE rev > ? ORDER BY rev LIMIT ?`,
    rev,
    limit,
  );
}

export interface PendingSleepSegment {
  rev: number;
  start: number;
  end: number;
  type: number;
  stage: string | null;
}

export function listSleepAfter(db: SQLiteDatabase, rev: number, limit: number): Promise<PendingSleepSegment[]> {
  return db.getAllAsync<PendingSleepSegment>(
    'SELECT rev, start, end, type, stage FROM sleep_segments WHERE rev > ? ORDER BY rev LIMIT ?',
    rev,
    limit,
  );
}

export interface PendingWorkout {
  rev: number;
  id: number;
  workoutNumber: number;
  start: number;
  end: number;
  sportType: number;
  sportName: string;
  duration: number;
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  steps: number;
  summaryJson: string;
  complete: boolean;
}

export async function listWorkoutsAfter(db: SQLiteDatabase, rev: number, limit: number): Promise<PendingWorkout[]> {
  const rows = await db.getAllAsync<Omit<PendingWorkout, 'complete'> & { complete: number }>(
    `SELECT rev, id, workout_number AS workoutNumber, start, end, sport_type AS sportType,
            sport_name AS sportName, duration, distance, calories, avg_hr AS avgHr, max_hr AS maxHr,
            steps, summary_json AS summaryJson, complete
     FROM workouts WHERE rev > ? ORDER BY rev LIMIT ?`,
    rev,
    limit,
  );
  return rows.map((row) => ({ ...row, complete: row.complete !== 0 }));
}

export interface PendingWorkoutPoint {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
}

export function listWorkoutPointsOf(db: SQLiteDatabase, workoutId: number): Promise<PendingWorkoutPoint[]> {
  return db.getAllAsync<PendingWorkoutPoint>(
    'SELECT ts, lat, lon, alt, hr FROM workout_points WHERE workout_id = ? ORDER BY ts, rowid',
    workoutId,
  );
}

export interface DeviceRow {
  address: string;
  name: string;
  productModel: string | null;
  softwareVersion: string | null;
  lastSync: number | null;
}

export function listDevices(db: SQLiteDatabase): Promise<DeviceRow[]> {
  return db.getAllAsync<DeviceRow>(
    `SELECT address, name, product_model AS productModel, software_version AS softwareVersion,
            last_sync AS lastSync FROM device`,
  );
}
