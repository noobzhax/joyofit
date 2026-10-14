package com.joyodigitama.huaweiwear

import java.time.LocalDate
import java.time.ZoneId
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/**
 * Byte level of service 0x32 (menstrual calendar), written from Huawei Health 17.0.8.300 `neh`
 * (HwMenstrualManager), `nec` (HwMenstrualHelper) and `nej`. Static analysis only: none of it has been
 * seen on the wire yet, so every send and receive is logged.
 *
 * Commands (phone -> watch unless noted):
 *  - `01` switches: tag `01` one byte, a bitfield (bit 0 master, 1 period start, 2 period end, 3 fertile start,
 *    4 fertile end, 5 easy-pregnancy overall switch, only with ExpandCapability 265).
 *  - `02` modify time: the watch asks (empty), the phone answers tag `01` = 4-byte unix seconds, or `7F` = 150001.
 *  - `03` cycle list: the watch asks with tag `01` = [history cycles, future cycles] (one byte each) and optional
 *    empty tags `0a`, `0b`, `0c`; the phone answers tag `01` = [finished cycles, future cycles] (one byte each),
 *    container `82` of `83{04 period start, 05 period end, 06 fertile start, 07 fertile end` (all 4-byte unix
 *    seconds, 0 = none), `08` cycle length in days (1 byte), `12` 1 = logged, 0 = predicted (only when `0c` was
 *    asked)`}`, tag `09` = modify time (4 bytes), then tag `0a` = average cycle length when the watch asked
 *    `0b`, and tag `0b` = average period length when it asked `0a` (Huawei Health crosses the two, see [cycleList]).
 *  - `04` update notice: empty, the watch then asks again.
 *  - `05` capability: tag `01` one byte, 3 with ExpandCapability 174 (flow as dictionary points), else 2.
 *  - `06` (watch asks `01` history days, `02` future days, `03` frame size) answered with tag `04` = frame count
 *    (1 byte), or `7F` = 150001 when there is no data.
 *  - `07` (watch asks tag `01` = frame index) answered with `01` index, `02` item count (1 byte each) and
 *    `83{84{05 day start (4 bytes), 06 status (2 bytes), 08 physical (2 bytes, 0), 09 sub status (2 bytes, 0)}...}`.
 */
internal object MenstrualCodec {
  const val SERVICE = 0x32
  const val CMD_SWITCHES = 0x01
  const val CMD_MODIFY_TIME = 0x02
  const val CMD_CYCLES = 0x03
  const val CMD_UPDATE_NOTICE = 0x04
  const val CMD_CAPABILITY = 0x05
  const val CMD_FRAME_COUNT = 0x06
  const val CMD_BODY_STATUS = 0x07

  /** Error value Huawei Health puts in tag `7F` when it has no data (`150001`). */
  const val ERROR_NO_DATA = 150001

  /** ExpandCapability: menstrual flow as dictionary points (Huawei Health `neh.k`). */
  const val CAP_DICTIONARY = 174

  /** ExpandCapability gating the easy-pregnancy switch bit (`neh.o`, `OldToNewMotionPath.SPORT_TYPE_INDOOR_BIKE`). */
  const val CAP_EASY_PREGNANCY_SWITCH = 265

  /** Switches of `0x32/01`, bit `n` is `1 shl n` (`neh.c`). */
  data class Switches(
    val master: Boolean = false,
    val periodStart: Boolean = true,
    val periodEnd: Boolean = true,
    val fertileStart: Boolean = true,
    val fertileEnd: Boolean = false,
    val easyPregnancy: Boolean = false,
  ) {
    fun bitfield(includeEasyPregnancy: Boolean): Int =
      (if (master) 1 else 0) or
        (if (periodStart) 2 else 0) or
        (if (periodEnd) 4 else 0) or
        (if (fertileStart) 8 else 0) or
        (if (fertileEnd) 16 else 0) or
        (if (includeEasyPregnancy && easyPregnancy) 32 else 0)

    companion object {
      fun fromBitfield(bits: Int) = Switches(
        master = bits and 1 != 0,
        periodStart = bits and 2 != 0,
        periodEnd = bits and 4 != 0,
        fertileStart = bits and 8 != 0,
        fertileEnd = bits and 16 != 0,
        easyPregnancy = bits and 32 != 0,
      )
    }
  }

  fun switches(bitfield: Int): HuaweiTLV = HuaweiTLV().put(0x01, bitfield.toByte())

  fun capability(dictionarySupported: Boolean): HuaweiTLV = HuaweiTLV().put(0x01, (if (dictionarySupported) 3 else 2).toByte())

  fun updateNotice(): HuaweiTLV = HuaweiTLV()

  /** The error answer: tag `7F` = 150001. */
  fun noData(): HuaweiTLV = HuaweiTLV().put(0x7F, ERROR_NO_DATA)

  /** `0x32/02` answer: tag `01` = 4-byte [modifiedSec], or the error tag when nothing is stored. */
  fun modifyTime(modifiedSec: Long?): HuaweiTLV =
    if (modifiedSec == null) noData() else HuaweiTLV().put(0x01, modifiedSec.toInt())

  /** What the watch asks for in `0x32/03`. */
  data class CycleRequest(
    val historyCycles: Int,
    val futureCycles: Int,
    val tag0a: Boolean,
    val tag0b: Boolean,
    val tag0c: Boolean,
  )

  /** Reads the watch's `0x32/03` request; null when it is an error packet (`7F`) or has no tag `01`. */
  fun parseCycleRequest(tlv: HuaweiTLV): CycleRequest? {
    if (tlv.contains(0x7F)) return null
    if (!tlv.contains(0x01)) return null
    val bytes = tlv.getBytes(0x01)
    if (bytes.size < 2) return null
    return CycleRequest(
      historyCycles = bytes[0].toInt() and 0xFF,
      futureCycles = bytes[1].toInt() and 0xFF,
      tag0a = tlv.contains(0x0A),
      tag0b = tlv.contains(0x0B),
      tag0c = tlv.contains(0x0C),
    )
  }

  /** `0x32/03` answer, `neh.b(...)`. [entries] is `CycleModel.entries`, empty means "no data". */
  fun cycleList(
    entries: List<CycleEntry>,
    request: CycleRequest,
    nowSec: Long,
    modifiedSec: Long,
    averageCycleDays: Int,
    averagePeriodDays: Int,
    zone: ZoneId,
  ): HuaweiTLV {
    if (entries.isEmpty()) return noData()
    var finished = 0
    var future = 0
    val list = HuaweiTLV()
    for (e in entries) {
      val start = CycleModel.daySeconds(e.start, zone)
      // nec.c: a cycle is finished when start + length < now, upcoming when start > now.
      if (start + e.lengthDays * 86_400L < nowSec) finished++
      if (start > nowSec) future++
      val item = HuaweiTLV()
        .put(0x04, start.toInt())
        .put(0x05, secondsOrZero(e.end, zone))
        .put(0x06, secondsOrZero(e.fertileStart, zone))
        .put(0x07, secondsOrZero(e.fertileEnd, zone))
        .put(0x08, e.lengthDays.toByte())
      if (request.tag0c) item.put(0x12, (if (e.logged) 1 else 0).toByte())
      list.put(0x83, item)
    }
    val out = HuaweiTLV()
      .put(0x01, byteArrayOf(finished.coerceAtMost(255).toByte(), future.coerceAtMost(255).toByte()))
      .put(0x82, list)
      .put(0x09, modifiedSec.toInt())
    // neh.b(boolean[], int[], ...): zArr = {watch asked 0b, watch asked 0a}; 0a carries the cycle length, 0b the period length.
    if (request.tag0b) out.put(0x0A, averageCycleDays.toByte())
    if (request.tag0a) out.put(0x0B, averagePeriodDays.toByte())
    return out
  }

  private fun secondsOrZero(day: LocalDate?, zone: ZoneId): Int = day?.let { CycleModel.daySeconds(it, zone).toInt() } ?: 0

  /** What the watch asks for in `0x32/06`. */
  data class FrameRequest(val historyDays: Int, val futureDays: Int, val frameSize: Int)

  fun parseFrameRequest(tlv: HuaweiTLV): FrameRequest? {
    if (tlv.contains(0x7F)) return null
    return FrameRequest(
      historyDays = tlv.getAsInteger(0x01, 0),
      futureDays = tlv.getAsInteger(0x02, 0),
      frameSize = tlv.getAsInteger(0x03, 0),
    )
  }

  /** The frame index in the watch's `0x32/07` request. */
  fun parseBodyStatusRequest(tlv: HuaweiTLV): Int? {
    if (tlv.contains(0x7F) || !tlv.contains(0x01)) return null
    return tlv.getAsInteger(0x01, 0)
  }

  /** Frames needed for [count] days at [frameSize] per frame (`neh.d`: `ceil(size / frameSize)`). */
  fun frameCount(count: Int, frameSize: Int): Int = if (frameSize <= 0) 0 else (count + frameSize - 1) / frameSize

  /** `0x32/06` answer: tag `04` = frame count, or the error tag when there is nothing to send. */
  fun frameCountAnswer(frames: Int): HuaweiTLV =
    if (frames <= 0) noData() else HuaweiTLV().put(0x04, frames.coerceAtMost(255).toByte())

  /** `0x32/07` answer for frame [index] of [days] split into frames of [frameSize] (`neh.e(int)`); null when the index is out of range. */
  fun bodyStatusFrame(index: Int, days: List<Pair<LocalDate, Int>>, frameSize: Int, zone: ZoneId): HuaweiTLV? {
    if (index < 0 || frameSize <= 0) return null
    val from = index * frameSize
    if (from >= days.size) return null
    val slice = days.subList(from, minOf(days.size, from + frameSize))
    val items = HuaweiTLV()
    for ((day, status) in slice) {
      items.put(
        0x84,
        HuaweiTLV()
          .put(0x05, CycleModel.daySeconds(day, zone).toInt())
          .put(0x06, status.toShort())
          .put(0x08, 0.toShort())
          .put(0x09, 0.toShort()),
      )
    }
    return HuaweiTLV()
      .put(0x01, index.toByte())
      .put(0x02, slice.size.toByte())
      .put(0x83, items)
  }

  /** Dictionary 400018 (`PHYSIOLOGICAL_CYCLE`) field ids, from the APK's `assets/dict_config.txt`. */
  const val DICT_ID = 400018L
  const val FIELD_FLOW = 400018149L
  const val FIELD_CRAMPS = 400018771L

  /** Value of a dictionary field: a 4-byte big-endian int (`ego.i(int)` in `neb.d`). */
  fun dictValue(value: Int): ByteArray = byteArrayOf((value ushr 24).toByte(), (value ushr 16).toByte(), (value ushr 8).toByte(), value.toByte())

  /** Most rows Huawei Health answers a dictionary query with (`neb.b`). */
  const val DICT_MAX_ROWS = 10

  private const val DAY_MS = 86_400_000L

  /**
   * Rows for logged days overlapping [startMs]..[endMs] (`endMs` 0 = open) and changed after [modifyMs] (unix ms), oldest first,
   * at most [DICT_MAX_ROWS]. Like Huawei Health each (day, field) is its own row (`neb.d`: one `ege` per `HiHealthData`), the row
   * spanning the local day; the day's end is `start + 24 h - 1 ms` [INFERENCE].
   */
  fun dictionaryRows(days: List<LoggedDay>, startMs: Long, endMs: Long, modifyMs: Long, zone: ZoneId): List<DictRow> {
    val rows = ArrayList<DictRow>()
    for (day in days.sortedBy { it.day }) {
      val start = CycleModel.daySeconds(day.day, zone) * 1000
      val end = start + DAY_MS - 1
      if (endMs > 0 && start > endMs) continue
      if (end < startMs) continue
      val modified = day.modifiedSec * 1000
      if (modified <= modifyMs) continue
      rows += DictRow(start, end, modified, listOf(DictValue(FIELD_FLOW.toInt(), dictValue(day.flow))))
      rows += DictRow(start, end, modified, listOf(DictValue(FIELD_CRAMPS.toInt(), dictValue(day.cramps))))
    }
    return rows.take(DICT_MAX_ROWS)
  }
}
