package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The watch face part of the `HuaweiWear` module (`listWatchfaces` ... `deleteWatchface` in
 * `HuaweiWearModule.ts`). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchfaceApi(runtime: () -> WearRuntime) {
  AsyncFunction("listWatchfaces") Coroutine { ->
    runtime().watchfaces.list()
  }

  AsyncFunction("installWatchface") Coroutine { uri: String, signature: String?, fileName: String? ->
    runtime().watchfaces.install(uri, signature, fileName)
  }

  AsyncFunction("setActiveWatchface") Coroutine { id: String ->
    runtime().watchfaces.setActive(id)
  }

  AsyncFunction("deleteWatchface") Coroutine { id: String ->
    runtime().watchfaces.delete(id)
  }
}
