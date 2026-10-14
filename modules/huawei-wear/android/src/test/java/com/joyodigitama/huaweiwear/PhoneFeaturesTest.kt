package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Alarms
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DataSync
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FindPhone
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.datasync.HuaweiDataSyncCommon
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PhoneFeaturesTest {
  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false) }

  /** `5A | len | 00 | service | command | TLV | CRC16` for an unsliced, unencrypted packet. */
  private fun frame(service: Int, command: Int, tlv: ByteArray): ByteArray {
    val body = byteArrayOf(0x00, service.toByte(), command.toByte()) + tlv
    val head = byteArrayOf(0x5A, (body.size shr 8).toByte(), body.size.toByte()) + body
    val crc = CheckSums.getCRC16(head, 0)
    return head + byteArrayOf((crc shr 8).toByte(), crc.toByte())
  }

  @Test
  fun stopFindPhoneIsTagOneEqualsTwo() {
    val out = FindPhone.StopRequest(plain).serialize()
    assertEquals(1, out.size)
    assertArrayEquals(frame(0x0B, 0x02, byteArrayOf(0x01, 0x01, 0x02)), out[0])
  }

  @Test
  fun findWatchIsADataSyncConfigCommand() {
    val config = HuaweiDataSyncCommon.ConfigData()
    config.configId = PhoneFeatures.FIND_DEVICE_CONFIG_ID
    config.configAction = 2
    val data = HuaweiDataSyncCommon.ConfigCommandData()
    data.configDataList = listOf(config)

    val out = DataSync.ConfigCommand.Request(plain, PhoneFeatures.FIND_DEVICE_SRC_PACKAGE, PhoneFeatures.FIND_DEVICE_DST_PACKAGE, data).serialize()

    val expected = HuaweiTLV()
      .put(0x01, "hw.unitedevice.finddevice")
      .put(0x02, "findDevice")
      .put(0x83, HuaweiTLV().put(0x84, HuaweiTLV().put(0x05, 900100002).put(0x06, 2.toByte())))
    assertEquals(1, out.size)
    assertArrayEquals(frame(0x37, 0x01, expected.serialize()), out[0])
  }

  @Test
  fun emptyEventAlarmListClearsWithABareIndexOne() {
    val out = Alarms.EventAlarmsRequest(plain).serialize()
    val expected = HuaweiTLV().put(0x81, HuaweiTLV().put(0x82, HuaweiTLV().put(0x03, 0x01.toByte())))
    assertArrayEquals(frame(0x08, 0x01, expected.serialize()), out[0])
  }

  @Test
  fun alarmsRoundTripThroughJson() {
    val alarms = WatchAlarms(
      event = listOf(WatchAlarm(1, true, 7, 30, 0b0011111, "Work"), WatchAlarm(3, false, 23, 5, 0, "")),
      smart = WatchSmartAlarm(true, 6, 45, 127, 10),
      updatedAtMs = 1_700_000_000_000,
    )
    assertEquals(alarms, WatchAlarms.fromJson(alarms.toJson()))
    assertEquals(WatchAlarms.EMPTY, WatchAlarms.fromJson(null))
    assertEquals(WatchAlarms.EMPTY, WatchAlarms.fromJson("not json"))
    assertNull(WatchAlarms.fromJson(WatchAlarms(emptyList(), null, null).toJson()).smart)
  }

  private fun rejected(alarms: WatchAlarms) {
    try {
      AlarmSync.validate(alarms)
      fail("expected ERR_INVALID_ARGUMENT")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
  }

  @Test
  fun validateEnforcesSlotsAndRanges() {
    val ok = WatchAlarm(1, true, 7, 30, 1, "A")
    AlarmSync.validate(WatchAlarms(listOf(ok), WatchSmartAlarm(false, 6, 0, 0, 5), null))
    rejected(WatchAlarms(listOf(ok, ok), null, null))
    rejected(WatchAlarms(listOf(ok.copy(slot = 0)), null, null))
    rejected(WatchAlarms(listOf(ok.copy(slot = 6)), null, null))
    rejected(WatchAlarms(listOf(ok.copy(hour = 24)), null, null))
    rejected(WatchAlarms(listOf(ok.copy(minute = 60)), null, null))
    rejected(WatchAlarms(listOf(ok.copy(repeat = 128)), null, null))
    rejected(WatchAlarms((1..6).map { ok.copy(slot = it) }, null, null))
    rejected(WatchAlarms(emptyList(), WatchSmartAlarm(true, 25, 0, 0, 5), null))
  }

  @Test
  fun capabilitiesComeFromSupportedCommands() {
    DeviceCaps.reset()
    assertTrue(!AlarmSync.supported)
    DeviceCaps.supportedCommands = mapOf(0x08 to byteArrayOf(0x01, 0x03))
    assertTrue(AlarmSync.supported)
    assertTrue(!AlarmSync.smartSupported)
    DeviceCaps.supportedCommands = mapOf(0x08 to byteArrayOf(0x01, 0x02, 0x03, 0x04))
    assertTrue(AlarmSync.smartSupported)
    DeviceCaps.reset()
  }
}
