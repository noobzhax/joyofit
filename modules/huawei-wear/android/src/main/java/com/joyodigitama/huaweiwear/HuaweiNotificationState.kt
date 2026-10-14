// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiState.{notificationCapabilities,notificationConstraints,
// saveNotificationCapabilities,saveNotificationConstraints,supportsNotification*,supportsPromptPushMessage,get*Format,getContentLength}
// and HuaweiSupportProvider.getProtocolVersion.
package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications.NotificationConstraintsType

/**
 * The notification part of GB's HuaweiState: what the watch reported through NotificationCapabilities
 * (02/05) and NotificationConstraints (02/02), plus the `supports*` checks over SupportedCommands and
 * ExpandCapability (via [DeviceCaps]). Before the watch answers, GB's defaults apply.
 */
internal class HuaweiNotificationState(
  /** LinkParams protocolVersion (GB `getProtocolVersion()`). */
  val protocolVersion: Int,
) {
  @Volatile
  var capabilities: Byte = -0x01

  @Volatile
  var constraints: ByteBuffer = ByteBuffer.wrap(Notifications.defaultConstraints.copyOf())

  private fun supportsConstraint(which: Byte): Boolean = constraints.get(which.toInt()) == 0x01.toByte()

  private fun constraint(which: Byte): Int = constraints.getShort(which.toInt()).toInt()

  /** HuaweiState.supportsNotificationAlert: service 02, command 01 (the notification itself). */
  val supportsNotificationAlert: Boolean get() = DeviceCaps.supports(0x02, 0x01)

  /** HuaweiState.supportsNotification: service 02, command 04 (the on/off switch). */
  val supportsNotification: Boolean get() = DeviceCaps.supports(0x02, 0x04)

  val supportsNotificationsReply: Boolean get() = DeviceCaps.expandCapability(89)
  val supportsNotificationsReplyActions: Boolean get() = DeviceCaps.expandCapability(73)
  val supportsNotificationsRepeatedNotify: Boolean get() = DeviceCaps.expandCapability(94)
  val supportsNotificationsRemoveSingle: Boolean get() = DeviceCaps.expandCapability(120)
  val supportsNotificationsAddIconTimestamp: Boolean get() = DeviceCaps.expandCapability(77)

  /** HuaweiState.supportsPromptPushMessage. */
  val supportsPromptPushMessage: Boolean get() = ((capabilities.toInt() shr 1) and 1) == 0

  val supportsIncomingNumber: Boolean get() = supportsConstraint(NotificationConstraintsType.incomingNumberSupport)
  val incomingNumberFormat: Int get() = constraint(NotificationConstraintsType.incomingNumberFormat)

  val contentFormat: Int get() = constraint(NotificationConstraintsType.contentFormat)
  val contentLength: Int get() = constraint(NotificationConstraintsType.contentLength)

  /** GetNotificationCapabilitiesRequest.requestSupported. */
  val shouldAskCapabilities: Boolean get() = supportsPromptPushMessage && protocolVersion == 2

  /**
   * GetNotificationConstraintsRequest.requestSupported. GB also excludes two other device types by
   * type; the Fit 4 is neither.
   */
  val shouldAskConstraints: Boolean get() = supportsNotificationAlert && protocolVersion == 2
}
