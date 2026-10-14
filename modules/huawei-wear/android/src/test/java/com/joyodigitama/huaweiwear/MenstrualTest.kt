package com.joyodigitama.huaweiwear

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Menstrual
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Service 0x32 and the cycle model, against the structure read from Huawei Health 17.0.8.300 (`neh`, `nec`, `nej`, `neb`). */
class MenstrualTest {
  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false) }
  private val utc: ZoneId = ZoneOffset.UTC

  private fun day(text: String) = LocalDate.parse(text)

  private fun secs(text: String): Long = CycleModel.daySeconds(day(text), utc)

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02X".format(it) }

  private fun period(start: String, end: String?) = LoggedPeriod(day(start), end?.let { day(it) })

  /** Four finished 28-day cycles, the last period started 2026-09-23. */
  private val periods = listOf(
    period("2026-07-01", "2026-07-05"),
    period("2026-07-29", "2026-08-02"),
    period("2026-08-26", "2026-08-30"),
    period("2026-09-23", "2026-09-27"),
  )

  private val today = day("2026-10-14")

  // Model

  @Test
  fun averagesAndPredictions() {
    val model = CycleModel(periods, today)
    assertEquals(28, model.averageCycleDays)
    assertEquals(5, model.averagePeriodDays)
    assertEquals(listOf(day("2026-10-21"), day("2026-11-18")), model.predictedStarts(2))
    assertEquals(0, model.daysLate())
    assertFalse(model.periodOngoing)
  }

  @Test
  fun defaultsWithoutHistoryAndNoPredictionsWithoutAPeriod() {
    val none = CycleModel(emptyList(), today)
    assertEquals(28, none.averageCycleDays)
    assertEquals(5, none.averagePeriodDays)
    assertTrue(none.predictedStarts(3).isEmpty())
    assertTrue(none.entries(2, 2).isEmpty())
    val one = CycleModel(listOf(period("2026-10-10", null)), today)
    assertTrue(one.periodOngoing)
    assertEquals(listOf(day("2026-11-07")), one.predictedStarts(1))
  }

  @Test
  fun irregularIntervalsAreAveragedAndOutliersIgnored() {
    val model = CycleModel(
      listOf(period("2026-01-01", "2026-01-04"), period("2026-01-31", "2026-02-03"), period("2026-03-04", null), period("2026-09-01", null)),
      day("2026-09-10"),
    )
    // 30 and 32 days count, the 181-day gap does not: mean 31.
    assertEquals(31, model.averageCycleDays)
    assertEquals(4, model.averagePeriodDays)
  }

  @Test
  fun aLatePeriodIsExpectedTodayAndALongMissedOneRollsForward() {
    val late = CycleModel(periods, day("2026-10-24"))
    assertEquals(3, late.daysLate())
    assertEquals(day("2026-10-24"), late.predictedStarts(1).single())
    val missed = CycleModel(periods, day("2026-12-31"))
    assertEquals(day("2027-01-13"), missed.predictedStarts(1).single())
  }

  @Test
  fun entriesAreOldestFirstWithTheCurrentCycleThenPredictedOnes() {
    val entries = CycleModel(periods, today).entries(2, 2)
    assertEquals(
      listOf("2026-07-29", "2026-08-26", "2026-09-23", "2026-10-21", "2026-11-18"),
      entries.map { it.start.toString() },
    )
    assertEquals(listOf(true, true, true, false, false), entries.map { it.logged })
    assertEquals(listOf(28, 28, 28, 28, 28), entries.map { it.lengthDays })
    val current = entries[2]
    // The fertile window of the current cycle sits before the next period: ovulation 14 days before 2026-10-21.
    assertEquals(day("2026-10-07"), current.ovulation)
    assertEquals(day("2026-10-02"), current.fertileStart)
    assertEquals(day("2026-10-08"), current.fertileEnd)
    assertNull(entries[0].ovulation)
    assertEquals(day("2026-10-25"), entries[3].end)
  }

  @Test
  fun keyDaysCarryStatusCodesInsideTheWindow() {
    val days = CycleModel(periods, today).keyDays(30, 30)
    assertEquals(
      listOf(
        day("2026-09-23") to 101, day("2026-09-27") to 102, day("2026-10-02") to 401, day("2026-10-07") to 403,
        day("2026-10-08") to 402, day("2026-10-21") to 301, day("2026-10-25") to 302,
        // The fertile window of the cycle after next starts before the window's end.
        day("2026-10-30") to 401, day("2026-11-04") to 403, day("2026-11-05") to 402,
      ),
      days,
    )
  }

  // Log rules

  @Test
  fun periodsAreValidatedBeforeTheyAreStored() {
    val ended = periods
    assertNull(CycleLogRules.checkStart(ended, day("2026-10-14"), today))
    assertNotNull(CycleLogRules.checkStart(ended, day("2026-10-15"), today))
    assertNotNull(CycleLogRules.checkStart(ended, day("2026-09-25"), today))
    assertNotNull(CycleLogRules.checkStart(ended, day("2026-08-01"), today))
    val open = ended + period("2026-10-10", null)
    assertNotNull(CycleLogRules.checkStart(open, day("2026-10-14"), today))
    assertNull(CycleLogRules.checkEnd(open, day("2026-10-13"), today))
    assertNotNull(CycleLogRules.checkEnd(open, day("2026-10-09"), today))
    assertNotNull(CycleLogRules.checkEnd(ended, day("2026-10-13"), today))
    assertNull(CycleLogRules.checkRange(ended, day("2026-06-01"), day("2026-06-05"), today))
    assertNotNull(CycleLogRules.checkRange(ended, day("2026-07-04"), day("2026-07-09"), today))
    assertNotNull(CycleLogRules.checkRange(ended, day("2026-10-01"), day("2026-10-20"), today))
    assertNull(CycleLogRules.checkLevels(day("2026-10-14"), today, 3, 0))
    assertNotNull(CycleLogRules.checkLevels(day("2026-10-14"), today, 4, 0))
    assertNotNull(CycleLogRules.checkLevels(day("2026-10-15"), today, 1, 1))
  }

  // Service 0x32

  @Test
  fun switchesAreABitfieldInTagOne() {
    val all = MenstrualCodec.Switches(master = true, periodStart = true, periodEnd = true, fertileStart = true, fertileEnd = true, easyPregnancy = true)
    assertEquals(0b111111, all.bitfield(true))
    assertEquals(0b011111, all.bitfield(false))
    assertEquals(0b000011, MenstrualCodec.Switches(master = true, periodStart = true, periodEnd = false, fertileStart = false, fertileEnd = false).bitfield(true))
    assertEquals(all, MenstrualCodec.Switches.fromBitfield(63))
    val out = Menstrual.Message(plain, MenstrualCodec.CMD_SWITCHES.toByte(), MenstrualCodec.switches(0b00001011)).serialize()
    assertEquals("01010B", hex(out[0].copyOfRange(6, 9)))
    assertEquals(0x32, out[0][4].toInt())
    assertEquals(0x01, out[0][5].toInt())
  }

  @Test
  fun capabilityIsThreeWithDictionaryElseTwo() {
    assertEquals("0101" + "03", hex(MenstrualCodec.capability(true).serialize()))
    assertEquals("0101" + "02", hex(MenstrualCodec.capability(false).serialize()))
    assertEquals("0101" + "02", hex(Menstrual.CapabilityRequest(plain).getTlv().serialize()))
  }

  @Test
  fun modifyTimeIsFourBytesOrTheErrorTag() {
    assertEquals("0104" + "69C6C0C0", hex(MenstrualCodec.modifyTime(0x69C6C0C0L).serialize()))
    // 7F, length 4, 150001 = 0x000249F1
    assertEquals("7F04" + "000249F1", hex(MenstrualCodec.modifyTime(null).serialize()))
    assertEquals(hex(MenstrualCodec.noData().serialize()), hex(MenstrualCodec.modifyTime(null).serialize()))
  }

  @Test
  fun theWatchsCycleRequestIsRead() {
    val request = MenstrualCodec.parseCycleRequest(HuaweiTLV().put(0x01, byteArrayOf(0x02, 0x03)).put(0x0B).put(0x0C))!!
    assertEquals(2, request.historyCycles)
    assertEquals(3, request.futureCycles)
    assertFalse(request.tag0a)
    assertTrue(request.tag0b)
    assertTrue(request.tag0c)
    assertNull(MenstrualCodec.parseCycleRequest(HuaweiTLV().put(0x7F, 150001)))
    assertNull(MenstrualCodec.parseCycleRequest(HuaweiTLV()))
  }

  @Test
  fun cycleListLayoutMatchesNeh() {
    val entries = CycleModel(periods, today).entries(1, 1)
    val nowSec = secs("2026-10-14")
    val request = MenstrualCodec.CycleRequest(1, 1, tag0a = true, tag0b = true, tag0c = true)
    val tlv = MenstrualCodec.cycleList(entries, request, nowSec, modifiedSec = 1791936000L, averageCycleDays = 28, averagePeriodDays = 5, zone = utc)
    // Finished: 2026-08-26 (28 d ends 09-23 < now) and 2026-09-23 (ends 10-21, not finished) -> 1; future: 2026-10-21 -> 1.
    assertArrayEquals(byteArrayOf(1, 1), tlv.getBytes(0x01))
    val items = tlv.getObject(0x82).getObjects(0x83)
    assertEquals(3, items.size)
    val current = items[1]
    assertEquals(secs("2026-09-23").toInt(), current.getInteger(0x04))
    assertEquals(secs("2026-09-27").toInt(), current.getInteger(0x05))
    assertEquals(secs("2026-10-02").toInt(), current.getInteger(0x06))
    assertEquals(secs("2026-10-08").toInt(), current.getInteger(0x07))
    assertEquals(28.toByte(), current.getByte(0x08))
    assertEquals(1.toByte(), current.getByte(0x12))
    assertEquals(0.toByte(), items[2].getByte(0x12))
    assertEquals(0, items[0].getInteger(0x06))
    assertEquals(1791936000, tlv.getInteger(0x09))
    // The watch asked 0b, so 0a carries the cycle length; it asked 0a, so 0b carries the period length (neh.b crosses them).
    assertArrayEquals(byteArrayOf(28), tlv.getBytes(0x0A))
    assertArrayEquals(byteArrayOf(5), tlv.getBytes(0x0B))
  }

  @Test
  fun cycleListWithoutFlagsLeavesOutTheOptionalTags() {
    val entries = CycleModel(periods, today).entries(0, 0)
    val request = MenstrualCodec.CycleRequest(0, 0, tag0a = false, tag0b = false, tag0c = false)
    val tlv = MenstrualCodec.cycleList(entries, request, secs("2026-10-14"), 5L, 28, 5, utc)
    assertFalse(tlv.contains(0x0A))
    assertFalse(tlv.contains(0x0B))
    assertFalse(tlv.getObject(0x82).getObjects(0x83)[0].contains(0x12))
    assertTrue(MenstrualCodec.cycleList(emptyList(), request, 0, 0, 28, 5, utc).contains(0x7F))
  }

  @Test
  fun dailyStatusFramesPageTheKeyDays() {
    val days = CycleModel(periods, today).keyDays(30, 30)
    assertEquals(10, days.size)
    assertEquals(4, MenstrualCodec.frameCount(days.size, 3))
    assertEquals(0, MenstrualCodec.frameCount(0, 3))
    assertEquals(0, MenstrualCodec.frameCount(5, 0))
    assertEquals("0401" + "03", hex(MenstrualCodec.frameCountAnswer(3).serialize()))
    assertTrue(MenstrualCodec.frameCountAnswer(0).contains(0x7F))

    val frame = MenstrualCodec.bodyStatusFrame(3, days, 3, utc)!!
    assertArrayEquals(byteArrayOf(3), frame.getBytes(0x01))
    assertArrayEquals(byteArrayOf(1), frame.getBytes(0x02))
    val item = frame.getObject(0x83).getObjects(0x84).single()
    assertEquals(secs("2026-11-05").toInt(), item.getInteger(0x05))
    assertEquals(402, item.getShort(0x06).toInt())
    assertEquals(0, item.getShort(0x08).toInt())
    assertEquals(0, item.getShort(0x09).toInt())
    assertNull(MenstrualCodec.bodyStatusFrame(4, days, 3, utc))
    assertNull(MenstrualCodec.bodyStatusFrame(0, days, 0, utc))

    assertEquals(2, MenstrualCodec.parseBodyStatusRequest(HuaweiTLV().put(0x01, 2.toByte())))
    val asked = MenstrualCodec.parseFrameRequest(HuaweiTLV().put(0x01, 30.toByte()).put(0x02, 60.toByte()).put(0x03, 10.toByte()))!!
    assertEquals(MenstrualCodec.FrameRequest(30, 60, 10), asked)
  }

  // Dictionary 400018

  @Test
  fun dictionaryFieldIdsAreTheOnesFromDictConfig() {
    assertEquals(400018, MenstrualCodec.DICT_ID.toInt())
    assertEquals("17D7CAE5", "%08X".format(MenstrualCodec.FIELD_FLOW))
    assertEquals("17D7CD53", "%08X".format(MenstrualCodec.FIELD_CRAMPS))
    assertEquals("00000003", hex(MenstrualCodec.dictValue(3)))
  }

  @Test
  fun dictionaryRowsAreSplitPerFieldFilteredByTimeAndCappedAtTen() {
    val days = (1..8).map { LoggedDay(day("2026-10-0$it"), flow = it % 4, cramps = 1, modifiedSec = 1000L + it) }
    val rows = MenstrualCodec.dictionaryRows(days, 0, 0, 0, utc)
    assertEquals(10, rows.size)
    val first = rows[0]
    assertEquals(secs("2026-10-01") * 1000, first.startMs)
    assertEquals(secs("2026-10-01") * 1000 + 86_399_999, first.endMs)
    assertEquals(1001_000L, first.modifyMs)
    assertEquals(400018149, first.values.single().key)
    assertEquals("00000001", hex(first.values.single().value!!))
    assertEquals(400018771, rows[1].values.single().key)
    // Only days changed after the watch's modify time (1004 s) and inside its window.
    val newer = MenstrualCodec.dictionaryRows(days, 0, 0, 1_004_000L, utc)
    assertEquals(listOf("2026-10-05", "2026-10-05", "2026-10-06", "2026-10-06", "2026-10-07", "2026-10-07", "2026-10-08", "2026-10-08").map { secs(it) * 1000 }, newer.map { it.startMs })
    val window = MenstrualCodec.dictionaryRows(days, secs("2026-10-02") * 1000, secs("2026-10-02") * 1000 + 1000, 0, utc)
    assertEquals(2, window.size)
  }

  @Test
  fun dictionaryAnswerGoesOutAsDataSyncDictionary() {
    val rows = MenstrualCodec.dictionaryRows(listOf(LoggedDay(day("2026-10-01"), 2, 0, 1000L)), 0, 0, 0, utc)
    val out = DataSyncWire.dictionary(plain, "hw.unitedevice.physiological", "hw.watch.health.physiological", 400018, rows).serialize()
    val tlv = HuaweiTLV().parse(out[0], 6, out[0].size - 8)
    assertEquals("hw.unitedevice.physiological", tlv.getString(0x01))
    assertEquals("hw.watch.health.physiological", tlv.getString(0x02))
    assertEquals(400018, tlv.getInteger(0x03))
    assertEquals(2, tlv.getObject(0x84).getObjects(0x85).size)
  }
}
