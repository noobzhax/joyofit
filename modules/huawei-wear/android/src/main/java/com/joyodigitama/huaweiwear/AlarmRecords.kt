package com.joyodigitama.huaweiwear

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `WatchAlarm` in `HuaweiWear.types.ts`. */
class WatchAlarmRecord : Record {
  @Field var slot: Int = 1
  @Field var enabled: Boolean = false
  @Field var hour: Int = 0
  @Field var minute: Int = 0
  @Field var repeat: Int = 0
  @Field var name: String = ""
}

/** `WatchSmartAlarm` in `HuaweiWear.types.ts`. */
class WatchSmartAlarmRecord : Record {
  @Field var enabled: Boolean = false
  @Field var hour: Int = 0
  @Field var minute: Int = 0
  @Field var repeat: Int = 0
  @Field var aheadMinutes: Int = 5
}

/** The writable part of `WatchAlarms` in `HuaweiWear.types.ts`. */
class WatchAlarmsRecord : Record {
  @Field var event: List<WatchAlarmRecord> = emptyList()
  @Field var smart: WatchSmartAlarmRecord? = null
}

internal fun WatchAlarmsRecord.toData() = WatchAlarms(
  event = event.map { WatchAlarm(it.slot, it.enabled, it.hour, it.minute, it.repeat, it.name) },
  smart = smart?.let { WatchSmartAlarm(it.enabled, it.hour, it.minute, it.repeat, it.aheadMinutes) },
  updatedAtMs = null,
)
