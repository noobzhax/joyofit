package com.joyodigitama.huaweiwear

import java.time.Instant
import java.time.ZoneId

/**
 * Time-zone / DST transition sync, after Huawei Health 17.0.8.300 `ndg` (HwUniteDeviceDstSyncMgr). The watch sends
 * event `800100020` at level 0 (phone package `hw.unitedevice.dstsync`, watch package `hw.watch.dst.sync`); the phone
 * answers the same event id at level 0 with `{"dst_in": <epoch s of the next transition>, "time_offset": <offset in
 * seconds after it>}`, both 0 when the zone has no upcoming transition. Gated on ExpandCapability 84. Huawei Health
 * only answers the watch (`ndg.b()` is called from `onDataReceived` alone; the other callers of `ndg` only register
 * the listener on connect), it never pushes on its own, so neither does JoyoFit.
 */
internal object DstPayload {
  const val EVENT_ID = 800100020
  const val PHONE_PKG = "hw.unitedevice.dstsync"
  const val WATCH_PKG = "hw.watch.dst.sync"

  /** `ndg.d()`: `ZoneRules.nextTransition(now)` of [zone]. */
  fun build(zone: ZoneId, now: Instant): ByteArray {
    val transition = zone.rules.nextTransition(now)
    val dstIn = transition?.toEpochSecond() ?: 0L
    val offset = transition?.offsetAfter?.totalSeconds ?: 0
    return DataSyncJson.bytes(linkedMapOf("dst_in" to dstIn, "time_offset" to offset))
  }
}
