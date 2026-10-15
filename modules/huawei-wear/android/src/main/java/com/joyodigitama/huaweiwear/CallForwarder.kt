// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): externalevents/PhoneCallReceiver (state machine),
// HuaweiSupportProvider.onSetCallState, requests/{SendNotificationRequest.buildNotificationTLVFromCallSpec,
// StopNotificationRequest}, AsynchronousResponse.handleCallControls and service/receivers/GBCallControlReceiver.
package com.joyodigitama.huaweiwear

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Calls
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications

/**
 * Shows incoming phone calls on the watch (Notifications 02/01 with the call type, stopped with the
 * stop/start-call types) and runs the watch's accept/reject answer (Calls 04/01) on the phone.
 * Phone state comes from the manifest [PhoneStateReceiver], so it works with the UI closed. All
 * packets go through one queue so ringing, stop and start-call keep their order.
 */
internal class CallForwarder(
  context: Context,
  private val settings: PhoneFeatureSettings,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val nextMessageId: () -> Short,
) {
  private val appContext = context.applicationContext

  private val queue = Channel<suspend () -> Unit>(Channel.UNLIMITED)

  init {
    scope.launch {
      for (job in queue) {
        try {
          job()
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          log(LogDirection.ERROR, "Call notification failed: ${e.message ?: e.javaClass.simpleName}")
        }
      }
    }
  }

  private val lock = Any()
  private var lastState = TelephonyManager.CALL_STATE_IDLE
  private var number: String? = null

  /** The ringing notification was queued for this call, so the end of the call has to stop it. */
  private var announced = false

  /** Bumped on every state change so a delayed announcement can tell it is stale. */
  private var generation = 0

  private fun log(direction: LogDirection, message: String) = events.log(direction, null, null, null, message)

  private fun granted(permission: String): Boolean =
    appContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  /**
   * One `ACTION_PHONE_STATE_CHANGED` broadcast. Android 9+ sends RINGING twice, the first without
   * the number, and only with READ_CALL_LOG does the second carry one; the announcement waits for it.
   */
  fun onPhoneState(stateName: String, incomingNumber: String?) {
    val state = when (stateName) {
      TelephonyManager.EXTRA_STATE_RINGING -> TelephonyManager.CALL_STATE_RINGING
      TelephonyManager.EXTRA_STATE_OFFHOOK -> TelephonyManager.CALL_STATE_OFFHOOK
      TelephonyManager.EXTRA_STATE_IDLE -> TelephonyManager.CALL_STATE_IDLE
      else -> return
    }
    val enabled = settings.callsEnabled
    var announceNow = false
    var announceLater = 0
    var startCall = false
    var endCall = false
    synchronized(lock) {
      val previous = lastState
      if (state == previous) {
        // The second RINGING broadcast: pick up the number if it came with it.
        if (state == TelephonyManager.CALL_STATE_RINGING && number.isNullOrEmpty() && !incomingNumber.isNullOrEmpty()) {
          number = incomingNumber
          if (enabled && !announced) announceNow = true
        }
        return@synchronized
      }
      lastState = state
      generation++
      when (state) {
        TelephonyManager.CALL_STATE_RINGING -> {
          number = incomingNumber
          if (enabled) {
            if (incomingNumber.isNullOrEmpty() && granted(Manifest.permission.READ_CALL_LOG)) announceLater = generation else announceNow = true
          }
        }
        TelephonyManager.CALL_STATE_OFFHOOK -> {
          if (previous == TelephonyManager.CALL_STATE_RINGING && announced) startCall = true
        }
        else -> {
          if (announced) endCall = true
          announced = false
          number = null
        }
      }
    }
    log(LogDirection.INFO, "Phone call state: $stateName" + if (incomingNumber.isNullOrEmpty()) "" else " (number received)")
    when {
      announceNow -> announce()
      announceLater != 0 -> {
        val expected = announceLater
        scope.launch {
          delay(NUMBER_WAIT_MS)
          val stillRinging = synchronized(lock) { generation == expected && !announced }
          if (stillRinging) announce()
        }
      }
      startCall -> queue.trySend { stopNotification(startCall = true) }
      endCall -> queue.trySend { stopNotification(startCall = false) }
    }
  }

  private fun announce() {
    val callerNumber: String?
    synchronized(lock) {
      if (announced || lastState != TelephonyManager.CALL_STATE_RINGING) return
      announced = true
      callerNumber = number
    }
    queue.trySend {
      val name = withContext(Dispatchers.IO) { contactName(callerNumber) } ?: callerNumber ?: if (Distribution.canIdentifyCaller) UNKNOWN_CALLER else INCOMING_CALL
      sendRinging(name, callerNumber)
    }
  }

  /** GB DeviceCommunicationService.getContactDisplayNameByNumber: the number itself without READ_CONTACTS or a match. */
  private fun contactName(number: String?): String? {
    if (number.isNullOrEmpty() || !granted(Manifest.permission.READ_CONTACTS)) return null
    return try {
      val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
      appContext.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0)?.takeIf { name -> name.isNotBlank() } else null
      }
    } catch (e: SecurityException) {
      null
    }
  }

  /** HuaweiSupportProvider.onSetCallState(CALL_INCOMING): notification type `call`, name as text, number as `flight` text when the watch takes one. */
  private suspend fun sendRinging(name: String, callerNumber: String?) {
    val handle = link.handle()
    if (handle == null) {
      log(LogDirection.INFO, "Incoming call not sent: the watch is not connected")
      return
    }
    val state = handle.notificationState
    if (!state.supportsNotificationAlert) {
      log(LogDirection.INFO, "Incoming call not sent: the watch does not support notifications (02/01)")
      return
    }
    val format = state.contentFormat.toByte()
    val content = ArrayList<Notifications.NotificationActionRequest.TextElement>()
    content.add(Notifications.NotificationActionRequest.TextElement(Notifications.TextType.text.toByte(), format, name))
    if (state.supportsIncomingNumber) {
      content.add(
        Notifications.NotificationActionRequest.TextElement(
          Notifications.TextType.flight.toByte(),
          state.incomingNumberFormat.toByte(),
          callerNumber,
        ),
      )
    }
    val packet = Notifications.NotificationActionRequest(
      handle.session.params,
      nextMessageId(),
      Notifications.NotificationType.call,
      content,
      null,
      null,
    )
    log(LogDirection.INFO, "Incoming call -> watch: \"$name\"")
    handle.session.request(packet, Timeouts.QUERY_MS, "IncomingCall")
  }

  /**
   * HuaweiSupportProvider.onSetCallState(CALL_ACCEPT/CALL_START or CALL_END/CALL_REJECT): the same
   * notification packet with an empty text and the start-call type (ExpandCapability 74) or stop type.
   */
  private suspend fun stopNotification(startCall: Boolean) {
    val handle = link.handle() ?: return
    val type = if (startCall && DeviceCaps.expandCapability(74)) Notifications.NotificationType.startCall else Notifications.NotificationType.stopNotification
    val content = ArrayList<Notifications.NotificationActionRequest.TextElement>()
    content.add(
      Notifications.NotificationActionRequest.TextElement(Notifications.TextType.text.toByte(), handle.notificationState.contentFormat.toByte(), ""),
    )
    val packet = Notifications.NotificationActionRequest(handle.session.params, nextMessageId(), type, content, null, null)
    log(LogDirection.INFO, if (type == Notifications.NotificationType.startCall) "Call answered -> watch: start-call" else "Call ended -> watch: stop notification")
    // GB's StopNotificationRequest has addToResponse = false: nothing waits for a reply.
    handle.session.send(packet, "StopCallNotification")
  }

  /** AsynchronousResponse.handleCallControls + GBCallControlReceiver (TelecomManager, API 28+; the app's minSdk is 29). */
  fun onWatchAnswer(action: Calls.AnswerCallResponse.Action) {
    val accept = when (action) {
      Calls.AnswerCallResponse.Action.CALL_ACCEPT -> true
      Calls.AnswerCallResponse.Action.CALL_REJECT -> false
      else -> {
        log(LogDirection.INFO, "Watch call answer: unknown action")
        return
      }
    }
    val label = if (accept) "accept" else "reject"
    log(LogDirection.INFO, "Watch call answer: $label")
    if (!settings.callControlEnabled) {
      log(LogDirection.INFO, "Call $label from the watch ignored: disabled in settings")
      return
    }
    if (synchronized(lock) { lastState } != TelephonyManager.CALL_STATE_RINGING) {
      log(LogDirection.INFO, "Call $label from the watch ignored: the phone is not ringing")
      return
    }
    if (!granted(Manifest.permission.ANSWER_PHONE_CALLS)) {
      log(LogDirection.ERROR, "Call $label from the watch not done: ANSWER_PHONE_CALLS is not granted")
      return
    }
    try {
      val telecom = appContext.getSystemService(TelecomManager::class.java)
      if (accept) telecom.acceptRingingCall() else telecom.endCall()
      log(LogDirection.INFO, "Call ${label}ed through TelecomManager")
    } catch (e: SecurityException) {
      log(LogDirection.ERROR, "Call $label from the watch: no permission: ${e.message}")
    }
  }

  private companion object {
    /** How long a RINGING without a number waits for the second broadcast that carries it. */
    const val NUMBER_WAIT_MS = 1_500L
    const val UNKNOWN_CALLER = "Unknown caller"

    /** The Google Play build has no READ_CALL_LOG, so Android never hands it the caller. */
    const val INCOMING_CALL = "Incoming call"
  }
}

/** Manifest receiver for `PHONE_STATE`; needs READ_PHONE_STATE (the number extra also READ_CALL_LOG). */
class PhoneStateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
    val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
    @Suppress("DEPRECATION")
    val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
    WearRuntime.get(context).features.calls.onPhoneState(state, number)
  }
}
