package com.joyodigitama.huaweiwear

import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/** What [WatchfaceCustomizer.apply] reports: what was sent, what the watch holds afterwards and where they differ. */
internal class FaceApplyResult(
  /** The watch's configuration read back after the apply; null when the read-back got no answer. */
  val config: FaceCustomization?,
  /** The watch pushed its own report for the face right after the apply (Huawei Health's only ack). */
  val echoed: Boolean,
  /** Parts of the request that the read-back does not show; empty when everything stuck. */
  val mismatches: List<String>,
  val message: String,
) {
  val ok: Boolean get() = config != null && mismatches.isEmpty()

  fun toJs(): Map<String, Any?> = mapOf(
    "ok" to ok,
    "echoed" to echoed,
    "mismatches" to mismatches,
    "message" to message,
    "config" to config?.toJs(),
  )
}

/**
 * Editable watch-face configuration (`hw.app.watchface.custom` <-> `hw.watch.watchface.custom`, DataSync events 800100008 and
 * 800100009). Huawei Health (`CustomConfigWatchFaceService`) sends the query `{01 marketId}`; the watch answers, and also pushes,
 * an 800100009 report with the face's current selections. Applying is the same 800100009 sent by the phone. The marketId is the face's id
 * from the watch's face list (`WatchFaceWearService.handleWatchFaceTransferSuccess` compares it with the 27/05 report's face id).
 *
 * The watch reports only the selected index of each option, not how many options exist: Huawei Health's own editor is an H5 page
 * of the face that knows its option lists (`WatchFaceCallback.queryCustomConfig` just relays the watch's report to that page).
 */
internal class WatchfaceCustomizer(
  private val events: WearEvents,
  /** The watch's face list, to check that the id is installed; null when it could not be read. */
  private val faces: suspend () -> List<WatchfaceEntry>?,
  private val queryTimeoutMs: Long = QUERY_TIMEOUT_MS,
  private val echoWaitMs: Long = ECHO_WAIT_MS,
) : DataSyncFeature {
  override val name = "watch face customization"

  private class Waiter(val marketId: String) {
    val result = CompletableDeferred<FaceCustomization>()
  }

  private val waiters = CopyOnWriteArrayList<Waiter>()
  private lateinit var service: DataSyncService

  override fun register(service: DataSyncService) {
    this.service = service
    service.onEvent(FaceCustomWire.PHONE_PKG, FaceCustomWire.WATCH_PKG, FaceCustomWire.EVENT_REPORT) { onReport(it) }
  }

  /** The watch's 800100009: the reply to a query, the echo of an apply, or the user editing the face on the watch. */
  private fun onReport(event: SampleEvent) {
    val data = event.data
    if (data == null) {
      log("report from the watch has no data")
      return
    }
    val config = FaceCustomWire.decode(data)
    if (config == null) {
      error("report from the watch could not be read: ${DataSyncService.describe(data)}")
      return
    }
    val waiting = waiters.filter { it.marketId == config.marketId }
    log("report from the watch for ${config.describe()} (${if (waiting.isEmpty()) "pushed, nobody asked" else "answers ${waiting.size} waiting request(s)"})")
    waiting.forEach { it.result.complete(config) }
    if (waiting.isEmpty()) events.faceCustomization(config.toJs())
  }

  /** The 800100008 query: the face's current configuration. Throws when the watch is not ready, or does not answer in time. */
  suspend fun query(faceId: String): FaceCustomization {
    gate("query", faceId)
    checkInstalled("query", faceId)
    return readConfig(faceId)
  }

  private suspend fun readConfig(faceId: String): FaceCustomization {
    val waiter = Waiter(faceId)
    waiters += waiter
    try {
      send("query", FaceCustomWire.EVENT_QUERY, FaceCustomWire.encodeQuery(faceId), faceId)
      val config = withTimeoutOrNull(queryTimeoutMs) { waiter.result.await() }
      if (config == null) {
        error("query $faceId: no report within ${queryTimeoutMs} ms")
        throw WearException(
          ErrorCodes.TIMEOUT,
          "The watch did not report a configuration for face $faceId. It is probably not a face with editable options.",
        )
      }
      return config
    } finally {
      waiters -= waiter
    }
  }

  /**
   * The 800100009 apply, then a query to read back what the watch holds. Nothing in Huawei Health acknowledges the apply
   * except the 27/05 report it uses to finish its install flow, so the read-back is the only proof here.
   */
  suspend fun apply(faceId: String, config: FaceCustomization): FaceApplyResult {
    if (config.marketId != faceId) throw WearException(ErrorCodes.INVALID_ARGUMENT, "The configuration is for face ${config.marketId}, not $faceId")
    val data = try {
      FaceCustomWire.encodeConfig(config)
    } catch (e: IllegalArgumentException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, e.message ?: "Invalid face configuration")
    }
    gate("apply", faceId)
    checkInstalled("apply", faceId)
    val echo = Waiter(faceId)
    waiters += echo
    val echoed = try {
      send("apply", FaceCustomWire.EVENT_REPORT, data, faceId)
      withTimeoutOrNull(echoWaitMs) { echo.result.await() } != null
    } finally {
      waiters -= echo
    }
    log("apply $faceId: ${if (echoed) "the watch pushed a report" else "no push from the watch within $echoWaitMs ms"}, reading back")
    val after = try {
      readConfig(faceId)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      error("apply $faceId: read-back failed: ${e.message}")
      return FaceApplyResult(null, echoed, emptyList(), "Sent, but the watch did not answer the read-back, so nothing is confirmed.")
    }
    val mismatches = differences(config, after)
    val message = if (mismatches.isEmpty()) "The watch now reports the requested configuration." else "The watch did not take: ${mismatches.joinToString("; ")}."
    log("apply $faceId: $message")
    return FaceApplyResult(after, echoed, mismatches, message)
  }

  private fun gate(operation: String, faceId: String) {
    if (faceId.isEmpty()) throw WearException(ErrorCodes.INVALID_ARGUMENT, "A face id is required")
    if (!service.connected()) {
      log("$operation $faceId: refused, no connected watch")
      throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    }
    val bit = FaceCustomWire.CAP_EVENT
    val supported = service.supports(bit)
    log("$operation $faceId: ExpandCapability $bit (DataSync events) ${if (supported) "set" else "NOT set"}")
    if (!supported) {
      throw WearException(ErrorCodes.UNSUPPORTED, "This watch does not report ExpandCapability $bit, the one Huawei Health requires to send DataSync events.")
    }
  }

  /** Checks the id against the watch's face list. A face the list does not show is refused; flags are only logged (Huawei Health never reads them here). */
  private suspend fun checkInstalled(operation: String, faceId: String) {
    val list = try {
      faces()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      log("$operation $faceId: face list unreadable (${e.message ?: e.javaClass.simpleName}), not checked")
      return
    }
    if (list == null) {
      log("$operation $faceId: face list unreadable, not checked")
      return
    }
    val face = list.firstOrNull { it.id == faceId }
    if (face == null) {
      log("$operation $faceId: not in the watch's face list (${list.size} faces), refused")
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "Face $faceId is not installed on the watch")
    }
    log("$operation $faceId: in the face list as '${face.name}' type=${face.type} (editable flag ${face.isEditable}, factory ${face.isFactory}) expandedType=${face.expandedType}")
  }

  private suspend fun send(what: String, eventId: Int, data: ByteArray, faceId: String) {
    val sent = service.sendEvent(
      FaceCustomWire.PHONE_PKG, FaceCustomWire.WATCH_PKG, eventId, data,
      what = "face customization $what $faceId",
    )
    if (!sent) throw WearException(ErrorCodes.DISCONNECTED, "The $what for face $faceId could not be sent. See the log for the reason.")
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "FaceCustom: $message")

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, "FaceCustom: $message")

  companion object {
    const val QUERY_TIMEOUT_MS = 6_000L
    const val ECHO_WAIT_MS = 2_500L

    /**
     * What of [wanted] [actual] does not show. A mode, the colour or a custom colour that was not requested is not compared. Scale is
     * written under modes 2 and 3 by Huawei Health; both are compared when requested.
     */
    fun differences(wanted: FaceCustomization, actual: FaceCustomization): List<String> {
      val out = ArrayList<String>()
      for (style in wanted.styles) {
        val got = actual.style(style.mode)
        if (got != style.index) out += "${FaceEditMode.name(style.mode)} is ${got ?: "not reported"}, wanted ${style.index}"
      }
      if (wanted.colourIndex != null && wanted.colourIndex != actual.colourIndex) out += "colour is ${actual.colourIndex ?: "not reported"}, wanted ${wanted.colourIndex}"
      if (wanted.customColour != null && wanted.customColour != actual.customColour) out += "custom colour is ${actual.customColour ?: "not reported"}, wanted ${wanted.customColour}"
      wanted.widgets.forEachIndexed { slot, option ->
        val got = actual.widgets.getOrNull(slot)
        if (got != option) out += "widget $slot is ${got ?: "not reported"}, wanted $option"
      }
      return out
    }
  }
}
