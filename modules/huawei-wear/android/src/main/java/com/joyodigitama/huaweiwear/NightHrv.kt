// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.downloadStressData (gate and request),
// HuaweiStressParser.parseRri (file layout), HuaweiStressHRVCalculation (meaning of the 10 features and their valid ranges).
package com.joyodigitama.huaweiwear

import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiStressParser

/**
 * One record of `rrisqi_data.bin`: a roughly one minute stress measurement the watch made and analysed itself. The file
 * holds no raw RR intervals. The watch keeps the intervals' summary instead: [features] are the ten values of GB's
 * `HuaweiStressHRVCalculation.calculateHRV` (0 median-NNI bin count, 1 sdHR, 2 NNI range, 3 %VLF, 4 RMSSD, 5 median NNI,
 * 6 normalised variance, 7 HF power, 8 LF power, 9 %LF) followed by two zeros.
 */
internal class RriRecord(
  val startSec: Long,
  val endSec: Long,
  val score: Int,
  val level: Int,
  val cFlag: Int,
  val type: Int,
  val accFlag: Int,
  val ppgFlag: Int,
  val features: List<Float>,
) {
  /** RMSSD in milliseconds when the watch's value is inside the range its own validation accepts (0..200), else null. */
  val rmssd: Double?
    get() {
      val v = features.getOrNull(FEATURE_RMSSD) ?: return null
      return if (v.isFinite() && v > 0f && v <= NightHrv.MAX_RMSSD_MS) v.toDouble() else null
    }

  /** The 20 ms bin the intervals clustered in, when inside the watch's 300..1500 ms validation range. */
  val medianNni: Double?
    get() {
      val v = features.getOrNull(FEATURE_MEDIAN_NNI) ?: return null
      return if (v.isFinite() && v >= NightHrv.MIN_NNI_MS && v <= NightHrv.MAX_NNI_MS) v.toDouble() else null
    }

  val midSec: Long get() = (startSec + endSec) / 2

  override fun toString(): String =
    "$startSec..$endSec score=$score level=$level flags(c=$cFlag type=$type acc=$accFlag ppg=$ppgFlag) " +
      "rmssd=${features.getOrNull(FEATURE_RMSSD)} medianNni=${features.getOrNull(FEATURE_MEDIAN_NNI)} " +
      "sdHr=${features.getOrNull(1)} nniCount=${features.getOrNull(0)}"

  companion object {
    const val FEATURE_RMSSD = 4
    const val FEATURE_MEDIAN_NNI = 5
  }
}

internal class RriFile(val fileSize: Long, val version: Int, val bitmap: Int, val records: List<RriRecord>, val understood: Boolean)

/** A span of unix seconds. */
internal class TimeSpan(val start: Long, val end: Long) {
  operator fun contains(t: Long) = t in start until end
}

/** One sleep session: the main sleep of a night, with the spans that count as asleep. */
internal class NightSpan(val start: Long, val end: Long, val asleep: List<TimeSpan>) {
  val asleepSec: Long get() = asleep.sumOf { it.end - it.start }
  fun asleepAt(t: Long) = asleep.any { t in it }
}

internal class NightSummary(
  val night: NightSpan,
  /** Records whose midpoint lies in an asleep span. */
  val inSleep: List<RriRecord>,
  /** [inSleep] with a usable RMSSD. */
  val valid: List<RriRecord>,
  val rmssdMean: Double?,
  val rmssdMedian: Double?,
  /** Beats the valid records cover, estimated as duration / median NNI; the file has no beat count. */
  val beats: Int,
  /** Why no reading is stored, or null when there is one. */
  val rejected: String?,
)

/**
 * Nightly HRV from the watch's automatic stress records. `rrisqi_data.bin` (service 0x2C `FileDownloadInit`, type RRI,
 * or 0x0A `RriFileRequest`) is requested like GB's `downloadStressData`; each record carries the RMSSD the watch computed
 * from its beat-to-beat intervals. A night's value is the mean of the records made while asleep.
 */
internal object NightHrv {
  const val FILE_NAME = "rrisqi_data.bin"

  /** GB `HuaweiState.supportsAutoStress`: service 0x20 command 0x09. */
  const val GATE_SERVICE = 0x20
  const val GATE_COMMAND = 0x09

  /** The watch's own validation accepts RMSSD up to 200 ms and median NNI 300..1500 ms (`calculateHRV`). */
  const val MAX_RMSSD_MS = 200f
  const val MIN_NNI_MS = 300f
  const val MAX_NNI_MS = 1500f

  /** Fewer usable records than this during sleep give no night reading. */
  const val MIN_RECORDS = 3

  /** Header of a version 3 file; records of 66 bytes follow (GB `parseRri`). */
  const val HEADER_BYTES = 48

  private const val FIRST_WINDOW_SEC = 7 * 24 * 3600L
  private const val MIN_WINDOW_SEC = 48 * 3600L
  private const val REWIND_SEC = 12 * 3600L

  /** Records of [data], or null when GB's parser rejects it (shorter than the 48 byte header). */
  fun parse(data: ByteArray): RriFile? {
    val file = HuaweiStressParser.parseRri(data) ?: return null
    val stress = file.stressData
    val records = (stress ?: emptyList()).map { s ->
      RriRecord(
        startSec = s.startTime / 1000L,
        endSec = s.endTime / 1000L,
        score = s.score.toInt(),
        level = s.level.toInt(),
        cFlag = s.cFlag.toInt(),
        type = s.type.toInt(),
        accFlag = s.accFlag.toInt(),
        ppgFlag = s.ppgFlag.toInt(),
        features = s.features.toList(),
      )
    }
    return RriFile(file.fileSize, file.version, file.bitmap, records, understood = stress != null)
  }

  /**
   * Start of the file window: a week back when no night was stored yet, else 12 h before the last stored night's end,
   * but never later than 48 h ago, so a night that ended yesterday morning is still fully inside it.
   */
  fun windowStart(lastNightEndSec: Long?, nowSec: Long): Long {
    val earliest = nowSec - FIRST_WINDOW_SEC
    if (lastNightEndSec == null) return earliest
    return maxOf(earliest, minOf(nowSec - MIN_WINDOW_SEC, lastNightEndSec - REWIND_SEC))
  }

  /**
   * Sleep sessions of [segments] like `buildNights` in `nights.ts`: unstaged strays dropped, sessions split where the gap
   * exceeds [SleepReport.SESSION_GAP_SEC]. Asleep means deep, light or rem; segments without any decoded stage in the
   * session count as asleep as a whole. Oldest first.
   */
  fun nights(segments: List<SleepSegment>): List<NightSpan> {
    val sorted = withoutStrayUnstaged(segments).sortedWith(compareBy({ it.start }, { it.end }))
    val sessions = ArrayList<MutableList<SleepSegment>>()
    var reach = Long.MIN_VALUE
    for (s in sorted) {
      if (s.end <= s.start) continue
      val current = sessions.lastOrNull()
      if (current != null && s.start - reach <= SleepReport.SESSION_GAP_SEC) {
        current.add(s)
      } else {
        sessions.add(mutableListOf(s))
        reach = Long.MIN_VALUE
      }
      reach = maxOf(reach, s.end)
    }
    return sessions.map { session ->
      val staged = session.any { it.stage != null && it.stage != "awake" }
      val asleep = session.filter { if (staged) it.stage in ASLEEP_STAGES else it.stage != "awake" }
      NightSpan(session.minOf { it.start }, session.maxOf { it.end }, merge(asleep.map { TimeSpan(it.start, it.end) }))
    }
  }

  private val ASLEEP_STAGES = setOf("deep", "light", "rem")

  private fun merge(spans: List<TimeSpan>): List<TimeSpan> {
    val out = ArrayList<TimeSpan>()
    for (s in spans.sortedBy { it.start }) {
      val last = out.lastOrNull()
      if (last != null && s.start <= last.end) out[out.size - 1] = TimeSpan(last.start, maxOf(last.end, s.end))
      else out.add(s)
    }
    return out
  }

  /** The night's value from the records made while asleep; [NightSummary.rejected] says why there is none. */
  fun summarize(night: NightSpan, records: List<RriRecord>): NightSummary {
    val inSleep = records.filter { night.asleepAt(it.midSec) }
    val valid = inSleep.filter { it.rmssd != null }
    val values = valid.mapNotNull { it.rmssd }.sorted()
    val mean = if (values.isEmpty()) null else values.average()
    val median = if (values.isEmpty()) null else if (values.size % 2 == 1) values[values.size / 2] else (values[values.size / 2 - 1] + values[values.size / 2]) / 2
    val beats = valid.sumOf { r ->
      val nni = r.medianNni
      if (nni == null || r.endSec <= r.startSec) 0 else ((r.endSec - r.startSec) * 1000.0 / nni).roundToInt()
    }
    val rejected = when {
      inSleep.isEmpty() -> "no stress records during sleep"
      valid.size < MIN_RECORDS -> "only ${valid.size} usable records during sleep, need $MIN_RECORDS"
      else -> null
    }
    return NightSummary(night, inSleep, valid, mean, median, beats, rejected)
  }
}

/**
 * The nightly HRV step of an activity sync: downloads `rrisqi_data.bin` for the window, works out each sleep night the
 * window covers and upserts `hrv_readings` (source `night`). Everything here is best effort: the caller isolates it.
 */
internal class NightHrvSync(
  session: HuaweiSession,
  private val events: WearEvents,
  private val store: SyncStore,
) {
  private val downloader = FileDownloader(session, events)

  suspend fun sync(nowSec: Long) {
    val autoStress = DeviceCaps.supports(NightHrv.GATE_SERVICE, NightHrv.GATE_COMMAND)
    val newSync = DeviceCaps.rriNewSync
    log(
      "Night HRV gates: supportsAutoStress(20/09)=$autoStress rriNewSync(SettingRelated)=$newSync " +
        "commands20=[${DeviceCaps.supportedCommands[NightHrv.GATE_SERVICE]?.joinToString(" ") { it.hex2() } ?: "none"}]",
    )
    if (!autoStress) {
      log("Night HRV: service 0x20 command 0x09 not supported, RRI file skipped (as GB)")
      return
    }

    val lastEnd = withContext(Dispatchers.IO) {
      store.read { db ->
        db.rawQuery("SELECT MAX(end) FROM hrv_readings WHERE source = 'night'", null).use { c ->
          if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null
        }
      }
    }
    val from = NightHrv.windowStart(lastEnd, nowSec)
    val request = FileRequest.rri(newSync, from.toInt(), nowSec.toInt())
    log("Night HRV: requesting $request (last stored night ends ${lastEnd ?: "never"})")
    val data = try {
      downloader.download(request)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      // GB treats any download failure of this file as "no stress data"; the watch answers an unsupported or empty
      // request with an error status or file size -1, which surfaces here as a protocol error.
      events.log(LogDirection.ERROR, null, null, null, "Night HRV: ${request.filename} not available, skipped [${e.errorCode}]: ${e.message}")
      return
    }
    if (data.isEmpty()) {
      log("Night HRV: ${request.filename} is empty, the watch has no stress records in the window (automatic stress off, or nothing measured yet)")
      return
    }
    log("Night HRV: ${request.filename} ${data.size} bytes, header ${data.copyOf(minOf(NightHrv.HEADER_BYTES, data.size)).toHex()}")

    val file = NightHrv.parse(data)
    if (file == null) {
      log("Night HRV: file shorter than the ${NightHrv.HEADER_BYTES} byte header, ignored")
      return
    }
    log("Night HRV: parsed fileSize=${file.fileSize} version=${file.version} bitmap=${file.bitmap} records=${file.records.size}")
    if (!file.understood) {
      log("Night HRV: file version ${file.version} is not known (GB only knows 3), no records read")
      return
    }
    if (file.records.isEmpty()) {
      log("Night HRV: file has no records")
      return
    }
    log("Night HRV: records span ${file.records.minOf { it.startSec }}..${file.records.maxOf { it.endSec }}")
    for (r in file.records.sortedBy { it.startSec }.takeLast(LOGGED_RECORDS)) log("Night HRV: record $r")

    val segments = withContext(Dispatchers.IO) {
      store.read { db ->
        db.rawQuery(
          "SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? ORDER BY start",
          arrayOf((from - SleepReport.SESSION_GAP_SEC).toString()),
        ).use { c ->
          val out = ArrayList<SleepSegment>()
          while (c.moveToNext()) out.add(SleepSegment(c.getLong(0), c.getLong(1), c.getInt(2), if (c.isNull(3)) null else c.getString(3)))
          out
        }
      }
    }
    val nights = NightHrv.nights(segments)
    log("Night HRV: ${segments.size} sleep segments in ${nights.size} sessions since ${from - SleepReport.SESSION_GAP_SEC}")

    var stored = 0
    for (night in nights) {
      val label = "night ${night.start}..${night.end}"
      if (night.start < from) {
        log("Night HRV: $label began before the file window ($from), left as stored")
        continue
      }
      if (night.asleepSec < SleepReport.MIN_NIGHT_SEC) {
        log("Night HRV: $label is a nap (${night.asleepSec / 60} min asleep), skipped")
        continue
      }
      val summary = NightHrv.summarize(night, file.records)
      log(
        "Night HRV: $label asleep=${night.asleepSec / 60} min records=${file.records.count { it.endSec >= night.start && it.startSec <= night.end }} " +
          "inSleep=${summary.inSleep.size} usable=${summary.valid.size} flagsAcc=${summary.inSleep.count { it.accFlag != 0 }} " +
          "rmssdMean=${summary.rmssdMean?.let { "%.1f".format(it) }} rmssdMedian=${summary.rmssdMedian?.let { "%.1f".format(it) }} " +
          "beats~${summary.beats}",
      )
      val reason = summary.rejected
      val mean = summary.rmssdMean
      if (reason != null || mean == null) {
        log("Night HRV: $label no reading: ${reason ?: "no usable RMSSD"}")
        continue
      }
      withContext(Dispatchers.IO) { saveNight(store.db(), night, mean, summary.beats) }
      stored++
      log("Night HRV: $label stored rmssd=${"%.1f".format(mean)} ms from ${summary.valid.size} records")
    }
    log("Night HRV: $stored nights stored")
  }

  /** A night's row replaces any earlier row for an overlapping session (its start moves when more sleep arrives). */
  private fun saveNight(db: android.database.sqlite.SQLiteDatabase, night: NightSpan, rmssd: Double, beats: Int) {
    db.beginTransaction()
    try {
      db.execSQL("DELETE FROM hrv_readings WHERE source = 'night' AND start <= ? AND end >= ?", arrayOf<Any?>(night.end, night.start))
      db.execSQL(
        "INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats) VALUES (?, ?, 'night', ?, NULL, NULL, ?)",
        arrayOf<Any?>(night.start, night.end, rmssd, beats),
      )
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private companion object {
    const val LOGGED_RECORDS = 40
  }
}
