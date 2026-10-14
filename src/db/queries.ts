import type { SQLiteDatabase } from 'expo-sqlite';

import type { DeviceInfo, SleepSegment, StepSample, SyncResult } from '@/wear';

/** Re-request this much already-stored history on every sync; upserts make the overlap idempotent. */
export const SYNC_OVERLAP_SEC = 3600;

export async function upsertDevice(db: SQLiteDatabase, info: DeviceInfo): Promise<void> {
  await db.runAsync(
    `INSERT INTO device (address, name, product_model, software_version, last_sync)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(address) DO UPDATE SET
       name = excluded.name,
       product_model = excluded.product_model,
       software_version = excluded.software_version`,
    info.address,
    info.name,
    info.productModel,
    info.softwareVersion,
  );
}

export async function getLastSync(db: SQLiteDatabase, address: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ last_sync: number | null }>(
    'SELECT last_sync FROM device WHERE address = ?',
    address,
  );
  return row?.last_sync ?? null;
}

/** Persists one sync in a single transaction and advances `device.last_sync` to `result.to`. */
export async function saveSyncResult(
  db: SQLiteDatabase,
  address: string,
  result: SyncResult,
): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const sample = await txn.prepareAsync(
      `INSERT INTO step_samples
         (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(timestamp) DO UPDATE SET
         steps = excluded.steps,
         calories = excluded.calories,
         distance = excluded.distance,
         heart_rate = excluded.heart_rate,
         spo2 = excluded.spo2,
         resting_heart_rate = excluded.resting_heart_rate`,
    );
    const segment = await txn.prepareAsync(
      `INSERT INTO sleep_segments (start, end, type) VALUES (?, ?, ?)
       ON CONFLICT(start, type) DO UPDATE SET end = excluded.end`,
    );
    try {
      for (const s of result.samples) {
        await sample.executeAsync([
          s.timestamp,
          s.steps,
          s.calories,
          s.distance,
          s.heartRate,
          s.spo2,
          s.restingHeartRate,
        ]);
      }
      for (const s of result.sleep) {
        await segment.executeAsync([s.start, s.end, s.type]);
      }
    } finally {
      await sample.finalizeAsync();
      await segment.finalizeAsync();
    }
    await txn.runAsync('UPDATE device SET last_sync = ? WHERE address = ?', result.to, address);
  });
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
    'SELECT start, end, type FROM sleep_segments WHERE end >= ? ORDER BY start',
    sinceSec,
  );
}
