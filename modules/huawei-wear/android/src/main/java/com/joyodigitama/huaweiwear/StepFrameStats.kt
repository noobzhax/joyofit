package com.joyodigitama.huaweiwear

import java.util.TreeMap
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData.MessageData.StepResponse.SubContainer

/**
 * What one sync's step frames carried besides steps: how many subcontainers have the heart-rate TV
 * (feature bitmap 1, bit 0x40), SpO2 (bitmap 2, bit 0x01) and resting heart rate (bitmap 2, bit
 * 0x02), and the TVs GB does not decode. Logged per sync to tell "the watch records nothing" from
 * "the app drops it".
 */
internal class StepFrameStats {
  var containers = 0
    private set
  var unparsed = 0
    private set
  var heartRate = 0
    private set
  var heartRateMeasured = 0
    private set
  var spo2 = 0
    private set
  var spo2Measured = 0
    private set
  var restingHeartRate = 0
    private set
  var restingHeartRateMeasured = 0
    private set

  /** `bitmap/tag` -> occurrences and the last value seen, in a stable order. */
  private val unknown = TreeMap<String, Pair<Int, Int>>()

  fun add(container: SubContainer) {
    containers++
    val tvs = container.parsedData
    if (tvs == null) {
      unparsed++
      return
    }
    for (tv in tvs) {
      val bitmap = tv.bitmap.toInt()
      val tag = tv.tag.toInt() and 0xFF
      when {
        bitmap == 1 && tag == HEART_RATE_BIT -> {
          heartRate++
          if (isMeasured(tv.value.toInt())) heartRateMeasured++
        }
        bitmap == 2 && tag == SPO2_BIT -> {
          spo2++
          if (isMeasured(tv.value.toInt())) spo2Measured++
        }
        bitmap == 2 && tag == RESTING_BIT -> {
          restingHeartRate++
          if (isMeasured(tv.value.toInt())) restingHeartRateMeasured++
        }
        bitmap == 1 && tag in KNOWN_BITMAP1 -> Unit
        else -> {
          val key = "b$bitmap/0x%02x".format(tag)
          val seen = unknown[key]
          unknown[key] = Pair((seen?.first ?: 0) + 1, tv.value.toInt())
        }
      }
    }
  }

  /** The unknown TVs as `b1/0x10 x3 (last 7)`, or `none`. */
  fun unknownSummary(): String =
    if (unknown.isEmpty()) "none" else unknown.entries.joinToString(", ") { "${it.key} x${it.value.first} (last ${it.value.second})" }

  fun summary(): String =
    "$containers step subcontainers (${unparsed} unparsed): heartRate TV in $heartRate (measured $heartRateMeasured), " +
      "SpO2 TV in $spo2 (measured $spo2Measured), resting HR TV in $restingHeartRate (measured $restingHeartRateMeasured); " +
      "unknown TVs: ${unknownSummary()}"

  private companion object {
    // Bits GB decodes: bitmap 1 steps 0x02, calories 0x04, distance 0x08, heart rate 0x40.
    const val HEART_RATE_BIT = 0x40
    const val SPO2_BIT = 0x01
    const val RESTING_BIT = 0x02
    val KNOWN_BITMAP1 = setOf(0x02, 0x04, 0x08)

    /** The watch's "not measured" markers (0 and 0xFF) as in [ActivitySync]. */
    fun isMeasured(value: Int): Boolean {
      val byte = value and 0xFF
      return byte != 0 && byte != 0xFF
    }
  }
}
