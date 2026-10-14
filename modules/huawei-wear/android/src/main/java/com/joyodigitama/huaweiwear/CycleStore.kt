package com.joyodigitama.huaweiwear

import java.time.LocalDate
import java.time.format.DateTimeParseException

/** What may be logged; each check returns the reason a change is refused, or null when it is fine. */
internal object CycleLogRules {
  const val MAX_LEVEL = 3

  fun parseDay(text: String): LocalDate = try {
    LocalDate.parse(text)
  } catch (e: DateTimeParseException) {
    throw WearException(ErrorCodes.INVALID_ARGUMENT, "'$text' is not a date (expected YYYY-MM-DD)")
  }

  private fun covers(period: LoggedPeriod, day: LocalDate, today: LocalDate): Boolean {
    val end = period.end ?: today
    return !day.isBefore(period.start) && !day.isAfter(end)
  }

  fun checkStart(periods: List<LoggedPeriod>, day: LocalDate, today: LocalDate): String? {
    if (day.isAfter(today)) return "A period cannot start in the future"
    periods.firstOrNull { it.end == null }?.let { return "A period started on ${it.start} is still open; end it first" }
    periods.firstOrNull { covers(it, day, today) }?.let { return "That day is already inside the period from ${it.start}" }
    periods.firstOrNull { it.start.isAfter(day) }?.let { return "A later period (${it.start}) is already logged; add an earlier one with both dates" }
    return null
  }

  /** A finished period [start]..[end] added after the fact: inside today and overlapping no logged period. */
  fun checkRange(periods: List<LoggedPeriod>, start: LocalDate, end: LocalDate, today: LocalDate): String? {
    if (end.isAfter(today)) return "A period cannot end in the future"
    if (end.isBefore(start)) return "A period cannot end before it started"
    periods.firstOrNull { !start.isAfter(it.end ?: today) && !end.isBefore(it.start) }
      ?.let { return "That overlaps the period from ${it.start}" }
    return null
  }

  fun checkEnd(periods: List<LoggedPeriod>, day: LocalDate, today: LocalDate): String? {
    val open = periods.firstOrNull { it.end == null } ?: return "There is no open period to end"
    if (day.isAfter(today)) return "A period cannot end in the future"
    if (day.isBefore(open.start)) return "A period cannot end before it started (${open.start})"
    return null
  }

  fun checkLevels(day: LocalDate, today: LocalDate, flow: Int, cramps: Int): String? {
    if (day.isAfter(today)) return "Symptoms cannot be logged for a future day"
    if (flow !in 0..MAX_LEVEL) return "Flow must be 0 to $MAX_LEVEL"
    if (cramps !in 0..MAX_LEVEL) return "Cramps must be 0 to $MAX_LEVEL"
    return null
  }
}

/** The menstrual log in `joyofit.db` (`cycle_periods`, `cycle_days`, migration 6). Times are unix seconds, days are local `YYYY-MM-DD`. */
internal class CycleStore(private val store: SyncStore) {
  fun periods(): List<LoggedPeriod> = store.read { db ->
    db.rawQuery("SELECT start, end FROM cycle_periods ORDER BY start", null).use { c ->
      buildList {
        while (c.moveToNext()) add(LoggedPeriod(LocalDate.parse(c.getString(0)), if (c.isNull(1)) null else LocalDate.parse(c.getString(1))))
      }
    }
  }

  /** Logged symptom days from [since] (inclusive), oldest first. */
  fun days(since: LocalDate): List<LoggedDay> = store.read { db ->
    db.rawQuery("SELECT day, flow, cramps, modified FROM cycle_days WHERE day >= ? ORDER BY day", arrayOf(since.toString())).use { c ->
      buildList { while (c.moveToNext()) add(LoggedDay(LocalDate.parse(c.getString(0)), c.getInt(1), c.getInt(2), c.getLong(3))) }
    }
  }

  /** The newest change of any row, unix seconds; null when nothing is logged. */
  fun lastModified(): Long? = store.read { db ->
    db.rawQuery(
      "SELECT MAX(m) FROM (SELECT MAX(modified) AS m FROM cycle_periods UNION ALL SELECT MAX(modified) FROM cycle_days)",
      null,
    ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
  }

  fun startPeriod(day: LocalDate, nowSec: Long) {
    store.read { db -> db.execSQL("INSERT INTO cycle_periods (start, end, modified) VALUES (?, NULL, ?)", arrayOf(day.toString(), nowSec)) }
  }

  fun endPeriod(day: LocalDate, nowSec: Long) {
    store.read { db -> db.execSQL("UPDATE cycle_periods SET end = ?, modified = ? WHERE end IS NULL", arrayOf(day.toString(), nowSec)) }
  }

  fun addPeriod(start: LocalDate, end: LocalDate, nowSec: Long) {
    store.read { db -> db.execSQL("INSERT INTO cycle_periods (start, end, modified) VALUES (?, ?, ?)", arrayOf(start.toString(), end.toString(), nowSec)) }
  }

  fun deletePeriod(start: LocalDate) {
    store.read { db -> db.execSQL("DELETE FROM cycle_periods WHERE start = ?", arrayOf(start.toString())) }
  }

  /** Saves flow and cramps of [day]. A row of 0 / 0 stays, so the watch also learns of a reset. */
  fun logDay(day: LocalDate, flow: Int, cramps: Int, nowSec: Long) {
    store.read { db ->
      db.execSQL(
        """INSERT INTO cycle_days (day, flow, cramps, modified) VALUES (?, ?, ?, ?)
           ON CONFLICT(day) DO UPDATE SET flow = excluded.flow, cramps = excluded.cramps, modified = excluded.modified""",
        arrayOf(day.toString(), flow, cramps, nowSec),
      )
    }
  }
}
