package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.Intent
import androidx.health.connect.client.PermissionController
import expo.modules.kotlin.activityresult.AppContextActivityResultContract

/**
 * Health Connect's own permission request contract ([PermissionController.createRequestPermissionResultContract])
 * adapted to Expo's activity-result registry. Input is the set of permission strings to ask for;
 * the output is the set that is now granted.
 */
internal class HealthConnectPermissionContract : AppContextActivityResultContract<HashSet<String>, Set<String>> {
  private val inner = PermissionController.createRequestPermissionResultContract()

  override fun createIntent(context: Context, input: HashSet<String>): Intent = inner.createIntent(context, input)

  override fun parseResult(input: HashSet<String>, resultCode: Int, intent: Intent?): Set<String> =
    inner.parseResult(resultCode, intent)
}
