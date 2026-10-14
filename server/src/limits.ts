/** Largest JSON body accepted by POST /v1/sync. Each table travels to D1 as one JSON bind parameter (2 MB cap). */
export const MAX_SYNC_BODY_BYTES = 3_000_000;

export const MAX_STEP_SAMPLES = 5_000;
export const MAX_SLEEP_SEGMENTS = 2_000;
export const MAX_WORKOUTS = 50;
export const MAX_DEVICES = 10;
export const MAX_POINTS_PER_WORKOUT = 30_000;
/** Workout points per D1 statement, so one bind parameter stays well under D1's 2 MB string limit. */
export const POINTS_PER_STATEMENT = 4_000;

export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1_000;
/** Workouts carry their GPS track, so a pull page holds fewer of them. */
export const PULL_MAX_WORKOUTS = 25;

/** How long a verified session is reused before JoyoRogo is asked again. */
export const AUTH_CACHE_TTL_MS = 60_000;
export const AUTH_CACHE_MAX_ENTRIES = 500;
export const AUTH_TIMEOUT_MS = 5_000;

export const DEFAULT_MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const IMPORT_LIST_LIMIT = 50;
