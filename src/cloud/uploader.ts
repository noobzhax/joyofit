import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError, cloudRequest } from '@/cloud/api';
import {
  getCloudState,
  getUploaded,
  listDevices,
  listSleepAfter,
  listStepSamplesAfter,
  listWorkoutPointsOf,
  listWorkoutsAfter,
  resetCloudCursors,
  setCloudState,
  setUploaded,
  type PendingWorkoutPoint,
} from '@/db/cloud';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

/** Batch sizes stay under the server's per-request limits (server/src/limits.ts). */
const STEP_BATCH = 2_000;
const SLEEP_BATCH = 500;
const WORKOUT_BATCH = 5;
/** Points per workout request; the server accepts 30 000 per workout. */
const POINTS_PER_REQUEST = 15_000;
const MAX_POINTS_PER_WORKOUT = 30_000;

export interface UploadReport {
  stepSamples: number;
  sleepSegments: number;
  workouts: number;
  /** Rows the server refused as invalid (400) even alone; their cursor moved on so they do not block the rest. */
  skipped: number;
}

interface MeResponse {
  user: { id: string; email: string };
}

const log = (message: string, direction: 'info' | 'error' = 'info') =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message: `cloud: ${message}` });

/** Keeps `max` points spread evenly over the track, always the first and the last. */
function thin(points: PendingWorkoutPoint[], max: number): PendingWorkoutPoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

/**
 * Posts `items` as one batch. When the server refuses the batch as invalid (400) or too big (413), it is split
 * in halves until the offending row stands alone and is skipped, so one bad row never blocks the cursor.
 */
async function send<T>(items: T[], body: (chunk: T[]) => object, report: UploadReport): Promise<void> {
  try {
    await cloudRequest('POST', '/v1/sync', body(items));
  } catch (error) {
    if (!(error instanceof CloudHttpError) || (error.status !== 400 && error.status !== 413)) throw error;
    if (items.length > 1) {
      const middle = Math.ceil(items.length / 2);
      await send(items.slice(0, middle), body, report);
      await send(items.slice(middle), body, report);
      return;
    }
    report.skipped += 1;
    log(`server refused one row (${error.status} ${error.code ?? ''}); skipped`, 'error');
  }
}

/**
 * Uploads everything written locally since the last successful upload, table by table, oldest change first.
 * A table's cursor advances only after the server accepted that batch, so a failure anywhere leaves the rest
 * for the next run; the server upserts, so a batch that is sent twice changes nothing.
 */
export async function runUpload(db: SQLiteDatabase): Promise<UploadReport> {
  const report: UploadReport = { stepSamples: 0, sleepSegments: 0, workouts: 0, skipped: 0 };
  try {
    const me = await cloudRequest<MeResponse>('GET', '/v1/me');
    const state = await getCloudState(db);
    if (state.userId !== me.user.id) {
      // First upload, or another JoyoRogo account signed in: that account has none of the rows yet.
      if (state.userId) log(`account changed (${state.userId} -> ${me.user.id}); uploading everything again`);
      await resetCloudCursors(db);
      await setCloudState(db, { user_id: me.user.id, email: me.user.email });
    } else if (state.email !== me.user.email) {
      await setCloudState(db, { email: me.user.email });
    }

    const devices = await listDevices(db);
    if (devices.length > 0) await send(devices, (devices) => ({ devices }), report);

    for (;;) {
      const rows = await listStepSamplesAfter(db, await getUploaded(db, 'step_samples'), STEP_BATCH);
      if (rows.length === 0) break;
      await send(
        rows.map((r) => ({
          timestamp: r.timestamp,
          steps: r.steps,
          calories: r.calories,
          distance: r.distance,
          heartRate: r.heartRate,
          spo2: r.spo2,
          restingHeartRate: r.restingHeartRate,
        })),
        (stepSamples) => ({ stepSamples }),
        report,
      );
      await setUploaded(db, 'step_samples', rows[rows.length - 1].rev);
      report.stepSamples += rows.length;
    }

    for (;;) {
      const rows = await listSleepAfter(db, await getUploaded(db, 'sleep_segments'), SLEEP_BATCH);
      if (rows.length === 0) break;
      await send(
        rows.map((r) => ({ start: r.start, end: r.end, type: r.type, stage: r.stage })),
        (sleepSegments) => ({ sleepSegments }),
        report,
      );
      await setUploaded(db, 'sleep_segments', rows[rows.length - 1].rev);
      report.sleepSegments += rows.length;
    }

    for (;;) {
      const rows = await listWorkoutsAfter(db, await getUploaded(db, 'workouts'), WORKOUT_BATCH);
      if (rows.length === 0) break;
      // A workout travels whole with its points; stop adding once the request is heavy enough.
      const batch: object[] = [];
      let lastRev = 0;
      let budget = POINTS_PER_REQUEST;
      for (const { rev, id, ...workout } of rows) {
        const points = thin(await listWorkoutPointsOf(db, id), MAX_POINTS_PER_WORKOUT);
        if (batch.length > 0 && points.length > budget) break;
        batch.push({ ...workout, points });
        budget -= points.length;
        lastRev = rev;
      }
      await send(batch, (workouts) => ({ workouts }), report);
      await setUploaded(db, 'workouts', lastRev);
      report.workouts += batch.length;
    }

    await setCloudState(db, { last_sync_at: String(Math.floor(Date.now() / 1000)), last_error: null });
    const total = report.stepSamples + report.sleepSegments + report.workouts;
    if (total > 0 || report.skipped > 0) {
      log(
        `uploaded ${report.stepSamples} step samples, ${report.sleepSegments} sleep segments, ${report.workouts} workouts` +
          (report.skipped > 0 ? `, ${report.skipped} skipped` : ''),
      );
    }
    return report;
  } catch (error) {
    const message = errorMessage(error);
    log(`upload failed: ${message}`, 'error');
    await setCloudState(db, { last_error: message }).catch(() => undefined);
    throw error;
  }
}
