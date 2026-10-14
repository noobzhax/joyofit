package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutRecordTest {
  private fun block(type: Int, pace: Int, correction: Int?) = Workout.WorkoutPace.Response.Block().also {
    it.type = type.toByte()
    it.pace = pace
    if (correction != null) {
      it.hasCorrection = true
      it.correction = correction.toShort()
    }
  }

  @Test
  fun sportTypesUseGadgetbridgeNames() {
    assertEquals("Running", WorkoutSportTypes.name(1))
    assertEquals("RUNNING", WorkoutSportTypes.kind(1))
    assertEquals("Pool Swimming", WorkoutSportTypes.name(6))
    assertEquals("Ping Pong", WorkoutSportTypes.name(128))
    assertEquals("EXERCISE", WorkoutSportTypes.kind(255))
    // The type byte is read unsigned: 0xFF arrives as -1.
    assertEquals("EXERCISE", WorkoutSportTypes.kind(-1))
    assertEquals("Workout (type 99)", WorkoutSportTypes.name(99))
    assertEquals("UNKNOWN", WorkoutSportTypes.kind(99))
  }

  @Test
  fun paceAndSwimClassification() {
    assertTrue(WorkoutSportTypes.isSwim("POOL_SWIM"))
    assertTrue(WorkoutSportTypes.isPace("TRAIL_RUN"))
    assertTrue(WorkoutSportTypes.isPace("INDOOR_WALKING"))
    assertTrue(!WorkoutSportTypes.isPace("CYCLING"))
  }

  @Test
  fun paceAggregatesWeightPartialKilometres() {
    // Two full km at 300 and 360 s/km, then half a km at 330. Per-mile blocks are ignored.
    val blocks = listOf(block(0, 300, null), block(0, 360, null), block(0, 330, 5000), block(1, 500, null))

    val (avg, fastest, slowest) = WorkoutBuilder.paceAggregates(blocks)!!

    assertEquals((300L * 10000 + 360L * 10000 + 330L * 5000) / 25000, avg.toLong())
    assertEquals(300, fastest)
    assertEquals(360, slowest)
    assertNull(WorkoutBuilder.paceAggregates(listOf(block(1, 500, null))))
  }

  @Test
  fun swimStylesFollowGb() {
    assertEquals("breaststroke", WorkoutBuilder.swimStyle(1))
    assertEquals("butterfly", WorkoutBuilder.swimStyle(3))
    assertEquals("backstroke", WorkoutBuilder.swimStyle(4))
    assertEquals("medley", WorkoutBuilder.swimStyle(5))
    assertEquals("freestyle", WorkoutBuilder.swimStyle(0))
  }

  @Test
  fun heartRateMarkersAreNotReadings() {
    assertNull(WorkoutBuilder.validHeartRate(0))
    assertNull(WorkoutBuilder.validHeartRate(-1))
    assertEquals(200, WorkoutBuilder.validHeartRate(200.toByte()))
  }
}
