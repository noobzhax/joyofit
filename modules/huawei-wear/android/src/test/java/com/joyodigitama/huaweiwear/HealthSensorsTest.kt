package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HealthSensorsTest {
  /** The zero key and zero IV of GB's TestFitnessData, so its TruSleep vector applies. */
  private val params = object : HuaweiPacket.ParamsProvider() {
    override fun getDeviceSupportType(): Byte = 0
    override fun getSecretKey(): ByteArray = ByteArray(16)
    override fun getIv(): ByteArray = ByteArray(16)
    override fun areTransactionsCrypted(): Boolean = true
    override fun getMtu(): Int = 0
    override fun getSliceSize(): Int = 0xF4
  }

  private fun hex(vararg bytes: Int) = ByteArray(bytes.size) { bytes[it].toByte() }

  private fun String.bytes() = chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  /** TestFitnessData.testTruSleepRequest: TruSleep (07/16) switched off, zero key and IV. */
  private val gbTruSleepOff =
    ("5a002a00" + "0716" + "7c0101" + "7d10" + "00".repeat(16) + "7e10" + "2800996f2acb623ae6542854f8ab5483" + "0223").bytes()

  /** The frame of [gbTruSleepOff] for another command: the TLV is the same, command byte and CRC differ. */
  private fun withCommand(frame: ByteArray, command: Int): ByteArray {
    val copy = frame.copyOf()
    copy[5] = command.toByte()
    val crc = CheckSums.getCRC16(copy.copyOf(copy.size - 2), 0x0000)
    return ByteBuffer.wrap(copy).apply { position(copy.size - 2) }.putShort(crc.toShort()).array()
  }

  private fun serialize(packet: HuaweiPacket): ByteArray {
    val frames = packet.serialize()
    assertEquals(1, frames.size)
    return frames[0]
  }

  /** The TLV bytes after decrypting a frame; asserts the header (service, command) too. */
  private fun plainTlv(frame: ByteArray, service: Int, command: Int): ByteArray {
    assertEquals(0x5A.toByte(), frame[0])
    assertEquals(service.toByte(), frame[4])
    assertEquals(command.toByte(), frame[5])
    val tlv = HuaweiTLV().parse(frame.copyOfRange(6, frame.size - 2))
    tlv.decrypt(params)
    return tlv.serialize()
  }

  @Test
  fun gbTruSleepVectorMatchesOurSerialization() {
    assertArrayEquals(gbTruSleepOff, serialize(FitnessData.TruSleep.Request(params, false)))
  }

  @Test
  fun switchesShareTruSleepsTlvLayout() {
    // 07/17 automatic heart rate, 07/1c realtime heart rate and 07/24 automatic SpO2 carry TLV 01:[bool], like TruSleep.
    assertArrayEquals(withCommand(gbTruSleepOff, 0x17), serialize(FitnessData.EnableAutomaticHeartrate.Request(params, false)))
    assertArrayEquals(withCommand(gbTruSleepOff, 0x1c), serialize(FitnessData.EnableRealtimeHeartRate.Request(params, false)))
    assertArrayEquals(withCommand(gbTruSleepOff, 0x24), serialize(FitnessData.EnableAutomaticSpo.Request(params, false)))
  }

  @Test
  fun switchesOnCarryTrueBoolean() {
    val on = hex(0x01, 0x01, 0x01)
    assertArrayEquals(on, plainTlv(serialize(FitnessData.EnableAutomaticHeartrate.Request(params, true)), 0x07, 0x17))
    assertArrayEquals(on, plainTlv(serialize(FitnessData.EnableRealtimeHeartRate.Request(params, true)), 0x07, 0x1c))
    assertArrayEquals(on, plainTlv(serialize(FitnessData.EnableAutomaticSpo.Request(params, true)), 0x07, 0x24))
    assertArrayEquals(on, plainTlv(serialize(FitnessData.TruSleep.Request(params, true)), 0x07, 0x16))
  }

  @Test
  fun alertsCarryThresholdOnlyWhenEnabled() {
    assertArrayEquals(
      hex(0x01, 0x01, 0x01, 0x02, 0x01, 120),
      plainTlv(serialize(FitnessData.HighHeartRateAlert.Request(params, true, 120)), 0x07, 0x1d),
    )
    assertArrayEquals(
      hex(0x01, 0x01, 0x00),
      plainTlv(serialize(FitnessData.HighHeartRateAlert.Request(params, false, 0)), 0x07, 0x1d),
    )
    assertArrayEquals(
      hex(0x01, 0x01, 0x01, 0x02, 0x01, 45),
      plainTlv(serialize(FitnessData.LowHeartRateAlert.Request(params, true, 45)), 0x07, 0x22),
    )
    assertArrayEquals(
      hex(0x01, 0x01, 0x01, 0x02, 0x01, 90),
      plainTlv(serialize(FitnessData.LowSpoAlert.Request(params, true, 90)), 0x07, 0x25),
    )
  }

  @Test
  fun capabilityNotificationsCarryGbsTlv() {
    // NotifyRestHeartRate (07/23) is TLV 01:int 1 and Workout NotifyHeartRate (17/17) TLV 01:int 3.
    assertArrayEquals(
      hex(0x01, 0x04, 0, 0, 0, 0x01),
      plainTlv(serialize(FitnessData.NotifyRestHeartRate.Request(params)), 0x07, 0x23),
    )
    assertArrayEquals(
      hex(0x01, 0x04, 0, 0, 0, 0x03),
      plainTlv(serialize(Workout.NotifyHeartRate.Request(params)), 0x17, 0x17),
    )
  }

  // Plan and gates

  private fun supporting(vararg pairs: Pair<Int, Int>): (Int, Int) -> Boolean = { service, command -> (service to command) in pairs }

  private val fit4 = supporting(
    0x07 to 0x13, 0x07 to 0x16, 0x07 to 0x17, 0x07 to 0x1c, 0x07 to 0x1d, 0x07 to 0x21, 0x07 to 0x22, 0x07 to 0x23,
    0x07 to 0x24, 0x07 to 0x25, 0x17 to 0x17,
  )

  @Test
  fun connectPlanSendsEverythingSupportedButAlertsThatAreOff() {
    val labels = HealthSensors.plan(fit4, HealthSensorConfig(), null).map { it.label }
    assertEquals(
      listOf("NotifyHeartRate", "NotifyRestHeartRate", "TruSleep on", "AutomaticHeartRate on", "AutomaticSpo2 on"),
      labels,
    )
  }

  @Test
  fun connectPlanIncludesAlertsThatAreOn() {
    val config = HealthSensorConfig(highHeartRateAlert = 140, lowHeartRateAlert = 50)
    val labels = HealthSensors.plan(fit4, config, null).map { it.label }
    assertEquals(listOf("HighHeartRateAlert 140 bpm", "LowHeartRateAlert 50 bpm"), labels.takeLast(2))
  }

  @Test
  fun planSkipsWhatTheWatchDoesNotList() {
    val onlyHeartRate = supporting(0x07 to 0x17)
    assertEquals(listOf("AutomaticHeartRate on"), HealthSensors.plan(onlyHeartRate, HealthSensorConfig(), null).map { it.label })
    assertEquals(emptyList<String>(), HealthSensors.plan(supporting(), HealthSensorConfig(), null).map { it.label })
  }

  @Test
  fun changePlanSendsOnlyWhatChangedAndAlertOff() {
    val before = HealthSensorConfig(highHeartRateAlert = 140)
    val after = before.copy(automaticSpo2 = false, highHeartRateAlert = 0)
    val labels = HealthSensors.plan(fit4, after, before).map { it.label }
    assertEquals(listOf("AutomaticSpo2 off", "HighHeartRateAlert off"), labels)
    assertEquals(emptyList<String>(), HealthSensors.plan(fit4, before, before).map { it.label })
  }

  @Test
  fun supportGatesFollowGbHuaweiState() {
    val support = HealthSensorSupport.of(fit4)
    assertEquals(true, support.heartRate)
    assertEquals(true, support.realtimeHeartRate)
    assertEquals(true, support.spo2)
    assertEquals(true, support.truSleep)
    assertEquals(true, support.highHeartRateAlert)
    assertEquals(true, support.lowHeartRateAlert)
    val none = HealthSensorSupport.of(supporting(0x07 to 0x01))
    assertEquals(false, none.heartRate)
    assertEquals(false, none.realtimeHeartRate)
  }

  // Realtime packets

  @Test
  fun realtimeReadingIsTheFirstSingleByteValueInRange() {
    assertEquals(72, HealthSensors.decodeRealtime(HuaweiTLV().put(0x01, 72.toByte())))
    // A container (tag with bit 7 set) is searched too; an enable flag (1) and an out-of-range value are skipped.
    assertEquals(
      88,
      HealthSensors.decodeRealtime(HuaweiTLV().put(0x81, HuaweiTLV().put(0x01, true).put(0x02, 255.toByte()).put(0x03, 88.toByte()))),
    )
  }

  @Test
  fun realtimePacketWithoutReadingDecodesToNull() {
    assertNull(HealthSensors.decodeRealtime(null))
    assertNull(HealthSensors.decodeRealtime(HuaweiTLV().put(0x01, true)))
    assertNull(HealthSensors.decodeRealtime(HuaweiTLV().put(0x02, 0x00001234)))
  }

  // Step frame statistics

  private fun container(vararg tvs: Triple<Int, Int, Int>) =
    FitnessData.MessageData.StepResponse.SubContainer().apply {
      parsedData = tvs.map { (bitmap, tag, value) ->
        FitnessData.MessageData.StepResponse.SubContainer.TV(bitmap.toByte(), tag.toByte(), value.toShort())
      }
    }

  @Test
  fun frameStatsCountHeartRateSpo2RestingAndUnknownTvs() {
    val stats = StepFrameStats()
    stats.add(container(Triple(1, 0x02, 5), Triple(1, 0x40, 72), Triple(2, 0x01, 97), Triple(2, 0x02, 55)))
    stats.add(container(Triple(1, 0x40, 0), Triple(2, 0x01, -1), Triple(1, 0x10, 7), Triple(2, 0x08, 3)))
    stats.add(container(Triple(1, 0x10, 9)))
    stats.add(FitnessData.MessageData.StepResponse.SubContainer())

    assertEquals(4, stats.containers)
    assertEquals(1, stats.unparsed)
    assertEquals(2, stats.heartRate)
    assertEquals(1, stats.heartRateMeasured)
    assertEquals(2, stats.spo2)
    assertEquals(1, stats.spo2Measured)
    assertEquals(1, stats.restingHeartRate)
    assertEquals(1, stats.restingHeartRateMeasured)
    assertEquals("b1/0x10 x2 (last 9), b2/0x08 x1 (last 3)", stats.unknownSummary())
  }

  @Test
  fun frameStatsWithoutExtraTvsReportNone() {
    val stats = StepFrameStats()
    stats.add(container(Triple(1, 0x02, 5), Triple(1, 0x04, 1), Triple(1, 0x08, 3)))
    assertEquals("none", stats.unknownSummary())
    assertEquals(0, stats.heartRate)
  }
}
