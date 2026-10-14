// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/requests/{SetAutomaticHeartrateRequest,
// SetAutomaticSpoRequest,SetHeartRateHighAlert,SetHeartRateLowAlert,SetTruSleepRequest,SendNotifyHeartRateCapabilityRequest,
// SendNotifyRestHeartRateCapabilityRequest} and the capability gates of HuaweiState.
package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout

/**
 * What the user chose for the watch's own health sensors. GB sends these only when its settings
 * change (all default off there, and none is in its init queue), so a watch that was wiped and bound
 * to a new account keeps continuous heart rate off. JoyoFit sends them on every connect; the
 * defaults are Huawei Health's.
 */
internal data class HealthSensorConfig(
  /** Continuous heart rate (FitnessData 07/17), the source of `heartRate` in the step frames. */
  val automaticHeartRate: Boolean = true,
  /** Automatic SpO2 (07/24). */
  val automaticSpo2: Boolean = true,
  /** TruSleep (07/16), which the sleep files need. */
  val truSleep: Boolean = true,
  /** bpm above which the watch alerts, 0 = off (07/1D). */
  val highHeartRateAlert: Int = 0,
  /** bpm below which the watch alerts, 0 = off (07/22). */
  val lowHeartRateAlert: Int = 0,
)

/** Which sensor commands the connected watch lists (GB HuaweiState.supports*). */
internal data class HealthSensorSupport(
  val heartRate: Boolean,
  val realtimeHeartRate: Boolean,
  val spo2: Boolean,
  val truSleep: Boolean,
  val highHeartRateAlert: Boolean,
  val lowHeartRateAlert: Boolean,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "heartRate" to heartRate,
    "realtimeHeartRate" to realtimeHeartRate,
    "spo2" to spo2,
    "truSleep" to truSleep,
    "highHeartRateAlert" to highHeartRateAlert,
    "lowHeartRateAlert" to lowHeartRateAlert,
  )

  companion object {
    fun of(supports: (service: Int, command: Int) -> Boolean) = HealthSensorSupport(
      heartRate = supports(FITNESS, FitnessData.EnableAutomaticHeartrate.id.toInt()), // supportsHeartRate
      realtimeHeartRate = supports(FITNESS, FitnessData.EnableRealtimeHeartRate.id.toInt()),
      spo2 = supports(FITNESS, FitnessData.EnableAutomaticSpo.id.toInt()),
      truSleep = supports(FITNESS, FitnessData.TruSleep.id.toInt()),
      highHeartRateAlert = supports(FITNESS, FitnessData.HighHeartRateAlert.id.toInt()),
      lowHeartRateAlert = supports(FITNESS, FitnessData.LowHeartRateAlert.id.toInt()),
    )
  }
}

private val FITNESS = FitnessData.id.toInt()

internal class SensorRequest(val label: String, val build: (HuaweiPacket.ParamsProvider) -> HuaweiPacket)

internal object HealthSensors {
  /**
   * The requests to send for [config], in GB's order (capability notifications first, then the
   * switches), each only when the watch lists its command.
   *
   * On connect ([previous] null) everything is sent, except an alert that is off, so the watch's own
   * alert configuration is not overwritten with "off". After the user changed a setting, [previous]
   * is the earlier configuration and only what differs is sent, an alert switched off included.
   */
  fun plan(
    supports: (service: Int, command: Int) -> Boolean,
    config: HealthSensorConfig,
    previous: HealthSensorConfig?,
  ): List<SensorRequest> {
    val plan = ArrayList<SensorRequest>()
    if (previous == null) {
      // SendNotifyHeartRateCapabilityRequest: supportsWorkoutsTrustHeartRate = 0x17/0x17.
      if (supports(Workout.id.toInt(), Workout.NotifyHeartRate.id)) {
        plan += SensorRequest("NotifyHeartRate") { Workout.NotifyHeartRate.Request(it) }
      }
      // SendNotifyRestHeartRateCapabilityRequest: supportsFitnessRestHeartRate = 07/23.
      if (supports(FITNESS, FitnessData.NotifyRestHeartRate.id.toInt())) {
        plan += SensorRequest("NotifyRestHeartRate") { FitnessData.NotifyRestHeartRate.Request(it) }
      }
    }
    if (supports(FITNESS, FitnessData.TruSleep.id.toInt()) && (previous == null || previous.truSleep != config.truSleep)) {
      plan += SensorRequest("TruSleep ${onOff(config.truSleep)}") { FitnessData.TruSleep.Request(it, config.truSleep) }
    }
    if (supports(FITNESS, FitnessData.EnableAutomaticHeartrate.id.toInt()) &&
      (previous == null || previous.automaticHeartRate != config.automaticHeartRate)
    ) {
      plan += automaticHeartRateRequest(config.automaticHeartRate)
    }
    if (supports(FITNESS, FitnessData.EnableAutomaticSpo.id.toInt()) &&
      (previous == null || previous.automaticSpo2 != config.automaticSpo2)
    ) {
      plan += SensorRequest("AutomaticSpo2 ${onOff(config.automaticSpo2)}") {
        FitnessData.EnableAutomaticSpo.Request(it, config.automaticSpo2)
      }
    }
    if (supports(FITNESS, FitnessData.HighHeartRateAlert.id.toInt()) &&
      if (previous == null) config.highHeartRateAlert > 0 else previous.highHeartRateAlert != config.highHeartRateAlert
    ) {
      plan += SensorRequest("HighHeartRateAlert ${alertText(config.highHeartRateAlert)}") {
        FitnessData.HighHeartRateAlert.Request(it, config.highHeartRateAlert > 0, config.highHeartRateAlert.toByte())
      }
    }
    if (supports(FITNESS, FitnessData.LowHeartRateAlert.id.toInt()) &&
      if (previous == null) config.lowHeartRateAlert > 0 else previous.lowHeartRateAlert != config.lowHeartRateAlert
    ) {
      plan += SensorRequest("LowHeartRateAlert ${alertText(config.lowHeartRateAlert)}") {
        FitnessData.LowHeartRateAlert.Request(it, config.lowHeartRateAlert > 0, config.lowHeartRateAlert.toByte())
      }
    }
    return plan
  }

  /**
   * Sends [plan] one request after the other; returns how many the watch acknowledged. A request that
   * fails or goes unanswered is logged and does not stop the rest. GB sends the switches without
   * waiting (`addToResponse = false`), so a missing acknowledgement is reported as "sent, no reply".
   */
  suspend fun send(session: HuaweiSession, events: WearEvents, plan: List<SensorRequest>): Int {
    var acknowledged = 0
    for (request in plan) {
      try {
        session.request(request.build(session.params), Timeouts.INIT_MS, request.label)
        acknowledged++
        events.log(LogDirection.INFO, null, null, null, "${request.label}: acknowledged")
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
        val what = if (e.errorCode == ErrorCodes.TIMEOUT) "sent, no reply" else "failed: ${e.message}"
        events.log(LogDirection.ERROR, null, null, null, "${request.label}: $what")
      } catch (e: Exception) {
        events.log(LogDirection.ERROR, null, null, null, "${request.label}: failed: ${e.message ?: e.javaClass.simpleName}")
      }
    }
    return acknowledged
  }

  /**
   * SetAutomaticHeartrateRequest in GB's realtime mode: FitnessData 07/1C carries one boolean. [enabled]
   * starts the watch pushing heart-rate readings; the watch's reply is the same command. Gated by
   * HuaweiState.supportsRealtimeHeartRate (07/1C).
   */
  fun realtimeRequest(enabled: Boolean) =
    SensorRequest("RealtimeHeartRate ${onOff(enabled)}") { FitnessData.EnableRealtimeHeartRate.Request(it, enabled) }

  /** Automatic heart rate on its own, used to restore the baseline after the realtime mode ends. */
  fun automaticHeartRateRequest(enabled: Boolean) =
    SensorRequest("AutomaticHeartRate ${onOff(enabled)}") { FitnessData.EnableAutomaticHeartrate.Request(it, enabled) }

  /** Realtime readings the watch pushes outside any request, on the command it was asked on. */
  val REALTIME_SERVICE = FitnessData.id
  val REALTIME_COMMAND = FitnessData.EnableRealtimeHeartRate.id

  /**
   * One heart-rate reading from a pushed realtime packet. GB never receives one (it has no parser),
   * so the layout is not known from its sources: this takes the first single-byte value in the
   * physiological range from the TLV, descending into containers (tags with bit 7 set). The raw
   * frame is logged by the session, so a different layout shows up in the log.
   */
  fun decodeRealtime(tlv: HuaweiTLV?): Int? {
    if (tlv == null) return null
    for (entry in tlv.get()) {
      val tag = entry.tag.toInt() and 0xFF
      val value = entry.value
      if (tag >= 0x80) {
        val nested = try {
          HuaweiTLV().parse(value)
        } catch (e: Exception) {
          continue
        }
        decodeRealtime(nested)?.let { return it }
      } else if (value.size == 1) {
        val bpm = value[0].toInt() and 0xFF
        if (bpm in MIN_BPM..MAX_BPM) return bpm
      }
    }
    return null
  }

  const val MIN_BPM = 30
  const val MAX_BPM = 250

  private fun onOff(on: Boolean) = if (on) "on" else "off"

  private fun alertText(bpm: Int) = if (bpm > 0) "$bpm bpm" else "off"
}
