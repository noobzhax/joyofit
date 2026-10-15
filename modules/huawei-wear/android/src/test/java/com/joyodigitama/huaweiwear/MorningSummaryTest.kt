package com.joyodigitama.huaweiwear

import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MorningSummaryTest {
  private val zone: ZoneId = ZoneOffset.UTC
  private val day = 1_800_000_000L - 1_800_000_000L % 86400 // a UTC midnight
  private val h = 3600L

  private fun sleep(startH: Double, endH: Double) =
    SleepSegment(day + (startH * h).toLong(), day + (endH * h).toLong(), 0, "light")

  @Test
  fun summarisesLastNightWithHrvAndUsual() {
    val hrv = listOf(
      NightHrvRow(day - 80 * h, day - 72 * h, 40.0),
      NightHrvRow(day - 56 * h, day - 48 * h, 44.0),
      NightHrvRow(day - 32 * h, day - 24 * h, 48.0),
      NightHrvRow(day - 1 * h, day + 7 * h, 52.0),
    )
    val plan = MorningSummary.plan(listOf(sleep(-1.0, 7.2)), hrv, null, day + 8 * h, zone)!!
    assertEquals("Slept 8 h 12 min. HRV 52 ms, usual 44. Open JoyoFit for today's recovery.", plan.text)
  }

  @Test
  fun omitsUsualWithoutEnoughEarlierNights() {
    val hrv = listOf(NightHrvRow(day - 1 * h, day + 7 * h, 52.0))
    val plan = MorningSummary.plan(listOf(sleep(0.0, 7.0)), hrv, null, day + 8 * h, zone)!!
    assertEquals("Slept 7 h 0 min. HRV 52 ms. Open JoyoFit for today's recovery.", plan.text)
  }

  @Test
  fun sleepOnlyWhenNoNightHrv() {
    val plan = MorningSummary.plan(listOf(sleep(0.0, 7.0)), emptyList(), null, day + 8 * h, zone)!!
    assertEquals("Slept 7 h 0 min. Open JoyoFit for today's recovery.", plan.text)
  }

  @Test
  fun postsOncePerDayAndNotForNapsOrOngoingSleep() {
    val nowSec = day + 8 * h
    val night = listOf(sleep(0.0, 7.0))
    assertNull(MorningSummary.plan(night, emptyList(), java.time.Instant.ofEpochSecond(nowSec).atZone(zone).toLocalDate().toString(), nowSec, zone))
    assertNull(MorningSummary.plan(listOf(sleep(1.0, 2.0)), emptyList(), null, nowSec, zone))
    assertNull(MorningSummary.plan(night, emptyList(), null, day + 7 * h + 60, zone))
    // Sleep that ended yesterday is not today's summary.
    assertNull(MorningSummary.plan(listOf(sleep(-20.0, -12.0)), emptyList(), null, nowSec, zone))
  }
}
