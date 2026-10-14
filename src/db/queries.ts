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

/** Segments that end at or after `sinceSec`, oldest first. */
export function listSleepSince(db: SQLiteDatabase, sinceSec: number): Promise<SleepSegment[]> {
  return db.getAllAsync<SleepSegment>(
    'SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? ORDER BY start',
    sinceSec,
  );
}
