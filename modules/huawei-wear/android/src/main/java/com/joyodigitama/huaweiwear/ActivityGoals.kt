// Layouts from Huawei Health 17.0.8.300 (SportGoalMgr.a, mdn.d) and Gadgetbridge's HuaweiDataSyncGoals (ids, packages, the
// per-goal `01 time, 02 goal` data, calories as kcal x 1000). UNVERIFIED on the Fit 4 Pro.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences
import java.io.ByteArrayOutputStream
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/** The activity-ring goals and reminders (Settings → Goals & reminders). Defaults match Huawei Health's. */
internal data class ActivityGoalsData(
  val steps: Int = DEFAULT_STEPS,
  /** Active kilocalories; the watch takes kcal x 1000. */
  val calories: Int = DEFAULT_CALORIES,
  val exerciseMinutes: Int = DEFAULT_EXERCISE_MINUTES,
  val standHours: Int = DEFAULT_STAND_HOURS,
  val remindStand: Boolean = true,
  val remindProgress: Boolean = true,
  val remindGoalReached: Boolean = true,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "steps" to steps,
    "calories" to calories,
    "exerciseMinutes" to exerciseMinutes,
    "standHours" to standHours,
    "remindStand" to remindStand,
    "remindProgress" to remindProgress,
    "remindGoalReached" to remindGoalReached,
  )

  companion object {
    const val DEFAULT_STEPS = 10_000
    const val DEFAULT_CALORIES = 300
    const val DEFAULT_EXERCISE_MINUTES = 30
    const val DEFAULT_STAND_HOURS = 12
  }
}

/** Pure encoders, so the byte layouts can be tested without a link. */
internal object ActivityGoalsCodec {
  const val SRC_PKG = "hw.sport.config"
  const val WEAR_PKG = "in.huawei.motion"

  const val BUNDLE = 900200002
  const val STEPS = 900200006
  const val CALORIES = 900200007
  const val EXERCISE = 900200008
  const val STAND = 900200009
  const val REMINDER_STAND = 900200004
  const val REMINDER_PROGRESS = 900200010
  const val REMINDER_GOAL_REACHED = 900200011

  /** SportGoalMgr.a / GB sendCommonData: `01 time int32 s, 02 goal int32`. */
  fun single(nowSec: Int, goal: Int): ByteArray = HuaweiTLV().put(0x01, nowSec).put(0x02, goal).serialize()

  /** mdn.d(int[]): `01 time, 82{83{04 type, 05 value} x3}` with types 1 steps, 3 exercise minutes, 4 stand hours; type and value are minimal big-endian bytes. */
  fun bundle(nowSec: Int, steps: Int, exerciseMinutes: Int, standHours: Int): ByteArray {
    val list = HuaweiTLV()
    for ((type, value) in listOf(1 to steps, 3 to exerciseMinutes, 4 to standHours)) {
      list.put(0x83, HuaweiTLV().put(0x04, minimal(type)).put(0x05, minimal(value)))
    }
    return HuaweiTLV().put(0x01, nowSec).put(0x82, list).serialize()
  }

  /** The configs one full send consists of, in the order they are sent. */
  fun items(goals: ActivityGoalsData, nowSec: Int, nowMs: Long): List<ConfigItem> = listOf(
    ConfigItem(STEPS, 1, single(nowSec, goals.steps), nowMs),
    ConfigItem(CALORIES, 1, single(nowSec, goals.calories * 1000), nowMs),
    ConfigItem(EXERCISE, 1, single(nowSec, goals.exerciseMinutes), nowMs),
    ConfigItem(STAND, 1, single(nowSec, goals.standHours), nowMs),
    ConfigItem(BUNDLE, 1, bundle(nowSec, goals.steps, goals.exerciseMinutes, goals.standHours), nowMs),
    ConfigItem(REMINDER_STAND, 1, single(nowSec, if (goals.remindStand) 1 else 0), nowMs),
    ConfigItem(REMINDER_PROGRESS, 1, single(nowSec, if (goals.remindProgress) 1 else 0), nowMs),
    ConfigItem(REMINDER_GOAL_REACHED, 1, single(nowSec, if (goals.remindGoalReached) 1 else 0), nowMs),
  )

  /** `HEXUtils.a(int)`: the value as big-endian bytes, as few as it takes (at least one). */
  fun minimal(value: Int): ByteArray {
    val out = ByteArrayOutputStream(4)
    var started = false
    for (shift in intArrayOf(24, 16, 8, 0)) {
      val b = (value shr shift) and 0xFF
      if (b != 0 || started || shift == 0) {
        out.write(b)
        started = true
      }
    }
    return out.toByteArray()
  }

  fun validate(goals: ActivityGoalsData) {
    fun bad(what: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, what)
    if (goals.steps !in 1000..100_000) bad("Steps goal must be 1000 to 100000")
    if (goals.calories !in 50..10_000) bad("Calories goal must be 50 to 10000 kcal")
    if (goals.exerciseMinutes !in 1..600) bad("Exercise goal must be 1 to 600 minutes")
    if (goals.standHours !in 1..24) bad("Stand goal must be 1 to 24 hours")
  }
}

/**
 * Sends the goals and reminders to the watch on change and on connect, and keeps them in step when the watch changes one
 * itself (a config from `in.huawei.motion`, which GB's HuaweiDataSyncGoals also stores). Gate: ExpandCapability 83.
 */
internal class ActivityGoals(
  context: Context,
  private val service: DataSyncService,
  private val events: WearEvents,
  private val settings: WearSettings,
) : DataSyncFeature {
  private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  override val name = "activity goals"

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  var goals: ActivityGoalsData
    get() = ActivityGoalsData(
      // Until the user saves goals, the ring's steps goal is the profile's daily step goal (the same number on the watch).
      steps = prefs.getInt(KEY_STEPS, settings.profile?.dailyStepGoal ?: ActivityGoalsData.DEFAULT_STEPS),
      calories = prefs.getInt(KEY_CALORIES, ActivityGoalsData.DEFAULT_CALORIES),
      exerciseMinutes = prefs.getInt(KEY_EXERCISE, ActivityGoalsData.DEFAULT_EXERCISE_MINUTES),
      standHours = prefs.getInt(KEY_STAND, ActivityGoalsData.DEFAULT_STAND_HOURS),
      remindStand = prefs.getBoolean(KEY_REMIND_STAND, true),
      remindProgress = prefs.getBoolean(KEY_REMIND_PROGRESS, true),
      remindGoalReached = prefs.getBoolean(KEY_REMIND_REACHED, true),
    )
    private set(value) {
      prefs.edit()
        .putInt(KEY_STEPS, value.steps)
        .putInt(KEY_CALORIES, value.calories)
        .putInt(KEY_EXERCISE, value.exerciseMinutes)
        .putInt(KEY_STAND, value.standHours)
        .putBoolean(KEY_REMIND_STAND, value.remindStand)
        .putBoolean(KEY_REMIND_PROGRESS, value.remindProgress)
        .putBoolean(KEY_REMIND_REACHED, value.remindGoalReached)
        .apply()
    }

  /** Unix ms of the last send the watch link accepted; 0 when never. */
  val lastSentAt: Long get() = prefs.getLong(KEY_SENT_AT, 0L)

  fun status(): Map<String, Any?> = goals.toJs() + mapOf(
    "configSupported" to if (service.connected()) service.supports(DataSyncWire.CAP_CONFIG) else null,
    "lastSentAt" to lastSentAt.takeIf { it > 0 },
  )

  /** Validates, stores and, when the watch is connected, sends. Returns true when it reached the watch. */
  suspend fun set(next: ActivityGoalsData): Boolean {
    ActivityGoalsCodec.validate(next)
    goals = next
    prefs.edit().putBoolean(KEY_SAVED, true).apply()
    log("Goals: saved steps=${next.steps} kcal=${next.calories} exercise=${next.exerciseMinutes} min stand=${next.standHours} h reminders stand=${next.remindStand} progress=${next.remindProgress} reached=${next.remindGoalReached}")
    return send("changed")
  }

  suspend fun send(reason: String): Boolean {
    val now = System.currentTimeMillis()
    val items = ActivityGoalsCodec.items(goals, (now / 1000).toInt(), now)
    log("Goals: sending to the watch ($reason)")
    // One packet per config, like Huawei Health and GB; the watch answers each, and the answers are only logged.
    var all = true
    for (item in items) {
      val sent = service.sendConfig(
        ActivityGoalsCodec.SRC_PKG,
        ActivityGoalsCodec.WEAR_PKG,
        item.configId,
        item.data,
        item.action,
        item.modifyMs,
        what = "activity goal ${item.configId}",
      )
      if (!sent) {
        all = false
        break
      }
    }
    if (all) prefs.edit().putLong(KEY_SENT_AT, now).apply()
    return all
  }

  override fun register(service: DataSyncService) {
    // The watch writes goals back (SportGoalMgr listens on hw.sport.config; GB on in.huawei.motion). Match either side.
    service.onConfig(null, ActivityGoalsCodec.WEAR_PKG, null) { onWatchConfig(it) }
    service.onConfig(ActivityGoalsCodec.SRC_PKG, null, null) { onWatchConfig(it) }
  }

  override suspend fun onConnected() {
    // Defaults are not pushed: a watch whose goals were set on the watch or in Huawei Health keeps them until the user saves goals here.
    if (!prefs.getBoolean(KEY_SAVED, false)) {
      log("Goals: not sent on connect, no goals saved in JoyoFit yet (Settings → Goals and reminders)")
      return
    }
    send("connected")
  }

  private fun onWatchConfig(config: SampleConfigIn) {
    val item = config.items.firstOrNull() ?: return
    val tlv = HuaweiTLV().parse(item.data ?: return)
    if (!tlv.contains(0x02)) return
    val value = tlv.getAsInteger(0x02, 0)
    val current = goals
    val next = when (item.configId) {
      ActivityGoalsCodec.STEPS -> current.copy(steps = value)
      ActivityGoalsCodec.CALORIES -> current.copy(calories = value / 1000)
      ActivityGoalsCodec.EXERCISE -> current.copy(exerciseMinutes = value)
      ActivityGoalsCodec.STAND -> current.copy(standHours = value)
      ActivityGoalsCodec.REMINDER_STAND -> current.copy(remindStand = value != 0)
      ActivityGoalsCodec.REMINDER_PROGRESS -> current.copy(remindProgress = value != 0)
      ActivityGoalsCodec.REMINDER_GOAL_REACHED -> current.copy(remindGoalReached = value != 0)
      else -> return
    }
    if (next == current) return
    goals = next
    log("Goals: the watch changed config ${item.configId} to $value; stored")
  }

  private companion object {
    const val PREFS_NAME = "joyofit_goals"
    const val KEY_STEPS = "steps"
    const val KEY_CALORIES = "calories"
    const val KEY_EXERCISE = "exercise"
    const val KEY_STAND = "stand"
    const val KEY_REMIND_STAND = "remind_stand"
    const val KEY_REMIND_PROGRESS = "remind_progress"
    const val KEY_REMIND_REACHED = "remind_reached"
    const val KEY_SENT_AT = "sent_at"
    const val KEY_SAVED = "saved_by_user"
  }
}
