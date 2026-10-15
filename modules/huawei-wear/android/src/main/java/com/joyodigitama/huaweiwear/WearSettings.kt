package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/** Profile and goal as the JS Settings screen stores them (`UserProfile` in `HuaweiWear.types.ts`). */
internal data class UserProfileData(
  val heightCm: Int,
  val weightKg: Double,
  val birthYear: Int,
  /** `male`, `female` or `unknown`. */
  val sex: String,
  val dailyStepGoal: Int,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "heightCm" to heightCm,
    "weightKg" to weightKg,
    "birthYear" to birthYear,
    "sex" to sex,
    "dailyStepGoal" to dailyStepGoal,
  )
}

/**
 * Everything the user configures that must survive without JS running: the remembered watch,
 * background mode and its sync interval, notification forwarding (switch + per-app choices) and
 * the profile/goal. One private SharedPreferences file, read by the service, the listener and the module.
 */
internal class WearSettings(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** The watch last connected from the app or enabled for background (uppercase MAC). */
  var watchAddress: String?
    get() = prefs.getString(KEY_ADDRESS, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_ADDRESS) else putString(KEY_ADDRESS, value) }.apply()

  var watchName: String?
    get() = prefs.getString(KEY_NAME, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_NAME) else putString(KEY_NAME, value) }.apply()

  var backgroundEnabled: Boolean
    get() = prefs.getBoolean(KEY_BACKGROUND, false)
    set(value) = prefs.edit().putBoolean(KEY_BACKGROUND, value).apply()

  var syncIntervalMinutes: Int
    get() = prefs.getInt(KEY_INTERVAL, DEFAULT_SYNC_INTERVAL_MIN)
    set(value) = prefs.edit().putInt(KEY_INTERVAL, value).apply()

  var notificationsEnabled: Boolean
    get() = prefs.getBoolean(KEY_NOTIFICATIONS, false)
    set(value) = prefs.edit().putBoolean(KEY_NOTIFICATIONS, value).apply()

  /** The once-a-day morning summary notification (off by default). */
  var morningSummaryEnabled: Boolean
    get() = prefs.getBoolean(KEY_MORNING_SUMMARY, false)
    set(value) = prefs.edit().putBoolean(KEY_MORNING_SUMMARY, value).apply()

  /** Local date (`yyyy-MM-dd`) the morning summary was last posted, so it posts once per day. */
  var morningSummaryDay: String?
    get() = prefs.getString(KEY_MORNING_SUMMARY_DAY, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_MORNING_SUMMARY_DAY) else putString(KEY_MORNING_SUMMARY_DAY, value) }.apply()

  /** Explicit per-app choice: true = forward, false = block, null = default policy. */
  fun appChoice(packageName: String): Boolean? = when {
    prefs.getStringSet(KEY_APPS_ON, emptySet())!!.contains(packageName) -> true
    prefs.getStringSet(KEY_APPS_OFF, emptySet())!!.contains(packageName) -> false
    else -> null
  }

  @Synchronized
  fun setAppChoice(packageName: String, enabled: Boolean) {
    val on = HashSet(prefs.getStringSet(KEY_APPS_ON, emptySet())!!)
    val off = HashSet(prefs.getStringSet(KEY_APPS_OFF, emptySet())!!)
    if (enabled) {
      on.add(packageName)
      off.remove(packageName)
    } else {
      off.add(packageName)
      on.remove(packageName)
    }
    prefs.edit().putStringSet(KEY_APPS_ON, on).putStringSet(KEY_APPS_OFF, off).apply()
  }

  /** The watch-side health sensor switches (see [HealthSensorConfig]); defaults match Huawei Health. */
  var healthSensors: HealthSensorConfig
    get() = HealthSensorConfig(
      automaticHeartRate = prefs.getBoolean(KEY_AUTO_HEART_RATE, true),
      automaticSpo2 = prefs.getBoolean(KEY_AUTO_SPO2, true),
      truSleep = prefs.getBoolean(KEY_TRUSLEEP, true),
      highHeartRateAlert = prefs.getInt(KEY_HIGH_HR_ALERT, 0),
      lowHeartRateAlert = prefs.getInt(KEY_LOW_HR_ALERT, 0),
    )
    set(value) = prefs.edit()
      .putBoolean(KEY_AUTO_HEART_RATE, value.automaticHeartRate)
      .putBoolean(KEY_AUTO_SPO2, value.automaticSpo2)
      .putBoolean(KEY_TRUSLEEP, value.truSleep)
      .putInt(KEY_HIGH_HR_ALERT, value.highHeartRateAlert)
      .putInt(KEY_LOW_HR_ALERT, value.lowHeartRateAlert)
      .apply()

  /** The watch's automatic stress switch as the user last set it here (GB PREF_HUAWEI_STRESS_SWITCH). */
  var stressEnabled: Boolean
    get() = prefs.getBoolean(KEY_STRESS_ENABLED, false)
    set(value) = prefs.edit().putBoolean(KEY_STRESS_ENABLED, value).apply()

  /** The last stress calibration as `HuaweiStressParser.stressDataToJsonStr` (GB PREF_HUAWEI_STRESS_LAST_DATA), so it can be re-sent. */
  var stressCalibration: String?
    get() = prefs.getString(KEY_STRESS_CALIBRATION, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_STRESS_CALIBRATION) else putString(KEY_STRESS_CALIBRATION, value) }.apply()

  var profile: UserProfileData?
    get() {
      if (!prefs.contains(KEY_PROFILE_HEIGHT)) return null
      return UserProfileData(
        heightCm = prefs.getInt(KEY_PROFILE_HEIGHT, 0),
        weightKg = java.lang.Double.longBitsToDouble(prefs.getLong(KEY_PROFILE_WEIGHT, 0L)),
        birthYear = prefs.getInt(KEY_PROFILE_BIRTH_YEAR, 0),
        sex = prefs.getString(KEY_PROFILE_SEX, "unknown") ?: "unknown",
        dailyStepGoal = prefs.getInt(KEY_PROFILE_GOAL, 0),
      )
    }
    set(value) {
      val editor = prefs.edit()
      if (value == null) {
        editor.remove(KEY_PROFILE_HEIGHT).remove(KEY_PROFILE_WEIGHT).remove(KEY_PROFILE_BIRTH_YEAR)
          .remove(KEY_PROFILE_SEX).remove(KEY_PROFILE_GOAL)
      } else {
        editor.putInt(KEY_PROFILE_HEIGHT, value.heightCm)
          .putLong(KEY_PROFILE_WEIGHT, java.lang.Double.doubleToRawLongBits(value.weightKg))
          .putInt(KEY_PROFILE_BIRTH_YEAR, value.birthYear)
          .putString(KEY_PROFILE_SEX, value.sex)
          .putInt(KEY_PROFILE_GOAL, value.dailyStepGoal)
      }
      editor.apply()
    }

  companion object {
    const val DEFAULT_SYNC_INTERVAL_MIN = 30
    const val MIN_SYNC_INTERVAL_MIN = 5
    const val MAX_SYNC_INTERVAL_MIN = 1440

    private const val PREFS_NAME = "joyofit_settings"
    private const val KEY_ADDRESS = "watch_address"
    private const val KEY_NAME = "watch_name"
    private const val KEY_BACKGROUND = "background_enabled"
    private const val KEY_INTERVAL = "sync_interval_min"
    private const val KEY_NOTIFICATIONS = "notifications_enabled"
    private const val KEY_MORNING_SUMMARY = "morning_summary_enabled"
    private const val KEY_MORNING_SUMMARY_DAY = "morning_summary_day"
    private const val KEY_APPS_ON = "notification_apps_on"
    private const val KEY_APPS_OFF = "notification_apps_off"
    private const val KEY_PROFILE_HEIGHT = "profile_height_cm"
    private const val KEY_PROFILE_WEIGHT = "profile_weight_kg"
    private const val KEY_PROFILE_BIRTH_YEAR = "profile_birth_year"
    private const val KEY_PROFILE_SEX = "profile_sex"
    private const val KEY_PROFILE_GOAL = "profile_step_goal"
    private const val KEY_AUTO_HEART_RATE = "sensor_auto_heart_rate"
    private const val KEY_AUTO_SPO2 = "sensor_auto_spo2"
    private const val KEY_TRUSLEEP = "sensor_trusleep"
    private const val KEY_HIGH_HR_ALERT = "sensor_high_hr_alert"
    private const val KEY_LOW_HR_ALERT = "sensor_low_hr_alert"
    private const val KEY_STRESS_ENABLED = "stress_automatic"
    private const val KEY_STRESS_CALIBRATION = "stress_calibration"
  }
}
