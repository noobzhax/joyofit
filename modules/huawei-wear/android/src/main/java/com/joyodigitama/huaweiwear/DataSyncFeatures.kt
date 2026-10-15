package com.joyodigitama.huaweiwear

/**
 * Every feature built on [DataSyncService]. Called once from [WearRuntime]'s `init`, after the features are constructed.
 * To add one: construct it in WearRuntime (it needs the runtime's store, link, settings) and add a `register` line here.
 */
internal object DataSyncFeatures {
  fun install(rt: WearRuntime) {
    rt.dataSync.register(rt.diet)
    rt.dataSync.register(rt.bodyMetrics)
    rt.dataSync.register(rt.activityGoals)
    rt.dataSync.register(rt.faceCustomizer)
    rt.dataSync.register(rt.liveWorkout)
    rt.dataSync.register(FeatureConfig(rt.dataSync, rt.sink))
    rt.extras.features.forEach { rt.dataSync.register(it) }
  }
}
