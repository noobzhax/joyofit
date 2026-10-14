package com.joyodigitama.huaweiwear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the background service after a reboot or an app update when background mode is on. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val runtime = WearRuntime.get(context)
    runtime.ensureServiceRunning()
  }
}
