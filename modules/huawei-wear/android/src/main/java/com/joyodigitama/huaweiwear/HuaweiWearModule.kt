package com.joyodigitama.huaweiwear

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module implementing `HuaweiWearModule.ts`. All protocol work lives in [WearLink]; this class
 * only wires the TS contract (functions + `onStateChange` / `onBattery` / `onLog` events) to it.
 */
class HuaweiWearModule : Module() {
  // After OnDestroy the module may no longer emit; a JS reload starts from a fresh module.
  @Volatile
  private var destroyed = false

  private val events = object : WearEvents {
    override fun state(state: LinkState, error: String?) {
      emit("onStateChange", mapOf("state" to state.wire, "error" to error))
    }

    override fun battery(level: Int) {
      emit("onBattery", mapOf("level" to level))
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

  private var link: WearLink? = null

  private fun link(): WearLink = synchronized(this) {
    link ?: WearLink(appContext.reactContext ?: throw Exceptions.ReactContextLost(), events).also { link = it }
  }

  override fun definition() = ModuleDefinition {
    Name("HuaweiWear")

    Events("onStateChange", "onBattery", "onLog")

    AsyncFunction("getBondedDevices") {
      link().bondedDevices()
    }

    AsyncFunction("connect") Coroutine { address: String ->
      link().connect(address)
    }

    AsyncFunction("disconnect") {
      link?.disconnect()
      Unit
    }

    // A fresh module (JS reload) is always disconnected.
    Function("getState") {
      link?.currentState() ?: LinkState.DISCONNECTED.wire
    }

    AsyncFunction("refreshBattery") Coroutine { ->
      link().refreshBattery()
    }

    AsyncFunction("syncActivity") Coroutine { fromSec: Double ->
      link().syncActivity(fromSec.toLong())
    }

    AsyncFunction("forgetDevice") { address: String ->
      link().forget(address)
    }

    OnDestroy {
      destroyed = true
      link?.shutdown()
    }
  }

  private companion object {
    const val TAG = "HuaweiWear"
  }
}
