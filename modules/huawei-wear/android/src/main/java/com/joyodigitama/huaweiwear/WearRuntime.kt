package com.joyodigitama.huaweiwear

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteException
import android.os.Build
import android.provider.Settings
import java.time.Year
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What the service notification shows. */
internal data class ServiceStatus(
  val state: LinkState,
  val battery: Int?,
  /** `SyncResult.to` of the last stored sync of this process, unix seconds. */
  val lastSyncSec: Long?,
  /** Why the link is down, when the background loop knows (waiting for Bluetooth, retry, paused...). */
  val note: String?,
)

/**
 * Process-wide owner of the one [WearLink]. The JS module, the foreground service, the notification
 * listener and the boot receiver all reach the watch through this object, so there is never a
 * second socket. Events fan out to whichever JS module instance is alive (none, when the app UI
 * is closed) and update [status] for the service notification.
 */
internal class WearRuntime private constructor(context: Context) {
  val appContext: Context = context.applicationContext
  val settings = WearSettings(appContext)
  val syncStore = SyncStore(appContext)
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  val status = MutableStateFlow(ServiceStatus(LinkState.DISCONNECTED, null, null, null))

  private val listeners = CopyOnWriteArraySet<WearEvents>()

  /** Set by the foreground service while it runs. */
  @Volatile
  var controller: BackgroundController? = null

  /**
   * The user disconnected in the app while background mode is on: auto-reconnect waits until a
   * connect from the app, or background being switched off and on again.
   */
  @Volatile
  var paused = false
    private set

  private val events = object : WearEvents {
    override fun state(state: LinkState, error: String?) {
      status.update { it.copy(state = state, note = if (state == LinkState.DISCONNECTED) it.note else null) }
      listeners.forEach { it.state(state, error) }
      if (state == LinkState.DISCONNECTED || state == LinkState.CONNECTED) controller?.onLinkChanged()
    }

    override fun battery(level: Int) {
      status.update { it.copy(battery = level) }
      listeners.forEach { it.battery(level) }
    }

    override fun syncComplete(summary: SyncSummary) {
      status.update { it.copy(lastSyncSec = summary.to) }
      listeners.forEach { it.syncComplete(summary) }
    }

    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      // Mirrored to logcat (tag WatchFit) so the log can be read over adb, even with the UI closed.
      val ids = if (serviceId != null) " svc=%02x cmd=%02x".format(serviceId, commandId ?: 0) else ""
      val line = "${direction.wire.uppercase()}$ids $message" + if (hex != null) " $hex" else ""
      if (direction == LogDirection.ERROR) android.util.Log.e("WatchFit", line) else android.util.Log.i("WatchFit", line)
      listeners.forEach { it.log(direction, serviceId, commandId, hex, message) }
    }
  }

  /** Same fan-out the link reports through; background code logs here so the Log tab shows it. */
  val sink: WearEvents get() = events

  val link = WearLink(appContext, events, settings, syncStore)
  val forwarder = NotificationForwarder(appContext, settings, link, events, scope)

  fun addListener(listener: WearEvents) {
    listeners.add(listener)
  }

  fun removeListener(listener: WearEvents) {
    listeners.remove(listener)
  }

  /** Seeds the notification's "synced" time from the database before this process has synced. */
  fun loadLastSync() {
    val address = settings.watchAddress ?: return
    scope.launch(Dispatchers.IO) {
      try {
        syncStore.lastSync(address)?.let { last -> status.update { it.copy(lastSyncSec = it.lastSyncSec ?: last) } }
      } catch (e: SQLiteException) {
        events.log(LogDirection.ERROR, null, null, null, "Could not read the last sync time: ${e.message}")
      }
    }
  }

  fun setNote(note: String?) {
    status.update { it.copy(note = note) }
  }

  // Link actions from the app

  suspend fun connectFromApp(address: String): Map<String, Any?> {
    paused = false
    return link.connect(address)
  }

  fun disconnectFromApp() {
    if (settings.backgroundEnabled) {
      paused = true
      setNote("Disconnected in the app. Connect there to resume.")
    }
    link.disconnect()
  }

  fun forget(rawAddress: String) {
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    link.forget(address)
    if (settings.watchAddress == address) {
      setBackground(null)
      settings.watchAddress = null
      settings.watchName = null
    }
  }

  /** JS reload with background off: nothing keeps the link, so it is closed as before. */
  fun onModuleDestroyed() {
    if (!settings.backgroundEnabled) link.shutdown()
  }

  // Background mode

  fun setBackground(rawAddress: String?) {
    if (rawAddress == null) {
      settings.backgroundEnabled = false
      paused = false
      setNote(null)
      WatchService.stop(appContext)
      return
    }
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    if (!BluetoothAdapter.checkBluetoothAddress(address)) {
      throw WearException(ErrorCodes.INVALID_ADDRESS, "'$rawAddress' is not a Bluetooth address")
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission is not granted; the background service needs it")
    }
    if (settings.watchAddress != address) settings.watchName = null
    settings.watchAddress = address
    settings.backgroundEnabled = true
    paused = false
    setNote(null)
    WatchService.start(appContext)
    controller?.nudge(true)
  }

  /** Brings the service back if background mode is on but it is not running (process death, update). */
  fun ensureServiceRunning() {
    if (settings.backgroundEnabled && settings.watchAddress != null && !WatchService.isActive) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
      ) {
        // Android 14 refuses a connectedDevice service without it; the user has to grant it in the app.
        events.log(LogDirection.ERROR, null, null, null, "Background service not started: BLUETOOTH_CONNECT is not granted")
        return
      }
      try {
        WatchService.start(appContext)
      } catch (e: Exception) {
        events.log(LogDirection.ERROR, null, null, null, "Could not start the background service: ${e.message}")
      }
    }
  }

  fun backgroundStatus(): Map<String, Any?> = mapOf(
    "enabled" to settings.backgroundEnabled,
    "address" to settings.watchAddress,
    "name" to settings.watchName,
    "running" to WatchService.isActive,
    "paused" to paused,
    "syncIntervalMinutes" to settings.syncIntervalMinutes,
  )

  fun setSyncInterval(minutes: Int) {
    if (minutes < WearSettings.MIN_SYNC_INTERVAL_MIN || minutes > WearSettings.MAX_SYNC_INTERVAL_MIN) {
      throw WearException(
        ErrorCodes.INVALID_ARGUMENT,
        "Sync interval must be ${WearSettings.MIN_SYNC_INTERVAL_MIN} to ${WearSettings.MAX_SYNC_INTERVAL_MIN} minutes, got $minutes",
      )
    }
    settings.syncIntervalMinutes = minutes
    controller?.reschedule()
  }

  // Notifications

  fun notificationAccessGranted(): Boolean {
    val manager = appContext.getSystemService(android.app.NotificationManager::class.java)
    return manager.isNotificationListenerAccessGranted(ComponentName(appContext, WatchNotificationListener::class.java))
  }

  fun notificationAccessStatus(): Map<String, Any?> = mapOf(
    "granted" to notificationAccessGranted(),
    "enabled" to settings.notificationsEnabled,
  )

  fun openNotificationAccess() {
    val list = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      appContext.startActivity(list)
      return
    }
    // Android 11+ can open this app's own entry; fall back to the list if that screen is missing.
    val component = ComponentName(appContext, WatchNotificationListener::class.java)
    val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
      .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      appContext.startActivity(detail)
    } catch (e: android.content.ActivityNotFoundException) {
      appContext.startActivity(list)
    }
  }

  /** Stores the switch and, when the watch is connected, mirrors it to the watch (GB SetNotificationRequest). */
  suspend fun setNotificationsEnabled(enabled: Boolean) {
    settings.notificationsEnabled = enabled
    val handle = link.handle() ?: return
    try {
      ProfileSender.sendNotificationSwitch(handle.session, events, enabled)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "NotificationState not sent: ${e.message}")
    }
  }

  suspend fun notificationApps(): List<Map<String, Any?>> =
    withContext(Dispatchers.IO) { NotificationApps.list(appContext, settings) }

  // Profile

  fun validate(profile: UserProfileData) {
    fun bad(what: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, what)
    if (profile.heightCm !in 100..250) bad("Height must be 100 to 250 cm")
    if (!(profile.weightKg in 20.0..300.0)) bad("Weight must be 20 to 300 kg")
    if (profile.birthYear !in 1900..Year.now().value) bad("Birth year must be 1900 to ${Year.now().value}")
    if (profile.sex != "male" && profile.sex != "female" && profile.sex != "unknown") bad("Sex must be male, female or unknown")
    if (profile.dailyStepGoal !in 1000..100_000) bad("Step goal must be 1000 to 100000")
  }

  /** Stores the profile; true when it also reached the connected watch. */
  suspend fun setUserProfile(profile: UserProfileData): Boolean {
    validate(profile)
    settings.profile = profile
    val handle = link.handle() ?: return false
    return try {
      ProfileSender.sendProfile(handle.session, events, profile) > 0
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      events.log(LogDirection.ERROR, null, null, null, "Profile not sent: ${e.message}")
      false
    }
  }

  companion object {
    @Volatile
    private var instance: WearRuntime? = null

    fun get(context: Context): WearRuntime =
      instance ?: synchronized(this) {
        instance ?: WearRuntime(context).also { instance = it }
      }
  }
}
