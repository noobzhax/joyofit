package com.joyodigitama.huaweiwear

/**
 * The watch's cloud-config file check (Huawei Health 17.0.8.300 `mza` HwCloudFileConfigManager, `fft` FeatureConfigFileManager;
 * notes in the RE workspace, FEATURE_CONFIG_PROTOCOL.md). With Huawei Health's reverse capabilities the watch asks every 15 s,
 * as SampleConfig 900100007 action 2, whether `com.huawei.health_deviceFeature_config` (regional health features such as
 * ECG and blood pressure) has an update. JoyoFit has no newer file, so it answers "current" (action 2, data `"00"`, no
 * modify time), which is Huawei Health's answer when the watch is up to date; that ends the polling.
 */
internal class FeatureConfig(private val dataSync: DataSyncService, private val events: WearEvents) : DataSyncFeature {
  override val name = "feature config"

  override fun register(service: DataSyncService) {
    service.onConfig(PHONE_PKG, WATCH_PKG, CONFIG_ID) { config ->
      val item = config.items.firstOrNull() ?: return@onConfig
      if (item.action != ACTION_QUERY) {
        events.log(LogDirection.INFO, null, null, null, "Feature config: action ${item.action} not answered")
        return@onConfig
      }
      dataSync.sendConfig(PHONE_PKG, WATCH_PKG, CONFIG_ID, UP_TO_DATE, action = ACTION_QUERY, modifyMs = null, what = "feature config up to date")
    }
  }

  companion object {
    const val PHONE_PKG = "hw.unitedevice.configManager"
    const val WATCH_PKG = "featureManager"
    const val CONFIG_ID = 900100007
    const val ACTION_QUERY = 2
    val UP_TO_DATE = "00".toByteArray()
  }
}
