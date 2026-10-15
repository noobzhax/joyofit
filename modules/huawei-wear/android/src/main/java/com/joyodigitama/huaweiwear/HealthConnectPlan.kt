package com.joyodigitama.huaweiwear

/**
 * Pure planning for the Health Connect export: turns stored watch rows into the records that are
 * written, without touching Health Connect classes so it can be unit-tested on the JVM.
 *
 * Units, from Gadgetbridge's reading of the step frames (`GetStepDataRequest` stores the values
 * unchanged; `HuaweiWorkoutGbParser` reports the same watch numbers as `UNIT_KCAL`):
 *  - `steps`: steps in that minute,
 *  - `distance`: metres in that minute (GB logs the totals as "m"),
 *  - `calories`: kilocalories in that minute (GB's TODO wonders whether it could be small calories;
 *    its own UI and workout summary treat the value as kcal, so it is written as kcal).
 *
 * Every record has a stable client id (`joyofit:<kind>:<key>`), so writing the same window again
 * replaces the earlier record instead of adding a second one.
 */
internal object HealthConnectPlan {
  const val ID_PREFIX = "joyofit"

  /** A sample's timestamp is the start of its minute. */
  const val SAMPLE_SPAN_SEC = 60L

  /** HeartRateRecord holds up to 10 000 samples; one record per hour is at most 60. */
  const val HEART_SERIES_SEC = 3600L

  const val MIN_BPM = 1
  const val MAX_BPM = 300

  /** Sleep spans separated by more than this are different sessions (a nap vs the night). */
  const val SLEEP_SESSION_GAP_SEC = 60 * 60L

  /** One value over [startSec, endSec). */
  data class Interval(val id: String, val startSec: Long, val endSec: Long, val value: Long)

  data class Point(val timeSec: Long, val value: Int)

  /** Heart-rate samples of one hour as a series record. */
  data class HeartSeries(val id: String, val startSec: Long, val endSec: Long, val points: List<Point>)

  data class SleepStagePlan(val startSec: Long, val endSec: Long, val stage: SleepStageKind)

  data class SleepPlan(val id: String, val startSec: Long, val endSec: Long, val stages: List<SleepStagePlan>)

  /** Mirrors the stages Health Connect knows; the exporter maps these to `SleepSessionRecord.STAGE_TYPE_*`. */
  enum class SleepStageKind { SLEEPING, LIGHT, DEEP, REM, AWAKE }

  fun id(kind: String, key: Any) = "$ID_PREFIX:$kind:$key"

  /** Per-minute steps for samples at or after [fromSec]; zero minutes are skipped. */
  fun steps(samples: List<StepSample>, fromSec: Long): List<Interval> =
    intervals("steps", samples, fromSec) { it.steps.toLong() }

  /** Per-minute distance in metres. */
  fun distance(samples: List<StepSample>, fromSec: Long): List<Interval> =
    intervals("distance", samples, fromSec) { it.distance.toLong() }

  /** Per-minute active energy in kilocalories. */
  fun calories(samples: List<StepSample>, fromSec: Long): List<Interval> =
    intervals("calories", samples, fromSec) { it.calories.toLong() }

  private inline fun intervals(
    kind: String,
    samples: List<StepSample>,
    fromSec: Long,
    value: (StepSample) -> Long,
  ): List<Interval> = samples.mapNotNull { s ->
    val v = value(s)
    if (s.timestamp < fromSec || v <= 0) null else Interval(id(kind, s.timestamp), s.timestamp, s.timestamp + SAMPLE_SPAN_SEC, v)
  }

  /**
   * Heart rate grouped into one record per epoch hour, built from every sample passed in (the
   * caller loads whole hours so a re-written hour never loses its earlier minutes).
   */
  fun heartSeries(samples: List<StepSample>): List<HeartSeries> =
    samples
      .filter { (it.heartRate ?: 0) in MIN_BPM..MAX_BPM }
      .groupBy { Math.floorDiv(it.timestamp, HEART_SERIES_SEC) }
      .map { (hour, group) ->
        val points = group.sortedBy { it.timestamp }.map { Point(it.timestamp, it.heartRate!!) }
        HeartSeries(id("hr", hour * HEART_SERIES_SEC), points.first().timeSec, points.last().timeSec + 1, points)
      }
      .sortedBy { it.startSec }

  /** Instantaneous SpO2 readings (percent) at or after [fromSec]. */
  fun spo2(samples: List<StepSample>, fromSec: Long): List<Point> =
    samples.mapNotNull { s ->
      val v = s.spo2
      if (s.timestamp < fromSec || v == null || v !in 1..100) null else Point(s.timestamp, v)
    }

  /**
   * The latest resting heart rate of each day, keyed by the day's index from [dayOf] (the caller
   * supplies the local-calendar day of a timestamp). Id and time are those of the latest reading.
   */
  fun restingHeartRate(samples: List<StepSample>, fromSec: Long, dayOf: (Long) -> String): List<Pair<String, Point>> {
    val latest = LinkedHashMap<String, Point>()
    for (s in samples.sortedBy { it.timestamp }) {
      val v = s.restingHeartRate
      if (s.timestamp < fromSec || v == null || v !in MIN_BPM..MAX_BPM) continue
      latest[dayOf(s.timestamp)] = Point(s.timestamp, v)
    }
    return latest.map { (day, point) -> id("rhr", day) to point }
  }

  fun stageKind(stage: String?): SleepStageKind = when (stage) {
    "light" -> SleepStageKind.LIGHT
    "deep" -> SleepStageKind.DEEP
    "rem" -> SleepStageKind.REM
    "awake" -> SleepStageKind.AWAKE
    else -> SleepStageKind.SLEEPING
  }

  /**
   * Groups sleep spans into sessions (gap over [SLEEP_SESSION_GAP_SEC] starts a new one) and turns
   * each into ordered, non-overlapping stages. Where spans overlap, the earlier-starting one keeps
   * the time. Sessions that end before [fromSec] are left out, so a window can reach back far
   * enough to see a whole night without rewriting older ones.
   */
  fun sleepSessions(segments: List<SleepSegment>, fromSec: Long): List<SleepPlan> {
    val sessions = ArrayList<SleepPlan>()
    var stages = ArrayList<SleepStagePlan>()
    var cursor = Long.MIN_VALUE

    fun close() {
      if (stages.isEmpty()) return
      val start = stages.first().startSec
      val end = stages.last().endSec
      if (end >= fromSec) sessions.add(SleepPlan(id("sleep", start), start, end, stages))
      stages = ArrayList()
    }

    for (s in withoutStrayUnstaged(segments).sortedWith(compareBy({ it.start }, { it.end }))) {
      if (s.end <= s.start) continue
      if (stages.isNotEmpty() && s.start - cursor > SLEEP_SESSION_GAP_SEC) close()
      val start = if (stages.isNotEmpty()) maxOf(s.start, cursor) else s.start
      if (s.end <= start) continue
      val kind = stageKind(s.stage)
      val last = stages.lastOrNull()
      if (last != null && last.stage == kind && last.endSec == start) {
        stages[stages.size - 1] = last.copy(endSec = s.end)
      } else {
        stages.add(SleepStagePlan(start, s.end, kind))
      }
      cursor = s.end
    }
    close()
    return sessions
  }
}
