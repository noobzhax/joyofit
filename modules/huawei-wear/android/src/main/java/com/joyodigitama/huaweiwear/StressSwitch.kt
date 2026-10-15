// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/requests/SetStressRequest,
// HuaweiSupportProvider.setStress / calibrateStress, devices/huawei/packets/Stress.
package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiStressParser
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Stress

/**
 * The watch's automatic stress switch (service 0x20, command 0x09). The watch only turns it on together with a stress
 * calibration computed on the phone from a minute of RR intervals (GB `HuaweiStressCalibration`): status 1, the score,
 * 12 float features and the time of the measurement. Status 2 turns it off. The switch and the last calibration are kept
 * in [WearSettings] and sent again when the watch reconnects, as GB does on every connection.
 */
internal class StressSwitch(
  private val link: WearLink,
  private val settings: WearSettings,
  private val hrv: HrvSpot,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val lock = Any()
  private var resentOn: HuaweiSession? = null

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun supported(): Boolean = link.handle() != null && DeviceCaps.supports(Stress.id.toInt(), Stress.AutomaticStress.id.toInt())

  /** `StressStatus` in `HuaweiWear.types.ts`. */
  fun status(): Map<String, Any?> = mapOf(
    "enabled" to settings.stressEnabled,
    "lastCalibratedAt" to storedCalibration()?.let { it.endTime / 1000 },
    "supported" to supported(),
  )

  private fun storedCalibration(): HuaweiStressParser.StressData? =
    settings.stressCalibration?.let { HuaweiStressParser.stressDataFromJsonStr(it) }

  /**
   * Turns the watch's automatic stress on (runs the 1-minute calibration first) or off. The returned status is the stored
   * one after the watch took the request; a watch that answers with an error code rejects with [ErrorCodes.STRESS_REJECTED].
   */
  suspend fun setEnabled(enabled: Boolean): Map<String, Any?> {
    link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "The watch is not connected")
    if (!supported()) {
      throw WearException(ErrorCodes.UNSUPPORTED, "This watch does not list the automatic stress command (20/09)")
    }
    if (enabled) {
      val collected = hrv.collect()
      // The same minute is a valid spot reading; keep it when it is clean enough.
      try {
        hrv.record(collected)
      } catch (e: WearException) {
        events.log(LogDirection.ERROR, null, null, null, "HRV spot reading from the calibration not stored: ${e.message}")
      }
      val data = HrvSpotCodec.calibrateStress(collected.beats, collected.startMs, collected.endMs)
        ?: throw WearException(
          ErrorCodes.STRESS_CALIBRATION,
          "The calibration minute could not be scored (${collected.beats.count { it.sqi != 0 }} beats with a clean signal). " +
            "Wear the watch snug on the wrist, sit still for the whole minute and try again.",
        )
      log("Stress calibration: score ${data.score}, level ${data.level}, factor ${data.scoreFactor}, features ${data.features}")
      val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "The watch disconnected before the calibration could be sent")
      transmit(handle.session, 1, data)
      settings.stressCalibration = HuaweiStressParser.stressDataToJsonStr(data)
      settings.stressEnabled = true
    } else {
      val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "The watch is not connected")
      transmit(handle.session, 2, null)
      settings.stressEnabled = false
    }
    return status()
  }

  /** A new connection: put the stored switch back on the watch once per session (GB sends it on every connect). */
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED -> {
        val session = link.handle()?.session ?: return
        val first = synchronized(lock) {
          if (resentOn === session) false else { resentOn = session; true }
        }
        if (!first || !settings.stressEnabled) return
        val data = storedCalibration() ?: return
        scope.launch {
          try {
            transmit(session, 1, data)
          } catch (e: CancellationException) {
            throw e
          } catch (e: Exception) {
            events.log(LogDirection.ERROR, null, null, null, "Automatic stress not re-sent: ${e.message}")
          }
        }
      }
      LinkState.DISCONNECTED -> synchronized(lock) { resentOn = null }
      else -> Unit
    }
  }

  /** `20/09` and the watch's answer, logged; GB does not wait for one, so none within [ANSWER_MS] is not an error. */
  private suspend fun transmit(session: HuaweiSession, status: Int, data: HuaweiStressParser.StressData?) {
    val request = Stress.AutomaticStress.Request(
      session.params,
      status.toByte(),
      data?.score ?: 0.toByte(),
      data?.features,
      ((data?.endTime ?: 0L) / 1000).toInt(),
    )
    val label = if (status == 1) "AutomaticStress on (20/09)" else "AutomaticStress off (20/09)"
    val answer = CompletableDeferred<HuaweiPacket>()
    val subscription = session.subscribe(Stress.id, Stress.AutomaticStress.id, "automatic stress answer") { answer.complete(it) }
    try {
      session.send(request, label)
      val reply = withTimeoutOrNull(ANSWER_MS) { answer.await() }
      if (reply == null) {
        log("$label: the watch did not answer within ${ANSWER_MS / 1000} s (GB does not wait for an answer either)")
        return
      }
      val tlv = reply.tlv
      val code = tlv?.getInteger(0x7f, null)
      log("$label: the watch answered tlv=$tlv")
      if (code != null && code != SUCCESS_CODE) {
        throw WearException(ErrorCodes.STRESS_REJECTED, "The watch refused the automatic stress setting (code $code)")
      }
    } finally {
      subscription.close()
    }
  }

  private companion object {
    const val ANSWER_MS = 5_000L

    /** Tag 0x7f of an answer: absent or this means accepted (`HuaweiConstants.RESULT_SUCCESS_INT`). */
    const val SUCCESS_CODE = 100000
  }
}
