package com.joyodigitama.huaweiwear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One stored `hrv_readings` night row. */
internal class NightHrvRow(val start: Long, val end: Long, val rmssd: Double)

/** The text of the daily summary and the day it belongs to. */
internal class MorningSummaryPlan(val day: String, val text: String)

/**
 * The once-a-day "Morning summary" notification. Only facts that need no scoring are used: last night's time asleep and,
 * when a night HRV row exists, its RMSSD next to the mean of the earlier nights. Recovery, readiness and strain stay in the app.
 */
internal object MorningSummary {
  const val CHANNEL_ID = "morning_summary"
  /** 4101 service, 4102 find phone, 4103 live workout. */
  const val NOTIFICATION_ID = 4104
  const val DEEP_LINK = "joyofit://readiness"

  /** Sleep that ended less than this long ago may still be going on, so it is not summarised yet. */
  const val SETTLE_SEC = 15 * 60L

  /** Earlier nights older than this do not count towards "usual". */
  const val BASELINE_DAYS = 30L

  /** "Usual" needs at least this many earlier nights; fewer is not a usual. */
  const val MIN_BASELINE_NIGHTS = 3

  /** How far back sleep is read: enough to see a night that ended today. */
  const val SLEEP_LOOKBACK_SEC = 36 * 3600L

  /**
   * The summary to post now, or null when there is nothing to say yet: already posted today, no night of at least
   * [SleepReport.MIN_NIGHT_SEC] asleep that ended today, or that sleep ended moments ago.
   */
  fun plan(
    segments: List<SleepSegment>,
    hrv: List<NightHrvRow>,
    lastPostedDay: String?,
    nowSec: Long,
    zone: ZoneId,
  ): MorningSummaryPlan? {
    val today = Instant.ofEpochSecond(nowSec).atZone(zone).toLocalDate()
    val day = today.toString()
    if (lastPostedDay == day) return null
    val midnight = today.atStartOfDay(zone).toEpochSecond()
    val night = NightHrv.nights(segments)
      .filter { it.end >= midnight && it.asleepSec >= SleepReport.MIN_NIGHT_SEC && nowSec - it.end >= SETTLE_SEC }
      .maxByOrNull { it.end } ?: return null

    val parts = ArrayList<String>()
    parts.add("Slept ${duration(night.asleepSec)}.")
    val thisNight = hrv.filter { it.start <= night.end && it.end >= night.start }.maxByOrNull { it.end }
    if (thisNight != null) {
      val earlier = hrv.filter { it.end < night.start && it.end >= night.start - BASELINE_DAYS * 86400 }
      parts.add(
        if (earlier.size >= MIN_BASELINE_NIGHTS) {
          "HRV ${thisNight.rmssd.roundHalfUp()} ms, usual ${earlier.map { it.rmssd }.average().roundHalfUp()}."
        } else {
          "HRV ${thisNight.rmssd.roundHalfUp()} ms."
        },
      )
    }
    parts.add("Open JoyoFit for today's recovery.")
    return MorningSummaryPlan(day, parts.joinToString(" "))
  }

  fun duration(sec: Long): String {
    val minutes = sec / 60
    val h = minutes / 60
    val m = minutes % 60
    return when {
      h == 0L -> "$m min"
      else -> "$h h $m min"
    }
  }

  private fun Double.roundHalfUp(): Long = Math.floor(this + 0.5).toLong()

  /** Reads the stored rows, and when [plan] has something to say and notifications are allowed, posts it and remembers the day. */
  suspend fun postIfDue(context: Context, settings: WearSettings, store: SyncStore, events: WearEvents) {
    if (!settings.morningSummaryEnabled) return
    val nowSec = System.currentTimeMillis() / 1000
    val (segments, hrv) = withContext(Dispatchers.IO) {
      store.read { db ->
        val segs = ArrayList<SleepSegment>()
        db.rawQuery(
          "SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? ORDER BY start",
          arrayOf((nowSec - SLEEP_LOOKBACK_SEC).toString()),
        ).use { c ->
          while (c.moveToNext()) segs.add(SleepSegment(c.getLong(0), c.getLong(1), c.getInt(2), if (c.isNull(3)) null else c.getString(3)))
        }
        val rows = ArrayList<NightHrvRow>()
        db.rawQuery(
          "SELECT start, end, rmssd FROM hrv_readings WHERE source = 'night' AND rmssd IS NOT NULL AND end >= ? ORDER BY end",
          arrayOf((nowSec - (SLEEP_LOOKBACK_SEC + BASELINE_DAYS * 86400)).toString()),
        ).use { c ->
          while (c.moveToNext()) rows.add(NightHrvRow(c.getLong(0), c.getLong(1), c.getDouble(2)))
        }
        segs to rows
      }
    }
    val plan = plan(segments, hrv, settings.morningSummaryDay, nowSec, ZoneId.systemDefault())
    if (plan == null) {
      events.log(LogDirection.INFO, null, null, null, "Morning summary: nothing to post yet (last posted ${settings.morningSummaryDay ?: "never"})")
      return
    }
    val manager = context.getSystemService(NotificationManager::class.java)
    if (!manager.areNotificationsEnabled()) {
      events.log(LogDirection.INFO, null, null, null, "Morning summary: notifications are off for this app, not posted")
      return
    }
    post(context, manager, plan.text)
    settings.morningSummaryDay = plan.day
    events.log(LogDirection.INFO, null, null, null, "Morning summary: posted for ${plan.day}: ${plan.text}")
  }

  private fun post(context: Context, manager: NotificationManager, text: String) {
    val channel = NotificationChannel(CHANNEL_ID, "Morning summary", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Last night's sleep and HRV, once a morning"
    }
    manager.createNotificationChannel(channel)
    val open = PendingIntent.getActivity(
      context,
      0,
      Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).setPackage(context.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val notification = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_joyofit)
      .setColor(context.getColor(R.color.joyofit_notification_accent))
      .setContentTitle("Morning summary")
      .setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text))
      .setCategory(Notification.CATEGORY_STATUS)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    manager.notify(NOTIFICATION_ID, notification)
  }
}
