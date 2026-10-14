package com.joyodigitama.huaweiwear

import java.time.LocalDate
import java.time.ZoneId

/** One logged period: [end] is null while it is still going on. */
internal data class LoggedPeriod(val start: LocalDate, val end: LocalDate?)

/** Symptoms the user logged for one day; flow and cramps are 0 (none) to 3 (heavy / strong). */
internal data class LoggedDay(val day: LocalDate, val flow: Int, val cramps: Int, val modifiedSec: Long)

/**
 * One cycle as the watch's calendar wants it (Huawei Health `nej`): period start and end, the estimated
 * fertile window and ovulation day, the length to the next period start and whether the period was logged.
 */
internal data class CycleEntry(
  val start: LocalDate,
  val end: LocalDate?,
  val fertileStart: LocalDate?,
  val fertileEnd: LocalDate?,
  val ovulation: LocalDate?,
  val lengthDays: Int,
  val logged: Boolean,
)

/** Day statuses Huawei Health stores per day (`menstrual_status`, read in `nec`/`neh`/`nej`). */
internal object CycleStatus {
  const val PERIOD_START = 101
  const val PERIOD_END = 102
  const val PREDICTED_START = 301
  const val PREDICTED_END = 302
  const val FERTILE_START = 401
  const val FERTILE_END = 402
  const val OVULATION = 403
}

/**
 * A plain average-cycle model, not a medical prediction. The cycle length is the mean of the last
 * [HISTORY] start-to-start intervals between 15 and 60 days (28 with fewer), the period length the mean of
 * the last [HISTORY] finished periods (5 with none). The next period starts one cycle after the last logged
 * one; ovulation is estimated 14 days before it and the fertile window runs from 5 days before ovulation to
 * 1 day after. It cannot know about irregular cycles, stress, illness, hormones or pregnancy.
 */
internal class CycleModel(periods: List<LoggedPeriod>, val today: LocalDate) {
  /** Logged periods, oldest first. */
  val periods: List<LoggedPeriod> = periods.sortedBy { it.start }

  private val intervals: List<Int> = this.periods.zipWithNext { a, b -> (b.start.toEpochDay() - a.start.toEpochDay()).toInt() }
    .filter { it in MIN_CYCLE_DAYS..MAX_CYCLE_DAYS }

  /** Cycle length in days used for predictions. */
  val averageCycleDays: Int = intervals.takeLast(HISTORY).let { if (it.isEmpty()) DEFAULT_CYCLE_DAYS else Math.round(it.average()).toInt() }

  /** Period length in days used for predictions. */
  val averagePeriodDays: Int = this.periods.filter { it.end != null }
    .map { (it.end!!.toEpochDay() - it.start.toEpochDay()).toInt() + 1 }
    .filter { it in 1..MAX_PERIOD_DAYS }
    .takeLast(HISTORY)
    .let { if (it.isEmpty()) DEFAULT_PERIOD_DAYS else Math.round(it.average()).toInt() }

  /** Whether the latest logged period has no end yet. */
  val periodOngoing: Boolean = this.periods.lastOrNull()?.end == null && this.periods.isNotEmpty()

  /**
   * The next [count] predicted period starts after the last logged one, or none before a period was logged.
   * A prediction that is already past by at most half a cycle is moved to today (the period is late); an older
   * one is rolled forward whole cycles.
   */
  fun predictedStarts(count: Int): List<LocalDate> {
    val last = periods.lastOrNull() ?: return emptyList()
    if (count <= 0) return emptyList()
    var next = last.start.plusDays(averageCycleDays.toLong())
    if (next.isBefore(today)) {
      val late = (today.toEpochDay() - next.toEpochDay()).toInt()
      if (late <= averageCycleDays / 2) {
        next = today
      } else {
        val cycles = (late + averageCycleDays - 1) / averageCycleDays
        next = next.plusDays(cycles.toLong() * averageCycleDays)
      }
    }
    return List(count) { next.plusDays(it.toLong() * averageCycleDays) }
  }

  /** Days the next period is late, 0 when it is not (or nothing is logged). */
  fun daysLate(): Int {
    val last = periods.lastOrNull() ?: return 0
    if (periodOngoing) return 0
    val due = last.start.plusDays(averageCycleDays.toLong())
    return if (today.isAfter(due)) (today.toEpochDay() - due.toEpochDay()).toInt() else 0
  }

  private fun ovulationFor(start: LocalDate): LocalDate = start.minusDays(LUTEAL_DAYS)

  /**
   * The cycle list Huawei Health sends in `0x32/03`: up to [history] finished cycles (oldest first), the
   * current one, then up to [future] predicted ones.
   */
  fun entries(history: Int, future: Int): List<CycleEntry> {
    if (periods.isEmpty()) return emptyList()
    val futureCount = maxOf(future, 0)
    // The fertile window of a cycle sits before the next period start, so the current cycle and every predicted one need the start after it.
    val predicted = predictedStarts(futureCount + 1)
    val out = ArrayList<CycleEntry>()
    val pastStart = maxOf(0, periods.size - 1 - maxOf(history, 0))
    for (i in pastStart until periods.size - 1) {
      val period = periods[i]
      val length = (periods[i + 1].start.toEpochDay() - period.start.toEpochDay()).toInt().coerceAtMost(MAX_LENGTH_SENT)
      out += CycleEntry(period.start, period.end, null, null, null, length, true)
    }
    val current = periods.last()
    val currentLength = (predicted.first().toEpochDay() - current.start.toEpochDay()).toInt().coerceIn(1, MAX_LENGTH_SENT)
    val currentOvulation = ovulationFor(predicted.first())
    out += CycleEntry(
      start = current.start,
      end = current.end,
      fertileStart = currentOvulation.minusDays(FERTILE_BEFORE),
      fertileEnd = currentOvulation.plusDays(FERTILE_AFTER),
      ovulation = currentOvulation,
      lengthDays = currentLength,
      logged = true,
    )
    // The list holds the current cycle plus `future` predicted ones (Huawei Health nec.b stops at future + 1 cycles).
    for (index in 0 until futureCount) {
      val start = predicted[index]
      val ovulation = ovulationFor(predicted[index + 1])
      out += CycleEntry(
        start = start,
        end = start.plusDays(averagePeriodDays.toLong() - 1),
        fertileStart = ovulation.minusDays(FERTILE_BEFORE),
        fertileEnd = ovulation.plusDays(FERTILE_AFTER),
        ovulation = ovulation,
        lengthDays = averageCycleDays,
        logged = false,
      )
    }
    return out
  }

  /** The `menstrual_status` key days in [[today - historyDays], [today + futureDays]] for the watch's daily calendar. */
  fun keyDays(historyDays: Int, futureDays: Int): List<Pair<LocalDate, Int>> {
    val from = today.minusDays(maxOf(historyDays, 0).toLong())
    val to = today.plusDays(maxOf(futureDays, 0).toLong())
    val out = ArrayList<Pair<LocalDate, Int>>()
    for (p in periods) {
      out += p.start to CycleStatus.PERIOD_START
      p.end?.let { out += it to CycleStatus.PERIOD_END }
    }
    for (start in predictedStarts(PREDICTED_CYCLES)) {
      out += start to CycleStatus.PREDICTED_START
      out += start.plusDays(averagePeriodDays.toLong() - 1) to CycleStatus.PREDICTED_END
      val ovulation = ovulationFor(start)
      out += ovulation.minusDays(FERTILE_BEFORE) to CycleStatus.FERTILE_START
      out += ovulation to CycleStatus.OVULATION
      out += ovulation.plusDays(FERTILE_AFTER) to CycleStatus.FERTILE_END
    }
    return out.filter { !it.first.isBefore(from) && !it.first.isAfter(to) }.sortedBy { it.first }
  }

  companion object {
    const val DEFAULT_CYCLE_DAYS = 28
    const val DEFAULT_PERIOD_DAYS = 5
    const val MIN_CYCLE_DAYS = 15
    const val MAX_CYCLE_DAYS = 60
    const val MAX_PERIOD_DAYS = 14

    /** How many recent intervals / periods the averages use. */
    const val HISTORY = 6

    /** Huawei Health caps the cycle length it sends at 180 days. */
    const val MAX_LENGTH_SENT = 180

    const val LUTEAL_DAYS = 14L
    const val FERTILE_BEFORE = 5L
    const val FERTILE_AFTER = 1L

    /** Predicted cycles ahead used for the watch's daily calendar. */
    const val PREDICTED_CYCLES = 3

    /** Local midnight of [day] in unix seconds (what Huawei Health stores as the day's start). */
    fun daySeconds(day: LocalDate, zone: ZoneId): Long = day.atStartOfDay(zone).toEpochSecond()
  }
}
