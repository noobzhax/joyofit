package com.joyodigitama.huaweiwear

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class ProfileSenderTest {
  @Test
  fun ageIsWholeYearsSinceBirthYear() {
    assertEquals(36, ProfileSender.age(1990, LocalDate.of(2026, 10, 14)))
    assertEquals(0, ProfileSender.age(2030, LocalDate.of(2026, 10, 14)))
  }

  @Test
  fun birthdayIsEncodedAsGbDoes() {
    // year << 16 | month << 8 | day for 1 January 1990.
    assertEquals((1990 shl 16) + 0x0101, ProfileSender.encodeBirthday(1990))
  }

  @Test
  fun sexMapsToGbGenderBytes() {
    assertEquals(1.toByte(), ProfileSender.genderByte("male"))
    assertEquals(2.toByte(), ProfileSender.genderByte("female"))
    assertEquals(3.toByte(), ProfileSender.genderByte("unknown"))
    assertEquals(3.toByte(), ProfileSender.genderByte("anything else"))
  }
}
