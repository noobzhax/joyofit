package com.joyodigitama.huaweiwear

import com.joyodigitama.huaweiwear.HealthConnectPlan.SleepStageKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthConnectPlanTest {
  private fun sample(
    ts: Long,
    steps: Int = 0,
    calories: Int = 0,
    distance: Int = 0,
    hr: Int? = null,
    spo2: Int? = null,
    resting: Int? = null,
  ) = StepSample(ts, steps, calories, distance, hr, spo2, resting)

  @Test
  fun intervalsSkipZeroMinutesAndEarlierSamples() {
    val samples = listOf(
      sample(1_000, steps = 5, calories = 2, distance = 3),
      sample(1_060, steps = 0, calories = 1),
      sample(1_120, steps = 7, distance = 4),
    )
    val steps = HealthConnectPlan.steps(samples, fromSec = 1_050)
    assertEquals(listOf(HealthConnectPlan.Interval("joyofit:steps:1120", 1_120, 1_180, 7)), steps)
    assertEquals(listOf(1_060L), HealthConnectPlan.calories(samples, 1_050).map { it.startSec })
    assertEquals(listOf(1_120L), HealthConnectPlan.distance(samples, 1_050).map { it.startSec })
  }

  @Test
  fun sameMinuteAlwaysGetsTheSameId() {
    val a = HealthConnectPlan.steps(listOf(sample(600, steps = 1)), 0).single().id
    val b = HealthConnectPlan.steps(listOf(sample(600, steps = 99)), 0).single().id
    assertEquals(a, b)
  }

  @Test
  fun heartRateIsOneSeriesPerHourWithValidReadingsOnly() {
    val samples = listOf(
      sample(3_600 * 10 + 60, hr = 60),
      sample(3_600 * 10 + 120, hr = 0),
      sample(3_600 * 10 + 180, hr = 70),
      sample(3_600 * 11, hr = 80),
      sample(3_600 * 11 + 60, hr = 400),
    )
    val series = HealthConnectPlan.heartSeries(samples)
    assertEquals(listOf("joyofit:hr:36000", "joyofit:hr:39600"), series.map { it.id })
    assertEquals(listOf(60, 70), series[0].points.map { it.value })
    assertEquals(36_060L, series[0].startSec)
    assertEquals(36_181L, series[0].endSec)
    assertEquals(1, series[1].points.size)
    // The record's end is after its last sample, so Health Connect accepts it.
    assertTrue(series.all { it.endSec > it.points.last().timeSec })
  }

  @Test
  fun spo2KeepsOnlyPercentages() {
    val samples = listOf(sample(60, spo2 = 97), sample(120, spo2 = 0), sample(180, spo2 = 101), sample(240))
    assertEquals(listOf(60L), HealthConnectPlan.spo2(samples, 0).map { it.timeSec })
  }

  @Test
  fun restingHeartRateIsTheLatestReadingOfEachDay() {
    val dayOf = { sec: Long -> (sec / 86_400).toString() }
    val samples = listOf(
      sample(100, resting = 55),
      sample(200, resting = 57),
      sample(86_400 + 10, resting = 52),
      sample(86_400 + 20),
    )
    val result = HealthConnectPlan.restingHeartRate(samples, 0, dayOf)
    assertEquals(listOf("joyofit:rhr:0", "joyofit:rhr:1"), result.map { it.first })
    assertEquals(listOf(57, 52), result.map { it.second.value })
    assertEquals(200L, result[0].second.timeSec)
  }

  @Test
  fun sleepSpansSplitIntoSessionsAtLongGaps() {
    val night = 100_000L
    val segments = listOf(
      SleepSegment(night, night + 600, 0x06, "light"),
      SleepSegment(night + 600, night + 1_200, 0x07, "deep"),
      SleepSegment(night + 1_200, night + 1_500, 0x5656, "rem"),
      SleepSegment(night + 1_500, night + 1_560, 0x5658, "awake"),
      // Nap 5 h later.
      SleepSegment(night + 20_000, night + 21_000, 1, null),
    )
    val sessions = HealthConnectPlan.sleepSessions(segments, fromSec = 0)
    assertEquals(2, sessions.size)
    assertEquals("joyofit:sleep:$night", sessions[0].id)
    assertEquals(night + 1_560, sessions[0].endSec)
    assertEquals(
      listOf(SleepStageKind.LIGHT, SleepStageKind.DEEP, SleepStageKind.REM, SleepStageKind.AWAKE),
      sessions[0].stages.map { it.stage },
    )
    assertEquals(listOf(SleepStageKind.SLEEPING), sessions[1].stages.map { it.stage })
  }

  @Test
  fun sleepStagesDoNotOverlapAndSameStagesMerge() {
    val segments = listOf(
      SleepSegment(0, 600, 0x06, "light"),
      SleepSegment(600, 900, 0x06, "light"),
      // Starts before the previous one ended: the earlier span keeps the time.
      SleepSegment(800, 1_200, 0x07, "deep"),
      SleepSegment(1_100, 1_150, 0x5656, "rem"),
    )
    val stages = HealthConnectPlan.sleepSessions(segments, 0).single().stages
    assertEquals(listOf(0L to 900L, 900L to 1_200L), stages.map { it.startSec to it.endSec })
    assertEquals(listOf(SleepStageKind.LIGHT, SleepStageKind.DEEP), stages.map { it.stage })
  }

  @Test
  fun sessionsEndedBeforeTheWindowAreNotRewritten() {
    val segments = listOf(
      SleepSegment(0, 3_600, 0x06, "light"),
      SleepSegment(200_000, 203_600, 0x06, "light"),
    )
    assertEquals(listOf("joyofit:sleep:200000"), HealthConnectPlan.sleepSessions(segments, 100_000).map { it.id })
  }
}
