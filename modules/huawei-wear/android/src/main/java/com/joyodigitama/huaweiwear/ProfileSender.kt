// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/requests/{SendFitnessUserInfoRequest,
// SendFitnessGoalRequest, SetNotificationRequest}.
package com.joyodigitama.huaweiwear

import java.time.LocalDate
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications

/** Sends the profile/goal and the notification switch; each request only when the watch lists its command. */
internal object ProfileSender {
  /** GB `ActivityUser.getAge()` for a birth date of 1 January of [birthYear]. */
  fun age(birthYear: Int, today: LocalDate): Int = maxOf(0, today.year - birthYear)

  /** SendFitnessUserInfoRequest: `year << 16 | month << 8 | day`. */
  fun encodeBirthday(birthYear: Int): Int = (birthYear shl 16) + (1 shl 8) + 1

  fun genderByte(sex: String): Byte = when (sex) {
    "male" -> FitnessData.UserInfo.UserInfoData.GENDER_MALE.toByte()
    "female" -> FitnessData.UserInfo.UserInfoData.GENDER_FEMALE.toByte()
    else -> FitnessData.UserInfo.UserInfoData.GENDER_UNKNOWN.toByte()
  }

  /**
   * SendFitnessUserInfoRequest (07/02) then SendFitnessGoalRequest (07/01). Returns how many of the
   * two the watch acknowledged. A command missing from SupportedCommands is skipped, as GB does for
   * the goal (`supportsMotionGoal`); for the user info it is skipped here too so an old watch is not
   * sent a command it never listed.
   */
  suspend fun sendProfile(session: HuaweiSession, events: WearEvents, profile: UserProfileData): Int {
    var sent = 0
    if (DeviceCaps.supports(FitnessData.id.toInt(), FitnessData.UserInfo.id.toInt())) {
      val data = FitnessData.UserInfo.UserInfoData(
        profile.heightCm,
        profile.weightKg.toFloat(),
        age(profile.birthYear, LocalDate.now()),
        encodeBirthday(profile.birthYear),
        genderByte(profile.sex),
        DeviceCaps.expandCapability(0x57), // HuaweiState.supportsUnknownGender
        false, // vo2 not supported (GB leaves it disabled too)
        0,
        0,
        DeviceCaps.expandCapability(0xb3), // HuaweiState.supportsPrecisionWeight
      )
      session.request(FitnessData.UserInfo.Request(session.params, data), Timeouts.INIT_MS, "FitnessUserInfo")
      events.log(
        LogDirection.INFO, null, null, null,
        "FitnessUserInfo: ${profile.heightCm} cm, ${profile.weightKg} kg, born ${profile.birthYear}, ${profile.sex}",
      )
      sent++
    }
    if (DeviceCaps.supports(FitnessData.id.toInt(), FitnessData.MotionGoal.id.toInt())) {
      val request = FitnessData.MotionGoal.Request(
        session.params,
        0x01.toByte(),
        0x00.toByte(),
        profile.dailyStepGoal,
        0, // calorie goal: GB sends 0 until it has a UI
        0.toShort(), // duration goal
      )
      session.request(request, Timeouts.INIT_MS, "FitnessGoal")
      events.log(LogDirection.INFO, null, null, null, "FitnessGoal: ${profile.dailyStepGoal} steps")
      sent++
    }
    return sent
  }

  /** SetNotificationRequest (02/04): the watch-side notification switch, like GB's `PREF_NOTIFICATION_ENABLE`. */
  suspend fun sendNotificationSwitch(session: HuaweiSession, events: WearEvents, enabled: Boolean): Boolean {
    if (!DeviceCaps.supports(Notifications.id.toInt(), Notifications.NotificationStateRequest.id.toInt())) return false
    session.request(Notifications.NotificationStateRequest(session.params, enabled), Timeouts.INIT_MS, "NotificationState")
    events.log(LogDirection.INFO, null, null, null, "NotificationState: ${if (enabled) "on" else "off"}")
    return true
  }
}
