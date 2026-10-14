package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The weather part of the `HuaweiWear` module (`getWeatherStatus` ... in `HuaweiWearModule.ts`),
 * kept out of [HuaweiWearModule]. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.weatherApi(runtime: () -> WearRuntime) {
  Function("getWeatherStatus") {
    runtime().weather.status()
  }

  AsyncFunction("setWeatherEnabled") { enabled: Boolean ->
    runtime().weather.setEnabled(enabled)
  }

  AsyncFunction("setWeatherUnit") { unit: String ->
    runtime().weather.setUnit(unit)
  }

  AsyncFunction("setWeatherLocationMode") { mode: String ->
    runtime().weather.setLocationMode(mode)
  }

  AsyncFunction("setWeatherIntervalMinutes") { minutes: Int ->
    runtime().weather.setIntervalMinutes(minutes)
  }

  AsyncFunction("setWeatherCity") Coroutine { query: String ->
    runtime().weather.setCity(query).toJs()
  }

  AsyncFunction("refreshWeather") Coroutine { ->
    runtime().weather.refreshNow()
  }
}
