// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/AsynchronousResponse.{handleFindPhone,
// handleCallControls}, HuaweiSupportProvider.{onFindDevice,onStopFindPhone,onSetAlarms}, requests/StopFindPhoneRequest and
// datasync/HuaweiDataSyncFindDevice.
package com.joyodigitama.huaweiwear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Calls
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DataSync
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FindPhone
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.datasync.HuaweiDataSyncCommon

/**
 * Find my watch / find my phone, incoming calls and alarms: everything the phone does for the
 * watch outside sync and notifications. Hooks the watch-initiated packets (FindPhone 0B/01, Calls
 * 04/01, DataSync 37/01) on each new session and works without JS, from the background service.
 */
internal class PhoneFeatures(
  context: Context,
  val settings: PhoneFeatureSettings,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  nextMessageId: () -> Short,
) {
  private val appContext = context.applicationContext
  private val alert = FindPhoneAlert(appContext, events)
  val calls = CallForwarder(appContext, settings, link, events, scope, nextMessageId)

  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  /** Called with every link state change: subscribes on the live session, drops the subscriptions when it is gone. */
  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        if (session === attached) return
        detach()
        attached = session
        subscriptions += session.subscribe(FindPhone.id, FindPhone.Response.id, "find phone") { onFindPhone(it) }
        subscriptions += session.subscribe(Calls.id, Calls.AnswerCallResponse.id, "call answer") { onCallAnswer(it) }
        // DataSync (37) packets, including the find-device replies, are handled by DataSyncService.
      }
      LinkState.DISCONNECTED -> detach()
      else -> Unit
    }
  }

  private fun detach() {
    subscriptions.forEach { it.close() }
    subscriptions.clear()
    attached = null
  }

  // Find my phone (watch -> phone)

  /** AsynchronousResponse.handleFindPhone. Runs on the read thread: parse, then hand off. */
  private fun onFindPhone(packet: HuaweiPacket) {
    val start = try {
      packet.parseTlv()
      (packet as FindPhone.Response).start
    } catch (e: Exception) {
      error("Find phone: could not parse the watch's packet: ${e.message}")
      return
    }
    scope.launch {
      if (!settings.findPhoneEnabled) {
        log("Find phone ${if (start) "start" else "stop"} from the watch ignored: disabled in settings")
        return@launch
      }
      if (start) {
        if (alert.start()) log("Find phone: started by the watch") else log("Find phone: start from the watch while already ringing")
      } else {
        stopFindPhone("Stop from the watch")
      }
    }
  }

  /**
   * Ends the alert and, like GB (FindPhoneActivity.onDestroy -> onFindPhone(false) ->
   * StopFindPhoneRequest 0B/02 with tag 01 = 2), tells the watch, whoever ended it.
   */
  fun stopFindPhone(reason: String) {
    if (!alert.stop()) return
    log("Find phone: stopped ($reason)")
    scope.launch {
      val handle = link.handle() ?: return@launch
      try {
        handle.session.send(FindPhone.StopRequest(handle.session.params), "FindPhoneStop")
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Find phone: stop not sent to the watch: ${e.message}")
      }
    }
  }

  // Calls

  private fun onCallAnswer(packet: HuaweiPacket) {
    val action = try {
      packet.parseTlv()
      (packet as Calls.AnswerCallResponse).action
    } catch (e: Exception) {
      error("Call answer: could not parse the watch's packet: ${e.message}")
      return
    }
    scope.launch { calls.onWatchAnswer(action) }
  }

  // Find my watch (phone -> watch)

  /**
   * HuaweiDataSyncFindDevice.sendStartFindDevice / sendStopFindDevice: DataSync (37) config command
   * 01 from package `hw.unitedevice.finddevice` to `findDevice`, config id 900100002, action 2 to
   * start and 1 to stop. GB registers this only with ExpandCapability 79 and sends config commands
   * only with ExpandCapability 83.
   */
  suspend fun findWatch(start: Boolean) {
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    if (!DeviceCaps.expandCapability(FIND_DEVICE_CAPABILITY)) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not report find-device support (ExpandCapability $FIND_DEVICE_CAPABILITY)")
    }
    if (!DeviceCaps.expandCapability(CONFIG_COMMAND_CAPABILITY)) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not report DataSync config commands (ExpandCapability $CONFIG_COMMAND_CAPABILITY)")
    }
    val config = HuaweiDataSyncCommon.ConfigData()
    config.configId = FIND_DEVICE_CONFIG_ID
    config.configAction = (if (start) 2 else 1).toByte()
    val data = HuaweiDataSyncCommon.ConfigCommandData()
    data.configDataList = listOf(config)
    val packet = DataSync.ConfigCommand.Request(handle.session.params, FIND_DEVICE_SRC_PACKAGE, FIND_DEVICE_DST_PACKAGE, data)
    log("Find watch: ${if (start) "start" else "stop"}")
    // GB's SendDataSyncConfigCommand has addToResponse = false: the reply is only logged, by DataSyncService (the one 0x37 subscriber).
    handle.session.send(packet, "FindWatch ${if (start) "start" else "stop"}")
  }

  // Alarms

  /** The alarms last read from or pushed to the watch; empty before the first exchange. */
  fun cachedAlarms(): WatchAlarms = WatchAlarms.fromJson(settings.alarmsJson)

  suspend fun refreshAlarms(): WatchAlarms {
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    val alarms = AlarmSync.read(handle.session, events)
    settings.alarmsJson = alarms.toJson()
    return alarms
  }

  /** Pushes [alarms] and returns what the watch holds afterwards (read back, so a missing acknowledgment is visible). */
  suspend fun setAlarms(alarms: WatchAlarms): WatchAlarms {
    AlarmSync.validate(alarms)
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    AlarmSync.write(handle.session, events, alarms)
    return refreshAlarms()
  }

  // Settings and permissions, for JS

  private fun granted(permission: String): Boolean =
    appContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  fun status(): Map<String, Any?> = mapOf(
    "findPhoneEnabled" to settings.findPhoneEnabled,
    "callsEnabled" to settings.callsEnabled,
    "callControlEnabled" to settings.callControlEnabled,
    "readPhoneState" to granted(Manifest.permission.READ_PHONE_STATE),
    "readCallLog" to granted(Manifest.permission.READ_CALL_LOG),
    "readContacts" to granted(Manifest.permission.READ_CONTACTS),
    "callerIdSupported" to Distribution.canIdentifyCaller,
    "answerPhoneCalls" to granted(Manifest.permission.ANSWER_PHONE_CALLS),
    // Only known once a watch is connected and has reported its capabilities.
    "findWatchSupported" to (DeviceCaps.expandCapability(FIND_DEVICE_CAPABILITY) && DeviceCaps.expandCapability(CONFIG_COMMAND_CAPABILITY)),
  )

  companion object {
    /** HuaweiState.supportsFindDeviceAbility. */
    const val FIND_DEVICE_CAPABILITY = 79

    /** HuaweiState.supportsDeviceCommandConfig. */
    const val CONFIG_COMMAND_CAPABILITY = 83

    const val FIND_DEVICE_CONFIG_ID = 900100002
    const val FIND_DEVICE_SRC_PACKAGE = "hw.unitedevice.finddevice"
    const val FIND_DEVICE_DST_PACKAGE = "findDevice"
  }
}
