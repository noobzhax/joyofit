package com.joyodigitama.huaweiwear

import android.database.sqlite.SQLiteException
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncInterface

/**
 * `health_metrics` (one row per dictionary entry the watch reported: type, start second, last second, the
 * number a chart plots, every value as JSON) and `health_metric_status` (what the last gate check and sync did
 * per metric, so the screen can say which ones the watch does not support). Schema: migration `health_metrics`
 * in `schema/joyofit-db-migrations.json`.
 */
internal class HealthMetricsStore(private val store: SyncStore) : HuaweiDictionarySyncInterface.Store {
  override fun getLastFetchTimestamp(type: String): Long =
    try {
      store.db().rawQuery("SELECT MAX(last_ts) FROM health_metrics WHERE type = ?", arrayOf(type)).use {
        if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) * 1000 else 0L
      }
    } catch (e: SQLiteException) {
      0L
    }

  override fun persist(rows: List<HuaweiDictionarySyncInterface.Row>) {
    if (rows.isEmpty()) return
    val db = store.db()
    db.beginTransaction()
    try {
      val statement = db.compileStatement(
        """INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(type, ts) DO UPDATE SET last_ts = excluded.last_ts, value = excluded.value, values_json = excluded.values_json""",
      )
      try {
        for (r in rows) {
          statement.clearBindings()
          statement.bindString(1, r.type)
          statement.bindLong(2, r.timestamp / 1000)
          statement.bindLong(3, maxOf(r.lastTimestamp, r.timestamp) / 1000)
          r.value?.let { statement.bindDouble(4, it) } ?: statement.bindNull(4)
          statement.bindString(5, r.valuesJson)
          statement.executeInsert()
        }
      } finally {
        statement.close()
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /** Records the outcome of the gate check or sync of one metric; [rows] adds to the stored count when not null. */
  fun setStatus(type: String, dictClass: Int, title: String, supported: Boolean, gate: String, note: String?, rowsAdded: Int? = null) {
    val db = store.db()
    val nowSec = System.currentTimeMillis() / 1000
    db.execSQL(
      """INSERT INTO health_metric_status (type, dict_class, title, supported, gate, checked_at, synced_at, rows_added, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(type) DO UPDATE SET
           dict_class = excluded.dict_class, title = excluded.title, supported = excluded.supported, gate = excluded.gate,
           checked_at = excluded.checked_at,
           synced_at = COALESCE(excluded.synced_at, health_metric_status.synced_at),
           rows_added = COALESCE(excluded.rows_added, health_metric_status.rows_added),
           note = excluded.note""",
      arrayOf<Any?>(type, dictClass, title, if (supported) 1 else 0, gate, nowSec, if (rowsAdded != null) nowSec else null, rowsAdded, note),
    )
  }

  fun count(type: String): Int =
    try {
      store.db().rawQuery("SELECT COUNT(*) FROM health_metrics WHERE type = ?", arrayOf(type)).use { if (it.moveToFirst()) it.getInt(0) else 0 }
    } catch (e: SQLiteException) {
      0
    }
}
