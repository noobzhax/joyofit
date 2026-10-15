// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.downloadTruSleepData /
// downloadDictTrueSleepData, HuaweiSampleProvider (RawTypes, toActivityKind, normalizeType).
package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiDictTypes
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiSequenceDataFileParser
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTrueSleepSequenceDataParser
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTruSleepParser

/**
 * The watch's own score for one night, from the sequence file's summary (dict 700013245 score, 700013232
 * efficiency). [start] is the time the stages start from, [end] the wake-up time.
 */
internal class SleepScore(val start: Long, val end: Long, val score: Int, val efficiency: Int?)

internal class SleepDownload(val segments: List<SleepSegment>, val scores: List<SleepScore>)

/**
 * Sleep from the files newer watches use instead of the old FitnessData sleep frames, gated and
 * ordered exactly like GB's `downloadTruSleepData(start, end)`:
 *
 *  1. Nothing unless FitnessData command 0x16 is supported (`HuaweiState.supportsTruSleep`).
 *  2. ExpandCapability bit 143 (`supportsDictSleepSync`): a `sequence_data` file of dictionary
 *     class [HuaweiDictTypes.SLEEP_DETAILS_CLASS] over service 0x2C, parsed into per-minute stages.
 *     GB does not fall back to the state/data files when this download fails.
 *  3. Otherwise `sleep_state.bin` then `sleep_data.bin` (service 0x2C when SettingRelated said
 *     `truSleepNewSync`, else 0x0A). GB stores one marker per [HuaweiTruSleepParser.TruSleepStatus]
 *     range and does not use the sleep_data content (its analysis call is commented out), so the
 *     data file is only parsed for the log.
 *
 * GB's P2P data-dictionary sync (HuaweiP2PDataDictionarySyncService) is a different mechanism: it
 * carries skin temperature, HRV, emotion, sleep apnea and similar, never sleep stages, steps, heart
 * rate or SpO2; it is ported in HealthMetricsSync.kt (class 700013, sleep detail, stays here as a file download).
 */
internal class SleepSync(
  private val session: HuaweiSession,
  private val events: WearEvents,
) {
  private val downloader = FileDownloader(session, events)

  /**
   * Returns the sleep segments, or an empty list when GB would not download sleep for this watch
   * or the download failed (logged). Only a lost link or cancellation aborts the caller.
   */
  suspend fun sync(sinceSec: Int, end: Int): SleepDownload {
    // GB starts at the last stored sleep. Here `sinceSec` is the previous sync, and a night that
    // began before it (synced mid-sleep, or the file not yet written then) would fall outside the
    // window, so the sleep window reaches back at least [SLEEP_LOOKBACK_SEC]. The database
    // upserts segments by (start, type), so re-downloading a night is harmless.
    val start = minOf(sinceSec, end - SLEEP_LOOKBACK_SEC)
    if (start != sinceSec) log("TruSleep: sleep window widened from $sinceSec to $start")
    val supportsTruSleep = DeviceCaps.supportsTruSleep
    val supportsDict = DeviceCaps.supportsDictSleepSync
    val supportsBedTime = DeviceCaps.supportsBedTime
    val newSync = DeviceCaps.truSleepNewSync
    log(
      "TruSleep gates: supportsTruSleep(07/16)=$supportsTruSleep supportsDictSleepSync(ExpandCapability 143)=$supportsDict " +
        "supportsBedTime(199)=$supportsBedTime truSleepNewSync(SettingRelated)=$newSync " +
        "commands07=[${DeviceCaps.supportedCommands[0x07]?.joinToString(" ") { it.hex2() } ?: "none"}] " +
        "expandCapability=${DeviceCaps.expandCapabilities?.toHex() ?: "none"}",
    )
    if (!supportsTruSleep) {
      log("TruSleep: FitnessData command 0x16 not supported, sleep files skipped (as GB)")
      return SleepDownload(emptyList(), emptyList())
    }
    return try {
      if (supportsDict) dictionarySleep(start, end, supportsBedTime) else truSleep(start, end, newSync)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      events.log(LogDirection.ERROR, null, null, null, "TruSleep: sleep download failed: ${e.message}")
      SleepDownload(emptyList(), emptyList())
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "TruSleep: sleep download failed: ${e.message ?: e.javaClass.simpleName}")
      SleepDownload(emptyList(), emptyList())
    }
  }

  // GB downloadDictTrueSleepData

  private suspend fun dictionarySleep(start: Int, end: Int, supportsBedTime: Boolean): SleepDownload {
    log("TruSleep: dictionary sleep sync (dict class ${HuaweiDictTypes.SLEEP_DETAILS_CLASS}), start=$start end=$end")
    val data = downloader.download(FileRequest.sequenceData(start, end, HuaweiDictTypes.SLEEP_DETAILS_CLASS))
    val result = parseSequenceFile(data, supportsBedTime) { log(it) }
    log("TruSleep: dictionary sleep sync produced ${result.segments.size} segments, ${result.scores.size} scores")
    return result
  }

  // GB downloadTruSleepData, state + data files

  private suspend fun truSleep(start: Int, end: Int, newSync: Boolean): SleepDownload {
    log("TruSleep: sleep_state/sleep_data download (${if (newSync) "service 2C" else "service 0A"}), start=$start end=$end")
    // GB's SleepFileDownloadCallback: each file is independent; a failed one just stays null.
    val state = downloadOrLog(FileRequest.sleepState(newSync, start, end))
    val sleepData = downloadOrLog(FileRequest.sleepData(newSync, start, end))

    if (sleepData != null && sleepData.isNotEmpty()) {
      val parsed = HuaweiTruSleepParser.parseData(sleepData)
      log("TruSleep: sleep_data parsed, ${parsed.dataACCs.size} ACC and ${parsed.dataPPGs.size} PPG samples (not mapped, as GB)")
    }
    if (state == null || state.isEmpty()) {
      log("TruSleep: sleep state file empty")
      return SleepDownload(emptyList(), emptyList())
    }
    val segments = segmentsFromState(HuaweiTruSleepParser.parseState(state))
    if (segments.isEmpty()) log("TruSleep: no sleep results")
    for (s in segments) log("TruSleep: sleep range ${s.start}..${s.end} type=${s.type} stage=${s.stage}")
    return SleepDownload(segments, emptyList())
  }

  private suspend fun downloadOrLog(request: FileRequest): ByteArray? =
    try {
      downloader.download(request)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      events.log(LogDirection.ERROR, null, null, null, "Error downloading file: ${request.filename}: ${e.message}")
      null
    }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  companion object {
    /** Minimum span of the sleep window; matches the 36 h the Today screen looks back for last night. */
    private const val SLEEP_LOOKBACK_SEC = 36 * 3600

    // HuaweiSampleProvider.RawTypes
    private const val RAW_UNKNOWN = 1
    private const val RAW_DEEP_SLEEP = 0x07
    private const val RAW_LIGHT_SLEEP = 0x06
    private const val RAW_TRUSLEEP_REM = 0x5656
    private const val RAW_TRUSLEEP_AWAKE = 0x5658
    private const val RAW_TRUSLEEP_NAP = 0x5659

    /**
     * GB addSleepActivities(data, 0x0a) stores every TruSleep state range with raw kind 0x06.
     */
    fun segmentsFromState(statuses: Array<HuaweiTruSleepParser.TruSleepStatus>): List<SleepSegment> =
      statuses.map { SleepSegment(it.startTime.toLong(), it.endTime.toLong(), RAW_LIGHT_SLEEP, stageForRawKind(RAW_LIGHT_SLEEP)) }

    /**
     * HuaweiSampleProvider.toActivityKind(HuaweiSleepStageSample): the raw sample kind for a watch
     * sleep-stage number (1 light, 2 REM, 3 deep, 4 awake, 5 nap, else unknown).
     */
    fun rawKindForStage(huaweiStage: Int): Int = when (huaweiStage) {
      1 -> RAW_LIGHT_SLEEP
      2 -> RAW_TRUSLEEP_REM
      3 -> RAW_DEEP_SLEEP
      4 -> RAW_TRUSLEEP_AWAKE
      5 -> RAW_TRUSLEEP_NAP
      else -> RAW_UNKNOWN
    }

    /**
     * HuaweiSampleProvider.normalizeType: ActivityKind of a raw kind. NAP is LIGHT_SLEEP in GB
     * ("TODO"); anything else GB does not know is UNKNOWN, which has no stage here.
     */
    fun stageForRawKind(rawKind: Int): String? = when (rawKind) {
      RAW_DEEP_SLEEP -> "deep"
      RAW_LIGHT_SLEEP, RAW_TRUSLEEP_NAP -> "light"
      RAW_TRUSLEEP_REM -> "rem"
      RAW_TRUSLEEP_AWAKE -> "awake"
      else -> null
    }

    /**
     * GB downloadDictTrueSleepData callback: per SequenceData the summary is parsed and corrected,
     * the start time chosen with [HuaweiTrueSleepSequenceDataParser.getTime] and the per-minute
     * details turned into stages. Consecutive minutes with the same stage are merged into one segment.
     */
    fun parseSequenceFile(
      data: ByteArray,
      supportsBedTime: Boolean,
      log: (String) -> Unit,
    ): SleepDownload {
      val file = HuaweiSequenceDataFileParser.parseSequenceFileData(data)
      if (file == null) {
        log("TruSleep: sequence file empty or invalid (${data.size} bytes)")
        return SleepDownload(emptyList(), emptyList())
      }
      log("TruSleep: sequence file $file")

      val segments = ArrayList<SleepSegment>()
      val scores = ArrayList<SleepScore>()
      for (sd in file.sequenceDataList) {
        log("TruSleep: SequenceData start=${sd.startTime} end=${sd.endTime} version=${sd.dataVersion} summaryType=${sd.summaryType}")
        val summary = HuaweiTrueSleepSequenceDataParser().parseData(file, sd)
        if (summary == null) {
          log("TruSleep: DataSummary is null, skipped")
          continue
        }
        // GB: "some watches return incorrect(random) data for some fields. We need to correct this data."
        HuaweiTrueSleepSequenceDataParser.correctSummary(summary)
        log("TruSleep: $summary")

        val time = HuaweiTrueSleepSequenceDataParser.getTime(
          summary.fallAsleepTime,
          summary.bedTime,
          summary.validData,
          supportsBedTime,
        )
        val details = sd.details
        if (details == null) {
          log("TruSleep: SequenceData has no details, skipped")
          continue
        }
        val stages = HuaweiTrueSleepSequenceDataParser.parseSleepDetails(details, time)
        if (stages == null) {
          log("TruSleep: sleep details of ${details.size} bytes could not be parsed, skipped")
          continue
        }
        log("TruSleep: ${stages.size} one-minute stages from $time")

        var runStart = 0L
        var runEnd = 0L
        var runStage = 0
        var open = false
        for (stage in stages) {
          if (open && stage.stage == runStage && stage.time == runEnd) {
            runEnd += 60
            continue
          }
          if (open) segments.add(segment(runStart, runEnd, runStage))
          runStart = stage.time
          runEnd = stage.time + 60
          runStage = stage.stage
          open = true
        }
        if (open) segments.add(segment(runStart, runEnd, runStage))
        // correctSummary has already blanked the score of a summary the watch marked invalid.
        if (summary.sleepScore in 0..100 && open) {
          val wake = if (summary.wakeupTime > time) summary.wakeupTime else runEnd
          scores.add(SleepScore(time, wake, summary.sleepScore, summary.sleepEfficiency.takeIf { it in 0..100 }))
        }
      }
      return SleepDownload(segments, scores)
    }

    private fun segment(start: Long, end: Long, huaweiStage: Int): SleepSegment {
      val raw = rawKindForStage(huaweiStage)
      return SleepSegment(start, end, raw, stageForRawKind(raw))
    }
  }
}
