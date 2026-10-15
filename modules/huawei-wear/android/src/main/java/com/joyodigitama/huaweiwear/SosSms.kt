package com.joyodigitama.huaweiwear

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import android.telephony.TelephonyManager
import java.util.concurrent.atomic.AtomicInteger

/** What the phone can do about an SOS request right now. */
internal class SosReadiness(
  val relayEnabled: Boolean,
  val smsPermission: Boolean,
  val telephony: Boolean,
  val simReady: Boolean,
  /** False in the Google Play build, whose manifest has no SEND_SMS (see [Distribution]). */
  val buildCanSendSms: Boolean = true,
) {
  /** Every reason the SMS cannot go out, in the order Huawei Health checks them (`nev.onDataReceived`) plus the user switch. */
  fun blockers(): List<String> = buildList {
    if (!buildCanSendSms) add("this version of JoyoFit (Google Play) cannot send text messages")
    if (!relayEnabled) add("the SOS SMS relay is switched off in JoyoFit")
    if (!smsPermission) add("the SEND_SMS permission is not granted")
    if (!telephony) add("this phone has no telephony")
    else if (!simReady) add("the SIM card is not ready")
  }

  val ready: Boolean get() = blockers().isEmpty()
}

/** Collects the per-part results of a multipart SMS (`nev.2` waits for the last part; here every part must succeed). */
internal class SmsDispatchTracker(private val parts: Int, private val onDone: (Boolean) -> Unit) {
  private val reported = BooleanArray(parts)
  private var failed = false
  private var done = false

  /** Records [ok] for part [index] (0-based); the callback runs once, when every part reported or one failed. */
  @Synchronized
  fun onPart(index: Int, ok: Boolean) {
    if (done || index !in 0 until parts) return
    reported[index] = true
    if (!ok) failed = true
    if (failed) {
      finish(false)
    } else if (reported.all { it }) {
      finish(true)
    }
  }

  private fun finish(ok: Boolean) {
    done = true
    onDone(ok)
  }
}

/** The Android side of the SOS relay: readiness and the multipart send. */
internal class SosSmsGateway(context: Context) {
  private val appContext = context.applicationContext
  private val requestIds = AtomicInteger(0)

  fun readiness(relayEnabled: Boolean): SosReadiness {
    val telephony = appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    val manager = appContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    return SosReadiness(
      relayEnabled = relayEnabled,
      smsPermission = appContext.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED,
      telephony = telephony,
      // Huawei Health: TelephonyManager.getSimState() == 5 (SIM_STATE_READY).
      simReady = manager?.simState == TelephonyManager.SIM_STATE_READY,
      buildCanSendSms = Distribution.canSendSms,
    )
  }

  /**
   * Sends [content] to [number] split with `divideMessage`. [onResult] gets true once every part was reported sent,
   * false on the first failure (or an exception). Only call it after [readiness] said ready.
   */
  fun send(number: String, content: String, onResult: (Boolean, String) -> Unit) {
    val manager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      appContext.getSystemService(SmsManager::class.java)
    } else {
      @Suppress("DEPRECATION")
      SmsManager.getDefault()
    }
    val parts = manager.divideMessage(content)
    if (parts == null || parts.isEmpty()) {
      onResult(false, "the message has no parts")
      return
    }
    val id = requestIds.incrementAndGet()
    val action = "$ACTION_PREFIX.$id"
    lateinit var receiver: BroadcastReceiver
    val tracker = SmsDispatchTracker(parts.size) { ok ->
      try {
        appContext.unregisterReceiver(receiver)
      } catch (e: IllegalArgumentException) {
        // Already unregistered.
      }
      onResult(ok, if (ok) "all ${parts.size} part(s) sent" else "a part failed")
    }
    receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val part = intent.getIntExtra(EXTRA_PART, -1)
        val ok = resultCode == Activity.RESULT_OK
        tracker.onPart(part, ok)
        if (!ok) android.util.Log.e("JoyoFit", "SOS SMS part ${part + 1}/${parts.size} result code $resultCode")
      }
    }
    val filter = IntentFilter(action)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      appContext.registerReceiver(receiver, filter)
    }
    try {
      val sentIntents = ArrayList<PendingIntent>(parts.size)
      for (index in parts.indices) {
        val intent = Intent(action).setPackage(appContext.packageName).putExtra(EXTRA_PART, index)
        sentIntents += PendingIntent.getBroadcast(
          appContext,
          id * 1000 + index,
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }
      manager.sendMultipartTextMessage(number, null, parts, sentIntents, null)
    } catch (e: Exception) {
      // SecurityException without SEND_SMS, IllegalArgumentException for a bad number, a dead telephony service.
      try {
        appContext.unregisterReceiver(receiver)
      } catch (ignored: IllegalArgumentException) {
      }
      onResult(false, "${e.javaClass.simpleName}: ${e.message}")
    }
  }

  private companion object {
    const val ACTION_PREFIX = "com.joyodigitama.joyofit.SOS_SMS_SENT"
    const val EXTRA_PART = "part"
  }
}
