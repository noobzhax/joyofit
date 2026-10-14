// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/requests/{GetEventAlarmList,
// GetSmartAlarmList,AlarmsRequest} and HuaweiSupportProvider.onSetAlarms.
package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CancellationException
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Alarms
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import org.json.JSONArray
import org.json.JSONObject

/** Alarms on the watch are Mon = 1 ... Sun = 64 (GB `Alarm.ALARM_MON` ... `ALARM_SUN`). */
internal const val ALARM_REPEAT_MAX = 127

/** The band has five event alarm slots, indexed 1 to 5 on the wire (GB getAlarmSlotCount: "always five event alarms"). */
internal const val EVENT_ALARM_SLOTS = 5

/** Name length accepted by [AlarmSync.validate]; GB has no limit but the packet must stay small. */
internal const val ALARM_NAME_MAX = 64

/** One event alarm. [slot] is the watch's index 1 to 5. */
internal data class WatchAlarm(
  val slot: Int,
  val enabled: Boolean,
  val hour: Int,
  val minute: Int,
  /** Weekday bitmask, Mon = 1 ... Sun = 64; 0 = once. */
  val repeat: Int,
  val name: String,
)

/** The watch's single smart alarm (service 08 command 02), which wakes within [aheadMinutes] before [hour]:[minute]. */
internal data class WatchSmartAlarm(
  val enabled: Boolean,
  val hour: Int,
  val minute: Int,
  val repeat: Int,
  val aheadMinutes: Int,
)

/** What `HuaweiWear.types.ts` calls `WatchAlarms`: the alarms last read from or pushed to the watch. */
internal data class WatchAlarms(
  val event: List<WatchAlarm>,
  val smart: WatchSmartAlarm?,
  /** Unix milliseconds of the last exchange with the watch; null before the first. */
  val updatedAtMs: Long?,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "event" to event.map {
      mapOf("slot" to it.slot, "enabled" to it.enabled, "hour" to it.hour, "minute" to it.minute, "repeat" to it.repeat, "name" to it.name)
    },
    "smart" to smart?.let {
      mapOf("enabled" to it.enabled, "hour" to it.hour, "minute" to it.minute, "repeat" to it.repeat, "aheadMinutes" to it.aheadMinutes)
    },
    "updatedAt" to updatedAtMs,
    // Capabilities of the connected watch; false while disconnected (nothing is known then).
    "supported" to AlarmSync.supported,
    "smartSupported" to AlarmSync.smartSupported,
  )

  fun toJson(): String = JSONObject()
    .put(
      "event",
      JSONArray().also { array ->
        event.forEach {
          array.put(
            JSONObject().put("slot", it.slot).put("enabled", it.enabled).put("hour", it.hour)
              .put("minute", it.minute).put("repeat", it.repeat).put("name", it.name),
          )
        }
      },
    )
    .put(
      "smart",
      smart?.let {
        JSONObject().put("enabled", it.enabled).put("hour", it.hour).put("minute", it.minute)
          .put("repeat", it.repeat).put("aheadMinutes", it.aheadMinutes)
      } ?: JSONObject.NULL,
    )
    .put("updatedAt", updatedAtMs ?: JSONObject.NULL)
    .toString()

  companion object {
    val EMPTY = WatchAlarms(emptyList(), null, null)

    fun fromJson(json: String?): WatchAlarms {
      if (json == null) return EMPTY
      return try {
        val root = JSONObject(json)
        val array = root.getJSONArray("event")
        val event = List(array.length()) { i ->
          val o = array.getJSONObject(i)
          WatchAlarm(o.getInt("slot"), o.getBoolean("enabled"), o.getInt("hour"), o.getInt("minute"), o.getInt("repeat"), o.getString("name"))
        }
        val smart = root.optJSONObject("smart")?.let {
          WatchSmartAlarm(it.getBoolean("enabled"), it.getInt("hour"), it.getInt("minute"), it.getInt("repeat"), it.getInt("aheadMinutes"))
        }
        WatchAlarms(event, smart, if (root.isNull("updatedAt")) null else root.getLong("updatedAt"))
      } catch (e: org.json.JSONException) {
        EMPTY
      }
    }
  }
}

/** Reads and writes the watch's alarms with GB's Alarms packets (service 0x08). */
internal object AlarmSync {
  /** HuaweiState.supportsChangingAlarm: Alarms (08) command 03. */
  val supported: Boolean get() = DeviceCaps.supports(Alarms.id.toInt(), Alarms.EventAlarmsList.id)

  /** HuaweiState.supportsSmartAlarm (without GB's force option): Alarms (08) command 02. */
  val smartSupported: Boolean get() = supported && DeviceCaps.supports(Alarms.id.toInt(), Alarms.SmartAlarmRequest.id)

  fun validate(alarms: WatchAlarms) {
    fun bad(what: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, what)
    if (alarms.event.size > EVENT_ALARM_SLOTS) bad("The watch has $EVENT_ALARM_SLOTS alarm slots, got ${alarms.event.size} alarms")
    val seen = HashSet<Int>()
    for (alarm in alarms.event) {
      if (alarm.slot !in 1..EVENT_ALARM_SLOTS) bad("Alarm slot must be 1 to $EVENT_ALARM_SLOTS, got ${alarm.slot}")
      if (!seen.add(alarm.slot)) bad("Alarm slot ${alarm.slot} is used twice")
      if (alarm.hour !in 0..23) bad("Alarm hour must be 0 to 23, got ${alarm.hour}")
      if (alarm.minute !in 0..59) bad("Alarm minute must be 0 to 59, got ${alarm.minute}")
      if (alarm.repeat !in 0..ALARM_REPEAT_MAX) bad("Alarm repeat must be a weekday bitmask 0 to $ALARM_REPEAT_MAX, got ${alarm.repeat}")
      if (alarm.name.length > ALARM_NAME_MAX) bad("Alarm name is longer than $ALARM_NAME_MAX characters")
    }
    alarms.smart?.let { smart ->
      if (smart.hour !in 0..23) bad("Smart alarm hour must be 0 to 23, got ${smart.hour}")
      if (smart.minute !in 0..59) bad("Smart alarm minute must be 0 to 59, got ${smart.minute}")
      if (smart.repeat !in 0..ALARM_REPEAT_MAX) bad("Smart alarm repeat must be a weekday bitmask 0 to $ALARM_REPEAT_MAX, got ${smart.repeat}")
      if (smart.aheadMinutes !in 0..127) bad("Smart alarm window must be 0 to 127 minutes, got ${smart.aheadMinutes}")
    }
  }

  /** GetEventAlarmList (08/03), then GetSmartAlarmList (08/04) when the watch has a smart alarm. */
  suspend fun read(session: HuaweiSession, events: WearEvents): WatchAlarms {
    if (!supported) throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not report alarm support (service 08 command 03)")
    val list = session
      .request(Alarms.EventAlarmsList.Request(session.params), Timeouts.QUERY_MS, "EventAlarmList")
      .expect<Alarms.EventAlarmsList.Response>("EventAlarmList")
    val event = ArrayList<WatchAlarm>()
    for (alarm in list.eventAlarms) {
      val slot = alarm.index.toInt() and 0xFF
      // A slot without a time is an empty slot (GB marks every index not in the reply as unused).
      if (alarm.startHour < 0 || slot !in 1..EVENT_ALARM_SLOTS) {
        events.log(LogDirection.INFO, null, null, null, "EventAlarmList: skipped $alarm")
        continue
      }
      event.add(
        WatchAlarm(slot, alarm.status, alarm.startHour.toInt(), alarm.startMinute.toInt() and 0xFF, alarm.repeat.toInt() and 0xFF, alarm.name),
      )
    }
    event.sortBy { it.slot }
    events.log(LogDirection.INFO, null, null, null, "EventAlarmList: ${event.size} alarm(s) " + event.joinToString { "#${it.slot} %02d:%02d".format(it.hour, it.minute) })

    var smart: WatchSmartAlarm? = null
    if (smartSupported) {
      val response = session
        .request(Alarms.SmartAlarmList.Request(session.params), Timeouts.QUERY_MS, "SmartAlarmList")
        .expect<Alarms.SmartAlarmList.Response>("SmartAlarmList")
      response.smartAlarm?.let {
        smart = WatchSmartAlarm(it.status, it.startHour.toInt(), it.startMinute.toInt() and 0xFF, it.repeat.toInt() and 0xFF, it.aheadTime.toInt() and 0xFF)
      }
      events.log(LogDirection.INFO, null, null, null, "SmartAlarmList: " + (smart?.let { "%02d:%02d enabled=${it.enabled}".format(it.hour, it.minute) } ?: "none"))
    }
    return WatchAlarms(event, smart, System.currentTimeMillis())
  }

  /**
   * HuaweiSupportProvider.onSetAlarms: the smart alarm (08/02) first, then the event alarms (08/01).
   * The event request carries exactly the alarms to keep; GB's serialize turns an empty list into a
   * single bare index-1 entry, which clears all of them.
   */
  suspend fun write(session: HuaweiSession, events: WearEvents, alarms: WatchAlarms) {
    if (!supported) throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not report alarm support (service 08 command 03)")
    validate(alarms)
    val smart = alarms.smart
    if (smart != null) {
      if (!smartSupported) throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not support a smart alarm")
      sendAcked(session, events, "SmartAlarm") {
        Alarms.SmartAlarmRequest(
          session.params,
          Alarms.SmartAlarm(smart.enabled, smart.hour.toByte(), smart.minute.toByte(), smart.repeat.toByte(), smart.aheadMinutes.toByte()),
        )
      }
    }
    sendAcked(session, events, "EventAlarms") {
      val request = Alarms.EventAlarmsRequest(session.params)
      for (alarm in alarms.event) {
        request.addEventAlarm(
          Alarms.EventAlarm(alarm.slot.toByte(), alarm.enabled, alarm.hour.toByte(), alarm.minute.toByte(), alarm.repeat.toByte(), alarm.name),
        )
      }
      request
    }
    events.log(LogDirection.INFO, null, null, null, "Alarms pushed: ${alarms.event.size} event alarm(s)" + if (smart != null) ", smart alarm" else "")
  }

  /**
   * GB's AlarmsRequest only logs the reply ("handle Alarm"). A missing reply is logged, not failed:
   * the caller reads the list back, which shows what the watch really holds.
   */
  private suspend fun sendAcked(
    session: HuaweiSession,
    events: WearEvents,
    label: String,
    build: () -> HuaweiPacket,
  ) {
    try {
      session.request(build(), Timeouts.QUERY_MS, label)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode != ErrorCodes.TIMEOUT) throw e
      events.log(LogDirection.ERROR, null, null, null, "$label: no acknowledgment from the watch; reading the list back to check")
    }
  }
}
