// Wire layouts follow Huawei Health 17.0.8.300 (defpackage.yoq ConvertCommandUtil, cqe TLV writer, ynw SampleCommandManager),
// read in /home/dzul/re/huawei-health/DIET_PROTOCOL.md and FEATURE_CANDIDATES.md. UNVERIFIED on the wire; the byte layouts
// are checked against that analysis only (DataSyncCodecTest). Service 0x37 reuses GB's HuaweiPacket / HuaweiTLV.
package com.joyodigitama.huaweiwear

import java.nio.charset.StandardCharsets
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import org.json.JSONException
import org.json.JSONObject

/** Service 0x37 commands, ExpandCapability gates and the tag numbers, in one place. */
internal object DataSyncWire {
  const val SERVICE = 0x37

  /** `0x37/01` SampleConfig. */
  const val CMD_CONFIG = 0x01

  /** `0x37/02` SampleEvent. */
  const val CMD_EVENT = 0x02

  /** `0x37/03` SamplePoint. */
  const val CMD_POINT = 0x03

  /** `0x37/04` DictionaryPointInfo. */
  const val CMD_DICT = 0x04

  /** `0x37/05` CompactDataDictionary; only logged. */
  const val CMD_COMPACT = 0x05

  /** ExpandCapability bits Huawei Health checks (`ynw`): config, event, point, dictionary. */
  const val CAP_CONFIG = 83
  const val CAP_EVENT = 84
  const val CAP_POINT = 85
  const val CAP_DICT = 173

  /** The error tag every service uses; `100000` means OK. */
  const val TAG_ERROR = 0x7F

  /**
   * Which side is which for a packet with `01 src` / `02 wear`, against a handler registered for [regPhone] and / or [regWatch]
   * (null = any). The watch writes its own package in `src` and the phone's in `wear`; Huawei's own senders write them the other way
   * round, and both are accepted. Returns (phone package, watch package) or null when the handler does not match.
   */
  fun matchPackages(regPhone: String?, regWatch: String?, src: String, wear: String): Pair<String, String>? {
    val watchSends = (regPhone == null || regPhone == wear) && (regWatch == null || regWatch == src)
    if (watchSends) return wear to src
    val phoneSends = (regPhone == null || regPhone == src) && (regWatch == null || regWatch == wear)
    return if (phoneSends) src to wear else null
  }

  fun capabilityFor(command: Int): Int? = when (command) {
    CMD_CONFIG -> CAP_CONFIG
    CMD_EVENT -> CAP_EVENT
    CMD_POINT -> CAP_POINT
    CMD_DICT -> CAP_DICT
    else -> null
  }

  fun commandName(command: Int): String = when (command) {
    CMD_CONFIG -> "config"
    CMD_EVENT -> "event"
    CMD_POINT -> "point"
    CMD_DICT -> "dictionary"
    CMD_COMPACT -> "compact dictionary"
    else -> "command %02x".format(command)
  }

  // Outbound

  /** `83{84{05 id int32, 06 action byte, 07 data, 08 modify time int64 ms}...}` after `01 src`, `02 wear` (yoq.e(efy)). */
  fun config(params: HuaweiPacket.ParamsProvider, srcPkg: String, wearPkg: String, items: List<ConfigItem>): HuaweiPacket {
    val list = HuaweiTLV()
    for (item in items) {
      val entry = HuaweiTLV().put(0x05, item.configId).put(0x06, item.action.toByte())
      item.data?.let { entry.put(0x07, it) }
      item.modifyMs?.let { entry.put(0x08, it) }
      list.put(0x84, entry)
    }
    val tlv = HuaweiTLV().put(0x01, srcPkg).put(0x02, wearPkg).put(0x83, list)
    return DataSyncPacket(params, DataSyncWire.CMD_CONFIG, tlv)
  }

  /** `03 event id int32, 04 level byte, 05 data` (yoq.c(egd)). */
  fun event(params: HuaweiPacket.ParamsProvider, srcPkg: String, wearPkg: String, eventId: Int, level: Int, data: ByteArray?): HuaweiPacket {
    val tlv = HuaweiTLV().put(0x01, srcPkg).put(0x02, wearPkg).put(0x03, eventId).put(0x04, level.toByte())
    data?.let { tlv.put(0x05, it) }
    return DataSyncPacket(params, DataSyncWire.CMD_EVENT, tlv)
  }

  /**
   * `03 dict type int32, 04 start int32, 05 end int32, 86{87{08 key int32, 09 value}...}, 0A metadata` (yoq.e(egf)).
   * Huawei sends the low 32 bits of a millisecond value for start and end; [startMs] / [endMs] null leaves the tag out.
   */
  fun samplePoint(
    params: HuaweiPacket.ParamsProvider,
    srcPkg: String,
    wearPkg: String,
    dictType: Int,
    values: List<PointValue>,
    startMs: Long?,
    endMs: Long?,
    metadata: ByteArray?,
  ): HuaweiPacket {
    val tlv = HuaweiTLV().put(0x01, srcPkg).put(0x02, wearPkg).put(0x03, dictType)
    startMs?.let { tlv.put(0x04, it.toInt()) }
    endMs?.let { tlv.put(0x05, it.toInt()) }
    val list = HuaweiTLV()
    for (value in values) {
      val entry = HuaweiTLV().put(0x08, value.key)
      value.value?.let { entry.put(0x09, it) }
      list.put(0x87, entry)
    }
    tlv.put(0x86, list)
    metadata?.let { tlv.put(0x0A, it) }
    return DataSyncPacket(params, DataSyncWire.CMD_POINT, tlv)
  }

  /**
   * `03 dict type int32, 84{85{06 start int64 ms, 07 end int64 ms, 08 modify int64 ms, 89{8A{0B key int32, 0C value}...}, 0D empty}...}`
   * (yoq.b(efw), `ega` rows). Huawei writes an empty tag `0D` for each row (its `ega.e()` metadata is null).
   */
  fun dictionary(params: HuaweiPacket.ParamsProvider, srcPkg: String, wearPkg: String, dictType: Int, rows: List<DictRow>): HuaweiPacket {
    val tlv = HuaweiTLV().put(0x01, srcPkg).put(0x02, wearPkg).put(0x03, dictType)
    val list = HuaweiTLV()
    for (row in rows) {
      val entry = HuaweiTLV().put(0x06, row.startMs).put(0x07, row.endMs)
      row.modifyMs?.let { entry.put(0x08, it) }
      if (row.values.isNotEmpty()) {
        val values = HuaweiTLV()
        for (value in row.values) {
          val item = HuaweiTLV().put(0x0B, value.key)
          // cqe.a(tag, bytes): a null or empty value is written as the tag with length 0.
          item.put(0x0C, value.value ?: ByteArray(0))
          values.put(0x8A, item)
        }
        entry.put(0x89, values)
      }
      entry.put(0x0D, ByteArray(0))
      list.put(0x85, entry)
    }
    tlv.put(0x84, list)
    return DataSyncPacket(params, DataSyncWire.CMD_DICT, tlv)
  }

  // Inbound (watch to phone). Every parser tolerates missing tags: a watch packet we do not know is logged, never thrown on.

  fun parseEvent(tlv: HuaweiTLV): SampleEvent {
    val src = tlv.stringOrNull(0x01) ?: ""
    val wear = tlv.stringOrNull(0x02) ?: ""
    return SampleEvent(
      srcPkg = src,
      wearPkg = wear,
      eventId = tlv.getAsInteger(0x03, 0),
      level = tlv.getAsInteger(0x04, 0),
      data = tlv.getBytes(0x05, null),
      errorCode = tlv.errorOrNull(),
    )
  }

  fun parseConfig(tlv: HuaweiTLV): SampleConfigIn {
    val items = ArrayList<ConfigItem>()
    if (tlv.contains(0x83)) {
      for (entry in tlv.getObject(0x83).getObjects(0x84)) {
        items += ConfigItem(
          configId = entry.getAsInteger(0x05, 0),
          action = entry.getAsInteger(0x06, 0),
          data = entry.getBytes(0x07, null),
          modifyMs = if (entry.contains(0x08)) entry.getAsLong(0x08) else null,
        )
      }
    }
    return SampleConfigIn(tlv.stringOrNull(0x01) ?: "", tlv.stringOrNull(0x02) ?: "", items, tlv.errorOrNull())
  }

  /** Both layouts seen in the RE: rows `84{85{06,07,08,89{...}}}` (as the phone sends them) and flat `06 / 07 / 08` at the top. */
  fun parseDictionary(tlv: HuaweiTLV): DictQuery {
    val rows = ArrayList<DictRow>()
    if (tlv.contains(0x84)) {
      for (entry in tlv.getObject(0x84).getObjects(0x85)) {
        val values = ArrayList<DictValue>()
        if (entry.contains(0x89)) {
          for (item in entry.getObject(0x89).getObjects(0x8A)) {
            values += DictValue(item.getAsInteger(0x0B, 0), item.getBytes(0x0C, null))
          }
        }
        rows += DictRow(
          startMs = if (entry.contains(0x06)) entry.getAsLong(0x06) else 0L,
          endMs = if (entry.contains(0x07)) entry.getAsLong(0x07) else 0L,
          modifyMs = if (entry.contains(0x08)) entry.getAsLong(0x08) else null,
          values = values,
        )
      }
    }
    val flatStart = if (tlv.contains(0x06)) tlv.getAsLong(0x06) else null
    val flatEnd = if (tlv.contains(0x07)) tlv.getAsLong(0x07) else null
    val flatModify = if (tlv.contains(0x08)) tlv.getAsLong(0x08) else null
    return DictQuery(
      srcPkg = tlv.stringOrNull(0x01) ?: "",
      wearPkg = tlv.stringOrNull(0x02) ?: "",
      dictId = tlv.getAsInteger(0x03, 0),
      rows = rows,
      startMs = rows.firstOrNull()?.startMs ?: flatStart,
      endMs = rows.firstOrNull()?.endMs ?: flatEnd,
      modifyMs = rows.firstOrNull()?.modifyMs ?: flatModify,
      errorCode = tlv.errorOrNull(),
    )
  }

  fun parsePoint(tlv: HuaweiTLV): SamplePointIn {
    val values = ArrayList<PointValue>()
    if (tlv.contains(0x86)) {
      for (entry in tlv.getObject(0x86).getObjects(0x87)) {
        values += PointValue(entry.getAsInteger(0x08, 0), entry.getBytes(0x09, null))
      }
    }
    return SamplePointIn(
      srcPkg = tlv.stringOrNull(0x01) ?: "",
      wearPkg = tlv.stringOrNull(0x02) ?: "",
      dictId = tlv.getAsInteger(0x03, 0),
      values = values,
      metadata = tlv.getBytes(0x0A, null),
      errorCode = tlv.errorOrNull(),
    )
  }

  private fun HuaweiTLV.stringOrNull(tag: Int): String? = getBytes(tag, null)?.toString(StandardCharsets.UTF_8)

  private fun HuaweiTLV.errorOrNull(): Int? = if (contains(TAG_ERROR)) getAsInteger(TAG_ERROR, 0) else null
}

/** A request packet for service 0x37 built from a ready TLV. Encrypted like every post-auth packet. */
internal class DataSyncPacket(params: ParamsProvider, command: Int, content: HuaweiTLV) : HuaweiPacket(params) {
  init {
    serviceId = DataSyncWire.SERVICE.toByte()
    commandId = command.toByte()
    tlv = content
  }
}

/** One item of a SampleConfig. [action] 1 sets, 2 queries (feature rows). [modifyMs] null leaves tag `08` out. */
internal class ConfigItem(val configId: Int, val action: Int = 1, val data: ByteArray? = null, val modifyMs: Long? = null)

/** One `87{08 key, 09 value}` of a SamplePoint. */
internal class PointValue(val key: Int, val value: ByteArray?)

/** One `8A{0B key, 0C value}` of a dictionary row. */
internal class DictValue(val key: Int, val value: ByteArray?)

/** One `85{...}` row of a DictionaryPointInfo; times are Unix **milliseconds** (8 bytes on the wire). */
internal class DictRow(val startMs: Long, val endMs: Long, val modifyMs: Long? = null, val values: List<DictValue> = emptyList())

/** The side that sent a packet is `srcPkg`; the watch writes its own package there and the phone's in `wearPkg`. */
internal class SampleEvent(
  val srcPkg: String,
  val wearPkg: String,
  val eventId: Int,
  val level: Int,
  val data: ByteArray?,
  val errorCode: Int?,
) {
  /** The registered phone / watch package this packet was matched against; set by the dispatcher. */
  var phonePkg: String = ""
  var watchPkg: String = ""

  fun json(): JSONObject? = DataSyncJson.parse(data)
}

internal class SampleConfigIn(val srcPkg: String, val wearPkg: String, val items: List<ConfigItem>, val errorCode: Int?) {
  var phonePkg: String = ""
  var watchPkg: String = ""
}

internal class DictQuery(
  val srcPkg: String,
  val wearPkg: String,
  val dictId: Int,
  val rows: List<DictRow>,
  val startMs: Long?,
  val endMs: Long?,
  val modifyMs: Long?,
  val errorCode: Int?,
) {
  var phonePkg: String = ""
  var watchPkg: String = ""
}

internal class SamplePointIn(
  val srcPkg: String,
  val wearPkg: String,
  val dictId: Int,
  val values: List<PointValue>,
  val metadata: ByteArray?,
  val errorCode: Int?,
) {
  var phonePkg: String = ""
  var watchPkg: String = ""
}

/** Compact JSON like Gson writes it (no spaces, insertion order, `350.0` for a Float / Double), plus a lenient parser. */
internal object DataSyncJson {
  /** Map (insertion order), List, IntArray, String, Boolean, Number or null. Other types are a programming error. */
  fun write(value: Any?): String = StringBuilder().also { append(it, value) }.toString()

  fun bytes(value: Any?): ByteArray = write(value).toByteArray(StandardCharsets.UTF_8)

  fun parse(data: ByteArray?): JSONObject? {
    if (data == null || data.isEmpty()) return null
    return try {
      JSONObject(String(data, StandardCharsets.UTF_8))
    } catch (e: JSONException) {
      null
    }
  }

  private fun append(out: StringBuilder, value: Any?) {
    when (value) {
      null -> out.append("null")
      is String -> appendString(out, value)
      is Boolean -> out.append(value)
      is Float -> out.append(if (value.isFinite()) value.toString() else "null")
      is Double -> out.append(if (value.isFinite()) value.toString() else "null")
      is Number -> out.append(value.toString())
      is IntArray -> {
        out.append('[')
        value.forEachIndexed { i, n -> if (i > 0) out.append(','); out.append(n) }
        out.append(']')
      }
      is Map<*, *> -> {
        out.append('{')
        var first = true
        for ((k, v) in value) {
          if (!first) out.append(',')
          first = false
          appendString(out, k.toString())
          out.append(':')
          append(out, v)
        }
        out.append('}')
      }
      is List<*> -> {
        out.append('[')
        value.forEachIndexed { i, item -> if (i > 0) out.append(','); append(out, item) }
        out.append(']')
      }
      else -> throw IllegalArgumentException("Cannot write ${value.javaClass.simpleName} as JSON")
    }
  }

  private fun appendString(out: StringBuilder, value: String) {
    out.append('"')
    for (c in value) {
      when (c) {
        '"' -> out.append("\\\"")
        '\\' -> out.append("\\\\")
        '\n' -> out.append("\\n")
        '\r' -> out.append("\\r")
        '\t' -> out.append("\\t")
        else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
      }
    }
    out.append('"')
  }
}

/** Plain big-endian integers for the nested TLV payloads (goals) and dictionary values. */
internal object DataSyncBytes {
  fun int32(value: Int): ByteArray = byteArrayOf((value shr 24).toByte(), (value shr 16).toByte(), (value shr 8).toByte(), value.toByte())

  /** `ego.e(double)`: the bytes of the IEEE-754 bits, **least significant first**. */
  fun doubleLe(value: Double): ByteArray {
    var bits = java.lang.Double.doubleToLongBits(value)
    return ByteArray(8) { val b = bits.toByte(); bits = bits shr 8; b }
  }

  fun readInt32(bytes: ByteArray?): Int? {
    if (bytes == null || bytes.isEmpty() || bytes.size > 4) return null
    var n = 0
    for (b in bytes) n = (n shl 8) or (b.toInt() and 0xFF)
    return n
  }
}
