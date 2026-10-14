import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';

/**
 * Ordered schema migrations, shared with the native side (it reads the same JSON as an Android
 * asset). Each entry is a list of single SQL statements. `PRAGMA user_version` holds the number of
 * migrations already applied, so entry `i` upgrades a database from version `i` to `i + 1`. Never
 * edit a shipped entry; append.
 */
const MIGRATIONS: readonly (readonly string[])[] = migrationsJson;

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
    const sql = MIGRATIONS[version].join(';\n');
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(sql);
      await txn.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}
