package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPacketsTest {
  @After
  fun resetCaps() = DeviceCaps.reset()

  private fun spec(email: Boolean = false, key: String = "") = WatchNotification(
    id = 7,
    key = key,
    sourceAppId = "com.chat",
    sourceName = "Chat",
    title = "Ann",
    body = "hello",
    channelId = "messages",
    category = null,
    whenMs = 0L,
    isEmail = email,
  )

  @Test
  fun keyFallsBackToGbFormat() {
    assertEquals("0|com.chat|7||0", NotificationPackets.key(spec()))
    assertEquals("0|com.chat|1|tag|10001", NotificationPackets.key(spec(key = "0|com.chat|1|tag|10001")))
  }

  @Test
  fun typeIsEmailOnlyForEmailCategory() {
    assertEquals(Notifications.NotificationType.generic, NotificationPackets.type(spec()))
    assertEquals(Notifications.NotificationType.email, NotificationPackets.type(spec(email = true)))
  }

  @Test
  fun longBodiesAreCutLikeGb() {
    assertEquals("short", NotificationPackets.truncate("short", 100))
    assertEquals("abcdefghij", NotificationPackets.truncate("abcdefghij", 10))
    // 30 characters, limit 20: first 20 - 13 = 7 characters + "...".
    assertEquals("0123456...", NotificationPackets.truncate("0123456789012345678901234567890", 20))
    assertNull(NotificationPackets.truncate(null, 20))
  }

  @Test
  fun tinyLimitsSendTheWholeBody() {
    assertEquals("a long body that would crash GB", NotificationPackets.truncate("a long body that would crash GB", 13))
  }

  @Test
  fun messageIdCountsAndWraps() {
    assertEquals(1.toShort(), NotificationPackets.nextMessageId(0))
    assertEquals(256.toShort(), NotificationPackets.nextMessageId(255))
    assertEquals(0.toShort(), NotificationPackets.nextMessageId(256))
  }

  @Test
  fun notificationSerializesToAWireFrame() {
    val params = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }
    val frames = NotificationPackets.build(params, HuaweiNotificationState(2), spec(), 1).serialize()
    assertEquals(1, frames.size)
    assertEquals(0x5A.toByte(), frames[0][0])
    assertEquals(Notifications.id, frames[0][4])
    assertEquals(Notifications.NotificationActionRequest.id, frames[0][5])
  }

  @Test
  fun removeSerializesToAWireFrame() {
    val params = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }
    val frames = NotificationPackets.remove(params, spec()).serialize()
    assertEquals(Notifications.NotificationRemoveAction.id, frames[0][5])
  }

  @Test
  fun defaultsBeforeTheWatchAnswers() {
    val state = HuaweiNotificationState(2)
    assertEquals(2, state.contentFormat)
    assertEquals(15, state.contentLength)
    // GB: capability byte -1 has bit 1 set, so the capabilities are not asked for.
    assertFalse(state.shouldAskCapabilities)
    // Constraints are only asked when the watch lists service 02 command 01.
    assertFalse(state.shouldAskConstraints)
    DeviceCaps.supportedCommands = mapOf(0x02 to byteArrayOf(0x01, 0x04))
    assertTrue(state.supportsNotificationAlert)
    assertTrue(state.supportsNotification)
    assertTrue(state.shouldAskConstraints)
    assertFalse(HuaweiNotificationState(1).shouldAskConstraints)
  }

  @Test
  fun capabilitiesBitControlsPromptPush() {
    val state = HuaweiNotificationState(2)
    state.capabilities = 0x00
    assertTrue(state.shouldAskCapabilities)
    state.capabilities = 0x02
    assertFalse(state.shouldAskCapabilities)
  }

  @Test
  fun constraintsComeFromTheBuffer() {
    val state = HuaweiNotificationState(2)
    val buffer = ByteBuffer.allocate(22)
    buffer.putShort(Notifications.NotificationConstraintsType.contentFormat.toInt(), 2)
    buffer.putShort(Notifications.NotificationConstraintsType.contentLength.toInt(), 300)
    state.constraints = buffer
    assertEquals(300, state.contentLength)
    assertFalse(state.supportsIncomingNumber)
  }
}
