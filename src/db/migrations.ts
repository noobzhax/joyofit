import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Ordered schema migrations. `PRAGMA user_version` holds the number of migrations already applied,
 * so entry `i` upgrades a database from version `i` to `i + 1`. Never edit a shipped entry; append.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE step_samples (
    timestamp INTEGER PRIMARY KEY NOT NULL,
    steps INTEGER NOT NULL,
    calories INTEGER NOT NULL,
    distance INTEGER NOT NULL,
    heart_rate INTEGER,
    spo2 INTEGER,
    resting_heart_rate INTEGER
  );
  CREATE TABLE sleep_segments (
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    type INTEGER NOT NULL,
    PRIMARY KEY (start, type)
  );
  CREATE TABLE device (
    address TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    product_model TEXT,
    software_version TEXT,
    last_sync INTEGER
  );
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database schema v${current} is newer than this app supports (v${MIGRATIONS.length})`,
    );
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(sql);
      await txn.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}
