package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Weight / resting-metabolism dictionaries, the Health Glance JSON and the activity-ring configs. */
class BodyAndGoalsTest {
  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false); it.setSliceSize(1022) }

  private fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  private fun frame(command: Int, tlv: ByteArray): ByteArray {
    val body = byteArrayOf(0x00, 0x37, command.toByte()) + tlv
    val head = byteArrayOf(0x5A, (body.size shr 8).toByte(), body.size.toByte()) + body
    val crc = CheckSums.getCRC16(head, 0)
    return head + byteArrayOf((crc shr 8).toByte(), crc.toByte())
  }

  private fun glanceJson(map: Map<String, Any?>) = String(DataSyncJson.bytes(map), Charsets.UTF_8)

  @Test
  fun weightRowCarriesLittleEndianDoublesUnderTheDictionaryKeys() {
    val row = BodyMetricsCodec.weightRow(70.5, 1_760_400_000_000L, 22.5, null, 1_760_400_001_000L)
    assertEquals(1_760_400_000_000L, row.startMs)
    assertEquals(1_760_400_000_000L, row.endMs)
    assertEquals(1_760_400_001_000L, row.modifyMs)
    assertEquals(listOf(2004, 2001), row.values.map { it.key })
    assertArrayEquals(hex("0000000000a05140"), row.values[0].value)
    assertArrayEquals(DataSyncBytes.doubleLe(22.5), row.values[1].value)
    // Unknown fields are left out: no body fat, no BMR.
    assertEquals(listOf(2004), BodyMetricsCodec.weightRow(70.5, 1L, null, null, 2L).values.map { it.key })
    assertEquals(listOf(2004, 2001, 2024), BodyMetricsCodec.weightRow(70.5, 1L, 20.0, 1650.0, 2L).values.map { it.key })
  }

  @Test
  fun weightDictionaryPacketUses10006() {
    val packet = DataSyncWire.dictionary(plain, BodyMetricsCodec.PHONE_PKG, BodyMetricsCodec.WATCH_PKG, BodyMetricsCodec.DICT_WEIGHT, listOf(BodyMetricsCodec.weightRow(70.5, 1L, null, null, 2L)))
    val out = packet.serialize()
    assertEquals(1, out.size)
    val query = DataSyncWire.parseDictionary(packet.getTlv())
    assertEquals(10006, query.dictId)
    assertEquals(1L, query.startMs)
    assertEquals(2L, query.modifyMs)
    assertArrayEquals(DataSyncBytes.doubleLe(70.5), query.rows.single().values.single().value)
    assertTrue(out[0].size > 40)
  }

  @Test
  fun restingMetabolismIsAFourByteBigEndianIntUnder500018055() {
    val row = BodyMetricsCodec.restingRow(1650, 10L, 20L, 30L)
    assertEquals(500018055, row.values.single().key)
    assertArrayEquals(hex("00000672"), row.values.single().value)
    assertEquals(500018, BodyMetricsCodec.DICT_RESTING)
  }

  @Test
  fun healthGlanceOmitsWhatIsUnknown() {
    val full = BodyMetricsData(weightKg = 70.5, weightTsMs = 1_760_400_000_000L, bodyFatPct = 22.5, bodyFatTsMs = 1_760_400_000_000L)
    // BMI 70.5 / 1.75^2 = 23.02 -> 23.0; Gson order: bodyMassIndex, fatPercentageTimestamp, fatPercentage, height, weight, weightTimestamp.
    assertEquals(
      "{\"bodyMassIndex\":23.0,\"fatPercentageTimestamp\":1760400000000,\"fatPercentage\":22.5,\"height\":175,\"weight\":70.5,\"weightTimestamp\":1760400000000}",
      glanceJson(BodyMetricsCodec.glance(full, 70.5, 175)),
    )
    assertEquals("{\"bodyMassIndex\":23.0,\"height\":175,\"weight\":70.5}", glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), 70.5, 175)))
    assertEquals("{\"height\":175}", glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), null, 175)))
    assertEquals("{\"weight\":70.5}", glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), 70.5, null)))
    assertEquals("{}", glanceJson(BodyMetricsCodec.glance(BodyMetricsData(), null, null)))
  }

  @Test
  fun healthGlanceBloodPressureNeedsBothValues() {
    val bp = BodyMetricsData(systolic = 120, diastolic = 80, bpTsMs = 5L)
    assertEquals(
      "{\"bloodPressureSource\":0,\"bloodPressureTimestamp\":5,\"diastolicPressure\":80,\"systolicPressure\":120}",
      glanceJson(BodyMetricsCodec.glance(bp, null, null)),
    )
    assertEquals("{}", glanceJson(BodyMetricsCodec.glance(BodyMetricsData(systolic = 120), null, null)))
  }

  // Activity rings

  @Test
  fun singleGoalIsTimeThenGoalAsInt32() {
    assertArrayEquals(hex("010468ed9280020400002710"), ActivityGoalsCodec.single(1_760_400_000, 10000))
  }

  @Test
  fun bundleUsesMinimalBytesForTypesAndValues() {
    // 01 time, 82{83{04 01, 05 2710} 83{04 03, 05 1e} 83{04 04, 05 0c}}: types 1 steps, 3 exercise minutes, 4 stand hours.
    assertArrayEquals(
      hex("010468ed92808219830704010105022710830604010305011e830604010405010c"),
      ActivityGoalsCodec.bundle(1_760_400_000, 10000, 30, 12),
    )
    assertArrayEquals(byteArrayOf(0), ActivityGoalsCodec.minimal(0))
    assertArrayEquals(byteArrayOf(0x19), ActivityGoalsCodec.minimal(25))
    assertArrayEquals(hex("012c"), ActivityGoalsCodec.minimal(300))
    assertArrayEquals(hex("0186a0"), ActivityGoalsCodec.minimal(100_000))
  }

  @Test
  fun aFullSendIsEightConfigsInHuaweisIds() {
    val items = ActivityGoalsCodec.items(ActivityGoalsData(), 1_760_400_000, 1_760_400_000_000L)
    assertEquals(
      listOf(900200006, 900200007, 900200008, 900200009, 900200002, 900200004, 900200010, 900200011),
      items.map { it.configId },
    )
    // Calories are kcal x 1000 (GB sendCaloriesBurntGoal).
    assertArrayEquals(hex("010468ed9280020400" + "0493e0"), items[1].data)
    // Reminders are 1 / 0.
    assertArrayEquals(hex("010468ed9280020400000001"), items[5].data)
    assertArrayEquals(hex("010468ed9280020400000000"), ActivityGoalsCodec.items(ActivityGoalsData(remindStand = false), 1_760_400_000, 0L)[5].data)
  }

  @Test
  fun goalConfigPacketMatchesGbsFindDeviceShape() {
    val items = ActivityGoalsCodec.items(ActivityGoalsData(), 1_760_400_000, 1_760_400_000_000L)
    val packet = DataSyncWire.config(plain, ActivityGoalsCodec.SRC_PKG, ActivityGoalsCodec.WEAR_PKG, listOf(items[0]))
    val expected = HuaweiTLV()
      .put(0x01, "hw.sport.config").put(0x02, "in.huawei.motion")
      .put(0x83, HuaweiTLV().put(0x84, HuaweiTLV().put(0x05, 900200006).put(0x06, 1.toByte()).put(0x07, hex("010468ed9280020400002710")).put(0x08, 1_760_400_000_000L)))
    val out = packet.serialize()
    assertEquals(1, out.size)
    assertArrayEquals(frame(DataSyncWire.CMD_CONFIG, expected.serialize()), out[0])
  }

  @Test
  fun defaultsAndRanges() {
    val defaults = ActivityGoalsData()
    assertEquals(10_000, defaults.steps)
    assertEquals(300, defaults.calories)
    assertEquals(30, defaults.exerciseMinutes)
    assertEquals(12, defaults.standHours)
    assertTrue(defaults.remindStand && defaults.remindProgress && defaults.remindGoalReached)
    ActivityGoalsCodec.validate(defaults)
    for (bad in listOf(ActivityGoalsData(steps = 10), ActivityGoalsData(calories = 1), ActivityGoalsData(exerciseMinutes = 0), ActivityGoalsData(standHours = 25))) {
      try {
        ActivityGoalsCodec.validate(bad)
        fail("accepted $bad")
      } catch (e: WearException) {
        assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
      }
    }
  }
}
