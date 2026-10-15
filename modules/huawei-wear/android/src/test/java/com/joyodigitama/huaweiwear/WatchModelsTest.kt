package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants
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
  fun bluetoothLeAndHonorPakeModelsCannotConnect() {
    val band = WatchModels.match("HUAWEI Band 9-ABC")
    assertEquals("Huawei Band 9", band.model?.name)
    assertEquals(ModelSupport.UNSUPPORTED, band.support)
    assertFalse(band.connectable)
    assertEquals(ModelSupport.UNSUPPORTED, WatchModels.match("HONOR Watch 5-ABC").support)
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
