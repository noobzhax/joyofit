package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NightHrvTest {
  /** One 66 byte record the way GB's `parseRri` reads it: start, end, algorithm, six bytes, twelve floats. */
  private fun record(start: Int, end: Int, rmssd: Float, medianNni: Float, acc: Int = 0): ByteArray {
    val b = ByteBuffer.allocate(66)
    b.putInt(start).putInt(end).putInt(1)
    b.put(40).put(1).put(0).put(0).put(acc.toByte()).put(0)
    val features = FloatArray(12)
    features[0] = 20f
    features[1] = 4.5f
    features[4] = rmssd
    features[5] = medianNni
    for (f in features) b.putFloat(f)
    return b.array()
  }

  private fun file(version: Int, vararg records: ByteArray): ByteArray {
    val body = records.fold(ByteArray(0)) { acc, r -> acc + r }
    val header = ByteBuffer.allocate(NightHrv.HEADER_BYTES)
    header.putLong((NightHrv.HEADER_BYTES + body.size).toLong()).putShort(0x0f).putShort(version.toShort())
    return header.array() + body
  }

  @Test
  fun parsesRecordsOfAVersion3File() {
    val parsed = NightHrv.parse(file(3, record(1_000, 1_060, 42.5f, 880f), record(2_000, 2_058, 38f, 900f, acc = 1)))!!
    assertTrue(parsed.understood)
    assertEquals(3, parsed.version)
    assertEquals(0x0f, parsed.bitmap)
    assertEquals(NightHrv.HEADER_BYTES + 2 * 66L, parsed.fileSize)
    assertEquals(2, parsed.records.size)
    val first = parsed.records[0]
    assertEquals(1_000L, first.startSec)
    assertEquals(1_060L, first.endSec)
    assertEquals(40, first.score)
    assertEquals(1, first.level)
    assertEquals(12, first.features.size)
    assertEquals(42.5, first.rmssd!!, 1e-6)
    assertEquals(880.0, first.medianNni!!, 1e-6)
    assertEquals(1, parsed.records[1].accFlag)
  }

  @Test
  fun skipsRecordsWithoutTimesAndIgnoresATruncatedTail() {
    val data = file(3, record(0, 100, 40f, 900f), record(1_000, 1_060, 40f, 900f)) + ByteArray(30)
    val parsed = NightHrv.parse(data)!!
    assertEquals(listOf(1_000L), parsed.records.map { it.startSec })
  }

  @Test
  fun unknownVersionAndShortFilesGiveNoRecords() {
    val unknown = NightHrv.parse(file(4, record(1_000, 1_060, 40f, 900f)))!!
    assertFalse(unknown.understood)
    assertTrue(unknown.records.isEmpty())
    assertNull(NightHrv.parse(ByteArray(47)))
  }

  @Test
  fun rmssdOutsideTheWatchsRangeIsNotUsable() {
    val parsed = NightHrv.parse(file(3, record(1, 61, 0f, 900f), record(100, 160, 250f, 900f), record(200, 260, Float.NaN, 900f), record(300, 360, 30f, 100f)))!!
    assertEquals(listOf(null, null, null, 30.0), parsed.records.map { it.rmssd })
    assertNull(parsed.records[3].medianNni)
  }

  private fun seg(start: Long, end: Long, stage: String?) = SleepSegment(start, end, 0x06, stage)

  private val hour = 3600L

  @Test
  fun anAsleepNightUsesDeepLightAndRemNotAwake() {
    val t = 100_000L
    val nights = NightHrv.nights(
      listOf(
        seg(t, t + 2 * hour, "light"),
        seg(t + 2 * hour, t + 2 * hour + 600, "awake"),
        seg(t + 2 * hour + 600, t + 5 * hour, "deep"),
        seg(t + 5 * hour, t + 8 * hour, "rem"),
      ),
    )
    assertEquals(1, nights.size)
    val n = nights[0]
    assertEquals(t, n.start)
    assertEquals(t + 8 * hour, n.end)
    assertEquals(8 * hour - 600, n.asleepSec)
    assertTrue(n.asleepAt(t + hour))
    assertFalse(n.asleepAt(t + 2 * hour + 300))
    assertEquals(2, n.asleep.size)
  }

  @Test
  fun aNightWithoutDecodedStagesUsesItsWholeSpan() {
    val t = 100_000L
    val nights = NightHrv.nights(listOf(seg(t, t + 4 * hour, null)))
    assertEquals(1, nights.size)
    assertEquals(4 * hour, nights[0].asleepSec)
    assertTrue(nights[0].asleepAt(t + 2 * hour))
  }

  @Test
  fun sessionsSplitAtTheSessionGapAndOverlapsAreNotCountedTwice() {
    val t = 100_000L
    val night1 = listOf(seg(t, t + 4 * hour, "light"), seg(t + 2 * hour, t + 5 * hour, "deep"))
    val nap = seg(t + 5 * hour + SleepReport.SESSION_GAP_SEC + hour, t + 5 * hour + SleepReport.SESSION_GAP_SEC + 2 * hour, "light")
    val nights = NightHrv.nights(night1 + nap)
    assertEquals(2, nights.size)
    assertEquals(5 * hour, nights[0].asleepSec)
    assertEquals(hour, nights[1].asleepSec)
  }

  @Test
  fun aNightCoversOnlyTheRecordsMadeWhileAsleep() {
    val t = 100_000L
    val night = NightSpan(t, t + 8 * hour, listOf(TimeSpan(t, t + 2 * hour), TimeSpan(t + 2 * hour + 600, t + 8 * hour)))
    val records = NightHrv.parse(
      file(
        3,
        record((t - 600).toInt(), (t - 540).toInt(), 90f, 800f),
        record((t + hour).toInt(), (t + hour + 60).toInt(), 40f, 900f),
        record((t + 2 * hour + 100).toInt(), (t + 2 * hour + 160).toInt(), 99f, 700f),
        record((t + 3 * hour).toInt(), (t + 3 * hour + 60).toInt(), 50f, 1000f),
        record((t + 6 * hour).toInt(), (t + 6 * hour + 60).toInt(), 60f, 1000f),
        record((t + 9 * hour).toInt(), (t + 9 * hour + 60).toInt(), 70f, 800f),
      ),
    )!!.records
    val s = NightHrv.summarize(night, records)
    assertEquals(3, s.inSleep.size)
    assertEquals(3, s.valid.size)
    assertEquals(50.0, s.rmssdMean!!, 1e-9)
    assertEquals(50.0, s.rmssdMedian!!, 1e-9)
    // 60 s per record over 900, 1000, 1000 ms intervals: 67 + 60 + 60.
    assertEquals(187, s.beats)
    assertNull(s.rejected)
  }

  @Test
  fun tooFewUsableRecordsGiveNoReading() {
    val t = 100_000L
    val night = NightSpan(t, t + 8 * hour, listOf(TimeSpan(t, t + 8 * hour)))
    val records = NightHrv.parse(
      file(3, record((t + hour).toInt(), (t + hour + 60).toInt(), 40f, 900f), record((t + 2 * hour).toInt(), (t + 2 * hour + 60).toInt(), 0f, 900f)),
    )!!.records
    val s = NightHrv.summarize(night, records)
    assertEquals(2, s.inSleep.size)
    assertEquals(1, s.valid.size)
    assertNotNull(s.rejected)
    assertEquals("no stress records during sleep", NightHrv.summarize(night, emptyList()).rejected)
  }

  @Test
  fun windowStartReachesBackFromTheLastNight() {
    val now = 1_000_000_000L
    assertEquals(now - 7 * 24 * 3600, NightHrv.windowStart(null, now))
    // Last night ended 8 h ago: still ask for 48 h so the whole night is inside the window.
    assertEquals(now - 48 * 3600, NightHrv.windowStart(now - 8 * 3600, now))
    // Last stored night is 4 days old: 12 h before its end.
    assertEquals(now - 4 * 24 * 3600 - 12 * 3600, NightHrv.windowStart(now - 4 * 24 * 3600, now))
    // Older than a week: never more than 7 days.
    assertEquals(now - 7 * 24 * 3600, NightHrv.windowStart(now - 30 * 24 * 3600, now))
  }
}
