package com.joyodigitama.huaweiwear

import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The Health Connect part of the `HuaweiWear` module (`getHealthConnectStatus` ... in
 * `HuaweiWearModule.ts`), kept out of [HuaweiWearModule] because it needs its own activity-result
 * registration. Call once from the module definition. A module has a single
 * `RegisterActivityContracts` block: add further contracts inside this function's block.
 */
internal fun ModuleDefinitionBuilder.healthConnectApi(runtime: () -> WearRuntime) {
  lateinit var permissionLauncher: AppContextActivityResultLauncher<HashSet<String>, Set<String>>

  RegisterActivityContracts {
    permissionLauncher = registerForActivityResult(HealthConnectPermissionContract())
  }

  AsyncFunction("getHealthConnectStatus") Coroutine { ->
    runtime().healthConnect.status()
  }

  AsyncFunction("requestHealthConnectPermissions") Coroutine { ->
    val exporter = runtime().healthConnect
    if (exporter.availability() != "available") {
      throw WearException(ErrorCodes.UNSUPPORTED, "Health Connect is not available on this phone (${exporter.availability()})")
    }
    val missing = exporter.requiredPermissions() - exporter.grantedPermissions()
    if (missing.isNotEmpty()) permissionLauncher.launch(HashSet(missing))
    exporter.status()
  }

  AsyncFunction("setHealthConnectEnabled") Coroutine { enabled: Boolean ->
    val exporter = runtime().healthConnect
    exporter.setEnabled(enabled)
    exporter.status()
  }

  AsyncFunction("backfillHealthConnect") Coroutine { ->
    runtime().healthConnect.backfill()
  }

  // After two denials Android stops showing the permission dialog; the user then grants in Health Connect itself.
  AsyncFunction("openHealthConnectSettings") {
    val context = runtime().appContext
    context.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
}
