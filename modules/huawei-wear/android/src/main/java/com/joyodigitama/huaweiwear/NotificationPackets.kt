// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/requests/{SendNotificationRequest,
// SendNotificationRemoveRequest}, HuaweiNotificationsManager.getNotificationKey, HuaweiSupportProvider.getNotificationId.
package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications

/** The parts of GB's NotificationSpec that the Huawei requests read. */
internal class WatchNotification(
  val id: Int,
  /** `StatusBarNotification.getKey()`; may be empty. */
  val key: String,
  val sourceAppId: String,
  val sourceName: String?,
  val title: String?,
  val body: String?,
  val channelId: String?,
  val category: String?,
  val whenMs: Long,
  val isEmail: Boolean,
)

internal object NotificationPackets {
  /** HuaweiNotificationsManager.getNotificationKey. */
  fun key(n: WatchNotification): String =
    if (n.key.isNotEmpty()) n.key else "0|${n.sourceAppId}|${n.id}||0"

  /** SendNotificationRequest.getNotificationType for GB's generic and generic_email types. */
  fun type(n: WatchNotification): Byte =
    if (n.isEmail) Notifications.NotificationType.email else Notifications.NotificationType.generic

  /**
   * SendNotificationRequest: a body over the watch's content length is cut to `length - 0xD` plus
   * "...". GB would throw when the length is 13 or less (the unreported default is 15); then the
   * body is sent whole.
   */
  fun truncate(body: String?, contentLength: Int): String? {
    if (body == null || contentLength <= 0xD || body.length <= contentLength) return body
    return body.substring(0, contentLength - 0xD) + "..."
  }

  /** SendNotificationRequest.buildNotificationTLVFromNotificationSpec. */
  fun build(
    params: HuaweiPacket.ParamsProvider,
    state: HuaweiNotificationState,
    n: WatchNotification,
    msgId: Short,
  ): HuaweiPacket {
    val title = n.title ?: n.sourceName
    val body = truncate(n.body, state.contentLength)
    val format = state.contentFormat.toByte()

    val additional = Notifications.NotificationActionRequest.AdditionalParams()
    additional.supportsReply = state.supportsNotificationsReply
    additional.supportsRepeatedNotify = state.supportsNotificationsRepeatedNotify
    additional.supportsRemoveSingle = state.supportsNotificationsRemoveSingle
    additional.supportsReplyActions = state.supportsNotificationsReplyActions
    additional.supportsTimestamp = state.supportsNotificationsAddIconTimestamp
    additional.notificationId = n.id
    additional.notificationKey = key(n)
    additional.replyKey = ""
    additional.channelId = n.channelId ?: ""
    additional.category = n.category ?: ""
    additional.address = ""
    additional.`when` = n.whenMs

    val content = ArrayList<Notifications.NotificationActionRequest.TextElement>()
    content.add(Notifications.NotificationActionRequest.TextElement(Notifications.TextType.title.toByte(), format, title))
    // GB leaves the sender empty for non-SMS notifications; the app name goes there so the watch can show it.
    content.add(Notifications.NotificationActionRequest.TextElement(Notifications.TextType.sender.toByte(), format, n.sourceName))
    content.add(Notifications.NotificationActionRequest.TextElement(Notifications.TextType.text.toByte(), format, body))

    return Notifications.NotificationActionRequest(params, msgId, type(n), content, n.sourceAppId, additional)
  }

  /** SendNotificationRemoveRequest. */
  fun remove(params: HuaweiPacket.ParamsProvider, n: WatchNotification): HuaweiPacket =
    Notifications.NotificationRemoveAction(
      params,
      type(n),
      n.sourceAppId,
      key(n),
      n.id,
      n.channelId ?: "",
      n.category,
    )

  /** HuaweiSupportProvider.getNotificationId: a counter that wraps after 256. */
  fun nextMessageId(current: Short): Short = if (current < 256) (current + 1).toShort() else 0
}
