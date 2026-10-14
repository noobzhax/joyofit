package com.joyodigitama.huaweiwear

import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Answers the watch's DST query (event 800100020), see [DstPayload]. */
internal class DstFeature(private val events: WearEvents) : DataSyncFeature {
  override val name = "dst"

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  override fun register(service: DataSyncService) {
    service.onEvent(DstPayload.PHONE_PKG, DstPayload.WATCH_PKG, DstPayload.EVENT_ID) { event ->
      if (event.level != 0) {
        log("DST: event ${DstPayload.EVENT_ID} at level ${event.level} ignored (Huawei Health answers level 0 only)")
        return@onEvent
      }
      val zone = ZoneId.systemDefault()
      val payload = DstPayload.build(zone, Instant.now())
      log("DST: the watch asks, zone $zone, answering ${DataSyncService.describe(payload)}")
      service.sendEvent(event.phonePkg, event.watchPkg, DstPayload.EVENT_ID, payload, level = 0, what = "DST answer")
    }
  }
}

/**
 * The morning sleep report (see [SleepReport]): pushed once after the first sync that stored a night ending today.
 * Never sends while the switch is off, the watch lacks ExpandCapability 84 or no watch is connected.
 */
internal class SleepReportFeature(
  private val settings: WatchExtrasSettings,
  private val syncStore: SyncStore,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) : DataSyncFeature {
  override val name = "sleep-report"

  private lateinit var service: DataSyncService

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  override fun register(service: DataSyncService) {
    this.service = service
    service.onEvent(SleepReport.PHONE_PKG, SleepReport.WATCH_PKG, SleepReport.EVENT_ID) { event ->
      val shown = SleepReport.acknowledged(event.data)
      log("Sleep report: the watch answers ${if (shown) "shown" else "NOT shown"} (data ${DataSyncService.describe(event.data)}, level ${event.level})")
    }
  }

  /** After every stored sync (WearRuntime): a night in it may be the one to report. */
  fun onSyncComplete(summary: SyncSummary) {
    if (summary.sleep <= 0) return
    scope.launch {
      try {
        push(force = false)
      } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Sleep report: ${e.message ?: e.javaClass.simpleName}")
      }
    }
  }

  /** The newest night with stages, from the stored segments of the last 36 hours. */
  private suspend fun latestNight(nowSec: Long): SleepNight? = withContext(Dispatchers.IO) {
    val segments = syncStore.read { db ->
      db.rawQuery("SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? ORDER BY start", arrayOf((nowSec - LOOKBACK_SEC).toString())).use { c ->
        buildList { while (c.moveToNext()) add(SleepSegment(c.getLong(0), c.getLong(1), c.getInt(2), if (c.isNull(3)) null else c.getString(3))) }
      }
    }
    SleepReport.lastNight(segments)
  }

  /**
   * Pushes the report for the latest night. [force] skips the once-a-morning rules (the Settings "send now" button) but
   * never the switch-independent hardware gates. Returns a short description of what happened.
   */
  suspend fun push(force: Boolean): String {
    if (!force && !settings.sleepReportEnabled) return decision("switched off in settings")
    if (!service.connected()) return decision("no watch connected")
    if (!service.supports(DataSyncWire.CAP_EVENT)) return decision("the watch does not report DataSync events (ExpandCapability ${DataSyncWire.CAP_EVENT})")
    val zone = ZoneId.systemDefault()
    val nowSec = System.currentTimeMillis() / 1000
    val night = latestNight(nowSec) ?: return decision("no sleep stored in the last ${LOOKBACK_SEC / 3600} h")
    if (!force) {
      SleepReport.shouldPush(night, nowSec, zone, settings.sleepReportLastEnd)?.let { return decision(it) }
    }
    val message = SleepReport.message(night, zone, Locale.getDefault())
    log("Sleep report: sending \"${message.description}\" (night ${night.start}..${night.end}, locale ${message.locale})")
    val sent = service.sendEvent(
      SleepReport.PHONE_PKG,
      SleepReport.WATCH_PKG,
      SleepReport.EVENT_ID,
      SleepReport.payload(message),
      level = 0,
      what = "sleep report",
    )
    if (!sent) return decision("the send failed, see the lines above")
    settings.sleepReportLastEnd = maxOf(settings.sleepReportLastEnd, night.end)
    return "sent"
  }

  private fun decision(reason: String): String {
    log("Sleep report: not sent, $reason")
    return reason
  }

  private companion object {
    const val LOOKBACK_SEC = 36 * 3600L
  }
}
