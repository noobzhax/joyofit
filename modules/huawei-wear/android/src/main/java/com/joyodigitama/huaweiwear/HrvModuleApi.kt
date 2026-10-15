package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The 1-minute HRV measurement and the automatic stress switch of the `HuaweiWear` module (`measureHrv`,
 * `cancelHrvMeasurement`, `setAutomaticStress`, `getStressStatus` in `HuaweiWearModule.ts`); progress goes out as
 * `onHrvProgress`. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.hrvApi(runtime: () -> WearRuntime) {
  AsyncFunction("measureHrv") Coroutine { ->
    runtime().hrv.measure().toJs()
  }

  AsyncFunction("cancelHrvMeasurement") {
    runtime().hrv.cancel()
  }

  Function("getStressStatus") {
    runtime().stress.status()
  }

  AsyncFunction("setAutomaticStress") Coroutine { enabled: Boolean ->
    runtime().stress.setEnabled(enabled)
  }
}
