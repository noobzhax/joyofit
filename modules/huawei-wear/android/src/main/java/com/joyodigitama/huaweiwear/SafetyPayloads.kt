package com.joyodigitama.huaweiwear

import java.nio.charset.StandardCharsets
import org.json.JSONException
import org.json.JSONObject

/**
 * JSON of fall detection and the SOS SMS relay, after Huawei Health 17.0.8.300 `mtt` (FallDetectionManager),
 * `FallDetectionConstant` and `nev` (HwSafetyGuardMgr). Static analysis only; every send and receive is logged.
 *
 *  - Config `900500038`, phone package `hw.unitedevice.sos`, watch package `hw.watch.sos.help`: JSON
 *    `{"fallDetectionSwitch": 0|1, "timeStamp": ms}`. Action 1 sets it; action 2 without data asks the watch.
 *  - Event `800100040`, phone package `hw.unitedevice.safetyguard`, watch package `hw.watch.safetyguard`: the watch
 *    sends JSON with at least `phoneNumber` and `content`; the phone answers the same event id with the same JSON plus
 *    `"status": "0"` (sent) or `"1"` (failed).
 */
internal object SafetyPayloads {
  const val FALL_CONFIG_ID = 900500038
  const val FALL_PHONE_PKG = "hw.unitedevice.sos"
  const val FALL_WATCH_PKG = "hw.watch.sos.help"

  const val SOS_EVENT_ID = 800100040
  const val SOS_PHONE_PKG = "hw.unitedevice.safetyguard"
  const val SOS_WATCH_PKG = "hw.watch.safetyguard"

  const val STATUS_SENT = "0"
  const val STATUS_FAILED = "1"

  /** `{"fallDetectionSwitch": 0|1, "timeStamp": ms}` (`mtt.e`), key order as Huawei writes it. */
  fun fallConfig(enabled: Boolean, timeStampMs: Long): ByteArray =
    DataSyncJson.bytes(linkedMapOf("fallDetectionSwitch" to if (enabled) 1 else 0, "timeStamp" to timeStampMs))

  /** The fall detection state the watch reported: [switch] 0 / 1 and its [timeStampMs]; null when the JSON is unusable. */
  data class FallState(val switch: Int, val timeStampMs: Long)

  fun parseFallConfig(data: ByteArray?): FallState? {
    val json = DataSyncJson.parse(data) ?: return null
    if (!json.has("fallDetectionSwitch")) return null
    val value = json.optInt("fallDetectionSwitch", -1)
    if (value != 0 && value != 1) return null
    return FallState(value, json.optLong("timeStamp", 0L))
  }

  /** What the watch asked the phone to send. [raw] is the exact JSON text, echoed back in the answer. */
  class SosRequest(val raw: String, val phoneNumber: String, val content: String)

  /** Why a request cannot be used, or the request itself. */
  sealed interface SosParse {
    class Ok(val request: SosRequest) : SosParse

    /** [raw] is the text when it was readable JSON, for the answer. */
    class Bad(val reason: String, val raw: String?) : SosParse
  }

  /** `nev.onDataReceived`: the data is UTF-8 JSON with `phoneNumber` and `content`, both non-empty. */
  fun parseSos(data: ByteArray?): SosParse {
    if (data == null || data.isEmpty()) return SosParse.Bad("the event has no data", null)
    val text = String(data, StandardCharsets.UTF_8)
    val json = try {
      JSONObject(text)
    } catch (e: JSONException) {
      return SosParse.Bad("the data is not JSON", null)
    }
    val number = json.optString("phoneNumber", "").trim()
    val content = json.optString("content", "")
    if (number.isEmpty() || content.isEmpty()) return SosParse.Bad("phoneNumber or content is missing or empty", text)
    return SosParse.Ok(SosRequest(text, number, content))
  }

  /** `nev.e`: the watch's JSON with `status` added; `{"status":"1"}` alone when the watch's JSON was unreadable. */
  fun sosAnswer(raw: String?, sent: Boolean): ByteArray {
    val status = if (sent) STATUS_SENT else STATUS_FAILED
    val json = try {
      if (raw == null) JSONObject() else JSONObject(raw)
    } catch (e: JSONException) {
      JSONObject()
    }
    json.put("status", status)
    return json.toString().toByteArray(StandardCharsets.UTF_8)
  }

  /** A phone number for the log: only the last two digits survive. */
  fun maskNumber(number: String): String {
    val digits = number.filter { it.isDigit() }
    return if (digits.length <= 2) "**" else "*".repeat(digits.length - 2) + digits.takeLast(2)
  }
}
