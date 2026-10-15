package com.joyodigitama.huaweiwear

import android.content.Context
import kotlinx.coroutines.CoroutineScope

/**
 * Owner of the four small watch features that ride on DataSync / service 0x32: fall detection and the SOS SMS relay
 * ([SafetyFeatures]), DST answers ([DstFeature]), the morning sleep report ([SleepReportFeature]) and the menstrual
 * calendar ([MenstrualFeature]). [features] are registered with the DataSync framework by `DataSyncFeatures.install`.
 */
internal class WatchExtras(
  context: Context,
  syncStore: SyncStore,
  link: WearLink,
  private val events: WearEvents,
  scope: CoroutineScope,
) {
  val settings = WatchExtrasSettings(context)
  val safety = SafetyFeatures(context, settings, events)
  val dst = DstFeature(events)
  val sleepReport = SleepReportFeature(settings, syncStore, events, scope)
  val menstrual = MenstrualFeature(settings, CycleStore(syncStore), link, events, scope)

  val features: List<DataSyncFeature> = listOf(safety, dst, sleepReport, menstrual)

  /** Called with every link state change (WearRuntime). */
  fun onLinkState(state: LinkState) = menstrual.onLinkState(state)

  /** Called after every stored sync (WearRuntime). */
  fun onSyncComplete(summary: SyncSummary) = sleepReport.onSyncComplete(summary)

  /** The Safety settings screen: what the watch reports, what the phone can do, the switches. */
  fun safetyStatus(): Map<String, Any?> {
    val readiness = safety.readiness()
    val fallGate = safety.fallGate()
    return mapOf(
      "fallSupported" to (fallGate == null),
      "fallNote" to (fallGate ?: "the watch reports fall detection support"),
      "fallSwitch" to settings.fallSwitch,
      "fallUpdatedMs" to settings.fallUpdatedMs,
      // A switch left on by an earlier build still reads off here: the Play build never sends an SMS.
      "sosRelayEnabled" to (settings.sosRelayEnabled && Distribution.canSendSms),
      "smsSupported" to Distribution.canSendSms,
      "smsPermission" to readiness.smsPermission,
      "telephony" to readiness.telephony,
      "simReady" to readiness.simReady,
      "sosReady" to readiness.ready,
      "sosBlockers" to readiness.blockers(),
      "sosListedByWatch" to DeviceCaps.supports(0x33, 0x02),
      "sleepReportEnabled" to settings.sleepReportEnabled,
      "sleepReportSupported" to DeviceCaps.expandCapability(DataSyncWire.CAP_EVENT),
    )
  }
}
