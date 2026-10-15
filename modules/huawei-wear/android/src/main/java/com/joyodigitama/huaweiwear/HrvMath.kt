package com.joyodigitama.huaweiwear

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Time-domain HRV from beat-to-beat (RR) intervals, after the Task Force of the ESC and NASPE (1996): RMSSD (root mean
 * square of successive differences) and SDNN (standard deviation of the intervals). Artifacts are dropped first: an
 * interval outside 300..2000 ms (200..30 bpm), one the watch marked as unusable (`sqi` 0), or one more than 20 % away
 * from the median of its neighbours (a missed or doubled beat). A successive difference only counts when both of its
 * intervals survived.
 */
internal object HrvMath {
  const val MIN_RR_MS = 300
  const val MAX_RR_MS = 2000
  private const val NEIGHBOUR_TOLERANCE = 0.20
  private const val WINDOW = 5

  /** Fewer clean intervals than this give no reading (about 40 s at rest). */
  const val MIN_BEATS = 40

  class Result(val rmssd: Double, val sdnn: Double, val meanRr: Double, val beats: Int)

  /** [rr] in milliseconds, in order; [sqi] the watch's quality per interval or null when it gave none. */
  fun compute(rr: List<Int>, sqi: List<Int>? = null): Result? {
    val keep = BooleanArray(rr.size) { i ->
      rr[i] in MIN_RR_MS..MAX_RR_MS && (sqi == null || sqi.getOrNull(i) != 0)
    }
    for (i in rr.indices) {
      if (!keep[i]) continue
      val neighbours = (maxOf(0, i - WINDOW)..minOf(rr.size - 1, i + WINDOW))
        .filter { it != i && rr[it] in MIN_RR_MS..MAX_RR_MS }
        .map { rr[it] }
        .sorted()
      if (neighbours.size >= 3) {
        val median = neighbours[neighbours.size / 2].toDouble()
        if (abs(rr[i] - median) > NEIGHBOUR_TOLERANCE * median) keep[i] = false
      }
    }
    val clean = rr.indices.filter { keep[it] }
    if (clean.size < MIN_BEATS) return null
    var sumSq = 0.0
    var diffs = 0
    for (k in 1 until clean.size) {
      val a = clean[k - 1]
      val b = clean[k]
      if (b != a + 1) continue
      val d = (rr[b] - rr[a]).toDouble()
      sumSq += d * d
      diffs++
    }
    if (diffs < MIN_BEATS / 2) return null
    val values = clean.map { rr[it].toDouble() }
    val mean = values.average()
    val sdnn = sqrt(values.sumOf { (it - mean) * (it - mean) } / (values.size - 1))
    return Result(rmssd = sqrt(sumSq / diffs), sdnn = sdnn, meanRr = mean, beats = clean.size)
  }
}
