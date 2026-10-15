package com.joyodigitama.huaweiwear

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import java.io.File
import org.json.JSONArray

/** Re-request this much already-stored history on every sync; upserts make the overlap idempotent. */
internal const val SYNC_OVERLAP_SEC = 3600L

/** The first sync of a watch (no `last_sync` yet) asks for this much history. */
internal const val FIRST_SYNC_LOOKBACK_SEC = 7 * 24 * 3600L

/** Start of the next sync window, unix seconds: 7 days back on the first sync, else 1 h before the last one. */
internal fun syncWindowStart(lastSyncSec: Long?, nowSec: Long): Long =
  if (lastSyncSec == null) nowSec - FIRST_SYNC_LOOKBACK_SEC else maxOf(0L, lastSyncSec - SYNC_OVERLAP_SEC)

/** What one stored sync reports to JS (`SyncSummary` in `HuaweiWear.types.ts`). */
internal class SyncSummary(
  val from: Long,
  val to: Long,
  val samples: Int,
  val sleep: Int,
  val totalSteps: Int,
  val totalCalories: Int,
  val totalDistance: Int,
  /** Workouts written (new or completed) by this sync's workout phase. */
  val workouts: Int = 0,
) {
  fun withWorkouts(count: Int) =
    SyncSummary(from, to, samples, sleep, totalSteps, totalCalories, totalDistance, count)

  fun toJs(): Map<String, Any?> = mapOf(
    "from" to from,
    "to" to to,
    "samples" to samples,
    "workouts" to workouts,
    "sleep" to sleep,
    "totals" to mapOf(
      "steps" to totalSteps,
      "calories" to totalCalories,
      "distance" to totalDistance,
    ),
  )
}

/**
 * Writes sync results into the database the JS side reads with expo-sqlite: `joyofit.db` in
 * `<filesDir>/SQLite` (expo-sqlite's `defaultDatabaseDirectory` + the name `_layout.tsx` opens).
 * Schema and migrations come from the same JSON asset JS imports
 * (`modules/huawei-wear/schema/joyofit-db-migrations.json`); `PRAGMA user_version` counts applied
 * migrations in both. Upserts are the ones `src/db/queries.ts` used to run from JS.
 */
internal class SyncStore(context: Context) {
  private val appContext = context.applicationContext
  private val file = File(File(appContext.filesDir, "SQLite"), DATABASE_NAME)
  private var database: SQLiteDatabase? = null

  @Synchronized
  internal fun db(): SQLiteDatabase {
    database?.let { return it }
    file.parentFile?.mkdirs()
    val opened = SQLiteDatabase.openDatabase(
      file.path,
      null,
      SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING,
    )
    try {
      // The framework default is 2.5 s. JS may hold the file briefly (its own migration), so wait longer.
      opened.rawQuery("PRAGMA busy_timeout = $BUSY_TIMEOUT_MS", null).use { it.moveToFirst() }
      migrate(opened, loadMigrations())
    } catch (e: Exception) {
      opened.close()
      throw e
    }
    database = opened
    return opened
  }

  private fun loadMigrations(): List<List<String>> {
    val json = appContext.assets.open(MIGRATIONS_ASSET).use { String(it.readBytes(), Charsets.UTF_8) }
    val all = JSONArray(json)
    return List(all.length()) { i ->
      val statements = all.getJSONArray(i)
      List(statements.length()) { statements.getString(it) }
    }
  }

  /** `migrate()` in `src/db/migrations.ts`: entry `i` upgrades `user_version` i to i + 1. */
  private fun migrate(db: SQLiteDatabase, migrations: List<List<String>>) {
    val current = db.version
    if (current > migrations.size) {
      throw SQLiteException("Database schema v$current is newer than this app supports (v${migrations.size})")
    }
    for (version in current until migrations.size) {
      db.beginTransaction()
      try {
        // JS may have applied this step between the read above and taking the write lock.
        if (db.version <= version) {
          for (statement in migrations[version]) db.execSQL(statement)
          db.version = version + 1
        }
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    }
  }

  /** Runs [block] against the open database; the Health Connect export reads stored rows through this. */
  fun <T> read(block: (SQLiteDatabase) -> T): T = block(db())

  fun lastSync(address: String): Long? =
    db().rawQuery("SELECT last_sync FROM device WHERE address = ?", arrayOf(address)).use { cursor ->
      if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
    }

  /** `upsertDevice` of the old JS queries: keeps `last_sync` of an existing row. */
  fun upsertDevice(address: String, name: String, productModel: String?, softwareVersion: String?) {
    db().execSQL(
      """INSERT INTO device (address, name, product_model, software_version, last_sync)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(address) DO UPDATE SET
           name = excluded.name,
           product_model = excluded.product_model,
           software_version = excluded.software_version""",
      arrayOf(address, name, productModel, softwareVersion),
    )
  }

  /** Persists one sync in a single transaction and advances `device.last_sync` to `result.to`. */
  fun save(address: String, result: SyncResult): SyncSummary {
    val db = db()
    db.beginTransaction()
    try {
      val sample = db.compileStatement(
        """INSERT INTO step_samples
             (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(timestamp) DO UPDATE SET
             steps = excluded.steps,
             calories = excluded.calories,
             distance = excluded.distance,
             heart_rate = excluded.heart_rate,
             spo2 = excluded.spo2,
             resting_heart_rate = excluded.resting_heart_rate""",
      )
      val segment = db.compileStatement(
        """INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, ?, ?)
           ON CONFLICT(start, type) DO UPDATE SET end = excluded.end, stage = excluded.stage""",
      )
      try {
        for (s in result.samples) {
          sample.clearBindings()
          sample.bindLong(1, s.timestamp)
          sample.bindLong(2, s.steps.toLong())
          sample.bindLong(3, s.calories.toLong())
          sample.bindLong(4, s.distance.toLong())
          s.heartRate?.let { sample.bindLong(5, it.toLong()) } ?: sample.bindNull(5)
          s.spo2?.let { sample.bindLong(6, it.toLong()) } ?: sample.bindNull(6)
          s.restingHeartRate?.let { sample.bindLong(7, it.toLong()) } ?: sample.bindNull(7)
          sample.executeInsert()
        }
        for (s in result.sleep) {
          segment.clearBindings()
          segment.bindLong(1, s.start)
          segment.bindLong(2, s.end)
          segment.bindLong(3, s.type.toLong())
          s.stage?.let { segment.bindString(4, it) } ?: segment.bindNull(4)
          segment.executeInsert()
        }
      } finally {
        sample.close()
        segment.close()
      }
      for (s in result.sleepScores) {
        db.execSQL(
          """INSERT INTO sleep_scores (start, end, score, efficiency) VALUES (?, ?, ?, ?)
             ON CONFLICT(start) DO UPDATE SET end = excluded.end, score = excluded.score, efficiency = excluded.efficiency""",
          arrayOf<Any?>(s.start, s.end, s.score, s.efficiency),
        )
      }
      db.execSQL("UPDATE device SET last_sync = ? WHERE address = ?", arrayOf(result.to, address))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return SyncSummary(
      from = result.from,
      to = result.to,
      samples = result.samples.size,
      sleep = result.sleep.size,
      totalSteps = result.totalSteps,
      totalCalories = result.totalCalories,
      totalDistance = result.totalDistance,
    )
  }

  private companion object {
    /** Must match `DATABASE_NAME` in `src/app/_layout.tsx`. */
    const val DATABASE_NAME = "joyofit.db"
    const val MIGRATIONS_ASSET = "joyofit-db-migrations.json"
    const val BUSY_TIMEOUT_MS = 10_000
  }
}
