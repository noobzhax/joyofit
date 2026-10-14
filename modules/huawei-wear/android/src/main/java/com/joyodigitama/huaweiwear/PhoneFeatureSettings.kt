package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/**
 * Switches for the phone-side features that must work without JS running: find my phone, incoming
 * calls on the watch, answering/rejecting calls from the watch, and the cached watch alarms. Own
 * SharedPreferences file, separate from [WearSettings].
 */
internal class PhoneFeatureSettings(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** The watch's "find my phone" button rings the phone. GB's `PREF_FIND_PHONE` defaults to off; here the user asked for it, so on. */
  var findPhoneEnabled: Boolean
    get() = prefs.getBoolean(KEY_FIND_PHONE, true)
    set(value) = prefs.edit().putBoolean(KEY_FIND_PHONE, value).apply()

  /** Incoming calls are shown on the watch. Needs READ_PHONE_STATE. */
  var callsEnabled: Boolean
    get() = prefs.getBoolean(KEY_CALLS, false)
    set(value) = prefs.edit().putBoolean(KEY_CALLS, value).apply()

  /** The watch's accept/reject buttons act on the phone call (GB `enable_call_accept` / `enable_call_reject`, both default on). Needs ANSWER_PHONE_CALLS. */
  var callControlEnabled: Boolean
    get() = prefs.getBoolean(KEY_CALL_CONTROL, true)
    set(value) = prefs.edit().putBoolean(KEY_CALL_CONTROL, value).apply()

  /** Last alarms read from or pushed to the watch, as JSON (see [WatchAlarms]). */
  var alarmsJson: String?
    get() = prefs.getString(KEY_ALARMS, null)
    set(value) = prefs.edit().apply { if (value == null) remove(KEY_ALARMS) else putString(KEY_ALARMS, value) }.apply()

  private companion object {
    const val PREFS_NAME = "joyofit_phone_features"
    const val KEY_FIND_PHONE = "find_phone"
    const val KEY_CALLS = "calls"
    const val KEY_CALL_CONTROL = "call_control"
    const val KEY_ALARMS = "alarms"
  }
}
