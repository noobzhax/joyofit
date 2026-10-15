// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): devices/huawei/packets/HrRriTest (RriData.Response),
// service/devices/huawei/HuaweiStressCalibration (stopMeasurements: which intervals feed the stress model, how StressData is filled).
package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiStressParser
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.stress.HuaweiStressHRVCalculation
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.stress.HuaweiStressScoreCalculation

/** One beat-to-beat interval the watch pushed: [rri] in ms and its signal quality [sqi] (0 = unusable, 100 = good). */
internal class RriBeat(val rri: Int, val sqi: Int)

/** Pure parts of the 1-minute HRV measurement (`19/01` + `19/05`) and of the stress calibration built on it. */
internal object HrvSpotCodec {
  const val SERVICE = 0x19
  const val OPEN_CLOSE = 0x01
  const val RRI_DATA = 0x05

  /** `19/01` tag 01: open the RRI stream (GB HuaweiStressCalibration.startMeasurements). */
  const val OPEN: Byte = 3

  /** `19/01` tag 01: close it again (GB HuaweiStressCalibration.stopMeasurements). */
  const val CLOSE: Byte = 4

  /** The measurement runs this long (GB: `CountDownTimer(60000, 1000)`). */
  const val MEASURE_MS = 60_000L

  /**
   * `19/05`: `82{83{04 rri (2 bytes), 05 sqi (1 byte)}, 83{...}, ...}` (GB `HrRriTest.RriData.Response.parseTlv`). The
   * values are read unsigned and by size, a beat without either tag is skipped, and several `82` blocks are all read.
   */
  fun decodeRri(tlv: HuaweiTLV?): List<RriBeat> {
    if (tlv == null || !tlv.contains(0x82)) return emptyList()
    val beats = ArrayList<RriBeat>()
    for (outer in tlv.getObjects(0x82)) {
      for (inner in outer.getObjects(0x83)) {
        val rri = LiveWorkoutWire.unsigned(inner.getBytes(0x04, null))?.toInt() ?: continue
        val sqi = LiveWorkoutWire.unsigned(inner.getBytes(0x05, null))?.toInt() ?: continue
        beats += RriBeat(rri, sqi)
      }
    }
    return beats
  }

  /**
   * GB `HuaweiStressCalibration.stopMeasurements`: intervals with `sqi == 0` are dropped, the rest go through
   * `HuaweiStressHRVCalculation` (10 features) and `HuaweiStressScoreCalculation`; the watch wants 12 features, the last
   * two always 0. Null when the model refuses the measurement (not 50..70 s, not 30..210 intervals, too many outliers...).
   */
  fun calibrateStress(beats: List<RriBeat>, startMs: Long, endMs: Long): HuaweiStressParser.StressData? {
    val usable = beats.filter { it.sqi != 0 }
    val rri = usable.map { it.rri }
    val sqi = usable.map { it.sqi }
    val signalSeconds = (endMs - startMs).toInt() / 1000
    val features = HuaweiStressHRVCalculation().calculateStressHRVParameters(rri, sqi, signalSeconds)
    if (features == null || features.size != 10) return null
    val factor = HuaweiStressScoreCalculation.calculateScoreFactor(features)
    val score = HuaweiStressScoreCalculation.calculateNormalizedFinalScore(factor)
    val data = HuaweiStressParser.StressData()
    for (f in features) data.features.add(f)
    data.features.add(0.0f)
    data.features.add(0.0f)
    data.startTime = startMs
    data.endTime = endMs
    data.score = score
    data.scoreFactor = factor
    data.level = HuaweiStressScoreCalculation.calculateLevel(score.toInt())
    return data
  }
}
