package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Test

class BackgroundPlanningTest {
  @Test
  fun backoffDoublesUpToFiveMinutes() {
    var backoff = BackgroundController.INITIAL_BACKOFF_MS
    val seen = ArrayList<Long>()
    repeat(8) {
      seen.add(backoff)
      backoff = nextBackoff(backoff)
    }
    assertEquals(listOf(5_000L, 10_000L, 20_000L, 40_000L, 80_000L, 160_000L, 300_000L, 300_000L), seen)
  }

  @Test
  fun firstSyncLooksBackSevenDays() {
    assertEquals(1_000_000L - 7 * 24 * 3600, syncWindowStart(null, 1_000_000L))
  }

  @Test
  fun laterSyncsOverlapByOneHour() {
    assertEquals(500_000L - 3600, syncWindowStart(500_000L, 1_000_000L))
    assertEquals(0L, syncWindowStart(100L, 1_000_000L))
  }
}
