// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiWorkoutGbParser
// (updateBaseSummary: how the totals, data samples, pace and swim blocks are turned into summary values) and
// HuaweiWorkoutSyncManager.addWorkoutTotalsDataToDb. GB writes these into its own database and ActivitySummary
// JSON; here they become one [WorkoutRecord] for the app's `workouts` / `workout_points` tables.
package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiGpsParser
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout
import org.json.JSONArray
import org.json.JSONObject

/**
 * One sample of the route / heart-rate series. GPS points carry lat/lon (and the GPS altitude when the file has
 * one); data samples carry the heart rate and the barometric altitude. A point has only the fields its source had.
 */
internal class WorkoutPoint(val ts: Long, val lat: Double?, val lon: Double?, val alt: Double?, val hr: Int?)

/** One workout as stored (`workouts` row plus its points). Times are unix seconds, distance metres. */
internal class WorkoutRecord(
  /** The watch's own workout counter (FitnessData 0x17 tag 0x02); not unique across watches or resets. */
  val number: Int,
  val start: Long,
  val end: Long,
  /** The raw Huawei sport type byte, read unsigned. */
  val sportType: Int,
  val sportName: String,
  val duration: Int,
  val distance: Int,
  val calories: Int,
  val steps: Int,
  val avgHr: Int?,
  val maxHr: Int?,
  val summaryJson: String,
  val points: List<WorkoutPoint>,
  /** False while a part of the download failed; the next sync fetches the workout again. */
  val complete: Boolean,
)

/** Everything downloaded for one workout, filled in by [WorkoutSync]. */
internal class WorkoutParts(val totals: Workout.WorkoutTotals.Response) {
  val samples = ArrayList<Workout.WorkoutData.Response.Data>()
  val paceBlocks = ArrayList<Workout.WorkoutPace.Response.Block>()
  val swimBlocks = ArrayList<Workout.WorkoutSwimSegments.Response.Block>()
  val spo2Blocks = ArrayList<Workout.WorkoutSpO2.Response.Block>()
  val sectionBlocks = ArrayList<Workout.WorkoutSections.Response.Block>()
  val gps = ArrayList<HuaweiGpsParser.GpsPoint>()

  /** GB `currentWorkoutMissingData`: the watch kept refusing some part after the retries. */
  var missingData = false

  /** WorkoutCapability `supportNewStep`, GB `HuaweiWorkoutSummarySample.newSteps`. */
  var newSteps = false

  /** What happened to the GPS file: `none` (not asked), `empty`, `ok`, `failed`. */
  var gpsStatus = "none"
}

internal object WorkoutBuilder {
  fun build(parts: WorkoutParts, complete: Boolean): WorkoutRecord {
    val totals = parts.totals
    val type = totals.type.toInt() and 0xFF
    val kind = WorkoutSportTypes.kind(type)
    val start = totals.startTime.toLong() and 0xFFFFFFFFL
    val end = totals.endTime.toLong() and 0xFFFFFFFFL

    val duration = when {
      totals.duration >= 0 -> totals.duration
      totals.totalTime >= 0 -> totals.totalTime
      else -> maxOf(0L, end - start).toInt()
    }
    val distance = maxOf(0, totals.distance)
    val calories = maxOf(0, totals.calories)
    val steps = maxOf(0, totals.stepCount)

    val stats = SampleStats.of(parts, kind)
    val peakMin = totals.minHeartRatePeak.toInt() and 0xFF
    val peakMax = totals.maxHeartRatePeak.toInt() and 0xFF
    val maxHr = stats.maxHr ?: peakMax.takeIf { it > 0 }

    return WorkoutRecord(
      number = totals.number.toInt(),
      start = start,
      end = end,
      sportType = type,
      sportName = WorkoutSportTypes.name(type),
      duration = duration,
      distance = distance,
      calories = calories,
      steps = steps,
      avgHr = stats.avgHr,
      maxHr = maxHr,
      summaryJson = summaryJson(parts, kind, duration, distance, stats, peakMin, peakMax).toString(),
      points = points(parts),
      complete = complete,
    )
  }

  fun points(parts: WorkoutParts): List<WorkoutPoint> {
    val out = ArrayList<WorkoutPoint>(parts.samples.size + parts.gps.size)
    for (d in parts.samples) {
      val hr = validHeartRate(d.heartRate)
      val alt = d.altitude?.let { it / 10.0 }
      if (hr != null || alt != null) out.add(WorkoutPoint(d.timestamp.toLong() and 0xFFFFFFFFL, null, null, alt, hr))
    }
    for (p in parts.gps) {
      out.add(
        WorkoutPoint(
          p.timestamp.toLong() and 0xFFFFFFFFL,
          p.latitude,
          p.longitude,
          if (p.altitudeSupported) p.altitude else null,
          null,
        ),
      )
    }
    // Stable: samples before GPS points of the same second.
    return out.sortedBy { it.ts }
  }

  /** GB: the watch's 0 and -1 (0xFF) mean "no heart rate in this sample". */
  fun validHeartRate(value: Byte): Int? {
    val hr = value.toInt() and 0xFF
    return if (hr == 0 || hr == 0xFF) null else hr
  }

  private fun summaryJson(
    parts: WorkoutParts,
    kind: String,
    duration: Int,
    distance: Int,
    stats: SampleStats,
    peakMin: Int,
    peakMax: Int,
  ): JSONObject {
    val t = parts.totals
    val json = JSONObject()
    json.put("kind", kind)
    json.put("number", t.number.toInt())
    if (t.status >= 0) json.put("status", t.status.toInt())
    if (t.totalTime >= 0) json.put("totalTime", t.totalTime)
    json.put("newSteps", parts.newSteps)
    json.put("gps", parts.gpsStatus)
    json.put("gpsPoints", parts.gps.size)
    json.put("dataSamples", parts.samples.size)
    json.put("missingData", parts.missingData)
    t.rawData?.let { json.put("rawTotals", it.toHex()) }

    // GB: average speed is distance / active time; swim pace per 100 m, others per km.
    if (duration > 0 && distance > 0) {
      val avgSpeed = distance.toDouble() / duration
      json.put("avgSpeed", avgSpeed)
      when {
        WorkoutSportTypes.isSwim(kind) -> json.put("avgPaceSecPer100m", 100.0 / avgSpeed)
        WorkoutSportTypes.isPace(kind) -> json.put("avgPaceSecPerKm", 1000.0 / avgSpeed)
      }
    }
    stats.maxSpeed?.let { speed ->
      json.put("maxSpeed", speed)
      if (speed > 0) {
        when {
          WorkoutSportTypes.isSwim(kind) -> json.put("minPaceSecPer100m", 100.0 / speed)
          WorkoutSportTypes.isPace(kind) -> json.put("minPaceSecPerKm", 1000.0 / speed)
        }
      }
    }
    if (kind == "JUMP_ROPING") {
      json.put("jumps", t.stepCount.coerceAtLeast(0))
      if (t.longestStreak > 0) json.put("longestStreak", t.longestStreak)
      if (t.tripped > 0) json.put("interruptions", t.tripped)
    }

    if (peakMin > 0) json.put("hrPeakMin", peakMin)
    if (peakMax > 0) json.put("hrPeakMax", peakMax)
    stats.minHr?.let { json.put("minHr", it) }

    // Altitudes and elevation are decimetres on the wire (GB divides by 10).
    val minAlt = t.minAltitude ?: stats.minAlt
    val maxAlt = t.maxAltitude ?: stats.maxAlt
    val gain = t.elevationGain ?: stats.altUp
    val loss = t.elevationLoss ?: stats.altDown
    if (WorkoutSportTypes.isDiving(kind)) {
      // GB: for diving the "elevation loss" is the maximum depth.
      loss?.let { json.put("maxDepth", it / 10.0) }
    } else {
      minAlt?.let { json.put("minAltitude", it / 10.0) }
      maxAlt?.let { json.put("maxAltitude", it / 10.0) }
      gain?.let { json.put("elevationGain", it / 10.0) }
      loss?.let { json.put("elevationLoss", it / 10.0) }
    }
    stats.avgAlt?.let { json.put("avgAltitude", it / 10.0) }

    if (t.workoutLoad > 0) json.put("workoutLoad", t.workoutLoad)
    if (t.workoutAerobicEffect > 0) json.put("aerobicEffect", t.workoutAerobicEffect / 10.0)
    if (t.workoutAnaerobicEffect >= 0) json.put("anaerobicEffect", t.workoutAnaerobicEffect / 10.0)
    if (t.recoveryTime > 0) json.put("recoveryHours", t.recoveryTime / 60.0)
    if (t.maxMET > 0) json.put("vo2max", (t.maxMET * 3.5f).toInt() / 65536)
    if (t.trainingPoints >= 0) json.put("trainingPoints", t.trainingPoints)
    if (t.hrZoneType >= 0) json.put("hrZoneType", t.hrZoneType.toInt())
    t.recoveryHeartRates?.let { rec ->
      if (rec.isNotEmpty()) json.put("recoveryHeartRates", JSONArray(rec.map { it.toInt() and 0xFF }))
    }

    val swim = JSONObject()
    if (t.swimType >= 0) swim.put("style", swimStyle(t.swimType.toInt()))
    if (t.strokes >= 0) swim.put("strokes", t.strokes.toInt())
    if (t.avgStrokeRate > 0) swim.put("avgStrokeRate", t.avgStrokeRate.toInt())
    if (t.poolLength >= 0) swim.put("poolLengthCm", t.poolLength.toInt())
    if (t.laps >= 0) swim.put("laps", t.laps.toInt())
    if (t.avgSwolf > 0) swim.put("avgSwolf", t.avgSwolf.toInt())
    if (swim.length() > 0) json.put("swim", swim)

    val zones = JSONArray()
    val zoneMin = shortArrayOf(t.runPaceZone1Min, t.runPaceZone2Min, t.runPaceZone3Min, t.runPaceZone4Min, t.runPaceZone5Min)
    val zoneTime = shortArrayOf(t.runPaceZone1Time, t.runPaceZone2Time, t.runPaceZone3Time, t.runPaceZone4Time, t.runPaceZone5Time)
    if (zoneTime.any { it >= 0 }) {
      for (i in 0 until 5) {
        zones.put(
          JSONObject().put("minPace", zoneMin[i].toInt()).put("seconds", zoneTime[i].toInt()),
        )
      }
      json.put("runPaceZones", JSONObject().put("zones", zones).put("slowestMax", t.runPaceZone5Max.toInt()))
    }

    if (t.additionalValues.isNotEmpty()) {
      val extra = JSONObject()
      for ((key, value) in t.additionalValues) extra.put(key, value)
      json.put("additional", extra)
    }

    stats.putAverages(json)

    if (parts.paceBlocks.isNotEmpty()) {
      val blocks = JSONArray()
      for (b in parts.paceBlocks) {
        blocks.put(
          JSONObject()
            .put("type", b.type.toInt()) // GB: 0 = per km, 1 = per mile
            .put("distance", b.distance.toInt())
            .put("correction", if (b.hasCorrection) b.correction.toInt() else JSONObject.NULL) // 1/10000 of a unit
            .put("pace", b.pace) // seconds per unit
            .put("pointIndex", b.pointIndex.toInt()),
        )
      }
      json.put("paceBlocks", blocks)
      paceAggregates(parts.paceBlocks)?.let { (avg, fastest, slowest) ->
        json.put("paceAvgSecPerKm", avg)
        json.put("paceFastestSecPerKm", fastest)
        json.put("paceSlowestSecPerKm", slowest)
      }
    }
    if (parts.swimBlocks.isNotEmpty()) {
      val blocks = JSONArray()
      for (b in parts.swimBlocks) {
        blocks.put(
          JSONObject()
            .put("distance", b.distance.toInt())
            .put("type", b.type.toInt())
            .put("pace", b.pace)
            .put("pointIndex", b.pointIndex.toInt())
            .put("segment", b.segment.toInt())
            .put("swimType", b.swimType.toInt())
            .put("strokes", b.strokes.toInt())
            .put("avgSwolf", b.avgSwolf.toInt())
            .put("time", b.time),
        )
      }
      json.put("swimSegments", blocks)
    }
    if (parts.spo2Blocks.isNotEmpty()) {
      val blocks = JSONArray()
      for (b in parts.spo2Blocks) blocks.put(JSONObject().put("interval", b.interval).put("value", b.value))
      json.put("spo2", blocks)
    }
    if (parts.sectionBlocks.isNotEmpty()) {
      val blocks = JSONArray()
      for (b in parts.sectionBlocks) {
        blocks.put(
          JSONObject()
            .put("num", b.num)
            .put("time", b.time)
            .put("distance", b.distance)
            .put("pace", b.pace)
            .put("heartRate", b.heartRate)
            .put("cadence", b.cadence)
            .put("stepLength", b.stepLength)
            .put("totalRise", b.totalRise)
            .put("totalDescend", b.totalDescend),
        )
      }
      json.put("sections", blocks)
    }
    return json
  }

  /**
   * GB: over the per-km blocks (type 0), the average weighted by each block's share of a km
   * (`correction`, 10000 = a whole km), plus the fastest and slowest. Seconds per km.
   */
  fun paceAggregates(blocks: List<Workout.WorkoutPace.Response.Block>): Triple<Int, Int, Int>? {
    var weightSum = 0L
    var paceSum = 0L
    var fastest = Int.MAX_VALUE
    var slowest = 0
    for (b in blocks) {
      if (b.type.toInt() != 0) continue
      val weight = if (b.hasCorrection) b.correction.toLong() else 10000L
      weightSum += weight
      paceSum += b.pace.toLong() * weight
      if (b.pace < fastest) fastest = b.pace
      if (b.pace > slowest) slowest = b.pace
    }
    if (weightSum == 0L || paceSum == 0L) return null
    return Triple((paceSum / weightSum).toInt(), fastest, slowest)
  }

  /** GB HuaweiWorkoutGbParser.getSwimStyle. */
  fun swimStyle(swimType: Int): String = when (swimType) {
    1 -> "breaststroke"
    3 -> "butterfly"
    4 -> "backstroke"
    5 -> "medley"
    else -> "freestyle"
  }
}

/** The aggregates GB's updateBaseSummary computes over the data samples. */
internal class SampleStats private constructor() {
  var avgHr: Int? = null
  var maxHr: Int? = null
  var minHr: Int? = null

  /** Metres per second (the wire speed is decimetres per second). */
  var maxSpeed: Double? = null

  var minAlt: Int? = null
  var maxAlt: Int? = null
  var avgAlt: Int? = null
  var altUp: Int? = null
  var altDown: Int? = null

  private val averages = LinkedHashMap<String, Double>()
  private val extremes = LinkedHashMap<String, Int>()

  fun putAverages(json: JSONObject) {
    if (averages.isEmpty() && extremes.isEmpty()) return
    val out = JSONObject()
    for ((k, v) in averages) out.put(k, v)
    for ((k, v) in extremes) out.put(k, v)
    json.put("samples", out)
  }

  private class Mean {
    var sum = 0L
    var count = 0
    fun add(v: Int) { sum += v; count++ }
    fun value(): Double? = if (count > 0) sum.toDouble() / count else null
  }

  companion object {
    fun of(parts: WorkoutParts, kind: String): SampleStats {
      val s = SampleStats()
      val samples = parts.samples
      if (samples.isEmpty()) return s

      val hr = Mean()
      val cadence = Mean()
      val stepLength = Mean()
      val contact = Mean()
      val swing = Mean()
      val impact = Mean()
      val eversion = Mean()
      val swolf = Mean()
      val strokeRate = Mean()
      val power = Mean()
      val alt = Mean()
      var maxSpeed = Int.MIN_VALUE
      var maxImpact = Int.MIN_VALUE
      var maxEversion = Int.MIN_VALUE
      var minSwolf = Int.MAX_VALUE
      var maxSwolf = Int.MIN_VALUE
      var maxStrokeRate = Int.MIN_VALUE
      var minPower = Int.MAX_VALUE
      var maxPower = Int.MIN_VALUE
      var maxFrequency = Int.MIN_VALUE
      var minHr = Int.MAX_VALUE
      var maxHr = Int.MIN_VALUE
      var minAlt = Int.MAX_VALUE
      var maxAlt = Int.MIN_VALUE
      var previousAlt: Int? = null
      var up = 0
      var down = 0
      var altCount = 0

      val walkingSteps = parts.newSteps && (kind == "WALKING" || kind == "OUTDOOR_WALKING")

      for (d in samples) {
        if (d.speed.toInt() != -1) maxSpeed = maxOf(maxSpeed, d.speed.toInt())
        // GB: with the new step algorithm walking reports cadence in the step-rate byte.
        if (walkingSteps) {
          if (d.stepRate.toInt() != -1) cadence.add(d.stepRate.toInt() and 0xFF)
        } else if (d.cadence.toInt() != -1) {
          cadence.add(d.cadence.toInt())
        }
        if (d.stepLength.toInt() != -1) stepLength.add(d.stepLength.toInt())
        if (d.groundContactTime.toInt() != -1) contact.add(d.groundContactTime.toInt())
        if (d.impact.toInt() != -1) {
          impact.add(d.impact.toInt())
          maxImpact = maxOf(maxImpact, d.impact.toInt())
        }
        if (d.swingAngle.toInt() != -1) swing.add(d.swingAngle.toInt())
        if (d.eversionAngle.toInt() != -1) {
          eversion.add(d.eversionAngle.toInt())
          maxEversion = maxOf(maxEversion, d.eversionAngle.toInt())
        }
        if (d.swolf.toInt() != -1) {
          swolf.add(d.swolf.toInt())
          minSwolf = minOf(minSwolf, d.swolf.toInt())
          maxSwolf = maxOf(maxSwolf, d.swolf.toInt())
        }
        if (d.strokeRate.toInt() != -1) {
          strokeRate.add(d.strokeRate.toInt())
          maxStrokeRate = maxOf(maxStrokeRate, d.strokeRate.toInt())
        }
        WorkoutBuilder.validHeartRate(d.heartRate)?.let {
          hr.add(it)
          minHr = minOf(minHr, it)
          maxHr = maxOf(maxHr, it)
        }
        if (d.frequency.toInt() != -1) maxFrequency = maxOf(maxFrequency, d.frequency.toInt())
        if (d.cyclingPower.toInt() != -1) {
          power.add(d.cyclingPower.toInt())
          minPower = minOf(minPower, d.cyclingPower.toInt())
          maxPower = maxOf(maxPower, d.cyclingPower.toInt())
        }
        d.altitude?.let { a ->
          alt.add(a)
          altCount++
          minAlt = minOf(minAlt, a)
          maxAlt = maxOf(maxAlt, a)
          previousAlt?.let { prev -> if (a > prev) up += a - prev else down += prev - a }
          previousAlt = a
        }
      }

      s.avgHr = hr.value()?.let { Math.round(it).toInt() }
      if (hr.count > 0) {
        s.maxHr = maxHr
        s.minHr = minHr
      }
      if (maxSpeed != Int.MIN_VALUE) s.maxSpeed = maxSpeed / 10.0
      if (altCount > 0) {
        s.minAlt = minAlt
        s.maxAlt = maxAlt
        s.avgAlt = alt.value()?.let { Math.round(it).toInt() }
        s.altUp = up
        s.altDown = down
      }
      cadence.value()?.let { s.averages[if (walkingSteps) "avgStepRate" else "avgCadence"] = it }
      stepLength.value()?.let { s.averages["avgStepLength"] = it }
      contact.value()?.let { s.averages["avgGroundContactTime"] = it }
      swing.value()?.let { s.averages["avgSwingAngle"] = it }
      impact.value()?.let { s.averages["avgImpact"] = it }
      eversion.value()?.let { s.averages["avgEversionAngle"] = it }
      swolf.value()?.let { s.averages["avgSwolf"] = it }
      strokeRate.value()?.let { s.averages["avgStrokeRate"] = it }
      power.value()?.let { s.averages["avgPower"] = it }
      if (maxImpact != Int.MIN_VALUE) s.extremes["maxImpact"] = maxImpact
      if (maxEversion != Int.MIN_VALUE) s.extremes["maxEversionAngle"] = maxEversion
      if (minSwolf != Int.MAX_VALUE) s.extremes["minSwolf"] = minSwolf
      if (maxSwolf != Int.MIN_VALUE) s.extremes["maxSwolf"] = maxSwolf
      if (maxStrokeRate != Int.MIN_VALUE) s.extremes["maxStrokeRate"] = maxStrokeRate
      if (minPower != Int.MAX_VALUE) s.extremes["minPower"] = minPower
      if (maxPower != Int.MIN_VALUE) s.extremes["maxPower"] = maxPower
      if (maxFrequency > 0) s.extremes["maxJumpRate"] = maxFrequency
      return s
    }
  }
}
