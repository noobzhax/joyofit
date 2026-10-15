package com.joyodigitama.huaweiwear

import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Fall detection, SOS relay, DST and sleep report payloads against the byte examples in FEATURE_CANDIDATES.md. */
class WatchExtrasTest {
  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false) }

  private fun text(bytes: ByteArray) = String(bytes, Charsets.UTF_8)

  // Fall detection

  @Test
  fun fallConfigIsTheJsonHuaweiHealthWrites() {
    assertEquals("""{"fallDetectionSwitch":1,"timeStamp":1791979200000}""", text(SafetyPayloads.fallConfig(true, 1791979200000L)))
    assertEquals("""{"fallDetectionSwitch":0,"timeStamp":5}""", text(SafetyPayloads.fallConfig(false, 5L)))
  }

  @Test
  fun fallConfigGoesOutAsConfigItemWithIdAndAction() {
    val item = ConfigItem(SafetyPayloads.FALL_CONFIG_ID, 1, SafetyPayloads.fallConfig(true, 7L), null)
    val out = DataSyncWire.config(plain, SafetyPayloads.FALL_PHONE_PKG, SafetyPayloads.FALL_WATCH_PKG, listOf(item)).serialize()
    val tlv = HuaweiTLV().parse(out[0], 6, out[0].size - 8)
    assertEquals("hw.unitedevice.sos", tlv.getString(0x01))
    assertEquals("hw.watch.sos.help", tlv.getString(0x02))
    val entry = tlv.getObject(0x83).getObjects(0x84)[0]
    assertEquals(900500038, entry.getInteger(0x05))
    assertEquals(1.toByte(), entry.getByte(0x06))
    assertEquals("""{"fallDetectionSwitch":1,"timeStamp":7}""", text(entry.getBytes(0x07)))
  }

  @Test
  fun fallQueryIsActionTwoWithoutData() {
    val item = ConfigItem(SafetyPayloads.FALL_CONFIG_ID, 2, null, null)
    val out = DataSyncWire.config(plain, SafetyPayloads.FALL_PHONE_PKG, SafetyPayloads.FALL_WATCH_PKG, listOf(item)).serialize()
    val entry = HuaweiTLV().parse(out[0], 6, out[0].size - 8).getObject(0x83).getObjects(0x84)[0]
    assertEquals(2.toByte(), entry.getByte(0x06))
    assertFalse(entry.contains(0x07))
  }

  @Test
  fun fallStateFromTheWatch() {
    val state = SafetyPayloads.parseFallConfig("""{"fallDetectionSwitch":1,"timeStamp":123}""".toByteArray())
    assertEquals(1, state!!.switch)
    assertEquals(123L, state.timeStampMs)
    assertNull(SafetyPayloads.parseFallConfig("""{"fallDetectionSwitch":7}""".toByteArray()))
    assertNull(SafetyPayloads.parseFallConfig("""{"other":1}""".toByteArray()))
    assertNull(SafetyPayloads.parseFallConfig(null))
    assertNull(SafetyPayloads.parseFallConfig("nope".toByteArray()))
  }

  // SOS relay

  @Test
  fun sosRequestIsParsedAndAnsweredWithStatus() {
    val raw = """{"phoneNumber":"+6281234567890","content":"Help, I fell.","extra":3}"""
    val parsed = SafetyPayloads.parseSos(raw.toByteArray()) as SafetyPayloads.SosParse.Ok
    assertEquals("+6281234567890", parsed.request.phoneNumber)
    assertEquals("Help, I fell.", parsed.request.content)

    val sent = JSONObject(text(SafetyPayloads.sosAnswer(parsed.request.raw, true)))
    assertEquals("0", sent.getString("status"))
    assertEquals("+6281234567890", sent.getString("phoneNumber"))
    assertEquals(3, sent.getInt("extra"))
    assertEquals("1", JSONObject(text(SafetyPayloads.sosAnswer(parsed.request.raw, false))).getString("status"))
  }

  @Test
  fun badSosRequestsAreRefused() {
    assertTrue(SafetyPayloads.parseSos(null) is SafetyPayloads.SosParse.Bad)
    assertTrue(SafetyPayloads.parseSos(ByteArray(0)) is SafetyPayloads.SosParse.Bad)
    assertTrue(SafetyPayloads.parseSos("not json".toByteArray()) is SafetyPayloads.SosParse.Bad)
    val noContent = SafetyPayloads.parseSos("""{"phoneNumber":"123","content":""}""".toByteArray()) as SafetyPayloads.SosParse.Bad
    assertNotNull(noContent.raw)
    assertTrue(SafetyPayloads.parseSos("""{"phoneNumber":" ","content":"x"}""".toByteArray()) is SafetyPayloads.SosParse.Bad)
    assertEquals("""{"status":"1"}""", text(SafetyPayloads.sosAnswer(null, false)))
  }

  @Test
  fun sosAnswerGoesOutAsEventEightHundredMillionFortyAtLevelZero() {
    val out = DataSyncWire.event(plain, SafetyPayloads.SOS_PHONE_PKG, SafetyPayloads.SOS_WATCH_PKG, SafetyPayloads.SOS_EVENT_ID, 0, SafetyPayloads.sosAnswer("""{"phoneNumber":"1","content":"x"}""", true)).serialize()
    val tlv = HuaweiTLV().parse(out[0], 6, out[0].size - 8)
    assertEquals("hw.unitedevice.safetyguard", tlv.getString(0x01))
    assertEquals("hw.watch.safetyguard", tlv.getString(0x02))
    assertArrayEquals(byteArrayOf(0x2F, 0xB0.toByte(), 0x8E.toByte(), 0xC8.toByte()), tlv.getBytes(0x03))
    assertArrayEquals(byteArrayOf(0x00), tlv.getBytes(0x04))
  }

  @Test
  fun numbersAreMaskedInLogs() {
    assertEquals("*".repeat(11) + "90", SafetyPayloads.maskNumber("+6281234567890"))
    assertEquals("*".repeat(8) + "21", SafetyPayloads.maskNumber("(021) 555 01 21"))
    assertEquals("**", SafetyPayloads.maskNumber("7"))
  }

  @Test
  fun readinessListsEveryBlocker() {
    assertTrue(SosReadiness(true, true, true, true).ready)
    assertEquals(
      listOf("the SOS SMS relay is switched off in JoyoFit", "the SEND_SMS permission is not granted", "the SIM card is not ready"),
      SosReadiness(false, false, true, false).blockers(),
    )
    assertEquals(listOf("this phone has no telephony"), SosReadiness(true, true, false, false).blockers())
    assertEquals(
      listOf("this version of JoyoFit (Google Play) cannot send text messages"),
      SosReadiness(true, true, true, true, buildCanSendSms = false).blockers(),
    )
  }

  @Test
  fun smsResultWaitsForEveryPartAndFailsOnTheFirstBadOne() {
    val results = ArrayList<Boolean>()
    val ok = SmsDispatchTracker(3) { results += it }
    ok.onPart(0, true)
    ok.onPart(2, true)
    assertTrue(results.isEmpty())
    ok.onPart(1, true)
    ok.onPart(1, false)
    assertEquals(listOf(true), results)

    val failing = ArrayList<Boolean>()
    val bad = SmsDispatchTracker(2) { failing += it }
    bad.onPart(0, false)
    bad.onPart(1, true)
    assertEquals(listOf(false), failing)
  }

  // DST

  @Test
  fun dstAnswerNamesTheNextTransitionAndTheOffsetAfterIt() {
    val now = Instant.ofEpochSecond(1791979200L) // 2026-10-14T12:00Z
    val berlin = JSONObject(text(DstPayload.build(ZoneId.of("Europe/Berlin"), now)))
    assertEquals(1792890000L, berlin.getLong("dst_in")) // 2026-10-25T01:00Z, the clocks go back to CET
    assertEquals(3600, berlin.getInt("time_offset"))
    assertEquals("""{"dst_in":1792890000,"time_offset":3600}""", text(DstPayload.build(ZoneId.of("Europe/Berlin"), now)))
  }

  @Test
  fun dstAnswerIsZeroWithoutATransition() {
    assertEquals("""{"dst_in":0,"time_offset":0}""", text(DstPayload.build(ZoneId.of("Asia/Jakarta"), Instant.ofEpochSecond(1791979200L))))
  }

  @Test
  fun dstAnswerGoesOutAsEvent800100020() {
    val out = DataSyncWire.event(plain, DstPayload.PHONE_PKG, DstPayload.WATCH_PKG, DstPayload.EVENT_ID, 0, DstPayload.build(ZoneId.of("UTC"), Instant.EPOCH)).serialize()
    val tlv = HuaweiTLV().parse(out[0], 6, out[0].size - 8)
    assertEquals("hw.unitedevice.dstsync", tlv.getString(0x01))
    assertEquals("hw.watch.dst.sync", tlv.getString(0x02))
    assertArrayEquals(byteArrayOf(0x2F, 0xB0.toByte(), 0x8E.toByte(), 0xB4.toByte()), tlv.getBytes(0x03))
    assertEquals("""{"dst_in":0,"time_offset":0}""", text(tlv.getBytes(0x05)))
  }

  // Sleep report

  private val jakarta = ZoneId.of("Asia/Jakarta")

  private fun seg(startHour: Double, endHour: Double, stage: String?, baseDay: Long = 1791936000L - 7 * 3600L): SleepSegment =
    SleepSegment(baseDay + (startHour * 3600).toLong(), baseDay + (endHour * 3600).toLong(), 6, stage)

  // 2026-10-13T17:00Z is 2026-10-14 00:00 in Jakarta (UTC+7), so hour 0.0 below is local midnight.
  private val night = listOf(
    seg(-1.0, 0.5, "light"),
    seg(0.5, 1.5, "deep"),
    seg(1.5, 3.0, "rem"),
    seg(3.0, 6.25, "light"),
    seg(6.25, 6.5, "awake"),
  )

  @Test
  fun lastNightChainsSegmentsAndSumsStages() {
    val old = SleepSegment(night.first().start - 30 * 3600L, night.first().start - 26 * 3600L, 6, "light")
    val summary = SleepReport.lastNight(listOf(old) + night)!!
    assertEquals(night.first().start, summary.start)
    assertEquals(night.last().end, summary.end)
    assertEquals(7.5 * 3600, summary.totalSec.toDouble(), 0.5)
    assertEquals(3600L, summary.deepSec)
    assertEquals(5400L, summary.remSec)
    assertEquals(900L, summary.awakeSec)
    assertEquals((1.5 + 3.25) * 3600, summary.lightSec.toDouble(), 0.5)
    assertTrue(summary.hasStages)
    assertNull(SleepReport.lastNight(emptyList()))
  }

  @Test
  fun reportTextCarriesDurationClockTimesAndStages() {
    val summary = SleepReport.lastNight(night)!!
    val message = SleepReport.message(summary, jakarta, Locale("id", "ID"))
    assertEquals("Sleep report", message.title)
    assertEquals("7 h 30 min asleep, 23:00 to 06:30. Deep 1 h 00 min, REM 1 h 30 min, Light 4 h 45 min.", message.description)
    assertEquals("id-ID", message.locale)
    assertEquals("en-US", SleepReport.localeTag(Locale.ROOT))
  }

  @Test
  fun reportPayloadIsTagsSixToTwelveAsUtf8Strings() {
    val message = SleepReport.Message("T", "D", "O", "I", "en-US", "joyofit://a", "joyofit://b")
    val tlv = HuaweiTLV().parse(SleepReport.payload(message))
    assertEquals("T", tlv.getString(0x06))
    assertEquals("D", tlv.getString(0x07))
    assertEquals("O", tlv.getString(0x08))
    assertEquals("I", tlv.getString(0x09))
    assertEquals("en-US", tlv.getString(0x0A))
    assertEquals("joyofit://a", tlv.getString(0x0B))
    assertEquals("joyofit://b", tlv.getString(0x0C))
    assertArrayEquals(byteArrayOf(0x06, 0x01, 'T'.code.toByte(), 0x07, 0x01, 'D'.code.toByte()), SleepReport.payload(message).copyOfRange(0, 6))
  }

  @Test
  fun reportGoesOutAsEvent80030001() {
    val out = DataSyncWire.event(plain, SleepReport.PHONE_PKG, SleepReport.WATCH_PKG, SleepReport.EVENT_ID, 0, byteArrayOf(0x06, 0x01, 0x54)).serialize()
    val tlv = HuaweiTLV().parse(out[0], 6, out[0].size - 8)
    assertEquals("hw.unitedevice.sleepnotification", tlv.getString(0x01))
    assertEquals("hw.watch.health.sleep", tlv.getString(0x02))
    assertArrayEquals(byteArrayOf(0x04, 0xC5.toByte(), 0x29, 0x31), tlv.getBytes(0x03))
  }

  @Test
  fun reportIsPushedOnceInTheMorning() {
    val summary = SleepReport.lastNight(night)!!
    val wake = summary.end
    assertNull(SleepReport.shouldPush(summary, wake + 1800, jakarta, 0))
    assertNotNull("pushed already", SleepReport.shouldPush(summary, wake + 1800, jakarta, wake))
    assertNotNull("too late", SleepReport.shouldPush(summary, wake + 9 * 3600, jakarta, 0))
    val nap = SleepReport.lastNight(listOf(SleepSegment(wake + 4 * 3600, wake + 5 * 3600, 6, "light")))!!
    assertNotNull("a nap", SleepReport.shouldPush(nap, wake + 5 * 3600 + 60, jakarta, 0))
    // Woke at 23:30 yesterday, synced at 04:30: ended on another local day, not this morning.
    val lateEnd = wake - 7 * 3600
    val lateNight = SleepNight(lateEnd - 4 * 3600, lateEnd, 4 * 3600L, 0, 0, 0, 0)
    assertNotNull("ended yesterday", SleepReport.shouldPush(lateNight, lateEnd + 5 * 3600, jakarta, 0))
  }

  @Test
  fun watchAckIsTheNumberOne() {
    assertTrue(SleepReport.acknowledged(byteArrayOf(0x01)))
    assertTrue(SleepReport.acknowledged(byteArrayOf(0, 0, 0, 1)))
    assertFalse(SleepReport.acknowledged(byteArrayOf(0x02)))
    assertFalse(SleepReport.acknowledged(null))
    assertFalse(SleepReport.acknowledged(ByteArray(0)))
  }

  @Test
  fun durationRoundsToMinutes() {
    assertEquals("45 min", SleepReport.duration(45 * 60L))
    assertEquals("1 h 05 min", SleepReport.duration(65 * 60L + 20))
    assertEquals("8 h 00 min", SleepReport.duration(8 * 3600L))
  }
}
