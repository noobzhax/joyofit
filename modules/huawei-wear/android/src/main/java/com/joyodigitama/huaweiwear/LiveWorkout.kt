package com.joyodigitama.huaweiwear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import java.time.LocalDate
import java.util.Locale
import kotlin.math.roundToInt

/**
 * A workout started on the watch, followed live on the phone (Huawei Health's reverse linkage, [LiveWorkoutWire]). The
 * watch announces the workout and pushes its numbers by itself; this class answers the watch's start / stop / resume
 * requests, keeps the latest numbers with JoyoFit's fat and carbohydrate estimate ([SubstrateEstimator]), shows them in an
 * ongoing notification that opens the live screen, and reports every change to JS (`onLiveWorkout`).
 */
internal class LiveWorkout(
  context: Context,
  private val dataSync: DataSyncService,
  private val events: WearEvents,
  private val settings: WearSettings,
) : DataSyncFeature {
  override val name = "live workout"

  enum class Status(val wire: String) { PREPARING("preparing"), RUNNING("running"), PAUSED("paused"), ENDED("ended") }

  private class Session(
    val id: Long,
    var sportType: Int?,
    var status: Status,
    var metrics: LiveMetrics,
    val estimator: SubstrateEstimator,
    val maxHeartRate: Int,
    var updatedAtMs: Long,
    var endedAtMs: Long? = null,
  )

  private val appContext = context.applicationContext
  private val lock = Any()
  private var session: Session? = null
  private var notifiedAtMs = 0L
  private var notifiedStatus: Status? = null

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  override fun register(service: DataSyncService) {
    service.onEvent(LiveWorkoutWire.PHONE_PKG, LiveWorkoutWire.WATCH_PKG, null) { onEvent(it) }
    service.onPoint(LiveWorkoutWire.PHONE_PKG, LiveWorkoutWire.WATCH_PKG, null) { onPoint(it) }
  }

  /** The current or last workout for JS (`getLiveWorkout`), null when none was seen since the app started. */
  fun snapshot(): Map<String, Any?>? = synchronized(lock) { session?.let { toJs(it) } }

  /** The user closed the finished workout on the phone. */
  fun dismiss() {
    synchronized(lock) {
      if (session?.status == Status.ENDED) session = null
    }
    cancelNotification()
  }

  private suspend fun onEvent(event: SampleEvent) {
    when (event.eventId) {
      LiveWorkoutWire.EVENT_CONTROL -> onControl(LiveWorkoutWire.parseControl(event.data))
      LiveWorkoutWire.EVENT_START -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.RUNNING, "started")
      LiveWorkoutWire.EVENT_PAUSE -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.PAUSED, "paused")
      LiveWorkoutWire.EVENT_RESUME -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.RUNNING, "resumed")
      LiveWorkoutWire.EVENT_STOP -> change(LiveWorkoutWire.parseWorkoutType(event.data), Status.ENDED, "stopped")
      else -> log("Live workout: event ${event.eventId} not handled, data=${DataSyncService.describe(event.data)}")
    }
  }

  private suspend fun onControl(control: LiveWorkoutWire.Control) {
    log("Live workout: control op=${control.operation} type=${control.workoutType} status=${control.status}")
    val watchStatus = when (control.status) {
      LiveWorkoutWire.WATCH_RUNNING -> Status.RUNNING
      LiveWorkoutWire.WATCH_PAUSED -> Status.PAUSED
      else -> Status.PREPARING
    }
    when (control.operation) {
      LiveWorkoutWire.OP_START -> {
        // A new workout on the watch: always a fresh session, even if the last one never saw its stop.
        synchronized(lock) { session = newSession(control.workoutType, watchStatus) }
        publish(force = true)
        reply(LiveWorkoutWire.OP_START, "start")
      }
      LiveWorkoutWire.OP_RESUME -> {
        // The watch picks the phone up again (after a reconnect) with its current state.
        val status = if (control.status == LiveWorkoutWire.WATCH_PAUSED) Status.PAUSED else Status.RUNNING
        change(control.workoutType, status, "linked again")
        reply(LiveWorkoutWire.OP_RESUME, "resume")
      }
      LiveWorkoutWire.OP_STOP -> {
        change(control.workoutType, Status.ENDED, "stopped (control)")
        reply(LiveWorkoutWire.OP_STOP, "stop")
      }
      LiveWorkoutWire.OP_REPORT -> log("Live workout: watch reports linkage status ${control.status}")
      else -> log("Live workout: unknown control operation ${control.operation}")
    }
  }

  private suspend fun reply(operation: Int, what: String) {
    dataSync.sendEvent(
      LiveWorkoutWire.PHONE_PKG,
      LiveWorkoutWire.WATCH_PKG,
      LiveWorkoutWire.EVENT_CONTROL,
      LiveWorkoutWire.reply(operation),
      what = "live workout $what reply",
    )
  }

  private fun change(workoutType: Int?, status: Status, what: String) {
    synchronized(lock) {
      val current = session
      // A pause or resume without a known start (the app started mid-workout) still opens a session.
      if (current == null || current.status == Status.ENDED && status != Status.ENDED) {
        session = newSession(workoutType, status)
      } else {
        if (workoutType != null) current.sportType = workoutType
        if (current.status == Status.ENDED) return
        current.status = status
        current.updatedAtMs = System.currentTimeMillis()
        if (status == Status.ENDED) current.endedAtMs = current.updatedAtMs
      }
    }
    log("Live workout: $what (type $workoutType)")
    publish(force = true)
  }

  private fun onPoint(point: SamplePointIn) {
    synchronized(lock) {
      val current = session?.takeIf { it.status != Status.ENDED } ?: newSession(null, Status.RUNNING).also { session = it }
      val metrics = current.metrics.applyPoint(point.values)
      current.metrics = metrics
      current.updatedAtMs = System.currentTimeMillis()
      current.estimator.update(metrics.calories, metrics.heartRate)
      val fromStream = when (metrics.watchState) {
        1 -> Status.RUNNING
        2 -> Status.PAUSED
        3 -> Status.ENDED
        else -> null
      }
      if (fromStream != null && fromStream != current.status && current.status != Status.ENDED) {
        current.status = fromStream
        if (fromStream == Status.ENDED) current.endedAtMs = current.updatedAtMs
      }
    }
    publish(force = false)
  }

  private fun newSession(workoutType: Int?, status: Status): Session {
    val birthYear = settings.profile?.birthYear?.takeIf { it > 0 }
    val age = birthYear?.let { ProfileSender.age(it, LocalDate.now()) } ?: DEFAULT_AGE
    val maxHr = SubstrateEstimator.maxHeartRate(age)
    val now = System.currentTimeMillis()
    return Session(now, workoutType, status, LiveMetrics(), SubstrateEstimator(maxHr), maxHr, now)
  }

  private fun toJs(s: Session): Map<String, Any?> {
    val m = s.metrics
    return mapOf(
      "id" to s.id.toDouble(),
      "status" to s.status.wire,
      "sportType" to s.sportType,
      "sportName" to s.sportType?.let { WorkoutSportTypes.name(it) },
      "updatedAt" to s.updatedAtMs.toDouble(),
      "endedAt" to s.endedAtMs?.toDouble(),
      "durationSec" to m.durationSec,
      "heartRate" to m.heartRate,
      "heartRateZone" to m.heartRateZone,
      "maxHeartRate" to s.maxHeartRate,
      "distanceM" to m.distanceM,
      "calories" to m.calories,
      "activeCalories" to m.activeCalories,
      "speedKmh" to m.speedKmh,
      "paceSecPerKm" to m.paceSecPerKm,
      "stepRate" to m.stepRate,
      "steps" to m.steps,
      "cadence" to m.cadence,
      "altitudeM" to m.altitudeM,
      "riseM" to m.riseM,
      "descentM" to m.descentM,
      "aerobicTe" to m.aerobicTe,
      "anaerobicTe" to m.anaerobicTe,
      "fatGrams" to s.estimator.fatGrams,
      "carbGrams" to s.estimator.carbGrams,
      "fatShare" to m.heartRate?.let { SubstrateEstimator.fatShare(it, s.maxHeartRate) },
    )
  }

  private fun publish(force: Boolean) {
    val (payload, s) = synchronized(lock) { val s = session ?: return; toJs(s) to s }
    events.liveWorkout(payload)
    val now = SystemClock.elapsedRealtime()
    if (!force && s.status == notifiedStatus && now - notifiedAtMs < NOTIFY_EVERY_MS) return
    notifiedAtMs = now
    notifiedStatus = s.status
    if (s.status == Status.ENDED) cancelNotification() else notify(s)
  }

  private fun notify(s: Session) {
    val manager = appContext.getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(CHANNEL_ID, "Live workout", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Follows a workout you started on the watch"
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
    val open = PendingIntent.getActivity(
      appContext,
      0,
      Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).setPackage(appContext.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val m = s.metrics
    val sport = s.sportType?.let { WorkoutSportTypes.name(it) } ?: "Workout"
    val title = when (s.status) {
      Status.PREPARING -> "$sport starting on your watch"
      Status.PAUSED -> "$sport paused"
      else -> sport
    }
    val parts = ArrayList<String>()
    m.heartRate?.let { parts += "$it bpm" }
    m.distanceM?.let { parts += if (it >= 1000) String.format(Locale.US, "%.2f km", it / 1000) else "${it.roundToInt()} m" }
    m.calories?.let { parts += "${it.roundToInt()} kcal" }
    if (s.estimator.fatGrams > 0) parts += "fat ${formatGrams(s.estimator.fatGrams)}"
    if (s.estimator.carbGrams > 0) parts += "carbs ${formatGrams(s.estimator.carbGrams)}"
    val builder = Notification.Builder(appContext, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_joyofit)
      .setColor(appContext.getColor(R.color.joyofit_notification_accent))
      .setContentTitle(title)
      .setContentText(if (parts.isEmpty()) "Tap to follow it live" else parts.joinToString(" · "))
      .setCategory(Notification.CATEGORY_WORKOUT)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
    val duration = m.durationSec
    if (s.status == Status.RUNNING && duration != null) {
      // The system ticks the clock between pushes: base = now - elapsed.
      builder.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis() - duration * 1000L)
    } else {
      builder.setShowWhen(false)
    }
    try {
      manager.notify(NOTIFICATION_ID, builder.build())
    } catch (e: SecurityException) {
      log("Live workout: notification not shown: ${e.message}")
    }
  }

  private fun cancelNotification() {
    appContext.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    notifiedStatus = null
  }

  private fun formatGrams(g: Double): String = if (g < 10) String.format(Locale.US, "%.1f g", g) else "${g.roundToInt()} g"

  companion object {
    const val CHANNEL_ID = "watch_live_workout"
    const val NOTIFICATION_ID = 4103
    const val DEEP_LINK = "joyofit://workout-live"
    const val NOTIFY_EVERY_MS = 5_000L

    /** Age used for the maximum heart rate when no profile is saved (220 - 35 = 185 bpm). */
    const val DEFAULT_AGE = 35
  }
}
