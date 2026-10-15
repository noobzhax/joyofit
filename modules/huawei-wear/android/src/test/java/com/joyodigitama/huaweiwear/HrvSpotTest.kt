package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiStressParser
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.HrRriTest
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Stress
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class HrvSpotTest {
  /** No encryption, so the TLV of a frame can be read as it is. */
  private val params = object : HuaweiPacket.ParamsProvider() {
    override fun getDeviceSupportType(): Byte = 0
    override fun getSecretKey(): ByteArray = ByteArray(16)
    override fun getIv(): ByteArray = ByteArray(16)
    override fun areTransactionsCrypted(): Boolean = false
    override fun getMtu(): Int = 0
    override fun getSliceSize(): Int = 0xF4
  }

  private fun beat(rri: Int, sqi: Int) = HuaweiTLV().put(0x04, rri.toShort()).put(0x05, sqi.toByte())

  /** A `19/05` TLV as the watch builds it (GB HrRriTest.RriData): `82{83{04 rri, 05 sqi}, ...}`. */
  private fun report(vararg beats: HuaweiTLV): HuaweiTLV {
    val container = HuaweiTLV()
    for (b in beats) container.put(0x83, b)
    return HuaweiTLV().put(0x82, container)
  }

  private fun reparse(tlv: HuaweiTLV): HuaweiTLV = HuaweiTLV().parse(tlv.serialize())

  /** The TLV part of a frame: after `5a len len 00 service command`, before the 2-byte CRC. */
  private fun tlvOf(packet: HuaweiPacket, service: Int, command: Int): ByteArray {
    val frames = packet.serialize()
    assertEquals(1, frames.size)
    val frame = frames[0]
    assertEquals(service.toByte(), frame[4])
    assertEquals(command.toByte(), frame[5])
    return frame.copyOfRange(6, frame.size - 2)
  }

  /** The fixed measurement GB's own code was run on: 70 intervals with a repeating pattern, all sqi 100, a 60 s window. */
  private val fixedRri = List(70) { i -> 860 + ((i * 37) % 61 - 30) + (if (i % 9 < 4) 20 else -20) }
  private val fixedBeats = fixedRri.map { RriBeat(it, 100) }

  // 19/01: open and close

  @Test
  fun openAndCloseAreTag01WithTheMode() {
    val open = tlvOf(HrRriTest.OpenOrClose.Request(params, HrvSpotCodec.OPEN), 0x19, 0x01)
    assertArrayEquals(byteArrayOf(0x01, 0x01, 0x03), open)
    val close = tlvOf(HrRriTest.OpenOrClose.Request(params, HrvSpotCodec.CLOSE), 0x19, 0x01)
    assertArrayEquals(byteArrayOf(0x01, 0x01, 0x04), close)
  }

  // 19/05 parsing

  @Test
  fun decodesEveryBeatOfAReport() {
    val beats = HrvSpotCodec.decodeRri(reparse(report(beat(812, 100), beat(900, 0), beat(1023, 100))))
    assertEquals(listOf(812, 900, 1023), beats.map { it.rri })
    assertEquals(listOf(100, 0, 100), beats.map { it.sqi })
  }

  @Test
  fun readsTheIntervalUnsigned() {
    // 0xFFFF is 65535 ms, not -1: a negative interval must never reach the filter as a small number.
    val beats = HrvSpotCodec.decodeRri(reparse(report(beat(0xFFFF, 100))))
    assertEquals(65535, beats.single().rri)
  }

  @Test
  fun skipsABeatWithoutBothTagsAndIgnoresOtherPackets() {
    val container = HuaweiTLV()
      .put(0x83, HuaweiTLV().put(0x04, 800.toShort()))
      .put(0x83, beat(810, 100))
    val beats = HrvSpotCodec.decodeRri(reparse(HuaweiTLV().put(0x82, container)))
    assertEquals(listOf(810), beats.map { it.rri })
    assertEquals(0, HrvSpotCodec.decodeRri(HuaweiTLV().put(0x01, 1.toByte())).size)
    assertEquals(0, HrvSpotCodec.decodeRri(null).size)
  }

  @Test
  fun readsSeveralContainersInOnePacket() {
    val tlv = HuaweiTLV()
      .put(0x82, HuaweiTLV().put(0x83, beat(800, 100)))
      .put(0x82, HuaweiTLV().put(0x83, beat(820, 90)))
    assertEquals(listOf(800, 820), HrvSpotCodec.decodeRri(reparse(tlv)).map { it.rri })
  }

  @Test
  fun timelineLandsEachBeatAtTheEndOfItsInterval() {
    val timeline = HrvSpot.rriTimeline(1_000_000L, listOf(RriBeat(800, 100), RriBeat(850, 0), RriBeat(900, 100)))
    assertEquals(listOf(1_000_800L, 1_001_650L, 1_002_550L), timeline.map { it.first })
    assertEquals(listOf(100, 0, 100), timeline.map { it.second.sqi })
  }

  // Stress calibration against GB (HuaweiStressHRVCalculation + HuaweiStressScoreCalculation run unmodified on fixedRri)

  private fun bits(f: Float) = java.lang.Float.floatToIntBits(f)

  @Test
  fun stressFeaturesMatchGadgetbridgeOnAFixedInput() {
    val data = HrvSpotCodec.calibrateStress(fixedBeats, 1_700_000_000_000L, 1_700_000_060_000L)
    assertNotNull(data)
    data!!
    // Reference: GB's classes compiled from the upstream commit and run on fixedRri with signalTime 60.
    val gbFeatureBits = intArrayOf(
      1100480512, 1074505231, 1120403456, 1060311596, 1107998886,
      1146224640, 1062658984, 1105692218, 1125049433, 1118119659,
    )
    assertEquals(12, data.features.size)
    assertArrayEquals(gbFeatureBits, IntArray(10) { bits(data.features[it]) })
    assertEquals(0f, data.features[10], 0f)
    assertEquals(0f, data.features[11], 0f)
    assertEquals(1079062597, bits(data.scoreFactor))
    assertEquals(47, data.score.toInt())
    assertEquals(2, data.level.toInt())
    assertEquals(1_700_000_000_000L, data.startTime)
    assertEquals(1_700_000_060_000L, data.endTime)
  }

  @Test
  fun unusableBeatsAreDroppedBeforeTheModelLikeGadgetbridge() {
    val withNoise = ArrayList<RriBeat>()
    for (b in fixedBeats) {
      withNoise += b
      withNoise += RriBeat(2500, 0)
    }
    val clean = HrvSpotCodec.calibrateStress(fixedBeats, 0L, 60_000L)!!
    val noisy = HrvSpotCodec.calibrateStress(withNoise, 0L, 60_000L)!!
    assertEquals(clean.features, noisy.features)
    assertEquals(clean.score, noisy.score)
  }

  @Test
  fun theModelRefusesWhatGadgetbridgeRefuses() {
    // Not 50..70 s of signal.
    assertNull(HrvSpotCodec.calibrateStress(fixedBeats, 0L, 45_000L))
    assertNull(HrvSpotCodec.calibrateStress(fixedBeats, 0L, 75_000L))
    // Fewer than 30 intervals.
    assertNull(HrvSpotCodec.calibrateStress(fixedBeats.take(25), 0L, 60_000L))
    // Intervals the watch did not rate 100 do not count.
    assertNull(HrvSpotCodec.calibrateStress(fixedRri.map { RriBeat(it, 50) }, 0L, 60_000L))
  }

  // 20/09

  @Test
  fun enableSendsStatusScoreTwelveFloatsAndTheTimeInSeconds() {
    val data = HrvSpotCodec.calibrateStress(fixedBeats, 1_700_000_000_000L, 1_700_000_060_000L)!!
    val packet = Stress.AutomaticStress.Request(params, 1.toByte(), data.score, data.features, (data.endTime / 1000).toInt())
    val tlv = tlvOf(packet, 0x20, 0x09)
    val expected = java.io.ByteArrayOutputStream()
    expected.write(byteArrayOf(0x01, 0x01, 0x01))
    expected.write(byteArrayOf(0x02, 0x01, data.score))
    expected.write(byteArrayOf(0x03, 48))
    val floats = java.nio.ByteBuffer.allocate(48)
    for (f in data.features) floats.putFloat(f)
    expected.write(floats.array())
    expected.write(byteArrayOf(0x04, 0x04))
    expected.write(java.nio.ByteBuffer.allocate(4).putInt(1_700_000_060).array())
    assertArrayEquals(expected.toByteArray(), tlv)
  }

  @Test
  fun disableSendsOnlyStatusTwo() {
    val tlv = tlvOf(Stress.AutomaticStress.Request(params, 2.toByte(), 0.toByte(), null, 0), 0x20, 0x09)
    assertArrayEquals(byteArrayOf(0x01, 0x01, 0x02), tlv)
  }

  @Test
  fun storedCalibrationSurvivesItsJsonForm() {
    val data = HrvSpotCodec.calibrateStress(fixedBeats, 1_700_000_000_000L, 1_700_000_060_000L)!!
    val back = HuaweiStressParser.stressDataFromJsonStr(HuaweiStressParser.stressDataToJsonStr(data))
    assertNotNull(back)
    back!!
    assertEquals(data.features, back.features)
    assertEquals(data.score, back.score)
    assertEquals(data.endTime, back.endTime)
    assertEquals(bits(data.scoreFactor), bits(back.scoreFactor))
  }
}
