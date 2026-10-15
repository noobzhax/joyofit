package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `FaceStyleChoice` in `HuaweiWearFaceCustom.types.ts`. */
class FaceStyleRecord : Record {
  @Field var mode: Int = 0
  @Field var index: Int = 0
}

/** `FaceCustomization` in `HuaweiWearFaceCustom.types.ts`. */
class FaceCustomizationRecord : Record {
  @Field var marketId: String = ""
  @Field var styles: List<FaceStyleRecord> = emptyList()
  @Field var colourIndex: Int? = null
  @Field var customColour: String? = null
  @Field var widgets: List<Int> = emptyList()

  internal fun toConfig() = FaceCustomization(
    marketId = marketId,
    styles = styles.map { FaceStyleChoice(it.mode, it.index) },
    colourIndex = colourIndex,
    customColour = customColour,
    widgets = widgets,
  )
}

/**
 * The editable-face part of the `HuaweiWear` module (`getFaceCustomization`, `applyFaceCustomization` in
 * `HuaweiWearModule.ts`, and the `onFaceCustomization` event). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.faceCustomApi(runtime: () -> WearRuntime) {
  AsyncFunction("getFaceCustomization") Coroutine { faceId: String ->
    runtime().faceCustomizer.query(faceId).toJs()
  }

  AsyncFunction("applyFaceCustomization") Coroutine { faceId: String, config: FaceCustomizationRecord ->
    runtime().faceCustomizer.apply(faceId, config.toConfig()).toJs()
  }
}
