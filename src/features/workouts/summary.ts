import type { WorkoutPointRow } from '@/db/queries';

/** One pace block of the watch: per-km (type 0) or per-mile (type 1) split. */
export interface PaceBlock {
  type: number;
  /** Whole units finished at the end of this block. */
  distance: number;
  /** Fraction of the last unit in 1/10000, null for full units. */
  correction: number | null;
  /** Seconds per unit. */
  pace: number;
}

/** The fields of `workouts.summary_json` the app shows (see `WorkoutRecord.kt`); everything is optional. */
export interface WorkoutSummary {
  /** Gadgetbridge `ActivityKind` name, e.g. `RUNNING`. */
  kind?: string;
  /** `ok`, `empty`, `failed` or `none`: what happened to the GPS file. */
  gps?: string;
  gpsPoints?: number;
  missingData?: boolean;
  avgSpeed?: number;
  maxSpeed?: number;
  avgPaceSecPerKm?: number;
  minPaceSecPerKm?: number;
  avgPaceSecPer100m?: number;
  minPaceSecPer100m?: number;
  jumps?: number;
  longestStreak?: number;
  interruptions?: number;
  minHr?: number;
  hrPeakMin?: number;
  hrPeakMax?: number;
  minAltitude?: number;
  maxAltitude?: number;
  avgAltitude?: number;
  elevationGain?: number;
  elevationLoss?: number;
  maxDepth?: number;
  workoutLoad?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
  recoveryHours?: number;
  vo2max?: number;
  trainingPoints?: number;
  swim?: {
    style?: string;
    strokes?: number;
    avgStrokeRate?: number;
    poolLengthCm?: number;
    laps?: number;
    avgSwolf?: number;
  };
  samples?: Record<string, number>;
  paceBlocks?: PaceBlock[];
  paceFastestSecPerKm?: number;
  paceSlowestSecPerKm?: number;
}

export function parseSummary(json: string): WorkoutSummary {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null ? (value as WorkoutSummary) : {};
  } catch {
    return {};
  }
}

/** `5:32 /km` */
export function formatPace(secPerUnit: number, unit: string): string {
  const total = Math.round(secPerUnit);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')} /${unit}`;
}

export function formatSpeed(metersPerSecond: number): string {
  return `${(metersPerSecond * 3.6).toFixed(1)} km/h`;
}

/** Metres or kilometres with the precision a list row needs. */
export function formatWorkoutDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** `1:05:09` or `42:10`; seconds matter for workouts, unlike sleep. */
export function formatElapsed(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Splits shown in the detail view: the per-km blocks, the last one a fraction of a km. */
export function kmSplits(summary: WorkoutSummary): { km: number; pace: number }[] {
  return (summary.paceBlocks ?? [])
    .filter((b) => b.type === 0)
    .map((b) => ({ km: b.distance + (b.correction !== null ? b.correction / 10000 : 0), pace: b.pace }));
}

export interface RoutePoint {
  lat: number;
  lon: number;
}

/** GPS points of a workout, in time order. */
export function routePoints(points: readonly WorkoutPointRow[]): RoutePoint[] {
  const route: RoutePoint[] = [];
  for (const p of points) {
    if (p.lat !== null && p.lon !== null) route.push({ lat: p.lat, lon: p.lon });
  }
  return route;
}

/** At most `max` evenly spaced items, keeping the first and the last. */
export function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

export interface ProjectedRoute {
  /** `x,y x,y …` for an SVG polyline in a `width` x `height` box. */
  polyline: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Equirectangular projection (longitude scaled by cos of the mean latitude), fitted into the box with
 * `padding` on every side, north up. Good for a run or ride; no map tiles involved.
 */
export function projectRoute(
  route: readonly RoutePoint[],
  width: number,
  height: number,
  padding: number,
): ProjectedRoute | null {
  if (route.length < 2) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of route) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  const lonScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * lonScale, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = (p: RoutePoint) => ({
    x: offsetX + (p.lon - minLon) * lonScale * scale,
    y: offsetY + (maxLat - p.lat) * scale,
  });
  const projected = route.map(project);
  return {
    polyline: projected.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    start: projected[0],
    end: projected[projected.length - 1],
  };
}

export interface HeartRateBuckets {
  /** Average bpm per bucket, null where the bucket had no reading. */
  values: (number | null)[];
  min: number;
  max: number;
}

/** Averages the heart-rate readings into `count` equal time buckets between `start` and `end`. */
export function heartRateBuckets(
  points: readonly WorkoutPointRow[],
  start: number,
  end: number,
  count: number,
): HeartRateBuckets | null {
  const sums = new Array<number>(count).fill(0);
  const counts = new Array<number>(count).fill(0);
  const span = Math.max(end - start, 1);
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.hr === null) continue;
    const bucket = Math.min(count - 1, Math.max(0, Math.floor(((p.ts - start) / span) * count)));
    sums[bucket] += p.hr;
    counts[bucket] += 1;
    min = Math.min(min, p.hr);
    max = Math.max(max, p.hr);
  }
  if (min === Infinity) return null;
  return { values: sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : null)), min, max };
}
