package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The editable-face TLVs against the byte layout of `CustomConfigWatchFaceService.buildCustomConfigEventDataBytes` with the `cqe`
 * writer (hand-computed from its source in Huawei Health 17.0.8.300). The wire bytes of a watch reply are exercised separately on
 * the device; see protocol/README.md.
 */
class FaceCustomCodecTest {
  private fun hex(s: String): ByteArray = s.replace(" ", "").let { t -> ByteArray(t.length / 2) { t.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }

  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false); it.setSliceSize(1022) }

  @Test
  fun queryIsTheMarketIdAsUtf8() {
    assertArrayEquals(hex("01 03 31 32 33"), FaceCustomWire.encodeQuery("123"))
  }

  @Test
  fun fullConfigurationMatchesTheCqeLayout() {
    val config = FaceCustomization(
      marketId = "123",
      styles = listOf(FaceStyleChoice(FaceEditMode.STYLE, 2), FaceStyleChoice(FaceEditMode.BACKGROUND, 3)),
      colourIndex = 5,
      customColour = "#FF0000",
      widgets = listOf(1, 0),
    )
    val expected = hex(
      "01 03 31 32 33" +
        "82 10 83 06 04 01 00 05 01 02 83 06 04 01 01 05 01 03" +
        "06 01 05" +
        "07 07 23 46 46 30 30 30 30" +
        "88 10 89 06 0A 01 00 0B 01 01 89 06 0A 01 01 0B 01 00",
    )
    assertArrayEquals(expected, FaceCustomWire.encodeConfig(config))
  }

  @Test
  fun optionalPartsAreLeftOutAndAnEmptyCustomColourToo() {
    val onlyColour = FaceCustomization("9", colourIndex = 0, customColour = "")
    assertArrayEquals(hex("01 01 39 06 01 00"), FaceCustomWire.encodeConfig(onlyColour))
    assertArrayEquals(hex("01 01 39"), FaceCustomWire.encodeConfig(FaceCustomization("9")))
  }

  @Test
  fun colourIndexIsMinimalBigEndianButStyleIndexesAreOneByte() {
    assertArrayEquals(hex("00"), FaceCustomWire.minimalBigEndian(0))
    assertArrayEquals(hex("FF"), FaceCustomWire.minimalBigEndian(255))
    assertArrayEquals(hex("01 2C"), FaceCustomWire.minimalBigEndian(300))
    assertArrayEquals(hex("01 00 00 00"), FaceCustomWire.minimalBigEndian(1 shl 24))
    assertArrayEquals(hex("01 03 31 32 33 06 02 01 2C"), FaceCustomWire.encodeConfig(FaceCustomization("123", colourIndex = 300)))
  }

  @Test
  fun listLengthUsesTheSevenBitVarint() {
    // 20 slots x 8 bytes = 160 bytes: length 0x81 0x20.
    val encoded = FaceCustomWire.encodeConfig(FaceCustomization("1", widgets = List(20) { it % 3 }))
    assertArrayEquals(hex("88 81 20"), encoded.copyOfRange(3, 6))
    assertEquals(3 + 3 + 160, encoded.size)
    assertEquals(List(20) { it % 3 }, FaceCustomWire.decode(encoded)?.widgets)
  }

  @Test
  fun anIndexThatDoesNotFitAByteIsRefused() {
    val tooBig = FaceCustomization("1", styles = listOf(FaceStyleChoice(FaceEditMode.BACKGROUND, 256)))
    assertTrue(runCatching { FaceCustomWire.encodeConfig(tooBig) }.exceptionOrNull() is IllegalArgumentException)
    assertTrue(runCatching { FaceCustomWire.encodeConfig(FaceCustomization("1", widgets = listOf(-1))) }.exceptionOrNull() is IllegalArgumentException)
    assertTrue(runCatching { FaceCustomWire.encodeConfig(FaceCustomization("")) }.exceptionOrNull() is IllegalArgumentException)
  }

  @Test
  fun decodeRoundTripsEveryMode() {
    val config = FaceCustomization(
      marketId = "400001",
      styles = FaceEditMode.ALL.map { FaceStyleChoice(it, it + 1) },
      colourIndex = 12,
      customColour = "#0A1B2C",
      widgets = listOf(3, 1, 4, 1),
    )
    assertEquals(config, FaceCustomWire.decode(FaceCustomWire.encodeConfig(config)))
  }

  @Test
  fun decodeReadsMultiByteInts() {
    // marketId "AB", one style whose index is two bytes (0x0100), a colour of 0x0102.
    val data = hex("01 02 41 42  82 09 83 07 04 01 05 05 02 01 00  06 02 01 02")
    val config = FaceCustomWire.decode(data)
    assertEquals(FaceCustomization("AB", styles = listOf(FaceStyleChoice(FaceEditMode.TYPEFACE, 256)), colourIndex = 0x0102), config)
  }

  @Test
  fun decodeSkipsWhatHuaweiHealthSkips() {
    // A style without an index, then a good one; widgets whose slot is outside the list; an empty custom colour.
    val data = hex(
      "01 01 58" +
        "82 0D 83 03 04 01 02  83 06 04 01 03 05 01 07 " +
        "07 00 " +
        "88 10 89 06 0A 01 05 0B 01 09 89 06 0A 01 01 0B 01 02",
    )
    val config = FaceCustomWire.decode(data)!!
    assertEquals(listOf(FaceStyleChoice(FaceEditMode.SCALE, 7)), config.styles)
    assertNull(config.customColour)
    assertEquals(listOf(2), config.widgets)
  }

  @Test
  fun decodeRejectsWhatIsNotAConfiguration() {
    assertNull(FaceCustomWire.decode(ByteArray(0)))
    assertNull(FaceCustomWire.decode(hex("06 01 05")))
    assertNull(FaceCustomWire.decode(hex("01 05 41")))
    assertNull(FaceCustomWire.decode(hex("00 01 41")))
  }

  @Test
  fun theEventPacketCarriesTheQueryInTag05() {
    val packet = DataSyncWire.event(plain, FaceCustomWire.PHONE_PKG, FaceCustomWire.WATCH_PKG, FaceCustomWire.EVENT_QUERY, 0, FaceCustomWire.encodeQuery("123"))
    // 01 src, 02 wear, 03 event id (int32), 04 level, 05 data.
    val tlv = hex("01 17") + FaceCustomWire.PHONE_PKG.toByteArray() +
      hex("02 19") + FaceCustomWire.WATCH_PKG.toByteArray() +
      hex("03 04 2FB08EA8 04 01 00 05 05 01 03 31 32 33")
    val body = byteArrayOf(0x00, 0x37, 0x02) + tlv
    val head = byteArrayOf(0x5A, (body.size shr 8).toByte(), body.size.toByte()) + body
    val crc = nodomain.freeyourgadget.gadgetbridge.util.CheckSums.getCRC16(head, 0)
    val expected = head + byteArrayOf((crc shr 8).toByte(), crc.toByte())
    val serialized = packet.serialize()
    assertEquals(1, serialized.size)
    assertArrayEquals(expected, serialized[0])
  }

  @Test
  fun differencesNamesWhatDidNotStick() {
    val wanted = FaceCustomization(
      "1",
      styles = listOf(FaceStyleChoice(FaceEditMode.BACKGROUND, 2), FaceStyleChoice(FaceEditMode.HAND, 1)),
      colourIndex = 4,
      customColour = "#112233",
      widgets = listOf(1, 2),
    )
    val same = wanted.copy(widgets = listOf(1, 2, 9))
    assertEquals(emptyList<String>(), WatchfaceCustomizer.differences(wanted, same))
    val actual = FaceCustomization("1", styles = listOf(FaceStyleChoice(FaceEditMode.BACKGROUND, 3)), colourIndex = 4, widgets = listOf(1))
    assertEquals(
      listOf("background is 3, wanted 2", "hand is not reported, wanted 1", "custom colour is not reported, wanted #112233", "widget 1 is not reported, wanted 2"),
      WatchfaceCustomizer.differences(wanted, actual),
    )
  }

  @Test
  fun partsThatWereNotRequestedAreNotCompared() {
    val actual = FaceCustomization("1", styles = listOf(FaceStyleChoice(FaceEditMode.STYLE, 1)), colourIndex = 3, widgets = listOf(5))
    assertEquals(emptyList<String>(), WatchfaceCustomizer.differences(FaceCustomization("1"), actual))
  }
}
