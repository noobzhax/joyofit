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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * A workout on the watch, followed live on the phone. Two sources:
 *  - the watch's own numbers, when it sends them (Huawei Health's reverse linkage [LiveWorkoutWire], or the `17/11` report);
 *  - otherwise JoyoFit's own session ([Source.GPS] / [Source.STATUS] / [Source.MANUAL]): the Fit 4 Pro (6.1.0.117) sends
 *    neither, but asks for the phone's GPS about every 20 s while an outdoor workout runs, answers the `17/03` status poll,
 *    and pushes realtime heart rate when asked. The session runs on that heart rate: time from the phone, calories from
 *    [HeartRateEnergy]. It ends when the status poll says "no workout" [IDLE_ANSWERS_TO_END] times in a row with no GPS
 *    request for [GPS_SILENCE_MS], on GPS silence alone only if the poll is not answered, or when the user taps Finish.
 * Either way it keeps JoyoFit's fat and carbohydrate estimate ([SubstrateEstimator]), an ongoing notification that opens the
 * live screen, and reports every change to JS (`onLiveWorkout`).
 */
internal class LiveWorkout(
  context: Context,
  private val dataSync: DataSyncService,
  private val events: WearEvents,
  private val settings: WearSettings,
  private val liveHeartRate: LiveHeartRate,
  private val scope: CoroutineScope,
) : DataSyncFeature {
  override val name = "live workout"

  enum class Status(val wire: String) { PREPARING("preparing"), RUNNING("running"), PAUSED("paused"), ENDED("ended") }

  /** Where the numbers come from: the watch, or JoyoFit's heart-rate session started by the GPS requests or by hand. */
  enum class Source(val wire: String) { WATCH("watch"), GPS("gps"), STATUS("status"), MANUAL("manual") }

  private class Session(
    val id: Long,
    var sportType: Int?,
    var status: Status,
    var metrics: LiveMetrics,
    val estimator: SubstrateEstimator,
    val maxHeartRate: Int,
    var updatedAtMs: Long,
    var source: Source,
    var endedAtMs: Long? = null,
    /** Phone-side session: kcal so far, last heart-rate time, last GPS request. */
    var estimatedKcal: Double = 0.0,
    var lastHeartRateAtMs: Long? = null,
    var lastGpsAtMs: Long = 0L,
  )

  private var watchdog: Job? = null

  /** Last answer of the 17/03 status poll, and how many answers in a row said "no workout". */
  private var lastStatusAtMs = 0L
  private var idleAnswers = 0

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

  /** Live screen "Start": a phone-side session for a workout the watch does not announce (indoor). */
  fun startManual() {
    synchronized(lock) {
      if (session?.status.let { it != null && it != Status.ENDED }) return
      session = newSession(null, Status.RUNNING, Source.MANUAL)
    }
    log("Live workout: started on the phone")
    liveHeartRate.setWorkoutActive(true)
    publish(force = true)
  }

  /** Live screen "Finish". */
  fun finish() = end("finished on the phone")

  private fun end(why: String) {
    synchronized(lock) {
      val s = session ?: return
      if (s.status == Status.ENDED) return
      s.status = Status.ENDED
      s.updatedAtMs = System.currentTimeMillis()
      s.endedAtMs = s.updatedAtMs
    }
    log("Live workout: ended ($why)")
    liveHeartRate.setWorkoutActive(false)
    watchdog?.cancel()
    watchdog = null
    publish(force = true)
  }

  /** Realtime heart rate from the watch: drives a phone-side session; a watch-fed one has its own heart rate. */
  fun onHeartRate(bpm: Int) {
    synchronized(lock) {
      val s = session ?: return
      if (s.status != Status.RUNNING || s.source == Source.WATCH) return
      val now = System.currentTimeMillis()
      val last = s.lastHeartRateAtMs
      s.lastHeartRateAtMs = now
      if (last != null) {
        // A reading covers the time since the previous one, at most 10 s (the link may have dropped in between).
        val minutes = (now - last).coerceIn(0L, 10_000L) / 60_000.0
        val profile = settings.profile
        val age = profile?.birthYear?.takeIf { it > 0 }?.let { ProfileSender.age(it, LocalDate.now()) } ?: DEFAULT_AGE
        val weight = profile?.weightKg?.takeIf { it > 0 } ?: DEFAULT_WEIGHT_KG
        s.estimatedKcal += HeartRateEnergy.kcalPerMinute(bpm, weight, age, profile?.sex ?: "unknown") * minutes
      }
      s.metrics = s.metrics.copy(heartRate = bpm, calories = s.estimatedKcal, durationSec = ((now - s.id) / 1000).toInt())
      s.updatedAtMs = now
      s.estimator.update(s.estimatedKcal, bpm)
    }
    publish(force = false)
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
      val current = watchSession()
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

  /**
   * The watch's answer to the 30 s status poll (`17/03`): starts a heart-rate session for a running workout (indoor ones
   * included), follows pause and resume, and ends a session it or the GPS requests started once the watch is idle.
   */
  fun watchStatus(running: Boolean, paused: Boolean, workoutType: Int?) {
    var created = false
    var ended = false
    var changed = false
    synchronized(lock) {
      lastStatusAtMs = System.currentTimeMillis()
      idleAnswers = if (running) 0 else idleAnswers + 1
      val s = session?.takeIf { it.status != Status.ENDED }
      when {
        running && s == null -> {
          session = newSession(workoutType, if (paused) Status.PAUSED else Status.RUNNING, Source.STATUS)
          created = true
        }
        running && s != null -> {
          if (workoutType != null && s.sportType == null) s.sportType = workoutType
          if (s.source != Source.WATCH) {
            val want = if (paused) Status.PAUSED else Status.RUNNING
            if (s.status != want) {
              s.status = want
              // A pause must not count as workout time once resumed.
              s.lastHeartRateAtMs = null
              changed = true
            }
          }
        }
        // One idle answer is not enough to end a workout the user is still doing, and a watch still asking for the
        // phone's GPS is running one whatever the poll says.
        !running && s != null && (s.source == Source.STATUS || s.source == Source.GPS) ->
          ended = idleAnswers >= IDLE_ANSWERS_TO_END && System.currentTimeMillis() - s.lastGpsAtMs > GPS_SILENCE_MS
      }
    }
    when {
      created -> {
        log("Live workout: the watch reports a workout running (type $workoutType); following its heart rate")
        liveHeartRate.setWorkoutActive(true)
        publish(force = true)
      }
      ended -> end("the watch reported no workout $idleAnswers times in a row")
      changed -> publish(force = true)
    }
  }

  /** The watch asked for the phone's GPS: an outdoor workout is running (the request repeats about every 20 s). */
  fun gpsPing() {
    val created = synchronized(lock) {
      val s = session
      if (s != null && s.status != Status.ENDED) {
        s.lastGpsAtMs = System.currentTimeMillis()
        false
      } else {
        session = newSession(null, Status.RUNNING, Source.GPS).also { it.lastGpsAtMs = it.id }
        true
      }
    }
    if (!created) return
    log("Live workout: running on the watch (it asked for the phone's GPS); following its heart rate")
    liveHeartRate.setWorkoutActive(true)
    watchdog?.cancel()
    watchdog = scope.launch {
      while (isActive) {
        delay(15_000L)
        val silent = synchronized(lock) {
          val s = session
          val now = System.currentTimeMillis()
          // The watch stops asking once its own GPS has a fix, so silence alone says nothing while the status poll
          // answers; then the poll decides. Silence ends the session only on watches that do not answer the poll.
          s != null && s.source == Source.GPS && s.status != Status.ENDED &&
            now - s.lastGpsAtMs > GPS_SILENCE_MS && now - lastStatusAtMs > STATUS_STALE_MS
        }
        if (silent) end("the watch stopped asking for GPS and does not answer the status poll")
      }
    }
    publish(force = true)
  }

  /** A `17/11` realtime report ([WorkoutReport]); operator type 1 running, 2 paused, 3 resumed, 4 stopped. */
  fun onReport(report: WorkoutReport.Parsed) {
    synchronized(lock) {
      val current = watchSession()
      val metrics = report.apply(current.metrics)
      current.metrics = metrics
      current.updatedAtMs = System.currentTimeMillis()
      current.estimator.update(metrics.calories, metrics.heartRate)
      when (report.operatorType) {
        1, 3 -> current.status = Status.RUNNING
        2 -> current.status = Status.PAUSED
        4 -> {
          current.status = Status.ENDED
          current.endedAtMs = current.updatedAtMs
        }
      }
    }
    publish(force = false)
  }

  /**
   * The session watch numbers go into. A phone-side session is replaced by a watch-fed one with the same id, because the
   * watch's cumulative calories and its estimate would otherwise be mixed. Callers hold [lock].
   */
  private fun watchSession(): Session {
    val current = session?.takeIf { it.status != Status.ENDED }
    if (current != null && current.source == Source.WATCH) return current
    val fresh = newSession(current?.sportType, Status.RUNNING, Source.WATCH, id = current?.id)
    session = fresh
    if (current != null) log("Live workout: the watch sends its own numbers; using them instead of the heart-rate estimate")
    return fresh
  }

  private fun newSession(workoutType: Int?, status: Status, source: Source = Source.WATCH, id: Long? = null): Session {
    val birthYear = settings.profile?.birthYear?.takeIf { it > 0 }
    val age = birthYear?.let { ProfileSender.age(it, LocalDate.now()) } ?: DEFAULT_AGE
    val maxHr = SubstrateEstimator.maxHeartRate(age)
    val now = System.currentTimeMillis()
    return Session(id ?: now, workoutType, status, LiveMetrics(), SubstrateEstimator(maxHr), maxHr, now, source)
  }

  private fun toJs(s: Session): Map<String, Any?> {
    val m = s.metrics
    return mapOf(
      "id" to s.id.toDouble(),
      "status" to s.status.wire,
      "source" to s.source.wire,
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
    if (s.status == Status.ENDED) {
      liveHeartRate.setWorkoutActive(false)
      cancelNotification()
    } else {
      notify(s)
    }
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

    /** Weight for the heart-rate energy estimate when no profile is saved. */
    const val DEFAULT_WEIGHT_KG = 70.0

    /** No GPS request for this long counts as GPS silence (the watch asks about every 20 s until its own GPS has a fix). */
    const val GPS_SILENCE_MS = 120_000L

    /** "No workout" answers in a row (one per 30 s poll) that end a phone-side session. */
    const val IDLE_ANSWERS_TO_END = 2

    /** No status answer for this long means the poll stopped (the watch does not answer 17/03). */
    const val STATUS_STALE_MS = 90_000L
  }
}
