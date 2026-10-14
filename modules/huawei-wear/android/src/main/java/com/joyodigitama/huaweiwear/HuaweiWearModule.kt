package com.joyodigitama.huaweiwear

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `UserProfile` in `HuaweiWear.types.ts`. */
class UserProfileRecord : Record {
  @Field var heightCm: Int = 0
  @Field var weightKg: Double = 0.0
  @Field var birthYear: Int = 0
  @Field var sex: String = "unknown"
  @Field var dailyStepGoal: Int = 0
}

/**
 * Expo module implementing `HuaweiWearModule.ts`. All protocol work lives in [WearLink], reached
 * through the process-wide [WearRuntime] that the background service shares; this class wires the
 * TS contract to it and forwards runtime events (`onStateChange` / `onBattery` / `onLog` /
 * `onSyncComplete`) to JS while the module is alive.
 */
class HuaweiWearModule : Module() {
  // After OnDestroy the module may no longer emit; a JS reload starts from a fresh module.
  @Volatile
  private var destroyed = false

  private val listener = object : WearEvents {
    override fun state(state: LinkState, error: String?) {
      emit("onStateChange", mapOf("state" to state.wire, "error" to error))
    }

    override fun battery(level: Int) {
      emit("onBattery", mapOf("level" to level))
    }

    override fun syncComplete(summary: SyncSummary) {
      emit("onSyncComplete", summary.toJs())
    }

    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      emit(
        "onLog",
        mapOf(
          "ts" to System.currentTimeMillis(),
          "direction" to direction.wire,
          "serviceId" to serviceId,
          "commandId" to commandId,
          "hex" to hex,
          "message" to message,
        ),
      )
    }

    private fun emit(name: String, payload: Map<String, Any?>) {
      if (destroyed) return
      try {
        sendEvent(name, payload)
      } catch (e: Exception) {
        // The JS runtime may be gone (reload); losing an event must never break the link.
        android.util.Log.w(TAG, "Dropped $name event: ${e.message}")
      }
    }
  }

  // Kept so OnDestroy can still reach the runtime after the React context is gone.
  @Volatile
  private var runtimeRef: WearRuntime? = null

  private fun runtime(): WearRuntime =
    runtimeRef ?: WearRuntime.get(appContext.reactContext ?: throw Exceptions.ReactContextLost()).also { runtimeRef = it }

  private fun profileOf(record: UserProfileRecord) = UserProfileData(
    heightCm = record.heightCm,
    weightKg = record.weightKg,
    birthYear = record.birthYear,
    sex = record.sex,
    dailyStepGoal = record.dailyStepGoal,
  )

  override fun definition() = ModuleDefinition {
    Name("HuaweiWear")

    Events("onStateChange", "onBattery", "onLog", "onSyncComplete")

    OnCreate {
      val runtime = runtime()
      runtime.addListener(listener)
      runtime.ensureServiceRunning()
    }

    AsyncFunction("getBondedDevices") {
      runtime().link.bondedDevices()
    }

    AsyncFunction("connect") Coroutine { address: String ->
      runtime().connectFromApp(address)
    }

    AsyncFunction("disconnect") {
      runtime().disconnectFromApp()
    }

    // The link outlives JS reloads when the background service owns it.
    Function("getState") {
      runtime().link.currentState()
    }

    Function("getDevice") {
      val runtime = runtime()
      runtime.link.deviceInfo()?.let { info ->
        runtime.status.value.battery?.let { info + ("batteryLevel" to it) } ?: info
      }
    }

    AsyncFunction("refreshBattery") Coroutine { ->
      runtime().link.refreshBattery()
    }

    AsyncFunction("syncActivity") Coroutine { ->
      runtime().link.syncActivity().toJs()
    }

    AsyncFunction("forgetDevice") { address: String ->
      runtime().forget(address)
    }

    AsyncFunction("setBackgroundEnabled") { address: String? ->
      runtime().setBackground(address)
    }

    Function("getBackgroundStatus") {
      runtime().backgroundStatus()
    }

    AsyncFunction("setSyncIntervalMinutes") { minutes: Int ->
      runtime().setSyncInterval(minutes)
    }

    AsyncFunction("openNotificationAccess") {
      runtime().openNotificationAccess()
    }

    Function("getNotificationAccess") {
      runtime().notificationAccessStatus()
    }

    AsyncFunction("setNotificationsEnabled") Coroutine { enabled: Boolean ->
      runtime().setNotificationsEnabled(enabled)
    }

    AsyncFunction("getNotificationApps") Coroutine { ->
      runtime().notificationApps()
    }

    AsyncFunction("setNotificationAppEnabled") { packageName: String, enabled: Boolean ->
      runtime().settings.setAppChoice(packageName, enabled)
    }

    Function("getUserProfile") {
      runtime().settings.profile?.toJs()
    }

    AsyncFunction("setUserProfile") Coroutine { profile: UserProfileRecord ->
      runtime().setUserProfile(profileOf(profile))
    }

    // Find my watch / find my phone, calls and alarms (PhoneFeaturesModuleApi.kt).
    phoneFeaturesApi { runtime() }

    // Health Connect export: status, permission request, enable + backfill (HealthConnectModuleApi.kt).
    healthConnectApi { runtime() }

    // Weather: settings, status, refresh (WeatherModuleApi.kt).
    weatherApi { runtime() }

    OnDestroy {
      destroyed = true
      runtimeRef?.let {
        it.removeListener(listener)
        it.onModuleDestroyed()
      }
    }
  }

  private companion object {
    const val TAG = "HuaweiWear"
  }
}
