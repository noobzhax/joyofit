// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiNotificationsManager.{onNotification,onDeleteNotification,
// addNotificationToCache} and the notification extraction of externalevents/NotificationListener.
package com.joyodigitama.huaweiwear

import android.app.Notification
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.StatusBarNotification
import java.util.LinkedList
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Turns [StatusBarNotification]s into GB's Notifications packets and sends them over the single
 * link, if the watch supports them. Filters: own app, ongoing, group summaries, local-only, calls,
 * media controls, progress, empty text, per-app choice (default: all except system apps) and an
 * exact repeat of the same notification.
 */
internal class NotificationForwarder(
  context: Context,
  private val settings: WearSettings,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val ownPackage = appContext.packageName

  private val lock = Any()

  /** HuaweiNotificationsManager.notificationSpecCache: the last notifications, for remove requests. */
  private val cache = LinkedList<WatchNotification>()

  /** Notification key -> hash of what was last sent for it; identical reposts are dropped. */
  private val lastSent = HashMap<String, Int>()
  private var nextId = 1
  private var msgId: Short = 0

  /** GB's `getNotificationId` counter, shared with the call notifications so message ids never collide. */
  fun nextMessageId(): Short = synchronized(lock) {
    msgId = NotificationPackets.nextMessageId(msgId)
    msgId
  }

  fun onPosted(sbn: StatusBarNotification) {
    if (!settings.notificationsEnabled) return
    val notification = sbn.notification ?: return
    val extras = notification.extras
    val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.let(::sanitize)
    val big = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    val body = (if (!big.isNullOrBlank()) big else extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString())
      ?.let(::sanitize)

    val reason = NotificationPolicy.skipReason(
      notification.flags, notification.category, sbn.packageName, ownPackage, title, body,
    )
    if (reason != null) return

    val appInfo = applicationInfo(sbn.packageName, extras)
    val choice = settings.appChoice(sbn.packageName)
    if (!NotificationPolicy.appAllowed(choice, appInfo != null && NotificationPolicy.isSystemApp(appInfo.flags))) return

    val hash = listOf(title, body, sbn.packageName).hashCode()
    val spec: WatchNotification
    synchronized(lock) {
      if (lastSent[sbn.key] == hash) return
      if (lastSent.size > MAX_TRACKED) lastSent.clear()
      lastSent[sbn.key] = hash
      spec = WatchNotification(
        id = nextId++,
        key = sbn.key ?: "",
        sourceAppId = sbn.packageName,
        sourceName = appInfo?.let { label(it) } ?: sbn.packageName,
        title = title,
        body = body,
        channelId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) notification.channelId else null,
        category = notification.category,
        whenMs = notification.`when`,
        isEmail = notification.category == Notification.CATEGORY_EMAIL,
      )
      // GB keeps the last 11 and replaces one with the same id.
      if (cache.size > 10) cache.poll()
      cache.removeAll { it.id == spec.id }
      cache.offer(spec)
    }
    scope.launch { send(spec) }
  }

  fun onRemoved(sbn: StatusBarNotification) {
    val spec: WatchNotification?
    synchronized(lock) {
      lastSent.remove(sbn.key)
      val found = cache.firstOrNull { it.key == sbn.key && it.sourceAppId == sbn.packageName }
      if (found != null) cache.remove(found)
      spec = found
    }
    if (spec == null) return
    scope.launch { remove(spec) }
  }

  private suspend fun send(spec: WatchNotification) {
    val handle = link.handle() ?: return
    val state = handle.notificationState
    if (!state.supportsNotificationAlert) {
      events.log(LogDirection.INFO, null, null, null, "Notification from ${spec.sourceAppId} not sent: the watch does not support notifications")
      return
    }
    try {
      val id = synchronized(lock) {
        msgId = NotificationPackets.nextMessageId(msgId)
        msgId
      }
      val packet = NotificationPackets.build(handle.session.params, state, spec, id)
      handle.session.request(packet, Timeouts.QUERY_MS, "Notification (${spec.sourceAppId})")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Sending notification from ${spec.sourceAppId} failed: ${e.message}")
    }
  }

  /** HuaweiNotificationsManager.onDeleteNotification: only watches that can remove a single one. */
  private suspend fun remove(spec: WatchNotification) {
    val handle = link.handle() ?: return
    val state = handle.notificationState
    if (!state.supportsNotificationsRepeatedNotify && !state.supportsNotificationsRemoveSingle) return
    try {
      handle.session.request(NotificationPackets.remove(handle.session.params, spec), Timeouts.QUERY_MS, "NotificationRemove (${spec.sourceAppId})")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Removing notification from ${spec.sourceAppId} failed: ${e.message}")
    }
  }

  private fun applicationInfo(packageName: String, extras: android.os.Bundle?): ApplicationInfo? {
    val fromExtras = extras?.let {
      @Suppress("DEPRECATION")
      it.getParcelable<ApplicationInfo>(EXTRA_BUILDER_APPLICATION_INFO)
    }
    if (fromExtras != null) return fromExtras
    return try {
      appContext.packageManager.getApplicationInfo(packageName, 0)
    } catch (e: PackageManager.NameNotFoundException) {
      null
    }
  }

  private fun label(info: ApplicationInfo): String? =
    appContext.packageManager.getApplicationLabel(info).toString().takeIf { it.isNotBlank() }

  /** GB sanitizeUnicode keeps text the watch font can show; here only control characters are dropped. */
  private fun sanitize(text: String): String = text.filter { !Character.isISOControl(it) || it == '\n' }

  private companion object {
    const val MAX_TRACKED = 256

    /** `Notification.EXTRA_BUILDER_APPLICATION_INFO`, hidden constant. */
    const val EXTRA_BUILDER_APPLICATION_INFO = "android.appInfo"
  }
}
