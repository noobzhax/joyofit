package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchModelsTest {
  @Test
  fun longerNamesWinOverTheirShorterSiblings() {
    assertEquals("Huawei Watch Fit 4 Pro", WatchModels.match("HUAWEI WATCH FIT 4 Pro-A0B").model?.name)
    assertEquals("Huawei Watch Fit 4", WatchModels.match("HUAWEI WATCH FIT 4-A0B").model?.name)
    assertEquals("Huawei Watch GT 3 SE", WatchModels.match("HUAWEI WATCH GT 3 SE-1C2").model?.name)
    assertEquals("Huawei Watch GT 7 Pro", WatchModels.match("HUAWEI WATCH GT 7 Pro-1C2").model?.name)
    assertEquals("Huawei Watch Fit", WatchModels.match("HUAWEI WATCH FIT-1C2").model?.name)
  }

  @Test
  fun onlyTheFit4ProIsTestedAndOtherClassicWatchesAreExperimental() {
    assertEquals(ModelSupport.TESTED, WatchModels.match("HUAWEI WATCH FIT 4 Pro-A0B").support)
    val gt4 = WatchModels.match("HUAWEI WATCH GT 4-1A2")
    assertEquals(ModelSupport.EXPERIMENTAL, gt4.support)
    assertTrue(gt4.connectable)
    assertEquals(HuaweiConstants.UUID_SERVICE_HUAWEI_SDP, gt4.sdp)
    assertTrue(gt4.crypted)
  }

  @Test
  fun theFit4ProKeepsRfcommAndItsAuthPath() {
    val fit = WatchModels.match("HUAWEI WATCH FIT 4 Pro-A0B")
    assertEquals(ModelTransport.BR, fit.transportFor(leOnlyDevice = false))
    // A classic model stays on RFCOMM whatever Android reports for the device.
    assertEquals(ModelTransport.BR, fit.transportFor(leOnlyDevice = true))
    assertEquals(HuaweiDeviceType.BR, fit.deviceType(ModelTransport.BR))
  }

  @Test
  fun bluetoothLeBandsAreExperimentalOverGatt() {
    val band = WatchModels.match("HUAWEI Band 9-ABC")
    assertEquals("Huawei Band 9", band.model?.name)
    assertEquals(ModelSupport.EXPERIMENTAL, band.support)
    assertTrue(band.connectable)
    assertEquals(ModelTransport.LE, band.transportFor(leOnlyDevice = false))
    assertEquals(HuaweiDeviceType.BLE, band.deviceType(ModelTransport.LE))
    assertFalse(band.newHonorProtocol)
    assertEquals(ModelSupport.EXPERIMENTAL, WatchModels.match("HUAWEI WATCH FIT-1C2").support)
  }

  @Test
  fun leQuirksFollowGadgetbridgesCoordinators() {
    // HuaweiBandAw70Coordinator: Band 3e and 4e are HuaweiDeviceType.AW.
    assertEquals(HuaweiDeviceType.AW, WatchModels.match("HUAWEI Band 4e-ABC").deviceType(ModelTransport.LE))
    assertEquals(HuaweiDeviceType.BLE, WatchModels.match("HUAWEI Band 4-ABC").deviceType(ModelTransport.LE))
    assertEquals(HuaweiDeviceType.BLE, WatchModels.match("HUAWEI Band 4 Pro-ABC").deviceType(ModelTransport.LE))
    // isNewHonorProtocol: Honor Band 7, 9 and 10 only.
    for (name in listOf("HONOR Band 7-ABC", "HONOR Band 9-ABC", "HONOR Band 10-ABC")) {
      assertTrue(name, WatchModels.match(name).newHonorProtocol)
    }
    assertFalse(WatchModels.match("HONOR Band 6-ABC").newHonorProtocol)
    assertFalse(WatchModels.match("HUAWEI Band 9-ABC").newHonorProtocol)
  }

  @Test
  fun honorPakeWatchesCannotConnect() {
    val honor5 = WatchModels.match("HONOR Watch 5-ABC")
    assertEquals(ModelSupport.UNSUPPORTED, honor5.support)
    assertFalse(honor5.connectable)
  }

  @Test
  fun unlistedNamesFollowWhatAndroidKnowsOfTheDevice() {
    val unknown = WatchModels.match("HUAWEI WATCH 6-ABC")
    assertEquals(ModelTransport.BR, unknown.transportFor(leOnlyDevice = false))
    assertEquals(ModelTransport.LE, unknown.transportFor(leOnlyDevice = true))
    assertEquals(HuaweiDeviceType.BLE, unknown.deviceType(ModelTransport.LE))
  }

  @Test
  fun honorClassicWatchesUseTheirOwnServiceAndPlainTransactions() {
    val honor = WatchModels.match("HONOR Watch 4-ABC")
    assertEquals(ModelSupport.EXPERIMENTAL, honor.support)
    assertEquals(HuaweiConstants.UUID_SERVICE_HONOR_SDP, honor.sdp)
    assertFalse(honor.crypted)
    // MagicWatch 2 extends HuaweiBRCoordinator in GB: Huawei's service, unencrypted.
    val magic = WatchModels.match("HONOR MagicWatch 2-ABC")
    assertEquals(HuaweiConstants.UUID_SERVICE_HUAWEI_SDP, magic.sdp)
    assertFalse(magic.crypted)
  }

  @Test
  fun unlistedNamesAreTriedOnlyWhenTheyLookLikeHuaweiOrHonor() {
    val unknown = WatchModels.match("HUAWEI WATCH 6-ABC")
    assertNull(unknown.model)
    assertEquals(ModelSupport.UNKNOWN, unknown.support)
    assertTrue(unknown.connectable)
    assertEquals(ModelSupport.UNKNOWN, WatchModels.match(null).support)
    assertEquals(ModelSupport.UNSUPPORTED, WatchModels.match("HUAWEI FreeBuds Pro 3").support)
    assertEquals(ModelSupport.UNSUPPORTED, WatchModels.match("Galaxy Watch6").support)
  }

  @Test
  fun supportReportLeavesOutAddressesAndSerial() {
    val text = SupportReport.redact("Connecting to 30:A9:98:FC:64:0A; ProductInfo serial=ABC123XYZ; again ABC123XYZ", "ABC123XYZ")
    assertFalse(text.contains("30:A9"))
    assertFalse(text.contains("ABC123XYZ"))
    assertTrue(text.contains("XX:XX:XX:XX:XX:XX"))
  }
}
