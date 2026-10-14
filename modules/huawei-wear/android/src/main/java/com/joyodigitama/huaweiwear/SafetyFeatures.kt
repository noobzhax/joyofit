package com.joyodigitama.huaweiwear

import android.content.Context
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Fall detection switch and SOS SMS relay over DataSync (see [SafetyPayloads] for the wire format).
 *
 * Fall detection (config 900500038) is only offered when the watch reports what Huawei Health needs for it:
 * ExpandCapability 83 (DataSync configs) and SupportedCommands service 0x33 command 1 (`isSupportSosTransmission`,
 * `lso.o`). The SOS relay answers the watch whenever it asks, whatever the watch reports: refusing silently would
 * leave the person waiting for help. It sends an SMS only with the user's switch ON and SEND_SMS granted; in every
 * other case it answers `status: "1"` so the watch knows nothing was sent.
 */
internal class SafetyFeatures(
  context: Context,
  private val settings: WatchExtrasSettings,
  private val events: WearEvents,
  private val gateway: SosSmsGateway = SosSmsGateway(context),
) : DataSyncFeature {
  override val name = "safety"

  private lateinit var service: DataSyncService

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  override fun register(service: DataSyncService) {
    this.service = service
    service.onConfig(SafetyPayloads.FALL_PHONE_PKG, SafetyPayloads.FALL_WATCH_PKG, SafetyPayloads.FALL_CONFIG_ID) { onFallConfig(it) }
    service.onEvent(SafetyPayloads.SOS_PHONE_PKG, SafetyPayloads.SOS_WATCH_PKG, SafetyPayloads.SOS_EVENT_ID) { onSos(it) }
  }

  override suspend fun onConnected() {
    val gate = fallGate()
    log("Fall detection: ${gate ?: "supported"} (config ${SafetyPayloads.FALL_CONFIG_ID}, bit ${DataSyncWire.CAP_CONFIG}, 0x33/01)")
    if (gate == null) queryFall()
    val readiness = gateway.readiness(settings.sosRelayEnabled)
    log("SOS relay: ${if (readiness.ready) "ready" else "not ready, " + readiness.blockers().joinToString("; ")}; 0x33/02 ${if (DeviceCaps.supports(0x33, 0x02)) "listed" else "not listed"} by the watch")
  }

  // Fall detection

  /** Why fall detection cannot be used with the connected watch, or null when it can. */
  fun fallGate(): String? {
    if (!service.connected()) return "no watch connected"
    if (!service.supports(DataSyncWire.CAP_CONFIG)) return "the watch does not report DataSync configs (ExpandCapability ${DataSyncWire.CAP_CONFIG})"
    if (!DeviceCaps.supports(0x33, 0x01)) return "the watch does not list SOS support (service 0x33 command 01)"
    return null
  }

  /** Asks the watch for its switch (config 900500038, action 2, no data); the answer arrives in [onFallConfig]. */
  suspend fun queryFall(): Boolean {
    fallGate()?.let {
      log("Fall detection query not sent: $it")
      return false
    }
    return service.sendConfig(
      SafetyPayloads.FALL_PHONE_PKG,
      SafetyPayloads.FALL_WATCH_PKG,
      SafetyPayloads.FALL_CONFIG_ID,
      data = null,
      action = ACTION_QUERY,
      what = "fall detection query",
    )
  }

  /** Sets the watch's switch (action 1 with `{fallDetectionSwitch, timeStamp}`); the stored state follows the watch's own report. */
  suspend fun setFall(enabled: Boolean): Boolean {
    fallGate()?.let { throw WearException(ErrorCodes.UNSUPPORTED, "Fall detection cannot be changed: $it") }
    val now = System.currentTimeMillis()
    val sent = service.sendConfig(
      SafetyPayloads.FALL_PHONE_PKG,
      SafetyPayloads.FALL_WATCH_PKG,
      SafetyPayloads.FALL_CONFIG_ID,
      SafetyPayloads.fallConfig(enabled, now),
      action = ACTION_SET,
      modifyMs = now,
      what = "fall detection ${if (enabled) "on" else "off"}",
    )
    if (sent) {
      // Huawei Health stores what it sent as well; the watch's own report (onFallConfig) overwrites it.
      settings.fallSwitch = if (enabled) 1 else 0
      settings.fallUpdatedMs = now
    }
    return sent
  }

  private fun onFallConfig(config: SampleConfigIn) {
    val item = config.items.firstOrNull()
    if (item == null) {
      log("Fall detection: config from the watch has no item")
      return
    }
    val state = SafetyPayloads.parseFallConfig(item.data)
    if (state == null) {
      log("Fall detection: config from the watch (action ${item.action}) carries no readable fallDetectionSwitch: ${DataSyncService.describe(item.data)}")
      return
    }
    settings.fallSwitch = state.switch
    settings.fallUpdatedMs = if (state.timeStampMs > 0) state.timeStampMs else System.currentTimeMillis()
    log("Fall detection: the watch reports ${if (state.switch == 1) "ON" else "OFF"} (action ${item.action}, timeStamp ${state.timeStampMs})")
  }

  // SOS SMS relay

  /** What the relay would do right now, nothing is sent or logged as an SOS (the Settings test button). */
  fun testRelay(): Map<String, Any?> {
    val readiness = gateway.readiness(settings.sosRelayEnabled)
    log("SOS relay test: ${if (readiness.ready) "an SOS request would be sent as SMS" else "an SOS request would be refused (${readiness.blockers().joinToString("; ")})"}; nothing was sent")
    return mapOf("ready" to readiness.ready, "blockers" to readiness.blockers())
  }

  fun readiness(): SosReadiness = gateway.readiness(settings.sosRelayEnabled)

  private suspend fun onSos(event: SampleEvent) {
    val phone = event.phonePkg
    val watch = event.watchPkg
    when (val parsed = SafetyPayloads.parseSos(event.data)) {
      is SafetyPayloads.SosParse.Bad -> {
        error("SOS: request refused, ${parsed.reason}")
        answer(phone, watch, parsed.raw, false)
      }
      is SafetyPayloads.SosParse.Ok -> {
        val request = parsed.request
        log("SOS: the watch asks to send ${request.content.length} characters to ${SafetyPayloads.maskNumber(request.phoneNumber)}")
        val readiness = gateway.readiness(settings.sosRelayEnabled)
        if (!readiness.ready) {
          error("SOS: no SMS sent, ${readiness.blockers().joinToString("; ")}")
          answer(phone, watch, request.raw, false)
          return
        }
        val result = CompletableDeferred<Pair<Boolean, String>>()
        gateway.send(request.phoneNumber, request.content) { ok, detail -> result.complete(ok to detail) }
        val outcome = withTimeoutOrNull(SMS_TIMEOUT_MS) { result.await() }
        if (outcome == null) {
          error("SOS: no sent report from the SMS service within ${SMS_TIMEOUT_MS / 1000} s, answering failed")
          answer(phone, watch, request.raw, false)
        } else {
          log("SOS: SMS ${if (outcome.first) "sent" else "FAILED"} to ${SafetyPayloads.maskNumber(request.phoneNumber)} (${outcome.second})")
          answer(phone, watch, request.raw, outcome.first)
        }
      }
    }
  }

  private suspend fun answer(phone: String, watch: String, raw: String?, sent: Boolean) {
    service.sendEvent(phone, watch, SafetyPayloads.SOS_EVENT_ID, SafetyPayloads.sosAnswer(raw, sent), what = "SOS SMS result ${if (sent) "0" else "1"}")
  }

  private companion object {
    const val ACTION_SET = 1
    const val ACTION_QUERY = 2
    const val SMS_TIMEOUT_MS = 90_000L
  }
}
