// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/requests/SendHeartRateZonesConfig and
// service/devices/huawei/p2p/HuaweiP2PTrackService. Without a zone configuration the watch's workout screen shows the heart
// rate but no zone, so JoyoFit sends GB's default zones for the profile age.
package com.joyodigitama.huaweiwear

import java.time.LocalDate
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg

/** Which way the watch takes its heart-rate zones (GB: Track means P2P, otherwise FitnessData 0x07/0x13|0x21). */
internal object HeartRateZonesSync {
  /** Age used when no profile is saved; the same as the live workout's maximum heart rate. */
  const val DEFAULT_AGE = 35

  fun age(profile: UserProfileData?): Int =
    profile?.birthYear?.takeIf { it > 0 }?.let { ProfileSender.age(it, LocalDate.now()) } ?: DEFAULT_AGE

  /** GB HuaweiState.supportsTrack: ExpandCapability 0x36 (when the watch sent an ExpandCapability at all). */
  val supportsTrack: Boolean get() = DeviceCaps.expandCapability(0x36)

  /** GB HuaweiState.supportsHeartRateZones: FitnessData command 0x13. */
  val supportsSimple: Boolean get() = DeviceCaps.supports(0x07, 0x13)

  /** GB HuaweiState.supportsExtendedHeartRateZones: FitnessData command 0x21. */
  val supportsExtended: Boolean get() = DeviceCaps.supports(0x07, 0x21)

  fun capsLine(): String =
    "HR zones: ExpandCapability 0x36 (Track)=$supportsTrack, FitnessData 07/13=$supportsSimple, 07/21=$supportsExtended, " +
      "P2P 34/01=${DeviceCaps.supports(0x34, 0x01)}; branch=" +
      when {
        supportsTrack -> "P2P module ${TrackService.MODULE} (sent when the P2P service registers)"
        supportsSimple -> "FitnessData 07/${if (supportsExtended) "21" else "13"} (sent after the profile)"
        else -> "none (the watch takes no zone configuration)"
      }

  /**
   * SendHeartRateZonesConfig (07/13 or 07/21) for the non-Track branch; false when the watch does not use it
   * (Track watches get the zones over P2P, [TrackService]).
   */
  suspend fun sendFitnessData(session: HuaweiSession, events: WearEvents, age: Int): Boolean {
    if (supportsTrack || !supportsSimple) return false
    val extended = supportsExtended
    val config = HeartRateZonesCalc.deviceConfig(age, track = false, simpleCommand = true, extended = extended)
      .firstOrNull { it.posture == HeartRateZonesCalc.Posture.UPRIGHT } ?: return false
    val mhr = config.byMethod(HeartRateZonesCalc.Method.MHR)?.takeIf { it.hasValidData() }
    val hrr = config.byMethod(HeartRateZonesCalc.Method.HRR)?.takeIf { it.hasValidData() }
    val packet = if (extended) {
      FitnessData.HeartRateZoneConfigPacket.Request.requestExtended(
        session.params, config.warningEnable, config.warningHRLimit, mhr?.asArray(), config.currentMethod.huaweiCode, hrr?.asArray(),
      )
    } else {
      FitnessData.HeartRateZoneConfigPacket.Request.requestSimple(session.params, config.warningEnable, config.warningHRLimit, mhr?.asArray())
    }
    session.request(packet, Timeouts.INIT_MS, "HeartRateZones")
    events.log(
      LogDirection.INFO, FitnessData.id.toInt(), if (extended) 0x21 else 0x13, null,
      "HR zones: sent 07/${if (extended) "21" else "13"} for age $age, MHR ${mhr?.let { "${it.zone1}/${it.zone2}/${it.zone3}/${it.zone4}/${it.zone5} of ${it.threshold}" }} " +
        "warning ${config.warningHRLimit}${hrr?.let { ", HRR ${it.zone1}/${it.zone2}/${it.zone3}/${it.zone4}/${it.zone5} resting ${it.resting}" } ?: ""}",
    )
    return true
  }
}

/**
 * P2P module `hw.unitedevice.track` (package `hw.watch.health.p2p`, fingerprint `SystemApp`): on registration the phone sends the
 * zone TLV in a type-2 [HuaweiP2PSubMsg], like GB's `HuaweiP2PTrackService`. [age] is read at each send, so [resend] picks up a
 * changed profile.
 */
internal class TrackService(
  manager: HuaweiP2PManager,
  private val events: WearEvents,
  private val age: () -> Int,
) : HuaweiBaseP2PService(manager) {
  override fun getModule() = MODULE

  override fun getPackage() = PACKAGE

  override fun getFingerprint() = FINGERPRINT

  override fun registered() = resend()

  override fun unregister() = Unit

  override fun handleData(data: ByteArray) {
    log("HR zones: track service data, ${data.size} bytes: ${data.toHex()}")
  }

  /** GB `sendHeartZoneConfig`. */
  fun resend() {
    val years = age()
    val configs = HeartRateZonesCalc.deviceConfig(years, track = true, simpleCommand = false, extended = false)
    val pairs = HeartRateZonesCalc.trackTlv(configs)
    if (pairs == null) {
      events.log(LogDirection.ERROR, 0x34, 0x01, null, "HR zones: not sent, the zones for age $years are not valid")
      return
    }
    val tlv = HuaweiTLV()
    for ((tag, value) in pairs) tlv.put(tag, value.toByte())
    val packet = HuaweiP2PSubMsg(2, HuaweiP2PSubMsg.getNext(), tlv.serialize())
    sendCommand(packet.bytes, null)
    val upright = configs.first { it.posture == HeartRateZonesCalc.Posture.UPRIGHT }
    val mhr = upright.byMethod(HeartRateZonesCalc.Method.MHR)!!
    val hrr = upright.byMethod(HeartRateZonesCalc.Method.HRR)!!
    log(
      "HR zones: sent via $MODULE for age $years, upright MHR ${mhr.zone1}/${mhr.zone2}/${mhr.zone3}/${mhr.zone4}/${mhr.zone5} of ${mhr.threshold}, " +
        "HRR ${hrr.zone1}/${hrr.zone2}/${hrr.zone3}/${hrr.zone4}/${hrr.zone5} resting ${hrr.resting}, warning ${upright.warningHRLimit}, ${packet.bytes.size} bytes",
    )
  }

  private fun log(message: String) = events.log(LogDirection.INFO, 0x34, 0x01, null, message)

  companion object {
    const val MODULE = "hw.unitedevice.track"
    const val PACKAGE = "hw.watch.health.p2p"
    const val FINGERPRINT = "SystemApp"
  }
}
