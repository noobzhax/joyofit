// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.fetchActivityDataP2P.
package com.joyodigitama.huaweiwear

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncInterface

/** What one dictionary sync did: rows stored per metric type, and the metrics that were asked for. */
internal class HealthMetricsResult(val rows: Map<String, Int>, val failed: List<String>) {
  val total: Int get() = rows.values.sum()
}

/**
 * GB `fetchActivityDataP2P`: asks the watch (P2P module `datadictionarysync`, watch package
 * `hw.watch.health.filesync`) for every dictionary class whose ExpandCapability gate is set, one class
 * after the other, and stores the answers in `health_metrics`. Differences from GB: a class the watch does not
 * answer within [CLASS_TIMEOUT_MS] is given up (GB waits forever and keeps the sync flag set), each class has its
 * own request so one silent class does not stop the rest, and the gate decisions are logged and kept in
 * `health_metric_status`.
 */
internal class HealthMetricsSync(
  private val stack: P2pStack,
  private val store: HealthMetricsStore,
  private val events: WearEvents,
) {
  private val caps = HuaweiDictionarySyncInterface.Caps { DeviceCaps.expandCapability(it) }

  /** Gate check only: logs and records which metrics this watch supports, no traffic. */
  fun recordGates(service: HuaweiP2PDataDictionarySyncService = requireNotNull(stack.dictionary)): List<HuaweiDictionarySyncInterface> {
    val supported = ArrayList<HuaweiDictionarySyncInterface>()
    for (handler in service.syncHandlers) {
      val ok = handler.supports(caps)
      log("Health metric ${handler.title} (dictionary class ${handler.dataClass}): gate ${handler.describeGate()} = $ok -> ${if (ok) "will sync" else "skipped, the watch does not support it"}")
      try {
        store.setStatus(
          handler.metricType,
          handler.dataClass,
          handler.title,
          ok,
          handler.describeGate(),
          if (ok) null else "Not supported by this watch (${handler.describeGate()} is not set).",
        )
      } catch (e: android.database.sqlite.SQLiteException) {
        log("Health metric status not stored: ${e.message}", error = true)
      }
      if (ok) supported.add(handler)
    }
    return supported
  }

  suspend fun sync(): HealthMetricsResult? {
    val service = stack.dictionary
    if (service == null) {
      log("Health metrics: the P2P service is not available on this watch (no 34/01 in SupportedCommands); skipped")
      return null
    }
    val handlers = recordGates(service)
    if (handlers.isEmpty()) {
      log("Health metrics: the watch supports none of the dictionary classes")
      return HealthMetricsResult(emptyMap(), emptyList())
    }
    // The ping sent at registration may still be in flight when a sync starts right after connect.
    val ready = withTimeoutOrNull(PING_WAIT_MS) {
      while (!service.isAvailable) delay(POLL_MS)
      true
    }
    if (ready != true) {
      val ping = stack.dictionaryPing
      log(
        "Health metrics: the watch app hw.watch.health.filesync is not available (ping " +
          (if (ping == null) "not answered within ${PING_WAIT_MS} ms" else "answered 0x%02x, 0xca needed".format(ping and 0xFF)) + "); skipped",
        error = true,
      )
      for (h in handlers) {
        store.setStatus(h.metricType, h.dataClass, h.title, true, h.describeGate(), "The watch app did not answer the P2P ping; nothing synced.", rowsAdded = null)
      }
      return HealthMetricsResult(emptyMap(), handlers.map { it.metricType })
    }

    val rows = LinkedHashMap<String, Int>()
    val failed = ArrayList<String>()
    for (handler in handlers) {
      val added = AtomicInteger(0)
      val done = CompletableDeferred<Boolean>()
      val counting = object : HuaweiDictionarySyncInterface.Store by store {
        override fun persist(rows: MutableList<HuaweiDictionarySyncInterface.Row>) {
          store.persist(rows)
          added.addAndGet(rows.size)
        }
      }
      log("Health metrics: syncing ${handler.title} (class ${handler.dataClass}) from ${handler.getLastDataSyncTimestamp(store)} ms")
      service.startSync(
        listOf(handler.dataClass),
        object : HuaweiP2PDataDictionarySyncService.DictionarySyncCallback {
          override fun onGetLastDataSyncTimestamp(dictClass: Int): Long = handler.getLastDataSyncTimestamp(store)

          override fun onData(dictClass: Int, dictData: MutableList<HuaweiP2PDataDictionarySyncService.DictData>) {
            log("Health metrics: ${handler.title}: ${dictData.size} entries")
            handler.handleData(counting, dictData)
          }

          override fun onComplete(complete: Boolean) {
            done.complete(complete)
          }
        },
      )
      val outcome = withTimeoutOrNull(CLASS_TIMEOUT_MS) { done.await() }
      if (outcome == null) {
        service.cancelSync()
        log("Health metrics: ${handler.title}: the watch did not finish within ${CLASS_TIMEOUT_MS / 1000} s; given up", error = true)
        failed.add(handler.metricType)
      } else if (!outcome) {
        failed.add(handler.metricType)
      }
      rows[handler.metricType] = added.get()
      val note = when {
        outcome == null -> "The watch did not answer within ${CLASS_TIMEOUT_MS / 1000} s."
        !outcome -> "The sync of this class ended with an error (see the log)."
        added.get() == 0 -> "The watch had no new entries."
        else -> null
      }
      store.setStatus(handler.metricType, handler.dataClass, handler.title, true, handler.describeGate(), note, rowsAdded = added.get())
      log("Health metrics: ${handler.title}: ${added.get()} rows stored" + (if (note != null) " ($note)" else ""))
    }
    return HealthMetricsResult(rows, failed)
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, 0x34, 0x01, null, message)

  companion object {
    /** How long a class may take to answer before it is given up. */
    const val CLASS_TIMEOUT_MS = 15_000L

    /** How long a sync waits for the registration ping to be answered. */
    const val PING_WAIT_MS = 6_000L

    private const val POLL_MS = 100L
  }
}
