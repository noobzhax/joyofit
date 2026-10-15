package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The photo face part of the `HuaweiWear` module (`getPhotoFace` ... `setPhotoFaceActive` in
 * `HuaweiWearModule.ts`). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.photoFaceApi(runtime: () -> WearRuntime) {
  AsyncFunction("getPhotoFace") Coroutine { ->
    runtime().photoFaces.info()
  }

  AsyncFunction("addPhoto") Coroutine { uri: String ->
    runtime().photoFaces.add(uri)
  }

  AsyncFunction("deletePhoto") Coroutine { name: String ->
    runtime().photoFaces.delete(name)
  }

  AsyncFunction("setPhotoFaceActive") Coroutine { ->
    runtime().photoFaces.setActive()
  }
}
