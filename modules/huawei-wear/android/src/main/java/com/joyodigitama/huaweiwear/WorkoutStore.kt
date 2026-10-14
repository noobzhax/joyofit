package com.joyodigitama.huaweiwear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Writes workouts into the shared database (`workouts`, `workout_points`; migration 3 in
 * `schema/joyofit-db-migrations.json`) through [SyncStore]'s connection. A workout is replaced as a whole in one
 * transaction: the row is upserted by `start` (the id stays), its old points are deleted and the new ones inserted.
 */
internal class WorkoutStore(private val store: SyncStore) : WorkoutSink {
  override suspend fun isComplete(start: Long, end: Long): Boolean = withContext(Dispatchers.IO) {
    store.db().rawQuery(
      "SELECT 1 FROM workouts WHERE start = ? AND end = ? AND complete = 1",
      arrayOf(start.toString(), end.toString()),
    ).use { it.moveToFirst() }
  }

  override suspend fun save(record: WorkoutRecord): Boolean = withContext(Dispatchers.IO) {
    val db = store.db()
    db.beginTransaction()
    try {
      val wasComplete = db.rawQuery("SELECT complete FROM workouts WHERE start = ?", arrayOf(record.start.toString())).use {
        if (it.moveToFirst()) it.getInt(0) == 1 else null
      }
      db.execSQL(
        """INSERT INTO workouts
             (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(start) DO UPDATE SET
             workout_number = excluded.workout_number,
             end = excluded.end,
             sport_type = excluded.sport_type,
             sport_name = excluded.sport_name,
             duration = excluded.duration,
             distance = excluded.distance,
             calories = excluded.calories,
             avg_hr = excluded.avg_hr,
             max_hr = excluded.max_hr,
             steps = excluded.steps,
             summary_json = excluded.summary_json,
             complete = excluded.complete""",
        arrayOf(
          record.number,
          record.start,
          record.end,
          record.sportType,
          record.sportName,
          record.duration,
          record.distance,
          record.calories,
          record.avgHr,
          record.maxHr,
          record.steps,
          record.summaryJson,
          if (record.complete) 1 else 0,
        ),
      )
      val id = db.rawQuery("SELECT id FROM workouts WHERE start = ?", arrayOf(record.start.toString())).use {
        it.moveToFirst()
        it.getLong(0)
      }
      db.execSQL("DELETE FROM workout_points WHERE workout_id = ?", arrayOf(id))
      val insert = db.compileStatement("INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr) VALUES (?, ?, ?, ?, ?, ?)")
      try {
        for (p in record.points) {
          insert.clearBindings()
          insert.bindLong(1, id)
          insert.bindLong(2, p.ts)
          p.lat?.let { insert.bindDouble(3, it) } ?: insert.bindNull(3)
          p.lon?.let { insert.bindDouble(4, it) } ?: insert.bindNull(4)
          p.alt?.let { insert.bindDouble(5, it) } ?: insert.bindNull(5)
          p.hr?.let { insert.bindLong(6, it.toLong()) } ?: insert.bindNull(6)
          insert.executeInsert()
        }
      } finally {
        insert.close()
      }
      db.setTransactionSuccessful()
      wasComplete != true
    } finally {
      db.endTransaction()
    }
  }

  /**
   * Start of the next workout window, unix seconds. GB asks for everything after the newest stored workout
   * (and from 2022-06-10 when there is none); the start of the oldest incomplete workout wins over that so it
   * is downloaded again.
   */
  suspend fun syncStart(): Int = withContext(Dispatchers.IO) {
    val db = store.db()
    val newestEnd = db.rawQuery("SELECT MAX(end) FROM workouts", null).use {
      if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null
    }
    val oldestIncomplete = db.rawQuery("SELECT MIN(start) FROM workouts WHERE complete = 0", null).use {
      if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null
    }
    val start = when {
      newestEnd == null -> DEFAULT_START_SEC
      oldestIncomplete != null -> minOf(oldestIncomplete, newestEnd + 1)
      else -> newestEnd + 1
    }
    minOf(start, Int.MAX_VALUE.toLong()).toInt()
  }

  companion object {
    /** GB HuaweiWorkoutSyncManager.getStartTimeFromDb fallback: 2022-06-10 00:00:00 UTC. */
    const val DEFAULT_START_SEC = 1654819200L
  }
}
