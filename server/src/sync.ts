import { POINTS_PER_STATEMENT, PULL_MAX_WORKOUTS } from "./limits";
import type { DeviceInput, SleepSegmentInput, StepSampleInput, SyncBody, WorkoutInput } from "./schemas";

/**
 * Upserts and pulls, both scoped to one user.
 *
 * Writes go to D1 as one `db.batch` (a transaction). Each table travels as a single JSON bind parameter that
 * `json_each` expands, so a request costs a handful of statements whatever its size (D1 allows 100 bound
 * parameters per statement and, on the free plan, 50 queries per invocation).
 *
 * `rev` is a per-user counter. One request reserves a block of N values in `user_state` and gives each row it
 * writes a distinct value in that block. A row whose content is unchanged is not touched, so replaying a batch
 * writes nothing and never shows up again in a pull.
 */

interface TableSpec {
  table: string;
  keys: readonly string[];
  values: readonly string[];
}

const STEP_SAMPLES: TableSpec = {
  table: "step_samples",
  keys: ["timestamp"],
  values: ["steps", "calories", "distance", "heart_rate", "spo2", "resting_heart_rate"],
};
const SLEEP_SEGMENTS: TableSpec = {
  table: "sleep_segments",
  keys: ["start", "type"],
  values: ["end", "stage"],
};
const WORKOUTS: TableSpec = {
  table: "workouts",
  keys: ["start"],
  values: [
    "workout_number",
    "end",
    "sport_type",
    "sport_name",
    "duration",
    "distance",
    "calories",
    "avg_hr",
    "max_hr",
    "steps",
    "summary_json",
    "complete",
    "point_count",
  ],
};
const DEVICES: TableSpec = {
  table: "device",
  keys: ["address"],
  values: ["name", "product_model", "software_version", "last_sync"],
};

const q = (column: string) => `"${column}"`;

/** Bind parameters: ?1 user id, ?2 JSON array of rows, ?3 rows reserved by the request, ?4 offset of this table's block, ?5 now. */
function upsertSql(spec: TableSpec): string {
  const columns = [...spec.keys, ...spec.values];
  const picks = columns.map((_, i) => `json_extract(j.value, '$[${i}]')`).join(", ");
  const assign = spec.values.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ");
  const current = spec.values.map((c) => `${spec.table}.${q(c)}`).join(", ");
  const incoming = spec.values.map((c) => `excluded.${q(c)}`).join(", ");
  return `INSERT INTO ${spec.table} (user_id, ${columns.map(q).join(", ")}, rev, updated_at)
SELECT ?1, ${picks}, (SELECT rev FROM user_state WHERE user_id = ?1) - ?3 + ?4 + j.key + 1, ?5
FROM json_each(?2) AS j WHERE true
ON CONFLICT (user_id, ${spec.keys.map(q).join(", ")}) DO UPDATE SET ${assign}, rev = excluded.rev, updated_at = excluded.updated_at
WHERE (${current}) IS NOT (${incoming})`;
}

const stepRow = (s: StepSampleInput) => [s.timestamp, s.steps, s.calories, s.distance, s.heartRate, s.spo2, s.restingHeartRate];
const sleepRow = (s: SleepSegmentInput) => [s.start, s.type, s.end, s.stage];
const workoutRow = (w: WorkoutInput) => [
  w.start,
  w.workoutNumber,
  w.end,
  w.sportType,
  w.sportName,
  w.duration,
  w.distance,
  w.calories,
  w.avgHr,
  w.maxHr,
  w.steps,
  w.summaryJson,
  w.complete ? 1 : 0,
  w.points.length,
];
const deviceRow = (d: DeviceInput) => [d.address, d.name, d.productModel, d.softwareVersion, d.lastSync];

export interface SyncResult {
  /** The user's change counter after this request. */
  rev: number;
  /** Rows the request created or changed; rows identical to what is stored are not counted. */
  written: { stepSamples: number; sleepSegments: number; workouts: number; devices: number };
}

/** Last occurrence wins, like replaying the same upserts in order. */
function dedupe<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

export async function applySync(db: D1Database, userId: string, body: SyncBody, now: number): Promise<SyncResult> {
  const steps = dedupe(body.stepSamples, (s) => String(s.timestamp));
  const sleep = dedupe(body.sleepSegments, (s) => `${s.start}:${s.type}`);
  const workouts = dedupe(body.workouts, (w) => String(w.start));
  const devices = dedupe(body.devices, (d) => d.address);
  const total = steps.length + sleep.length + workouts.length + devices.length;

  if (total === 0) {
    const row = await db.prepare("SELECT rev FROM user_state WHERE user_id = ?1").bind(userId).first<{ rev: number }>();
    return { rev: row?.rev ?? 0, written: { stepSamples: 0, sleepSegments: 0, workouts: 0, devices: 0 } };
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO user_state (user_id, rev, last_sync_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id) DO UPDATE SET rev = rev + ?2, last_sync_at = ?3`,
      )
      .bind(userId, total, now),
  ];
  // Index in `statements` of each table's upsert, to read how many rows it wrote.
  const at: Partial<Record<"steps" | "sleep" | "workouts" | "devices", number>> = {};
  let offset = 0;
  const add = (name: keyof typeof at, spec: TableSpec, rows: unknown[][]) => {
    if (rows.length === 0) return;
    at[name] = statements.length;
    statements.push(db.prepare(upsertSql(spec)).bind(userId, JSON.stringify(rows), total, offset, now));
    offset += rows.length;
  };
  add("steps", STEP_SAMPLES, steps.map(stepRow));
  add("sleep", SLEEP_SEGMENTS, sleep.map(sleepRow));
  add("workouts", WORKOUTS, workouts.map(workoutRow));
  add("devices", DEVICES, devices.map(deviceRow));

  if (workouts.length > 0) {
    // A workout is replaced as a whole: drop its stored points, then insert the ones sent.
    statements.push(
      db
        .prepare("DELETE FROM workout_points WHERE user_id = ?1 AND workout_start IN (SELECT value FROM json_each(?2))")
        .bind(userId, JSON.stringify(workouts.map((w) => w.start))),
    );
    const points = workouts.flatMap((w) =>
      w.points.map((p, seq) => [w.start, seq, p.ts, p.lat, p.lon, p.alt, p.hr]),
    );
    for (let i = 0; i < points.length; i += POINTS_PER_STATEMENT) {
      statements.push(
        db
          .prepare(
            `INSERT INTO workout_points (user_id, workout_start, seq, ts, lat, lon, alt, hr)
             SELECT ?1, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'),
                    json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'),
                    json_extract(j.value, '$[6]')
             FROM json_each(?2) AS j`,
          )
          .bind(userId, JSON.stringify(points.slice(i, i + POINTS_PER_STATEMENT))),
      );
    }
  }
  statements.push(db.prepare("SELECT rev FROM user_state WHERE user_id = ?1").bind(userId));

  const results = await db.batch<{ rev: number }>(statements);
  const changes = (name: keyof typeof at): number => {
    const index = at[name];
    return index === undefined ? 0 : (results[index]?.meta.changes ?? 0);
  };
  return {
    rev: results[results.length - 1]?.results[0]?.rev ?? 0,
    written: {
      stepSamples: changes("steps"),
      sleepSegments: changes("sleep"),
      workouts: changes("workouts"),
      devices: changes("devices"),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pull

interface StepSampleRow {
  timestamp: number;
  steps: number;
  calories: number;
  distance: number;
  heart_rate: number | null;
  spo2: number | null;
  resting_heart_rate: number | null;
  rev: number;
}
interface SleepSegmentRow {
  start: number;
  end: number;
  type: number;
  stage: string | null;
  rev: number;
}
interface WorkoutRow {
  start: number;
  workout_number: number;
  end: number;
  sport_type: number;
  sport_name: string;
  duration: number;
  distance: number;
  calories: number;
  avg_hr: number | null;
  max_hr: number | null;
  steps: number;
  summary_json: string;
  complete: number;
  rev: number;
}
interface WorkoutPointRow {
  workout_start: number;
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
}
interface DeviceRow {
  address: string;
  name: string;
  product_model: string | null;
  software_version: string | null;
  last_sync: number | null;
  rev: number;
}

export interface PullResult {
  stepSamples: unknown[];
  sleepSegments: unknown[];
  workouts: unknown[];
  devices: unknown[];
  /** Pass as `since` to get the next page. */
  cursor: number;
  hasMore: boolean;
}

type Tagged =
  | { kind: "step"; rev: number; row: StepSampleRow }
  | { kind: "sleep"; rev: number; row: SleepSegmentRow }
  | { kind: "workout"; rev: number; row: WorkoutRow }
  | { kind: "device"; rev: number; row: DeviceRow };

/** Rows of this user with `rev > since`, oldest change first, at most `limit` rows across all tables. */
export async function pullSync(db: D1Database, userId: string, since: number, limit: number): Promise<PullResult> {
  const workoutLimit = Math.min(limit, PULL_MAX_WORKOUTS);
  const page = (table: string, columns: string, n: number) =>
    db
      .prepare(`SELECT ${columns}, rev FROM ${table} WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3`)
      .bind(userId, since, n);
  const [steps, sleep, workouts, devices] = await db.batch([
    page("step_samples", 'timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate', limit),
    page("sleep_segments", 'start, "end", type, stage', limit),
    page(
      "workouts",
      'start, workout_number, "end", sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete',
      workoutLimit,
    ),
    page("device", "address, name, product_model, software_version, last_sync", limit),
  ]);

  const stepRows = (steps?.results ?? []) as unknown as StepSampleRow[];
  const sleepRows = (sleep?.results ?? []) as unknown as SleepSegmentRow[];
  const workoutRows = (workouts?.results ?? []) as unknown as WorkoutRow[];
  const deviceRows = (devices?.results ?? []) as unknown as DeviceRow[];

  // A table that filled its page may hold more rows after the last one it returned.
  const maybeMore =
    stepRows.length === limit || sleepRows.length === limit || workoutRows.length === workoutLimit || deviceRows.length === limit;

  const merged: Tagged[] = [
    ...stepRows.map((row): Tagged => ({ kind: "step", rev: row.rev, row })),
    ...sleepRows.map((row): Tagged => ({ kind: "sleep", rev: row.rev, row })),
    ...workoutRows.map((row): Tagged => ({ kind: "workout", rev: row.rev, row })),
    ...deviceRows.map((row): Tagged => ({ kind: "device", rev: row.rev, row })),
  ].sort((a, b) => a.rev - b.rev);
  const included = merged.slice(0, limit);
  const hasMore = merged.length > limit || maybeMore;

  const includedWorkouts = included.flatMap((t) => (t.kind === "workout" ? [t.row] : []));
  const pointsByWorkout = new Map<number, WorkoutPointRow[]>();
  if (includedWorkouts.length > 0) {
    const points = await db
      .prepare(
        `SELECT workout_start, ts, lat, lon, alt, hr FROM workout_points
         WHERE user_id = ?1 AND workout_start IN (SELECT value FROM json_each(?2)) ORDER BY workout_start, seq`,
      )
      .bind(userId, JSON.stringify(includedWorkouts.map((w) => w.start)))
      .all<WorkoutPointRow>();
    for (const point of points.results) {
      const list = pointsByWorkout.get(point.workout_start) ?? [];
      list.push(point);
      pointsByWorkout.set(point.workout_start, list);
    }
  }

  const result: PullResult = {
    stepSamples: [],
    sleepSegments: [],
    workouts: [],
    devices: [],
    cursor: included[included.length - 1]?.rev ?? since,
    hasMore,
  };
  for (const t of included) {
    switch (t.kind) {
      case "step":
        result.stepSamples.push({
          timestamp: t.row.timestamp,
          steps: t.row.steps,
          calories: t.row.calories,
          distance: t.row.distance,
          heartRate: t.row.heart_rate,
          spo2: t.row.spo2,
          restingHeartRate: t.row.resting_heart_rate,
          rev: t.rev,
        });
        break;
      case "sleep":
        result.sleepSegments.push({ start: t.row.start, end: t.row.end, type: t.row.type, stage: t.row.stage, rev: t.rev });
        break;
      case "workout":
        result.workouts.push({
          workoutNumber: t.row.workout_number,
          start: t.row.start,
          end: t.row.end,
          sportType: t.row.sport_type,
          sportName: t.row.sport_name,
          duration: t.row.duration,
          distance: t.row.distance,
          calories: t.row.calories,
          avgHr: t.row.avg_hr,
          maxHr: t.row.max_hr,
          steps: t.row.steps,
          summaryJson: t.row.summary_json,
          complete: t.row.complete !== 0,
          points: (pointsByWorkout.get(t.row.start) ?? []).map((p) => ({
            ts: p.ts,
            lat: p.lat,
            lon: p.lon,
            alt: p.alt,
            hr: p.hr,
          })),
          rev: t.rev,
        });
        break;
      case "device":
        result.devices.push({
          address: t.row.address,
          name: t.row.name,
          productModel: t.row.product_model,
          softwareVersion: t.row.software_version,
          lastSync: t.row.last_sync,
          rev: t.rev,
        });
        break;
    }
  }
  return result;
}
