// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiWeatherManager.{sendWeather,handleAsyncMessage} and
// AsynchronousResponse.handleWeatherCheck.
package com.joyodigitama.huaweiwear

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import java.io.IOException
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Weather

/** Error codes of the weather feature, next to [ErrorCodes]. */
internal object WeatherErrorCodes {
  /** No position: permission missing, no fix yet, or no city chosen. Sent to the watch as GPS_PERMISSION_ERROR. */
  const val LOCATION = "ERR_WEATHER_LOCATION"

  /** Open-Meteo unreachable or answering garbage. Sent to the watch as NETWORK_ERROR. */
  const val NETWORK = "ERR_WEATHER_NETWORK"

  /** The weather switch is off. Sent to the watch as WEATHER_DISABLED. */
  const val DISABLED = "ERR_WEATHER_DISABLED"

  fun watchError(code: String): Weather.ErrorCode? = when (code) {
    LOCATION -> Weather.ErrorCode.GPS_PERMISSION_ERROR
    NETWORK -> Weather.ErrorCode.NETWORK_ERROR
    DISABLED -> Weather.ErrorCode.WEATHER_DISABLED
    else -> null
  }
}

/**
 * Fetches weather and keeps the watch's weather screen current:
 * - on connect (when the weather switch is on and the watch lists the weather service),
 * - whenever the watch asks (service 0f command 04, TLV 0x7f = 0x186AA, GB `handleAsyncMessage`),
 * - every [WeatherSettings.intervalMinutes] while the link is up, timed by an idle-safe alarm. The
 *   background service keeps the link up, so this is its refresh interval.
 * When it cannot get weather it tells the watch why (GB's WeatherError packets).
 */
internal class WeatherController(
  context: Context,
  private val settings: WeatherSettings,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val location = WeatherLocation(appContext, settings) { info(it) }

  /** GB `syncInProgress`: a push already running swallows the next request. */
  private val pushing = Mutex()

  @Volatile private var cache: WeatherReport? = null
  @Volatile private var cacheKey: String? = null

  @Volatile private var lastPushAtSec: Long? = null
  @Volatile private var lastError: String? = null
  @Volatile private var lastTempC: Int? = null
  @Volatile private var lastCondition: String? = null
  @Volatile private var lastPlaceName: String? = null

  private val lock = Any()
  private var subscribedSession: HuaweiSession? = null
  private var subscription: AutoCloseable? = null
  private var receiverRegistered = false

  private val alarmManager = appContext.getSystemService(AlarmManager::class.java)
  private val wakeLock: PowerManager.WakeLock =
    appContext.getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "joyofit:weather")
      .apply { setReferenceCounted(false) }

  private val tickIntent: PendingIntent = PendingIntent.getBroadcast(
    appContext,
    1,
    Intent(ACTION_TICK).setPackage(appContext.packageName),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (!wakeLock.isHeld) wakeLock.acquire(WAKE_LOCK_MS)
      scope.launch {
        try {
          if (link.handle() == null || !settings.enabled) stopTicker() else pushAndSchedule("interval", 0)
        } finally {
          if (wakeLock.isHeld) wakeLock.release()
        }
      }
    }
  }

  private fun info(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  // Link lifecycle (called from WearRuntime's event fan-out)

  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED -> onConnected()
      LinkState.DISCONNECTED -> onDisconnected()
      else -> {}
    }
  }

  /** The link reached CONNECTED (also fired after every sync; only the first call per session acts). */
  fun onConnected() {
    val handle = link.handle() ?: return
    synchronized(lock) {
      if (subscribedSession === handle.session) return
      subscription?.close()
      subscribedSession = handle.session
      subscription = handle.session.subscribe(
        Weather.id,
        Weather.WeatherDeviceRequest.id,
        "weather request",
      ) { packet -> onWatchMessage(handle.session, packet) }
    }
    val supported = HuaweiWeatherSender(handle.session, events).supported()
    info("Weather: the watch ${if (supported) "lists" else "does not list"} the weather service (0f/01); switch is ${if (settings.enabled) "on" else "off"}")
    if (settings.enabled && supported) scope.launch { pushAndSchedule("connect", CONNECT_MAX_AGE_SEC) }
  }

  fun onDisconnected() {
    synchronized(lock) {
      subscription?.close()
      subscription = null
      subscribedSession = null
    }
    stopTicker()
  }

  /** A setting changed: push at once when the watch is connected, or stop the timer when the switch went off. */
  fun onSettingsChanged() {
    cache = null
    cacheKey = null
    scope.launch {
      if (link.handle() == null) return@launch
      if (settings.enabled) pushAndSchedule("settings", 0) else stopTicker()
    }
  }

  /** The interval changed: the next push is one new interval away. */
  fun onIntervalChanged() {
    if (link.handle() != null && settings.enabled) scheduleNext(intervalMs())
  }

  // Watch request

  /** Runs on the read thread: must not block, so the work moves to the scope. */
  private fun onWatchMessage(session: HuaweiSession, packet: HuaweiPacket) {
    val code = packet.tlv?.getInteger(0x7f, -1) ?: -1
    scope.launch {
      val sender = HuaweiWeatherSender(session, events)
      try {
        if (code != WATCH_REQUEST_CODE) {
          info("Weather: watch message 0x%08x, acknowledged".format(code))
          sender.acknowledge()
          return@launch
        }
        info("Weather: the watch asked for weather")
        if (!settings.enabled) {
          info("Weather: switch is off, telling the watch")
          sender.sendError(Weather.ErrorCode.WEATHER_DISABLED)
          return@launch
        }
        try {
          pushAndSchedule("watch request", REQUEST_MAX_AGE_SEC, rethrow = true)
        } catch (e: WearException) {
          WeatherErrorCodes.watchError(e.errorCode)?.let { sender.sendError(it) }
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Weather: answering the watch failed: ${e.message ?: e.javaClass.simpleName}")
      }
    }
  }

  // Fetch and push

  /**
   * One push, then the next alarm: an interval away, or [RETRY_MS] when the network failed. Errors
   * are logged and kept in the status; with [rethrow] they reach the caller (the watch request).
   */
  private suspend fun pushAndSchedule(reason: String, maxAgeSec: Long, rethrow: Boolean = false) {
    var delay = intervalMs()
    var failure: WearException? = null
    try {
      push(reason, maxAgeSec)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      failure = e
    } catch (e: Exception) {
      // Anything unexpected (a SecurityException, bad JSON values) must not escape the scope.
      failure = WearException(WeatherErrorCodes.NETWORK, "Could not get the weather: ${e.message ?: e.javaClass.simpleName}", e)
      lastError = failure.message
    }
    if (failure != null) {
      error("Weather ($reason) failed [${failure.errorCode}]: ${failure.message}")
      if (failure.errorCode == WeatherErrorCodes.NETWORK) delay = minOf(delay, RETRY_MS)
    }
    scheduleNext(delay)
    if (failure != null && rethrow) throw failure
  }

  /**
   * Fetches (or reuses a report younger than [maxAgeSec]) and sends it. Returns false when another
   * push was already running. Throws [WearException]: NOT_CONNECTED, UNSUPPORTED, a [WeatherErrorCodes]
   * code, or the protocol error of the failed request.
   */
  suspend fun push(reason: String, maxAgeSec: Long): Boolean {
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")
    val sender = HuaweiWeatherSender(handle.session, events)
    if (!sender.supported()) throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not support weather")
    if (!settings.enabled) throw WearException(WeatherErrorCodes.DISABLED, "Weather is switched off")
    if (!pushing.tryLock()) {
      info("Weather ($reason): a push is already running, skipped")
      return false
    }
    try {
      val report = try {
        report(maxAgeSec)
      } catch (e: WearException) {
        lastError = e.message
        throw e
      }
      try {
        sender.send(report, settings.unit, System.currentTimeMillis() / 1000, ZoneId.systemDefault())
      } catch (e: WearException) {
        lastError = e.message
        throw e
      }
      lastPushAtSec = System.currentTimeMillis() / 1000
      lastError = null
      lastTempC = WeatherPackets.temperatureByte(report.tempC).toInt()
      lastCondition = WeatherIcons.forWmo(report.code).name
      lastPlaceName = report.place.name
      info("Weather ($reason): pushed")
      return true
    } finally {
      pushing.unlock()
    }
  }

  private fun cacheKeyOf(): String = when (settings.locationMode) {
    WeatherLocationMode.CITY -> settings.city.let { "city:${it?.latitude},${it?.longitude}" }
    WeatherLocationMode.CURRENT -> "current"
  }

  private suspend fun report(maxAgeSec: Long): WeatherReport {
    val now = System.currentTimeMillis() / 1000
    val key = cacheKeyOf()
    cache?.let { if (cacheKey == key && now - it.fetchedAtSec <= maxAgeSec) return it }

    val place = when (settings.locationMode) {
      WeatherLocationMode.CITY -> settings.city
        ?: throw WearException(WeatherErrorCodes.LOCATION, "No city chosen for the weather")
      WeatherLocationMode.CURRENT -> try {
        location.current()
      } catch (e: WeatherLocationException) {
        throw WearException(WeatherErrorCodes.LOCATION, e.message ?: "No location", e)
      }
    }
    info("Weather: fetching Open-Meteo for ${place.name ?: "an unnamed place"} (%.2f, %.2f)".format(place.latitude, place.longitude))
    val report = try {
      withContext(Dispatchers.IO) { OpenMeteo.fetchForecast(place, now) }
    } catch (e: IOException) {
      throw WearException(WeatherErrorCodes.NETWORK, "Could not get the weather: ${e.message ?: e.javaClass.simpleName}", e)
    }
    cache = report
    cacheKey = key
    return report
  }

  /** `refreshWeather()` from JS: a fresh fetch and push now; throws what went wrong. */
  suspend fun refreshNow(): Map<String, Any?> {
    pushAndSchedule("app", 0, rethrow = true)
    return status()
  }

  /** Geocodes [query] and stores the first match as the chosen city. */
  suspend fun setCity(query: String): WeatherPlace {
    if (query.isBlank()) throw WearException(ErrorCodes.INVALID_ARGUMENT, "Enter a city name")
    val places = try {
      withContext(Dispatchers.IO) { OpenMeteo.searchCity(query) }
    } catch (e: IOException) {
      throw WearException(WeatherErrorCodes.NETWORK, "Could not search for the city: ${e.message ?: e.javaClass.simpleName}", e)
    }
    val place = places.firstOrNull() ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "No city found for \"${query.trim()}\"")
    settings.city = place
    info("Weather: city set to ${place.name} (${place.detail ?: "no region"}) %.2f, %.2f".format(place.latitude, place.longitude))
    onSettingsChanged()
    return place
  }

  // Settings from JS; each validates, stores, and acts on a connected watch.

  fun setEnabled(enabled: Boolean) {
    settings.enabled = enabled
    info("Weather: switch ${if (enabled) "on" else "off"}")
    onSettingsChanged()
  }

  fun setUnit(wire: String) {
    settings.unit = TemperatureUnit.fromWire(wire)
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Temperature unit must be celsius or fahrenheit, got '$wire'")
    onSettingsChanged()
  }

  fun setLocationMode(wire: String) {
    settings.locationMode = WeatherLocationMode.fromWire(wire)
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Location mode must be current or city, got '$wire'")
    onSettingsChanged()
  }

  fun setIntervalMinutes(minutes: Int) {
    if (minutes < WeatherSettings.MIN_INTERVAL_MIN || minutes > WeatherSettings.MAX_INTERVAL_MIN) {
      throw WearException(
        ErrorCodes.INVALID_ARGUMENT,
        "Weather interval must be ${WeatherSettings.MIN_INTERVAL_MIN} to ${WeatherSettings.MAX_INTERVAL_MIN} minutes, got $minutes",
      )
    }
    settings.intervalMinutes = minutes
    onIntervalChanged()
  }

  fun status(): Map<String, Any?> {
    val handle = link.handle()
    return mapOf(
      "enabled" to settings.enabled,
      "unit" to settings.unit.wire,
      "locationMode" to settings.locationMode.wire,
      "intervalMinutes" to settings.intervalMinutes,
      "city" to settings.city?.toJs(),
      "locationPermission" to location.hasPermission(),
      "watchSupported" to handle?.let { HuaweiWeatherSender(it.session, events).supported() },
      "lastPushAt" to lastPushAtSec,
      "lastError" to lastError,
      "lastTemperatureC" to lastTempC,
      "lastCondition" to lastCondition,
      "lastLocationName" to lastPlaceName,
    )
  }

  // Timer

  private fun intervalMs() = settings.intervalMinutes * 60_000L

  private fun scheduleNext(delayMs: Long) {
    if (!settings.enabled || link.handle() == null) return
    synchronized(lock) {
      if (!receiverRegistered) {
        val filter = IntentFilter(ACTION_TICK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          appContext.registerReceiver(receiver, filter)
        }
        receiverRegistered = true
      }
    }
    alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, tickIntent)
  }

  private fun stopTicker() {
    alarmManager.cancel(tickIntent)
    synchronized(lock) {
      if (receiverRegistered) {
        try {
          appContext.unregisterReceiver(receiver)
        } catch (e: IllegalArgumentException) {
          // Already gone.
        }
        receiverRegistered = false
      }
    }
  }

  companion object {
    const val ACTION_TICK = "com.joyodigitama.huaweiwear.action.WEATHER_TICK"

    /** Weather request code in the watch's 0f/04 message (GB handleAsyncMessage). */
    const val WATCH_REQUEST_CODE = 0x000186AA

    /** A reconnect inside this window reuses the last fetched report. */
    private const val CONNECT_MAX_AGE_SEC = 10 * 60L

    /** A watch that opens its weather screen repeatedly does not refetch inside this window. */
    private const val REQUEST_MAX_AGE_SEC = 5 * 60L

    private const val RETRY_MS = 10 * 60_000L
    private const val WAKE_LOCK_MS = 2 * 60_000L
  }
}
