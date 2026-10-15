// Device list from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): devices/huawei/*/…Coordinator (getSupportedDeviceName,
// Huawei/Honor BR vs LE base class, isTransactionCrypted, supportsHiChainPake) and HuaweiConstants.*_NAME.
package com.joyodigitama.huaweiwear

import java.util.Locale
import java.util.UUID
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType

/** How far JoyoFit gets with a watch model. */
internal enum class ModelSupport(val wire: String) {
  /** Checked on a real watch. */
  TESTED("tested"),

  /** In Gadgetbridge's list, on a link (RFCOMM or GATT) and an auth mode JoyoFit implements; never tried with JoyoFit. */
  EXPERIMENTAL("experimental"),

  /** A Huawei or Honor name Gadgetbridge does not list; JoyoFit tries it like a Huawei watch. */
  UNKNOWN("unknown"),

  /** JoyoFit cannot talk to it; [ModelMatch.reason] says why. */
  UNSUPPORTED("unsupported"),
}

/** Bluetooth Classic (RFCOMM, [RfcommTransport]) or Bluetooth LE (GATT, [BleTransport]); [label] is what the support report says. */
internal enum class ModelTransport(val label: String) {
  BR("Bluetooth Classic (RFCOMM)"),
  LE("Bluetooth LE (GATT)"),
}

internal class WatchModel(
  /** For people: "Huawei Watch GT 4". */
  val name: String,
  /** Lower case start of the Bluetooth name, as in GB's coordinator ("huawei watch gt 4-"). */
  val prefix: String,
  val transport: ModelTransport,
  /** HonorBRCoordinator: the RFCOMM service is UUID_SERVICE_HONOR_SDP. */
  val honorSdp: Boolean = false,
  /** GB isTransactionCrypted. */
  val crypted: Boolean = true,
  /** GB supportsHiChainPake: Honor's newer pairing, which JoyoFit does not implement. */
  val pake: Boolean = false,
  val tested: Boolean = false,
  /** GB HuaweiDeviceType.AW (HuaweiBandAw70Coordinator: Band 3e, 4e): LE, but asks LinkParams and ProductInfo with the AW tag sets. */
  val aw: Boolean = false,
  /** GB isNewHonorProtocol (Honor Band 7, 9, 10): LE with Honor's own GATT service instead of 0xFE86. */
  val newHonorProtocol: Boolean = false,
)

internal class ModelMatch(val model: WatchModel?, val support: ModelSupport, val reason: String?) {
  /** RFCOMM service record to connect to. */
  val sdp: UUID get() = if (model?.honorSdp == true) HuaweiConstants.UUID_SERVICE_HONOR_SDP else HuaweiConstants.UUID_SERVICE_HUAWEI_SDP

  val crypted: Boolean get() = model?.crypted ?: true

  /** GATT service and characteristics are Honor's own ones ([HuaweiConstants.UUID_SERVICE_HONOR_SERVICE]), not 0xFE86. */
  val newHonorProtocol: Boolean get() = model?.newHonorProtocol == true

  val connectable: Boolean get() = support != ModelSupport.UNSUPPORTED

  /**
   * The link to open. A listed model has the transport of its Gadgetbridge coordinator. GB lists no model for other names, so
   * there is nothing to follow: those are tried over RFCOMM, the link JoyoFit has been used with, unless Android knows the
   * device as Bluetooth LE only (it has no Classic side to open a socket on).
   */
  fun transportFor(leOnlyDevice: Boolean): ModelTransport =
    model?.transport ?: if (leOnlyDevice) ModelTransport.LE else ModelTransport.BR

  /** GB's HuaweiDeviceType: BR on RFCOMM, AW for the AW70 bands, BLE for the other LE models and unlisted LE-only devices. */
  fun deviceType(transport: ModelTransport): HuaweiDeviceType = when {
    transport == ModelTransport.BR -> HuaweiDeviceType.BR
    model?.aw == true -> HuaweiDeviceType.AW
    else -> HuaweiDeviceType.BLE
  }

  fun toJs(): Map<String, Any?> = mapOf("model" to model?.name, "support" to support.wire, "reason" to reason)
}

internal object WatchModels {
  private fun br(name: String, prefix: String, honorSdp: Boolean = false, crypted: Boolean = true, pake: Boolean = false, tested: Boolean = false) =
    WatchModel(name, prefix, ModelTransport.BR, honorSdp, crypted, pake, tested)

  private fun le(name: String, prefix: String, aw: Boolean = false, newHonorProtocol: Boolean = false) =
    WatchModel(name, prefix, ModelTransport.LE, aw = aw, newHonorProtocol = newHonorProtocol)

  val all: List<WatchModel> = listOf(
    br("Huawei Watch Fit 4 Pro", HuaweiConstants.HU_JOYOFIT4PRO_NAME, tested = true),
    br("Huawei Watch Fit 4", HuaweiConstants.HU_JOYOFIT4_NAME),
    br("Huawei Watch Fit 5", HuaweiConstants.HU_JOYOFIT5_NAME),
    br("Huawei Watch Fit 5 Pro", HuaweiConstants.HU_JOYOFIT5PRO_NAME),
    br("Huawei Watch Fit 3", HuaweiConstants.HU_JOYOFIT3_NAME),
    br("Huawei Watch Fit 2", HuaweiConstants.HU_JOYOFIT2_NAME),
    br("Huawei Watch GT 2", HuaweiConstants.HU_WATCHGT2_NAME),
    br("Huawei Watch GT 2 Pro", HuaweiConstants.HU_WATCHGT2PRO_NAME),
    br("Huawei Watch GT 3", HuaweiConstants.HU_WATCHGT3_NAME),
    br("Huawei Watch GT 3 Pro", HuaweiConstants.HU_WATCHGT3PRO_NAME),
    br("Huawei Watch GT 3 SE", HuaweiConstants.HU_WATCHGT3SE_NAME),
    br("Huawei Watch GT 4", HuaweiConstants.HU_WATCHGT4_NAME),
    br("Huawei Watch GT 5", HuaweiConstants.HU_WATCHGT5_NAME),
    br("Huawei Watch GT 5 Pro", HuaweiConstants.HU_WATCHGT5PRO_NAME),
    br("Huawei Watch GT 6", HuaweiConstants.HU_WATCHGT6_NAME),
    br("Huawei Watch GT 6 Pro", HuaweiConstants.HU_WATCHGT6PRO_NAME),
    // GB matches these two with "huawei watch gt 7( pro)?-.+" patterns, not constants.
    br("Huawei Watch GT 7", "huawei watch gt 7-"),
    br("Huawei Watch GT 7 Pro", "huawei watch gt 7 pro-"),
    br("Huawei Watch GT Runner", HuaweiConstants.HU_WATCHGTRUNNER_NAME),
    br("Huawei Watch GT Runner 2", HuaweiConstants.HU_WATCHGTRUNNER2_NAME),
    br("Huawei Watch GT Cyber", HuaweiConstants.HU_WATCHGTCYBER_NAME),
    br("Huawei Watch 3", HuaweiConstants.HU_WATCH3_NAME),
    br("Huawei Watch 3 Pro", HuaweiConstants.HU_WATCH3PRO_NAME),
    br("Huawei Watch 4", HuaweiConstants.HU_WATCH4_NAME),
    br("Huawei Watch 4 Pro", HuaweiConstants.HU_WATCH4PRO_NAME),
    br("Huawei Watch 5", HuaweiConstants.HU_WATCH5_NAME),
    br("Huawei Watch D2", HuaweiConstants.HU_WATCHD2_NAME),
    br("Huawei Watch Ultimate", HuaweiConstants.HU_WATCHULTIMATE_NAME),
    br("Huawei Watch Ultimate 2", HuaweiConstants.HU_WATCHULTIMATE2_NAME),
    br("Huawei TalkBand B6", HuaweiConstants.HU_TALKBANDB6_NAME, crypted = false),
    br("Honor MagicWatch 2", HuaweiConstants.HO_MAGICWATCH2_NAME, crypted = false),
    br("Honor Watch GS 3", HuaweiConstants.HO_WATCHGS3_NAME, crypted = false),
    br("Honor Watch GS Pro", HuaweiConstants.HO_WATCHGSPRO_NAME, crypted = false),
    br("Honor Watch 4", HuaweiConstants.HO_WATCH4_NAME, honorSdp = true, crypted = false),
    br("Honor Watch 4 Pro", HuaweiConstants.HO_WATCH4PRO_NAME, honorSdp = true, crypted = false),
    br("Honor Watch 5", HuaweiConstants.HO_WATCH5_NAME, honorSdp = true, crypted = false, pake = true),
    br("Honor Watch 5 Pro", HuaweiConstants.HO_WATCH5PRO_NAME, honorSdp = true, crypted = false, pake = true),
    br("Honor Watch 6", HuaweiConstants.HO_WATCH6_NAME, honorSdp = true, crypted = false, pake = true),
    le("Huawei Watch Fit", HuaweiConstants.HU_JOYOFIT_NAME),
    le("Huawei Watch GT", HuaweiConstants.HU_WATCHGT_NAME),
    le("Huawei Watch GT 2e", HuaweiConstants.HU_WATCHGT2E_NAME),
    le("Huawei Band 2", HuaweiConstants.HU_BAND2_NAME),
    le("Huawei Band 2 Pro", HuaweiConstants.HU_BAND2PRO_NAME),
    le("Huawei Band 3", HuaweiConstants.HU_BAND3_NAME),
    le("Huawei Band 3 Pro", HuaweiConstants.HU_BAND3PRO_NAME),
    le("Huawei Band 3e", HuaweiConstants.HU_BAND3E_NAME, aw = true),
    le("Huawei Band 4", HuaweiConstants.HU_BAND4_NAME),
    le("Huawei Band 4 Pro", HuaweiConstants.HU_BAND4PRO_NAME),
    le("Huawei Band 4e", HuaweiConstants.HU_BAND4E_NAME, aw = true),
    le("Huawei Band 6", HuaweiConstants.HU_BAND6_NAME),
    le("Huawei Band 7", HuaweiConstants.HU_BAND7_NAME),
    le("Huawei Band 8", HuaweiConstants.HU_BAND8_NAME),
    le("Huawei Band 9", HuaweiConstants.HU_BAND9_NAME),
    le("Huawei Band 10", HuaweiConstants.HU_BAND10_NAME),
    le("Huawei Band 11", HuaweiConstants.HU_BAND11_NAME),
    le("Huawei Band 11 Pro", HuaweiConstants.HU_BAND11PRO_NAME),
    le("Honor Band 3", HuaweiConstants.HO_BAND3_NAME),
    le("Honor Band 4", HuaweiConstants.HO_BAND4_NAME),
    le("Honor Band 5", HuaweiConstants.HO_BAND5_NAME),
    le("Honor Band 6", HuaweiConstants.HO_BAND6_NAME),
    le("Honor Band 7", HuaweiConstants.HO_BAND7_NAME, newHonorProtocol = true),
    le("Honor Band 9", HuaweiConstants.HO_BAND9_NAME, newHonorProtocol = true),
    le("Honor Band 10", HuaweiConstants.HO_BAND10_NAME, newHonorProtocol = true),
    le("Honor Watch", HuaweiConstants.HO_MAGICWATCH_NAME),
  )

  /** Earphones share the Huawei/Honor names but not the watch protocol. */
  private val AUDIO = listOf("freebuds", "freeclip", "freearc", "freelace", "earbuds")

  /** The catalog entry for a Bluetooth name (longest matching prefix, case-insensitive) and what JoyoFit can do with it. */
  fun match(bluetoothName: String?): ModelMatch {
    val lower = bluetoothName?.trim()?.lowercase(Locale.ROOT).orEmpty()
    val model = all.filter { lower.startsWith(it.prefix.lowercase(Locale.ROOT)) }.maxByOrNull { it.prefix.length }
    return when {
      model == null && AUDIO.any { it in lower } -> ModelMatch(null, ModelSupport.UNSUPPORTED, "Earphones, not a watch")
      // No name (Bluetooth permission trouble): let the connect decide.
      model == null && (lower.isEmpty() || lower.startsWith("huawei") || lower.startsWith("honor")) ->
        ModelMatch(null, ModelSupport.UNKNOWN, "Not in the list of known watches; it may not work")
      model == null -> ModelMatch(null, ModelSupport.UNSUPPORTED, "Not a Huawei or Honor watch")
      model.pake -> ModelMatch(model, ModelSupport.UNSUPPORTED, "Uses Honor's newer pairing, which JoyoFit does not support yet")
      model.tested -> ModelMatch(model, ModelSupport.TESTED, null)
      // GB's coordinators for these three carry isExperimental() (its issue #6027).
      model.newHonorProtocol -> ModelMatch(model, ModelSupport.EXPERIMENTAL, "Not tested with JoyoFit yet; Gadgetbridge calls it experimental too")
      else -> ModelMatch(model, ModelSupport.EXPERIMENTAL, "Not tested with JoyoFit yet")
    }
  }
}
