// Editable watch-face configuration over DataSync (service 0x37, package hw.app.watchface.custom <-> hw.watch.watchface.custom).
// Wire layouts follow Huawei Health 17.0.8.300: CustomConfigWatchFaceService.{queryCustomConfig, setCustomConfig,
// buildCustomConfigEventDataBytes, buildEventDataStyleList, buildEventDataWidgetList, loadCustomConfigFromSampleEvent,
// loadCustomStyle, loadWidgetList} with the TLV writer `cqe` and reader `cqj` (value encodings from `cph`).
package com.joyodigitama.huaweiwear

import java.nio.charset.StandardCharsets

/** The `DIAL_EDIT_MODE_*` constants of `CustomConfigWatchFaceService`. */
internal object FaceEditMode {
  const val STYLE = 0
  const val BACKGROUND = 1
  const val DUAL = 2
  const val SCALE = 3
  const val SYMBOL = 4
  const val TYPEFACE = 5
  const val TIME = 6
  const val HAND = 7

  val ALL = (STYLE..HAND).toList()

  fun name(mode: Int): String = when (mode) {
    STYLE -> "style"
    BACKGROUND -> "background"
    DUAL -> "dual"
    SCALE -> "scale"
    SYMBOL -> "symbol"
    TYPEFACE -> "typeface"
    TIME -> "time"
    HAND -> "hand"
    else -> "mode $mode"
  }
}

/** One selected option of an edit mode: [mode] is a [FaceEditMode], [index] the option's position in the face. */
internal data class FaceStyleChoice(val mode: Int, val index: Int)

/**
 * Huawei Health's `CustomConfig`. Every part is optional: a face exposes only the parts the watch reports for it.
 * [styles] keeps the watch's order and its raw modes (Huawei Health's own model folds modes 2 and 3 into one "scale" index
 * when reading, and writes the scale index under both when sending; [FaceCustomWire.encodeConfig] sends exactly what it is given).
 * [widgets] holds the selected option of each widget slot, slot = position.
 */
internal data class FaceCustomization(
  val marketId: String,
  val styles: List<FaceStyleChoice> = emptyList(),
  val colourIndex: Int? = null,
  val customColour: String? = null,
  val widgets: List<Int> = emptyList(),
) {
  fun style(mode: Int): Int? = styles.firstOrNull { it.mode == mode }?.index

  fun toJs(): Map<String, Any?> = mapOf(
    "marketId" to marketId,
    "styles" to styles.map { mapOf("mode" to it.mode, "index" to it.index) },
    "colourIndex" to colourIndex,
    "customColour" to customColour,
    "widgets" to widgets,
  )

  /** One line for the log. */
  fun describe(): String = buildString {
    append("face $marketId")
    if (styles.isNotEmpty()) append(" styles=").append(styles.joinToString(",") { "${FaceEditMode.name(it.mode)}=${it.index}" })
    if (colourIndex != null) append(" colour=").append(colourIndex)
    if (customColour != null) append(" customColour=").append(customColour)
    if (widgets.isNotEmpty()) append(" widgets=").append(widgets)
  }
}

internal object FaceCustomWire {
  const val PHONE_PKG = "hw.app.watchface.custom"
  const val WATCH_PKG = "hw.watch.watchface.custom"

  /** `EVENT_QUERY_CUSTOM_WATCHFACE`: phone to watch, data `{01 marketId}`. */
  const val EVENT_QUERY = 800100008

  /** `EVENT_REPORT_CUSTOM_WATCHFACE`: phone to watch applies a configuration, watch to phone reports one. */
  const val EVENT_REPORT = 800100009

  /** `ynw` gates every sample event on ExpandCapability 84 (same bit as the rest of DataSync). */
  const val CAP_EVENT = DataSyncWire.CAP_EVENT

  // Tags of the event data.
  const val TAG_MARKET_ID = 0x01
  const val TAG_STYLE_LIST = 0x02
  const val TAG_STYLE = 0x03
  const val TAG_MODE = 0x04
  const val TAG_INDEX = 0x05
  const val TAG_COLOUR = 0x06
  const val TAG_CUSTOM_COLOUR = 0x07
  const val TAG_WIDGET_LIST = 0x08
  const val TAG_WIDGET = 0x09
  const val TAG_SLOT = 0x0A
  const val TAG_OPTION = 0x0B

  /** Huawei writes a struct item as one byte, so an index must fit one. */
  const val MAX_INDEX = 255

  /** `{01 marketId}`. */
  fun encodeQuery(marketId: String): ByteArray = Tlv.leaf(TAG_MARKET_ID, marketId.toByteArray(StandardCharsets.UTF_8))

  /**
   * `buildCustomConfigEventDataBytes`: `01 marketId`, then `82{83{04 mode, 05 index}...}` (when there are styles), `06 colour`
   * (minimal big-endian, `cqe.c(tag, int)`), `07 custom colour` (UTF-8, left out when empty), `88{89{0A slot, 0B option}...}`.
   * Mode, index, slot and option are one byte each (`cqe.a(tag, int)` writes `(byte) i`).
   */
  fun encodeConfig(config: FaceCustomization): ByteArray {
    require(config.marketId.isNotEmpty()) { "A face id is required" }
    val out = java.io.ByteArrayOutputStream()
    out.write(encodeQuery(config.marketId))
    if (config.styles.isNotEmpty()) {
      val list = java.io.ByteArrayOutputStream()
      for (style in config.styles) {
        requireByte("mode", style.mode)
        requireByte("${FaceEditMode.name(style.mode)} index", style.index)
        list.write(
          Tlv.node(TAG_STYLE, Tlv.leaf(TAG_MODE, byteArrayOf(style.mode.toByte())) + Tlv.leaf(TAG_INDEX, byteArrayOf(style.index.toByte()))),
        )
      }
      out.write(Tlv.node(TAG_STYLE_LIST, list.toByteArray()))
    }
    config.colourIndex?.let { out.write(Tlv.leaf(TAG_COLOUR, minimalBigEndian(it))) }
    config.customColour?.takeIf { it.isNotEmpty() }?.let { out.write(Tlv.leaf(TAG_CUSTOM_COLOUR, it.toByteArray(StandardCharsets.UTF_8))) }
    if (config.widgets.isNotEmpty()) {
      val list = java.io.ByteArrayOutputStream()
      config.widgets.forEachIndexed { slot, option ->
        requireByte("widget slot", slot)
        requireByte("widget $slot option", option)
        list.write(Tlv.node(TAG_WIDGET, Tlv.leaf(TAG_SLOT, byteArrayOf(slot.toByte())) + Tlv.leaf(TAG_OPTION, byteArrayOf(option.toByte()))))
      }
      out.write(Tlv.node(TAG_WIDGET_LIST, list.toByteArray()))
    }
    return out.toByteArray()
  }

  /**
   * `loadCustomConfigFromSampleEvent`: null when the data is not a TLV or has no market id. Unknown tags are ignored; a style whose
   * mode or index is missing is skipped (Huawei logs "style not found"); a widget whose slot is outside the list is skipped.
   */
  fun decode(data: ByteArray): FaceCustomization? {
    val top = Tlv.parseFlat(data) ?: return null
    val marketId = top.string(TAG_MARKET_ID) ?: return null
    val styles = ArrayList<FaceStyleChoice>()
    top.bytes(TAG_STYLE_LIST)?.let { list ->
      for (entry in Tlv.parseEntries(list) ?: emptyList()) {
        val fields = Tlv.parseFlat(entry) ?: continue
        val mode = fields.int(TAG_MODE)
        val index = fields.int(TAG_INDEX)
        if (mode != null && index != null) styles += FaceStyleChoice(mode, index)
      }
    }
    val widgets = ArrayList<Int>()
    top.bytes(TAG_WIDGET_LIST)?.let { list ->
      val entries = Tlv.parseEntries(list) ?: emptyList()
      for (entry in entries) {
        val fields = Tlv.parseFlat(entry) ?: continue
        val slot = fields.int(TAG_SLOT) ?: -1
        val option = fields.int(TAG_OPTION) ?: -1
        if (slot in entries.indices) widgets += option
      }
    }
    return FaceCustomization(
      marketId = marketId,
      styles = styles,
      colourIndex = top.int(TAG_COLOUR),
      customColour = top.string(TAG_CUSTOM_COLOUR)?.takeIf { it.isNotEmpty() },
      widgets = widgets,
    )
  }

  /** `cph.f(int)`: one to four big-endian bytes, leading zero bytes dropped (0 is `00`). */
  fun minimalBigEndian(value: Int): ByteArray {
    val full = byteArrayOf((value ushr 24).toByte(), (value ushr 16).toByte(), (value ushr 8).toByte(), value.toByte())
    val skip = full.indexOfFirst { it.toInt() != 0 }.let { if (it < 0) 3 else it }
    return full.copyOfRange(skip, 4)
  }

  private fun requireByte(what: String, value: Int) {
    require(value in 0..MAX_INDEX) { "$what $value does not fit the one byte Huawei Health sends" }
  }
}

/** Huawei's own TLV (`cqe` writer, `cqj` reader): tag byte, 7-bit varint length (1 to 3 bytes), value. A tag with the top bit holds more TLVs. */
internal object Tlv {
  fun leaf(tag: Int, value: ByteArray): ByteArray = byteArrayOf(tag.toByte()) + varint(value.size) + value

  /** A struct or list: tag with the top bit set, then the concatenated children. */
  fun node(tag: Int, children: ByteArray): ByteArray = leaf(tag or 0x80, children)

  fun varint(length: Int): ByteArray = when {
    length < 0 -> throw IllegalArgumentException("negative length")
    length < 0x80 -> byteArrayOf(length.toByte())
    length < 0x4000 -> byteArrayOf(((length ushr 7) or 0x80).toByte(), (length and 0x7F).toByte())
    length < 0x200000 -> byteArrayOf(((length ushr 14) or 0x80).toByte(), ((length ushr 7) or 0x80).toByte(), (length and 0x7F).toByte())
    else -> throw IllegalArgumentException("length overflow: $length")
  }

  /** Values by tag with the top bit masked, like `cqj.d(bytes, 0)`; the last of a repeated tag wins. Null when the bytes are not valid TLV. */
  fun parseFlat(data: ByteArray): Fields? {
    val map = LinkedHashMap<Int, ByteArray>()
    var pos = 0
    while (pos < data.size) {
      val tag = data[pos].toInt() and 0xFF
      if (tag == 0) return null
      val (length, next) = readLength(data, pos + 1) ?: return null
      if (next + length > data.size) return null
      map[tag and 0x7F] = data.copyOfRange(next, next + length)
      pos = next + length
    }
    return Fields(map)
  }

  /** The values of every TLV in [data], in order: the items of a list (`cqj.a.a(tag)` splits a list this way). */
  fun parseEntries(data: ByteArray): List<ByteArray>? {
    val out = ArrayList<ByteArray>()
    var pos = 0
    while (pos < data.size) {
      val (length, next) = readLength(data, pos + 1) ?: return null
      if (next + length > data.size) return null
      out += data.copyOfRange(next, next + length)
      pos = next + length
    }
    return out
  }

  private fun readLength(data: ByteArray, start: Int): Pair<Int, Int>? {
    var pos = start
    var value = 0
    for (i in 0 until 3) {
      if (pos >= data.size) return null
      val b = data[pos++].toInt() and 0xFF
      value = (value shl 7) or (b and 0x7F)
      if (b and 0x80 == 0) return value to pos
    }
    return null
  }

  class Fields(private val map: Map<Int, ByteArray>) {
    fun bytes(tag: Int): ByteArray? = map[tag]

    fun string(tag: Int): String? = map[tag]?.takeIf { it.isNotEmpty() }?.toString(StandardCharsets.UTF_8)

    /** `cph.e(bytes, default)`: one to four big-endian bytes; empty, absent or longer is null. */
    fun int(tag: Int): Int? {
      val value = map[tag] ?: return null
      if (value.isEmpty() || value.size > 4) return null
      var out = 0
      for (b in value) out = (out shl 8) or (b.toInt() and 0xFF)
      return out
    }
  }
}
