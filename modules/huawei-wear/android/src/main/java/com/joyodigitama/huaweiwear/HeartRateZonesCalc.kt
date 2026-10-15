// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): devices/huawei/{HuaweiHeartRateZones,HuaweiHeartRateZonesSpec},
// model/heartratezones/{HeartRateZones,HeartRateZonesConfig,HeartRateZonesUtils} and the TLV layout of
// service/devices/huawei/p2p/HuaweiP2PTrackService.getHRZonesData. Only GB's defaults are ported (no user-edited zones).
package com.joyodigitama.huaweiwear

/** Default heart-rate zones of GB's Huawei spec and the TLV the watch's `hw.unitedevice.track` module takes. Pure, no Android. */
internal object HeartRateZonesCalc {
  const val MAXIMUM_HEART_RATE = 220
  const val DEFAULT_REST_HEART_RATE = 60

  /** [huaweiType] is HuaweiHeartRateZonesSpec.HUAWEI_TYPE_*, [hrCorrection] its getHRCorrection. */
  enum class Posture(val huaweiType: Int, val hrCorrection: Int) {
    UPRIGHT(1, 0),
    SITTING(2, 6),
    SWIMMING(3, 10),
    OTHER(4, 5),
  }

  /** [huaweiCode] is HuaweiHeartRateZonesSpec.HUAWEI_CALCULATE_METHOD_*. */
  enum class Method(val huaweiCode: Int) { MHR(0), HRR(1), LTHR(3) }

  data class Zones(
    val method: Method,
    val threshold: Int,
    val resting: Int,
    val zone1: Int,
    val zone2: Int,
    val zone3: Int,
    val zone4: Int,
    val zone5: Int,
  ) {
    /** HeartRateZones.isValid. */
    fun isValid(): Boolean =
      checkValue(threshold) && checkValue(resting) && checkValue(zone1) && checkValue(zone2) && checkValue(zone3) &&
        checkValue(zone4) && checkValue(zone5) && zone1 <= zone2 && zone2 <= zone3 && zone3 <= zone4 && zone4 <= zone5

    /** HeartRateZones.hasValidData. */
    fun hasValidData(): Boolean {
      val valid = zone1 > 0 && zone2 > 0 && zone3 > 0 && zone4 > 0 && zone5 > 0 && threshold > 0
      return if (method == Method.HRR) valid && resting > 0 else valid
    }

    /** `{zone1..zone5, threshold-or-resting}` as [FitnessData.HeartRateZoneConfigPacket] takes them. */
    fun asArray(): IntArray = intArrayOf(zone1, zone2, zone3, zone4, zone5, if (method == Method.HRR) resting else threshold)
  }

  data class Config(
    val posture: Posture,
    val warningEnable: Boolean,
    val warningHRLimit: Int,
    val currentMethod: Method,
    val zones: List<Zones>,
  ) {
    fun byMethod(method: Method): Zones? = zones.firstOrNull { it.method == method }

    /** HeartRateZonesConfig.isValid. */
    fun isValid(): Boolean = checkValue(warningHRLimit) && warningHRLimit > 0 && zones.isNotEmpty() && zones.all { it.isValid() }
  }

  fun checkValue(v: Int): Boolean = v >= 0 && v < MAXIMUM_HEART_RATE

  /** `Math.round(((float) (x * pct)) / 100.0f)`, the float arithmetic of HuaweiHeartRateZones. */
  private fun pct(x: Int, pct: Int): Int = Math.round((x * pct).toFloat() / 100.0f)

  /** HuaweiHeartRateZones(method, HRThreshold) with the default resting rate: its constructor ends in `reset()`. */
  fun zones(method: Method, threshold: Int, resting: Int = DEFAULT_REST_HEART_RATE): Zones = when (method) {
    Method.MHR -> Zones(
      method, threshold, resting,
      zone1 = pct(threshold, 50), zone2 = pct(threshold, 60), zone3 = pct(threshold, 70), zone4 = pct(threshold, 80), zone5 = pct(threshold, 90),
    )
    Method.HRR -> {
      val calc = threshold - resting
      Zones(
        method, threshold, resting,
        zone1 = pct(calc, 59) + resting, zone2 = pct(calc, 74) + resting, zone3 = pct(calc, 84) + resting,
        zone4 = pct(calc, 88) + resting, zone5 = pct(calc, 95) + resting,
      )
    }
    Method.LTHR -> {
      val lthr = Math.round(resting.toFloat() + ((threshold - resting) * 85).toFloat() / 100.0f)
      Zones(
        method, lthr, resting,
        zone1 = pct(lthr, 67), zone2 = pct(lthr, 80), zone3 = pct(lthr, 89), zone4 = pct(lthr, 97), zone5 = pct(lthr, 102),
      )
    }
  }

  /** The methods GB builds per posture (getUprightZone/getSittingZone/...): upright also LTHR. */
  private fun methodsFor(posture: Posture): List<Method> =
    if (posture == Posture.UPRIGHT) listOf(Method.MHR, Method.HRR, Method.LTHR) else listOf(Method.MHR, Method.HRR)

  private fun config(posture: Posture, age: Int, methods: List<Method>): Config {
    val threshold = (MAXIMUM_HEART_RATE - age) - posture.hrCorrection
    return Config(
      posture,
      warningEnable = true,
      warningHRLimit = MAXIMUM_HEART_RATE - age,
      currentMethod = Method.MHR,
      zones = methods.map { zones(it, threshold) },
    )
  }

  /**
   * HuaweiHeartRateZonesSpec.getDeviceConfig for [age]: with Track all four postures; without Track but with the zone
   * command only upright (MHR, plus HRR when [extended]); otherwise nothing.
   */
  fun deviceConfig(age: Int, track: Boolean, simpleCommand: Boolean, extended: Boolean): List<Config> {
    if (!track && simpleCommand) {
      return listOf(config(Posture.UPRIGHT, age, if (extended) listOf(Method.MHR, Method.HRR) else listOf(Method.MHR)))
    }
    if (!track) return emptyList()
    return Posture.values().map { config(it, age, methodsFor(it)) }
  }

  /**
   * HuaweiP2PTrackService.getHRZonesData as (tag, single byte value) pairs in GB's order, or null when GB would refuse
   * to send (an invalid config, e.g. an age that puts a value outside 0..219).
   */
  fun trackTlv(configs: List<Config>): List<Pair<Int, Int>>? {
    fun cfg(p: Posture) = configs.firstOrNull { it.posture == p }
    val upright = cfg(Posture.UPRIGHT)
    val sitting = cfg(Posture.SITTING)
    val swimming = cfg(Posture.SWIMMING)
    val other = cfg(Posture.OTHER)
    if (upright == null || sitting == null || swimming == null || other == null) return null
    if (!upright.isValid() || !sitting.isValid() || !swimming.isValid() || !other.isValid()) return null
    val uMhr = upright.byMethod(Method.MHR)
    val uHrr = upright.byMethod(Method.HRR)
    val uLthr = upright.byMethod(Method.LTHR)
    val sMhr = sitting.byMethod(Method.MHR)
    val sHrr = sitting.byMethod(Method.HRR)
    val wMhr = swimming.byMethod(Method.MHR)
    val wHrr = swimming.byMethod(Method.HRR)
    val oMhr = other.byMethod(Method.MHR)
    val oHrr = other.byMethod(Method.HRR)
    if (uMhr == null || uHrr == null || uLthr == null || sMhr == null || sHrr == null || wMhr == null || wHrr == null || oMhr == null || oHrr == null) return null

    val out = ArrayList<Pair<Int, Int>>()
    fun put(tag: Int, v: Int) {
      out.add(tag to (v and 0xFF))
    }
    fun flag(c: Config) = if (c.warningEnable) 1 else 0

    if (uMhr.hasValidData()) {
      put(0x2, uMhr.zone1); put(0x3, uMhr.zone2); put(0x4, uMhr.zone3); put(0x5, uMhr.zone4); put(0x6, uMhr.zone5)
      put(0x7, uMhr.threshold); put(0x8, flag(upright)); put(0x9, upright.warningHRLimit)
      put(0xa, upright.currentMethod.huaweiCode); put(0xb, uMhr.threshold)
    }
    put(0xc, uHrr.resting)
    if (uHrr.hasValidData()) {
      put(0xd, uHrr.zone1); put(0xe, uHrr.zone2); put(0xf, uHrr.zone3); put(0x10, uHrr.zone4); put(0x11, uHrr.zone5)
    }
    if (uLthr.hasValidData()) {
      put(0x3f, uLthr.threshold); put(0x40, uLthr.zone5); put(0x41, uLthr.zone4); put(0x42, uLthr.zone3); put(0x43, uLthr.zone2); put(0x44, uLthr.zone1)
    }
    if (sMhr.hasValidData()) {
      put(0x12, flag(sitting)); put(0x13, sitting.currentMethod.huaweiCode); put(0x14, sitting.warningHRLimit)
      put(0x15, sMhr.zone1); put(0x16, sMhr.zone2); put(0x17, sMhr.zone3); put(0x18, sMhr.zone4); put(0x19, sMhr.zone5); put(0x1a, sMhr.threshold)
    }
    if (sHrr.hasValidData()) {
      put(0x1b, sHrr.resting); put(0x1c, sHrr.zone1); put(0x1d, sHrr.zone2); put(0x1e, sHrr.zone3); put(0x1f, sHrr.zone4); put(0x20, sHrr.zone5)
    }
    if (wMhr.hasValidData()) {
      put(0x21, flag(swimming)); put(0x22, swimming.currentMethod.huaweiCode); put(0x23, swimming.warningHRLimit)
      put(0x24, wMhr.zone1); put(0x25, wMhr.zone2); put(0x26, wMhr.zone3); put(0x27, wMhr.zone4); put(0x28, wMhr.zone5); put(0x29, wMhr.threshold)
    }
    if (wHrr.hasValidData()) {
      put(0x2a, wHrr.resting); put(0x2b, wHrr.zone1); put(0x2c, wHrr.zone2); put(0x2d, wHrr.zone3); put(0x2e, wHrr.zone4); put(0x2f, wHrr.zone5)
    }
    if (oMhr.hasValidData()) {
      put(0x30, flag(other)); put(0x31, other.currentMethod.huaweiCode); put(0x32, other.warningHRLimit)
      put(0x33, oMhr.zone1); put(0x34, oMhr.zone2); put(0x35, oMhr.zone3); put(0x36, oMhr.zone4); put(0x37, oMhr.zone5); put(0x38, oMhr.threshold)
    }
    if (oHrr.hasValidData()) {
      put(0x39, oHrr.resting); put(0x3a, oHrr.zone1); put(0x3b, oHrr.zone2); put(0x3c, oHrr.zone3); put(0x3d, oHrr.zone4); put(0x3e, oHrr.zone5)
    }
    return out
  }
}
