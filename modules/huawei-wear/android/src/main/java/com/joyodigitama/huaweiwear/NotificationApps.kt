package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/** The app chooser's data: launcher apps and whether their notifications are forwarded. */
internal object NotificationApps {
  fun list(context: Context, settings: WearSettings): List<Map<String, Any?>> {
    val pm = context.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val seen = HashSet<String>()
    val apps = ArrayList<Pair<String, Map<String, Any?>>>()
    for (resolved in pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))) {
      val info = resolved.activityInfo?.applicationInfo ?: continue
      val packageName = info.packageName
      if (packageName == context.packageName || !seen.add(packageName)) continue
      val label = pm.getApplicationLabel(info).toString().ifBlank { packageName }
      val enabled = NotificationPolicy.appAllowed(settings.appChoice(packageName), NotificationPolicy.isSystemApp(info.flags))
      apps.add(label.lowercase() to mapOf("packageName" to packageName, "label" to label, "enabled" to enabled))
    }
    return apps.sortedBy { it.first }.map { it.second }
  }
}
