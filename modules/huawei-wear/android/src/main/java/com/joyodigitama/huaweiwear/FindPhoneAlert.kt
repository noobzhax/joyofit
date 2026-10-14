// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): activities/FindPhoneActivity (ringtone on the alarm
// stream at maximum volume, vibration loop, volume restored afterwards) and GBDeviceEventFindPhone (high-priority notification).
package com.joyodigitama.huaweiwear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * What "find my phone" does on the phone: a looping ringtone on the alarm stream at maximum volume
 * (the previous alarm volume is restored), a vibration loop, and a high-priority notification whose
 * Stop action ends it. Runs from the background service; no activity or JS is involved.
 */
internal class FindPhoneAlert(context: Context, private val events: WearEvents) {
  private val appContext = context.applicationContext
  private var player: MediaPlayer? = null
  private var userVolume = -1
  private var active = false

  @Synchronized
  fun isActive(): Boolean = active

  /** Returns false when it was already running. */
  @Synchronized
  fun start(): Boolean {
    if (active) return false
    active = true
    playRingtone()
    vibrate()
    notifyUser()
    return true
  }

  /** Returns false when nothing was running. */
  @Synchronized
  fun stop(): Boolean {
    if (!active) return false
    active = false
    stopSound()
    vibrator()?.cancel()
    appContext.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    return true
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun playRingtone() {
    val audio = appContext.getSystemService(AudioManager::class.java)
    userVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val candidates = listOfNotNull(
      RingtoneManager.getActualDefaultRingtoneUri(appContext, RingtoneManager.TYPE_RINGTONE),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
    )
    for (uri in candidates) {
      val next = MediaPlayer()
      try {
        next.setAudioAttributes(attributes)
        next.setDataSource(appContext, uri)
        next.isLooping = true
        next.prepare()
        try {
          audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        } catch (e: SecurityException) {
          log("Find phone: could not raise the alarm volume: ${e.message}")
        }
        next.start()
        player = next
        log("Find phone: ringing with $uri, alarm volume $userVolume -> ${audio.getStreamVolume(AudioManager.STREAM_ALARM)}")
        return
      } catch (e: Exception) {
        next.release()
        log("Find phone: ringtone $uri failed: ${e.message ?: e.javaClass.simpleName}")
      }
    }
    log("Find phone: no ringtone could be played; vibration and notification only")
  }

  private fun stopSound() {
    player?.let {
      try {
        it.stop()
      } catch (e: IllegalStateException) {
        // Not started; release below.
      }
      it.release()
    }
    player = null
    if (userVolume >= 0) {
      try {
        appContext.getSystemService(AudioManager::class.java).setStreamVolume(AudioManager.STREAM_ALARM, userVolume, 0)
      } catch (e: SecurityException) {
        log("Find phone: could not restore the alarm volume: ${e.message}")
      }
      userVolume = -1
    }
  }

  private fun vibrator(): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) appContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
    else @Suppress("DEPRECATION") appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

  @Suppress("DEPRECATION")
  private fun vibrate() {
    val vibrator = vibrator() ?: return
    // Alarm usage so the vibration is allowed while the app is in the background.
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
    vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 1000, 1000), 0), attributes)
  }

  private fun notifyUser() {
    val manager = appContext.getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(CHANNEL_ID, "Find my phone", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Rings while the watch is looking for this phone"
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
    val stop = PendingIntent.getBroadcast(
      appContext,
      0,
      Intent(appContext, FindPhoneStopReceiver::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val open = appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)?.let {
      PendingIntent.getActivity(appContext, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification = Notification.Builder(appContext, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_joyofit)
      .setColor(appContext.getColor(R.color.joyofit_notification_accent))
      .setContentTitle("Your watch is looking for this phone")
      .setContentText("Tap Stop to silence it")
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setContentIntent(open)
      .addAction(Notification.Action.Builder(null, "Stop", stop).build())
      .build()
    manager.notify(NOTIFICATION_ID, notification)
  }

  companion object {
    const val CHANNEL_ID = "watch_find_phone"
    const val NOTIFICATION_ID = 4102
    const val ACTION_STOP = "com.joyodigitama.huaweiwear.FIND_PHONE_STOP"
  }
}

/** The Stop action of the find-my-phone notification. */
class FindPhoneStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != FindPhoneAlert.ACTION_STOP) return
    WearRuntime.get(context).features.stopFindPhone("Stop pressed on the phone")
  }
}
