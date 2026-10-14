package com.joyodigitama.huaweiwear

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Receives every posted notification once the user grants notification access and hands it to the
 * [NotificationForwarder]. The system binds this service on its own, so forwarding works while the
 * app UI is closed as long as the link is up.
 */
class WatchNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    WearRuntime.get(this).forwarder.onPosted(sbn)
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification) {
    WearRuntime.get(this).forwarder.onRemoved(sbn)
  }
}
