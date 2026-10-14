// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiWorkoutSyncManager,
// HuaweiSupportProvider.downloadWorkoutGpsFiles, requests/GetWorkoutCapability.
package com.joyodigitama.huaweiwear

import java.util.ArrayDeque
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiGpsParser
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout

/** Where [WorkoutSync] reads what is already stored and writes each finished workout. */
internal interface WorkoutSink {
  /** True when a complete workout with this start and end is stored (nothing left to download for it). */
  suspend fun isComplete(start: Long, end: Long): Boolean

  /** Stores the workout and its points, replacing an earlier copy with the same start. True if it is new or was incomplete. */
  suspend fun save(record: WorkoutRecord): Boolean
}

/**
 * Port of HuaweiWorkoutSyncManager. GB drives callbacks through a request queue; here each step is a suspend
 * call with the same order and the same retry rules:
 *
 *  1. WorkoutCount (17/07) for the window. An error answer or a count that does not match the list asks twice
 *     for each half of the window instead (at most [MAX_SMALLER_TIMESLOT_DEPTH] levels deep).
 *  2. Per workout, in workout number order: Totals (17/08), Data (17/0A), Pace (17/0C), SwimSegments (17/0E),
 *     SpO2 (17/14), Sections (17/16), then the GPS file (`<n>_gps.bin`, service 2C or 0A).
 *  3. Every request that can answer with an error is repeated up to [MAX_RETRIES] times, then skipped and the
 *     workout is flagged `missingData` (GB shows a toast). A timeout aborts the sync, as in GB.
 *
 * Unlike GB the workout is not written to the database until its parts are downloaded, and the sync keeps going
 * after a workout whose totals could not be read. A workout cut short by a timeout is stored as incomplete and
 * fetched again next sync.
 */
internal class WorkoutSync(
  private val session: HuaweiSession,
  private val events: WearEvents,
) {
  private val params get() = session.params
  private val downloader = FileDownloader(session, events)

  /** Workouts newly stored (or completed) by [sync] so far. */
  var saved = 0
    private set

  private class Range(val start: Int, val end: Int, val depth: Int)

  suspend fun sync(startSec: Int, endSec: Int, sink: WorkoutSink) {
    val supportedServices = DeviceCaps.supportedCommands
    if (supportedServices.isNotEmpty() && supportedServices[SERVICE] == null) {
      log("Workout: service 0x17 not offered by the watch, workout sync skipped")
      return
    }
    log(
      "Workout gates: 17/07=${DeviceCaps.supports(SERVICE, 0x07)} 17/08=${DeviceCaps.supports(SERVICE, 0x08)} " +
        "17/0A=${DeviceCaps.supports(SERVICE, 0x0A)} 17/15=${DeviceCaps.supports(SERVICE, 0x15)} " +
        "gpsNewSync(SettingRelated)=${DeviceCaps.gpsNewSync} " +
        "commands17=[${supportedServices[SERVICE]?.joinToString(" ") { it.hex2() } ?: "none"}]",
    )

    val newSteps = queryNewSteps()
    log("Workout: from=$startSec to=$endSec newSteps=$newSteps")

    val queue = ArrayDeque<Range>()
    queue.add(Range(startSec, endSec, 0))
    while (queue.isNotEmpty()) {
      val range = queue.removeFirst()
      val count = requestOrNull<Workout.WorkoutCount.Response>(
        Workout.WorkoutCount.Request(params, range.start, range.end),
        "WorkoutCount ${range.start}..${range.end}",
      )
      if (count == null) {
        // The Fit 4 can leave out the 0x81 container like it does for the step counts: no workouts.
        log("Workout: no count in the answer for ${range.start}..${range.end}; nothing to sync")
        continue
      }
      val listed = count.workoutNumbers
      if (count.error != null) {
        log("Workout: error ${count.error} on the count for ${range.start}..${range.end}")
        split(queue, range)
        continue
      }
      if (count.count.toInt() == 0 || listed == null) {
        log("Workout: 0 workouts in ${range.start}..${range.end}")
        continue
      }
      if (count.count.toInt() != listed.size) {
        log("Workout: count ${count.count} does not match ${listed.size} entries in ${range.start}..${range.end}")
        split(queue, range)
        continue
      }

      // GB: sorted by workout number, the timestamp based sync state depends on it.
      val numbers = listed.sortedBy { it.workoutNumber.toInt() }
      log("Workout: ${numbers.size} workouts in ${range.start}..${range.end}: ${numbers.joinToString { describe(it) }}")
      for (n in numbers) syncWorkout(n, newSteps, sink)
    }
  }

  private fun split(queue: ArrayDeque<Range>, range: Range) {
    if (range.depth >= MAX_SMALLER_TIMESLOT_DEPTH) {
      throw WearException(ErrorCodes.PROTOCOL, "Workout: asked for a smaller timeslot too many times, giving up on ${range.start}..${range.end}")
    }
    val half = range.start + (range.end - range.start) / 2
    log("Workout: retrying ${range.start}..${range.end} as ${range.start}..$half and ${half + 1}..${range.end}")
    queue.add(Range(range.start, half, range.depth + 1))
    queue.add(Range(half + 1, range.end, range.depth + 1))
  }

  /** GB GetWorkoutCapability: ExpandCapability-free gate is the command itself (17/15). */
  private suspend fun queryNewSteps(): Boolean {
    if (!DeviceCaps.supports(SERVICE, 0x15)) return false
    val response = requestOrNull<Workout.WorkoutCapability.Response>(Workout.WorkoutCapability.Request(params), "WorkoutCapability")
    log("Workout capability: NewSteps: ${response?.supportNewStep}")
    return response?.supportNewStep == true
  }

  private suspend fun syncWorkout(numbers: Workout.WorkoutCount.Response.WorkoutNumbers, newSteps: Boolean, sink: WorkoutSink) {
    val wn = numbers.workoutNumber
    val label = "workout ${wn.toInt()}"
    val totals = retrying("WorkoutTotals ${wn.toInt()}") { attempt ->
      val r = requestOrNull<Workout.WorkoutTotals.Response>(Workout.WorkoutTotals.Request(params, wn), "WorkoutTotals ${wn.toInt()}")
      when {
        r == null -> null
        r.error != null -> { log("$label totals: error ${r.error} (attempt $attempt)"); null }
        r.number != wn -> { log("$label totals: incorrect workout number ${r.number}"); null }
        else -> r
      }
    }
    if (totals == null) {
      log("$label: totals failed after $MAX_RETRIES retries, moving to the next workout")
      return
    }
    log(
      "$label totals: status=${totals.status} start=${totals.startTime} end=${totals.endTime} calories=${totals.calories} " +
        "distance=${totals.distance} steps=${totals.stepCount} time=${totals.totalTime} duration=${totals.duration} type=${totals.type.toInt() and 0xFF}",
    )
    val start = totals.startTime.toLong() and 0xFFFFFFFFL
    val end = totals.endTime.toLong() and 0xFFFFFFFFL
    if (sink.isComplete(start, end)) {
      log("$label: already stored (start=$start), skipped")
      return
    }

    val parts = WorkoutParts(totals)
    parts.newSteps = newSteps
    var complete = false
    try {
      downloadParts(numbers, parts)
      complete = true
    } finally {
      // A timeout or lost link keeps what was downloaded, flagged incomplete so the next sync retries.
      val record = WorkoutBuilder.build(parts, complete)
      val isNew = withContext(NonCancellable) { sink.save(record) }
      if (isNew) saved++
      log(
        "$label: stored ${if (complete) "complete" else "incomplete"} ${record.sportName} " +
          "${record.start}..${record.end} dur=${record.duration}s dist=${record.distance}m avgHr=${record.avgHr} maxHr=${record.maxHr} " +
          "points=${record.points.size} (data=${parts.samples.size} gps=${parts.gps.size} gpsStatus=${parts.gpsStatus}) missingData=${parts.missingData}",
      )
    }
  }

  private suspend fun downloadParts(numbers: Workout.WorkoutCount.Response.WorkoutNumbers, parts: WorkoutParts) {
    val wn = numbers.workoutNumber
    val label = "workout ${wn.toInt()}"

    for (i in 0 until numbers.dataCount) {
      val l = "WorkoutData ${wn.toInt()}/$i"
      val r = retrying(l) { attempt ->
        val r = requestOrNull<Workout.WorkoutData.Response>(Workout.WorkoutData.Request(params, wn, i.toShort(), parts.newSteps), l)
        when {
          r == null -> null
          r.error != null -> { log("$l: error ${r.error} (attempt $attempt)"); null }
          r.workoutNumber != wn -> { log("$l: incorrect workout number ${r.workoutNumber}"); null }
          r.dataNumber.toInt() != i -> { log("$l: incorrect data number ${r.dataNumber}"); null }
          else -> r
        }
      }
      if (r == null) { skipped(parts, l); continue }
      log("$l: ${r.dataList.size} samples, interval ${r.header.interval}s, bitmap ${r.header.bitmap}, inner bitmap ${r.innerBitmap}")
      parts.samples.addAll(r.dataList)
    }

    for (i in 0 until numbers.paceCount) {
      val l = "WorkoutPace ${wn.toInt()}/$i"
      val r = retrying(l) { attempt ->
        val r = requestOrNull<Workout.WorkoutPace.Response>(Workout.WorkoutPace.Request(params, wn, i.toShort()), l)
        when {
          r == null -> null
          r.error != null -> { log("$l: error ${r.error} (attempt $attempt)"); null }
          r.workoutNumber != wn -> { log("$l: incorrect workout number ${r.workoutNumber}"); null }
          r.paceNumber.toInt() != i -> { log("$l: incorrect pace number ${r.paceNumber}"); null }
          else -> r
        }
      }
      if (r == null) { skipped(parts, l); continue }
      log("$l: ${r.blocks.size} blocks")
      parts.paceBlocks.addAll(r.blocks)
    }

    for (i in 0 until numbers.segmentsCount) {
      val l = "WorkoutSwimSegments ${wn.toInt()}/$i"
      val r = retrying(l) { attempt ->
        val r = requestOrNull<Workout.WorkoutSwimSegments.Response>(Workout.WorkoutSwimSegments.Request(params, wn, i.toShort()), l)
        when {
          r == null -> null
          r.error != null -> { log("$l: error ${r.error} (attempt $attempt)"); null }
          r.workoutNumber != wn -> { log("$l: incorrect workout number ${r.workoutNumber}"); null }
          r.segmentNumber.toInt() != i -> { log("$l: incorrect swim segment number ${r.segmentNumber}"); null }
          else -> r
        }
      }
      if (r == null) { skipped(parts, l); continue }
      log("$l: ${r.blocks.size} blocks")
      parts.swimBlocks.addAll(r.blocks)
    }

    for (i in 0 until numbers.spO2Count) {
      val l = "WorkoutSpO2 ${wn.toInt()}/$i"
      val r = retrying(l) { attempt ->
        val r = requestOrNull<Workout.WorkoutSpO2.Response>(Workout.WorkoutSpO2.Request(params, wn, i.toShort()), l)
        when {
          r == null -> null
          r.error != null -> { log("$l: error ${r.error} (attempt $attempt)"); null }
          else -> r
        }
      }
      if (r == null) { skipped(parts, l); continue }
      log("$l: ${r.blocks.size} blocks")
      parts.spo2Blocks.addAll(r.blocks)
    }

    for (i in 0 until numbers.sectionsCount) {
      val l = "WorkoutSections ${wn.toInt()}/$i"
      var normalError = false
      val r = retrying(l) { attempt ->
        val r = requestOrNull<Workout.WorkoutSections.Response>(Workout.WorkoutSections.Request(params, wn, i.toShort()), l)
        when {
          r == null -> null
          // GB: 0x0001E079 "seems to be normal", ignored without retries and without flagging missing data.
          r.error == SECTIONS_NORMAL_ERROR -> { normalError = true; log("$l: error 0001E079, ignored (normal)"); r }
          r.error != null -> { log("$l: error ${r.error} (attempt $attempt)"); null }
          else -> r
        }
      }
      if (r == null) { skipped(parts, l); continue }
      if (normalError) continue
      log("$l: ${r.blocks.size} blocks")
      parts.sectionBlocks.addAll(r.blocks)
    }

    downloadGps(numbers, parts)
    log("$label: downloaded, missingData=${parts.missingData}")
  }

  /** GB finishSingleWorkoutSync -> downloadWorkoutGpsFiles. */
  private suspend fun downloadGps(numbers: Workout.WorkoutCount.Response.WorkoutNumbers, parts: WorkoutParts) {
    val wn = numbers.workoutNumber
    val label = "workout ${wn.toInt()} GPS"
    // WorkoutCount tag 0x0e: 1 when the watch has a _gps.bin/_pdr.bin for the workout. GB ignores it (older
    // firmware does not send it); here a watch that says 0 is believed, one that sends nothing is asked.
    val reported = try {
      HuaweiTLV().parse(numbers.rawData).contains(0x0e)
    } catch (e: Exception) {
      false
    }
    log("$label: trajectoriesData=${numbers.trajectoriesData} (reported=$reported)")
    if (reported && numbers.trajectoriesData.toInt() == 0) {
      log("$label: watch reports no trajectory data, GPS download skipped")
      return
    }

    val data = try {
      downloader.download(FileRequest.workoutGps(DeviceCaps.gpsNewSync, wn))
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      // A watch without a GPS file for an indoor workout answers the init with an error; that is not a failure.
      if (e.errorCode != ErrorCodes.PROTOCOL) throw e
      log("$label: no GPS file (${e.message})")
      parts.gpsStatus = "failed"
      return
    }
    if (data.isEmpty()) {
      log("$label: GPS file empty")
      parts.gpsStatus = "empty"
      return
    }
    val points = try {
      HuaweiGpsParser.parseHuaweiGps(data)
    } catch (e: Exception) {
      log("$label: GPS file of ${data.size} bytes could not be parsed (${e.javaClass.simpleName}: ${e.message})")
      parts.gpsStatus = "failed"
      return
    }
    // The file parser does no range checks; a garbled file must not put NaN or off-planet points in the table.
    val valid = points.filter { it.latitude.isFinite() && it.longitude.isFinite() && it.latitude in -90.0..90.0 && it.longitude in -180.0..180.0 }
    log("$label: received ${points.size} GPS points, ${valid.size} valid")
    if (valid.isEmpty()) {
      parts.gpsStatus = "empty"
      return
    }
    parts.gpsStatus = "ok"
    parts.gps.addAll(valid)
  }

  private fun skipped(parts: WorkoutParts, label: String) {
    log("$label: max tries exceeded, moving to the next part")
    parts.missingData = true
  }

  /** GB: up to [MAX_RETRIES] repeats of a request that answered with an error, then null. */
  private suspend fun <T> retrying(label: String, block: suspend (attempt: Int) -> T?): T? {
    var attempt = 0
    while (true) {
      block(attempt)?.let { return it }
      if (attempt >= MAX_RETRIES) return null
      attempt++
      log("$label: retry $attempt/$MAX_RETRIES")
    }
  }

  /**
   * Sends [packet] and returns the typed answer, or null when the answer cannot be used (it did not parse or is
   * of another type: the watch answers some workout requests without the expected container). A timeout or a
   * lost link still throws.
   */
  private suspend inline fun <reified T : HuaweiPacket> requestOrNull(packet: HuaweiPacket, label: String): T? =
    try {
      session.request(packet, WORKOUT_MS, label).expect<T>(label)
    } catch (e: WearException) {
      if (e.errorCode != ErrorCodes.PROTOCOL) throw e
      log("$label: unusable answer (${e.message})")
      null
    }

  private fun describe(n: Workout.WorkoutCount.Response.WorkoutNumbers) =
    "#${n.workoutNumber.toInt()}(data=${n.dataCount} pace=${n.paceCount} swim=${n.segmentsCount} spo2=${n.spO2Count} " +
      "sections=${n.sectionsCount} trajectories=${n.trajectoriesData})"

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private companion object {
    const val SERVICE = 0x17
    const val MAX_RETRIES = 3
    const val MAX_SMALLER_TIMESLOT_DEPTH = 5
    const val SECTIONS_NORMAL_ERROR = 0x0001E079

    /** GB uses 5 s for every workout request; the Fit 4 answers the data requests slowly, so more room here. */
    const val WORKOUT_MS = 10_000L
  }
}
