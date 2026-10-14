package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences

/** Wire names match `TemperatureUnit` in `HuaweiWear.types.ts`. */
internal enum class TemperatureUnit(val wire: String) {
  CELSIUS("celsius"),
  FAHRENHEIT("fahrenheit");

  companion object {
    fun fromWire(value: String): TemperatureUnit? = entries.firstOrNull { it.wire == value }
  }
}

/** Wire names match `WeatherLocationMode` in `HuaweiWear.types.ts`. */
internal enum class WeatherLocationMode(val wire: String) {
  /** The phone's coarse location (LocationManager). */
  CURRENT("current"),

  /** The city the user searched for (Open-Meteo geocoding). */
  CITY("city");

  companion object {
    fun fromWire(value: String): WeatherLocationMode? = entries.firstOrNull { it.wire == value }
  }
}

/** A named point on Earth: a geocoded city, or the last position the phone reported. */
internal data class WeatherPlace(
  /** Shown on the watch; null when a current position could not be named. */
  val name: String?,
  val latitude: Double,
  val longitude: Double,
  /** Region and country of a geocoded city, e.g. "West Java, Indonesia". */
  val detail: String? = null,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "name" to name,
    "latitude" to latitude,
    "longitude" to longitude,
    "detail" to detail,
  )
}

/**
 * The weather feature's user settings. They live in the same SharedPreferences file as
 * [WearSettings] (`joyofit_settings`; Android hands out one instance per file and process), under
 * `weather_` keys, so the service, the module and the watch-request handler all read the same values.
 */
internal class WeatherSettings(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** Off until the user switches it on: it needs the internet and the phone's location. */
  var enabled: Boolean
    get() = prefs.getBoolean(KEY_ENABLED, false)
    set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

  var unit: TemperatureUnit
    get() = TemperatureUnit.fromWire(prefs.getString(KEY_UNIT, null) ?: "") ?: TemperatureUnit.CELSIUS
    set(value) = prefs.edit().putString(KEY_UNIT, value.wire).apply()

  var locationMode: WeatherLocationMode
    get() = WeatherLocationMode.fromWire(prefs.getString(KEY_MODE, null) ?: "") ?: WeatherLocationMode.CURRENT
    set(value) = prefs.edit().putString(KEY_MODE, value.wire).apply()

  var intervalMinutes: Int
    get() = prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MIN)
    set(value) = prefs.edit().putInt(KEY_INTERVAL, value).apply()

  /** The city chosen for [WeatherLocationMode.CITY]. */
  var city: WeatherPlace?
    get() = read(KEY_CITY_LAT, KEY_CITY_LON, KEY_CITY_NAME, KEY_CITY_DETAIL)
    set(value) = write(value, KEY_CITY_LAT, KEY_CITY_LON, KEY_CITY_NAME, KEY_CITY_DETAIL)

  /**
   * The last position the phone gave for [WeatherLocationMode.CURRENT]. Used when no fresh fix can
   * be had (a background service may not get one on Android 10+ without background location).
   */
  var lastFix: WeatherPlace?
    get() = read(KEY_FIX_LAT, KEY_FIX_LON, KEY_FIX_NAME, null)
    set(value) = write(value, KEY_FIX_LAT, KEY_FIX_LON, KEY_FIX_NAME, null)

  private fun read(latKey: String, lonKey: String, nameKey: String, detailKey: String?): WeatherPlace? {
    if (!prefs.contains(latKey) || !prefs.contains(lonKey)) return null
    return WeatherPlace(
      name = prefs.getString(nameKey, null),
      latitude = java.lang.Double.longBitsToDouble(prefs.getLong(latKey, 0L)),
      longitude = java.lang.Double.longBitsToDouble(prefs.getLong(lonKey, 0L)),
      detail = detailKey?.let { prefs.getString(it, null) },
    )
  }

  private fun write(place: WeatherPlace?, latKey: String, lonKey: String, nameKey: String, detailKey: String?) {
    val editor = prefs.edit()
    if (place == null) {
      editor.remove(latKey).remove(lonKey).remove(nameKey)
      detailKey?.let { editor.remove(it) }
    } else {
      editor.putLong(latKey, java.lang.Double.doubleToRawLongBits(place.latitude))
        .putLong(lonKey, java.lang.Double.doubleToRawLongBits(place.longitude))
      if (place.name != null) editor.putString(nameKey, place.name) else editor.remove(nameKey)
      detailKey?.let { if (place.detail != null) editor.putString(it, place.detail) else editor.remove(it) }
    }
    editor.apply()
  }

  companion object {
    const val DEFAULT_INTERVAL_MIN = 60
    const val MIN_INTERVAL_MIN = 15
    const val MAX_INTERVAL_MIN = 1440

    /** Same file as [WearSettings]. */
    private const val PREFS_NAME = "joyofit_settings"
    private const val KEY_ENABLED = "weather_enabled"
    private const val KEY_UNIT = "weather_unit"
    private const val KEY_MODE = "weather_location_mode"
    private const val KEY_INTERVAL = "weather_interval_min"
    private const val KEY_CITY_LAT = "weather_city_lat"
    private const val KEY_CITY_LON = "weather_city_lon"
    private const val KEY_CITY_NAME = "weather_city_name"
    private const val KEY_CITY_DETAIL = "weather_city_detail"
    private const val KEY_FIX_LAT = "weather_fix_lat"
    private const val KEY_FIX_LON = "weather_fix_lon"
    private const val KEY_FIX_NAME = "weather_fix_name"
  }
}
