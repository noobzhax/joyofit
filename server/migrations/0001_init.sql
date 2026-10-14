-- JoyoFit cloud schema. Mirrors the app's local SQLite tables, every row owned by a JoyoRogo user.
-- `rev` is a per-user change counter: each row written gets a unique, increasing value, so
-- GET /v1/sync?since=<rev> returns exactly what changed after the caller's last pull.

CREATE TABLE user_state (
  user_id TEXT PRIMARY KEY NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  last_sync_at INTEGER
) WITHOUT ROWID;

CREATE TABLE step_samples (
  user_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  steps INTEGER NOT NULL,
  calories INTEGER NOT NULL,
  distance INTEGER NOT NULL,
  heart_rate INTEGER,
  spo2 INTEGER,
  resting_heart_rate INTEGER,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, timestamp)
) WITHOUT ROWID;
CREATE INDEX step_samples_rev ON step_samples (user_id, rev);

CREATE TABLE sleep_segments (
  user_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  "end" INTEGER NOT NULL,
  type INTEGER NOT NULL,
  stage TEXT,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, start, type)
) WITHOUT ROWID;
CREATE INDEX sleep_segments_rev ON sleep_segments (user_id, rev);

CREATE TABLE workouts (
  user_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  workout_number INTEGER NOT NULL,
  "end" INTEGER NOT NULL,
  sport_type INTEGER NOT NULL,
  sport_name TEXT NOT NULL,
  duration INTEGER NOT NULL,
  distance INTEGER NOT NULL,
  calories INTEGER NOT NULL,
  avg_hr INTEGER,
  max_hr INTEGER,
  steps INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  complete INTEGER NOT NULL,
  point_count INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, start)
) WITHOUT ROWID;
CREATE INDEX workouts_rev ON workouts (user_id, rev);

-- A workout is replaced as a whole, so its points are keyed by their position (`seq`) in it.
CREATE TABLE workout_points (
  user_id TEXT NOT NULL,
  workout_start INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  lat REAL,
  lon REAL,
  alt REAL,
  hr INTEGER,
  PRIMARY KEY (user_id, workout_start, seq)
) WITHOUT ROWID;

CREATE TABLE device (
  user_id TEXT NOT NULL,
  address TEXT NOT NULL,
  name TEXT NOT NULL,
  product_model TEXT,
  software_version TEXT,
  last_sync INTEGER,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, address)
) WITHOUT ROWID;
CREATE INDEX device_rev ON device (user_id, rev);

-- Raw files from the Huawei export; parsed later by an importer that reads `r2_key`.
CREATE TABLE imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  size INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX imports_by_user ON imports (user_id, created_at DESC);
