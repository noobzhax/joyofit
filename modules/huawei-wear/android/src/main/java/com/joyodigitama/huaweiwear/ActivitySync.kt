// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.fetchActivityData and
// service/devices/huawei/requests/{GetSleepDataCount,GetSleepData,GetStepDataCount,GetStepData,GetFitnessTotals}Request.
package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData

internal class StepSample(
  val timestamp: Long,
  val steps: Int,
  val calories: Int,
  val distance: Int,
  val heartRate: Int?,
  val spo2: Int?,
  val restingHeartRate: Int?,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "timestamp" to timestamp,
    "steps" to steps,
    "calories" to calories,
    "distance" to distance,
    "heartRate" to heartRate,
    "spo2" to spo2,
    "restingHeartRate" to restingHeartRate,
  )
}

internal class SleepSegment(val start: Long, val end: Long, val type: Int) {
  fun toJs(): Map<String, Any?> = mapOf("start" to start, "end" to end, "type" to type)
}

internal class SyncResult(
  val from: Long,
  val to: Long,
  val samples: List<StepSample>,
  val sleep: List<SleepSegment>,
  val totalSteps: Int,
  val totalCalories: Int,
  val totalDistance: Int,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "from" to from,
    "to" to to,
    "samples" to samples.map { it.toJs() },
    "sleep" to sleep.map { it.toJs() },
    "totals" to mapOf(
      "steps" to totalSteps,
      "calories" to totalCalories,
      "distance" to totalDistance,
    ),
  )
}

/**
 * Port of HuaweiSupportProvider.fetchActivityData for the sleep/step/totals part: sleep count and
 * data (GetSleepDataCountRequest, GetSleepDataRequest), step count and data
 * (GetStepDataCountRequest, GetStepDataRequest), then GetFitnessTotalsRequest. Results are
 * returned instead of being written to GB's database.
 */
internal class ActivitySync(
  private val session: HuaweiSession,
  private val events: WearEvents,
) {
  private val params get() = session.params

  suspend fun sync(fromSec: Long): SyncResult {
    // "Some bands don't work with zero timestamp, so starting later" (GB: 01/01/2000).
    val start = if (fromSec <= 0L) MIN_START_SEC else minOf(fromSec, Int.MAX_VALUE.toLong())
    val end = (System.currentTimeMillis() / 1000).toInt()
    events.log(LogDirection.INFO, null, null, null, "Sync: from=$start to=$end")

    val sleep = fetchSleep(start.toInt(), end)
    val samples = fetchSteps(start.toInt(), end)

    // GetFitnessTotalsRequest. The Fit 4 can answer without the 0x81 container; then today's
    // totals are summed from the synced per-minute samples since local midnight.
    val totals = skippable("FitnessTotals") {
      session
        .request(FitnessData.FitnessTotals.Request(params), Timeouts.SYNC_COUNT_MS, "FitnessTotals")
        .expect<FitnessData.FitnessTotals.Response>("FitnessTotals")
    }
    val midnight = java.time.LocalDate.now().atStartOfDay(java.time.ZoneId.systemDefault()).toEpochSecond()
    val today = samples.filter { it.timestamp >= midnight }
    val totalSteps = totals?.totalSteps ?: today.sumOf { it.steps }
    val totalCalories = totals?.totalCalories ?: today.sumOf { it.calories }
    val totalDistance = totals?.totalDistance ?: today.sumOf { it.distance }

    events.log(
      LogDirection.INFO,
      null,
      null,
      null,
      "Sync: ${samples.size} step samples, ${sleep.size} sleep segments, totals steps=$totalSteps " +
        "calories=$totalCalories distance=$totalDistance" + if (totals == null) " (summed from samples)" else "",
    )
    return SyncResult(start, end.toLong(), samples, sleep, totalSteps, totalCalories, totalDistance)
  }

  // GetSleepDataCountRequest -> GetSleepDataRequest chain

  private suspend fun fetchSleep(start: Int, end: Int): List<SleepSegment> {
    val segments = ArrayList<SleepSegment>()
    val maxCount = messageCount(FitnessData.MessageCount.sleepId, start, end, "SleepDataCount")
    if (maxCount <= 0) return segments

    var count = 0
    while (true) {
      val label = "SleepData ${count + 1}/$maxCount"
      val response = skippable(label) {
        session
          .request(
            FitnessData.MessageData.Request(params, FitnessData.MessageData.sleepId, count.toShort()),
            Timeouts.SYNC_DATA_MS,
            label,
          )
          .expect<FitnessData.MessageData.SleepResponse>(label)
      }
      if (response == null) {
        if (count + 1 < maxCount) { count += 1; continue } else break
      }

      if (response.number.toInt() != count) {
        events.log(LogDirection.INFO, null, null, null, "$label: counts do not match (received ${response.number})")
      }

      for (container in response.containers) {
        val raw: ByteArray? = container.timestamp
        if (raw == null || raw.size < 6) {
          events.log(LogDirection.ERROR, null, null, null, "$label: sleep timestamp has ${raw?.size ?: 0} bytes, expected 6")
          continue
        }
        // GB GetSleepDataRequest: bytes 0-3 start (big-endian seconds), bytes 4-5 duration in minutes.
        val b = IntArray(6) { raw[it].toInt() and 0xFF }
        val startSec = (b[0].toLong() shl 24) or (b[1].toLong() shl 16) or (b[2].toLong() shl 8) or b[3].toLong()
        val durationMin = (b[4] shl 8) or b[5]
        segments.add(SleepSegment(startSec, startSec + durationMin * 60L, container.type.toInt() and 0xFF))
      }

      if (count + 1 < maxCount) count += 1 else break
    }
    return segments
  }

  // GetStepDataCountRequest -> GetStepDataRequest chain

  private suspend fun fetchSteps(start: Int, end: Int): List<StepSample> {
    val samples = ArrayList<StepSample>()
    val maxCount = messageCount(FitnessData.MessageCount.stepId, start, end, "StepDataCount")
    if (maxCount <= 0) return samples

    var count = 0
    var requests = 0
    while (true) {
      val label = "StepData ${count + 1}/$maxCount"
      val response = skippable(label) {
        session
          .request(
            FitnessData.MessageData.Request(params, FitnessData.MessageData.stepId, count.toShort()),
            Timeouts.SYNC_DATA_MS,
            label,
          )
          .expect<FitnessData.MessageData.StepResponse>(label)
      }
      if (response == null) {
        if (count + 1 < maxCount) { count += 1; continue } else break
      }

      if (response.number.toInt() != count) {
        events.log(
          LogDirection.INFO,
          null,
          null,
          null,
          "$label: counts do not match (received ${response.number}, expected $count)",
        )
        count = response.number.toInt() // GB: "This stops it from going into a loop"
      }

      for (container in response.containers) {
        if (container.parsedData == null) {
          events.log(LogDirection.ERROR, null, null, null, "$label: ${container.parsedDataError}")
          continue
        }
        samples.add(
          StepSample(
            timestamp = container.timestamp.toLong(),
            steps = nonNegative(container.steps),
            calories = nonNegative(container.calories),
            distance = nonNegative(container.distance),
            heartRate = measured(container.heartrate),
            spo2 = measured(container.spo),
            restingHeartRate = measured(container.restingHeartRate),
          ),
        )
      }

      if (count + 1 < maxCount) count += 1 else break
      // GB trusts the watch's counter; bound the loop in case it never settles.
      if (++requests > maxCount * 2 + 16) {
        throw WearException(ErrorCodes.PROTOCOL, "StepData paging did not converge after $requests requests (count=$maxCount)")
      }
    }
    return samples
  }

  /**
   * Returns 0 when the watch answers without the 0x81 count container. Newer watches (Fit 4,
   * fw 6.1.0.117) do this for the old-style sleep frames, which they replace with TruSleep files.
   * GB aborts the whole sync there; we skip only that data type.
   */
  private suspend fun messageCount(commandId: Byte, start: Int, end: Int, label: String): Int {
    val response = skippable(label) {
      session
        .request(
          FitnessData.MessageCount.Request(params, commandId, start, end),
          Timeouts.SYNC_COUNT_MS,
          label,
        )
        .expect<FitnessData.MessageCount.Response>(label)
    } ?: return 0
    val count = response.count.toInt()
    events.log(LogDirection.INFO, null, null, null, "$label: $count")
    return count
  }

  /**
   * Runs [block]; a response the watch sent without the expected TLV (parse failure, seen on the
   * Fit 4 as frames lacking tag 0x81) is logged and yields null so the sync continues.
   * Transport errors and timeouts still abort.
   */
  private suspend fun <T> skippable(label: String, block: suspend () -> T): T? =
    try {
      block()
    } catch (e: WearException) {
      if (e.errorCode != ErrorCodes.PROTOCOL || e.cause !is HuaweiPacket.ParseException) throw e
      events.log(LogDirection.INFO, null, null, null, "$label: no data in response (${e.cause?.message}); skipping")
      null
    }

  /** GB casts to short and maps -1 (field absent / 0xFFFF) to 0. */
  private fun nonNegative(value: Int): Int {
    val asShort = value.toShort().toInt()
    return if (asShort == -1) 0 else asShort
  }

  /** `value & 0xFF`, with the watch's "not measured" markers (absent -1, 0, 0xFF) as null. */
  private fun measured(value: Int): Int? {
    val byte = value and 0xFF
    return if (byte == 0 || byte == 0xFF) null else byte
  }

  private companion object {
    const val MIN_START_SEC = 946684800L
  }
}
