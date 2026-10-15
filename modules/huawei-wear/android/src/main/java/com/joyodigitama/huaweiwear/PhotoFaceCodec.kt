// Photo face wire formats, from Huawei Health 17.0.8.300:
//  - 27/08 and 27/09: DiyWatchFaceDeviceService.getPhotoWatchInfo / handlePhotoInfo / handleNewBackground / handleCustomData /
//    handleOptionSelectedList / makeNewPhotoInfoCommand / combineWatchFaceBgListCommand (the layout the Fit 4 Pro answers in; the older
//    HwWatchFaceBtManager layout lists photos under 82{83} and the watch does not use it)
//  - 28/01 (the watch asks for a file): HwCommonFileMgr (`defpackage.myu`) `b` "5.40.5"-style handler `handleDeviceRequest` and `b(String,int,int,int,DeviceInfo)` reportDeviceRequest
//  - the .bin image: com.huawei.watchface.utils.WatchFaceBitmapUtil (`a(String,String,int)` and its run-length helpers)
// No signature or account data is part of any of these.
package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/**
 * One photo of the face, as the watch lists it in 27/08 (`84{85{…}}`). The settings are the watch's own; JoyoFit has no editor for them
 * and only sends them back unchanged so a save does not reset them. Null = the watch did not report it.
 */
internal class PhotoSlot(
  /** Tag 0x06: position in the face's list; the watch counts from 0. */
  val index: Int,
  /** Tag 0x07: the name the watch knows the photo by, `<name>.png`. */
  val name: String,
  /** Tag 0x0c (written as 0x0a). */
  val portPosition: Int? = null,
  /** Tag 0x0d (written as 0x0b). */
  val portraitMode: Int? = null,
  /** Tag 0x0e (written as 0x0c). */
  val timeStyle: Int? = null,
  /** Tag 0x0f (written as 0x0d), a `#AARRGGBB` string. */
  val timeColour: String? = null,
  /** Tag 0x10 (written as 0x0e), a `#AARRGGBB` string. */
  val backgroundColour: String? = null,
  /** Tag 0x29, the same tag both ways. */
  val timeSize: Int? = null,
)

/** The photo face's settings and its photo list (the answer to 27/08). */
internal class PhotoFaceInfo(
  /** Tag 0x01: how many photos the face takes. */
  val maxPhotos: Int,
  /** Tag 0x02: the face can pick its text colour from the photo. */
  val intellectColour: Boolean,
  /** Tag 0x03: Huawei Health writes 2 here to mean the watch's photos are `.bin` and must be converted to show them. */
  val backgroundType: Int,
  /** Tags 0x08 / 0x09 / 0x0a: position, style and data index when the face has them (written as 0x06 / 0x07 / 0x09). */
  val positionIndex: Int?,
  val styleIndex: Int?,
  val dataIndex: Int?,
  /** Tag 0x0b: which `.bin` flavour the watch wants (see [PhotoBin.Format]). */
  val imageOption: Int,
  /** Tag 0x0d at the top level. */
  val portraitMode: Int?,
  val photos: List<PhotoSlot>,
  /** Tags 0x11 / 0x12 (written as 0x0f / 0x10). */
  val wristSwitch: Int? = null,
  val styleApplyAll: Int? = null,
  /** Tag 0x13 `{14{15 container, 16 option}}` (written as 0x11 `{12{13, 14}}`): the option shown in each data slot. */
  val dataSlots: List<Pair<Int, Int>> = emptyList(),
  /** Tag 0x1f `{20{21 option}}` (written as 0x1d `{1e{1f}}`); Huawei Health only reads and writes it with exactly two entries. */
  val selectedOptions: List<Int> = emptyList(),
)

/** The answer to 27/09: tag 0x7f status (100000 = fine) and tag 0x08 the number of photos the watch still wants from the phone. */
internal class PhotoSaveStatus(val code: Int, val transferNum: Int)

/** The watch's request for one file (28/01). */
internal class PhotoFileRequest(val name: String, val fileType: Int, val resourceType: Int)

/** A 27/05 status report: `reportType` 4 is "photos received", `failedNum` how many did not arrive. */
internal class WatchfaceReport(val id: String, val version: String, val reportType: Int, val failedNum: Int, val code: Int)

internal object PhotoFaceCodec {
  const val STATUS_OK = 100000
  /** Huawei Health answers a file request with this when it has no such file. */
  const val FILE_MISSING = 140006
  const val FILE_TYPE_PHOTO = 3
  const val REPORT_PHOTOS_RECEIVED = 4
  const val PNG_SUFFIX = ".png"

  fun parseInfo(tlv: HuaweiTLV): PhotoFaceInfo {
    fun HuaweiTLV.opt(tag: Int): Int? = if (contains(tag)) getAsInteger(tag, 0) else null
    fun HuaweiTLV.optString(tag: Int): String? = if (contains(tag)) getString(tag) else null
    val photos = ArrayList<PhotoSlot>()
    for (container in tlv.getObjects(0x84)) {
      for (entry in container.getObjects(0x85)) {
        val name = entry.optString(0x07)
        if (name.isNullOrEmpty()) continue
        photos.add(
          PhotoSlot(
            index = entry.getAsInteger(0x06, photos.size),
            name = name,
            portPosition = entry.opt(0x0c),
            portraitMode = entry.opt(0x0d),
            timeStyle = entry.opt(0x0e),
            timeColour = entry.optString(0x0f),
            backgroundColour = entry.optString(0x10),
            timeSize = entry.opt(0x29),
          ),
        )
      }
    }
    photos.sortBy { it.index }
    val dataSlots = tlv.getObjects(0x93).flatMap { it.getObjects(0x94) }.mapNotNull { slot ->
      val container = slot.opt(0x15)
      val option = slot.opt(0x16)
      if (container != null && option != null) container to option else null
    }
    val selected = tlv.getObjects(0x9f).flatMap { it.getObjects(0xa0) }.map { it.opt(0x21) }
    return PhotoFaceInfo(
      maxPhotos = tlv.getAsInteger(0x01, 0),
      intellectColour = tlv.getAsInteger(0x02, 0) == 1,
      backgroundType = tlv.getAsInteger(0x03, 0),
      positionIndex = tlv.opt(0x08),
      styleIndex = tlv.opt(0x09),
      dataIndex = tlv.opt(0x0a),
      imageOption = tlv.getAsInteger(0x0b, 0),
      portraitMode = tlv.opt(0x0d),
      photos = photos,
      wristSwitch = tlv.opt(0x11),
      styleApplyAll = tlv.opt(0x12),
      dataSlots = dataSlots,
      selectedOptions = if (selected.size == 2 && selected.all { it != null }) selected.map { it!! } else emptyList(),
    )
  }

  /**
   * The 27/09 TLV (`makeNewPhotoInfoCommand`): `01` count, `82{83{04 index, 05 name, 0a, 0b, 0c, 0d, 0e, 29}}` for [names] in order,
   * then `06`, `07`, `09`, `0f`, `10`, `91{92{13, 14}}` and `9d{9e{1f}}` echoed from [info]. A photo the watch already lists keeps its
   * settings; a new one is sent with name and index only and the watch fills in its defaults. Indexes count from 0, as the watch reports
   * them. The smart-colour / Gaussian fields (`15`…`1c`) are left out: the watch does not report the switch that decides them.
   */
  fun saveTlv(info: PhotoFaceInfo, names: List<String>): HuaweiTLV {
    val known = info.photos.associateBy { it.name }
    val tlv = HuaweiTLV().put(0x01, names.size.toByte())
    if (names.isNotEmpty()) {
      val list = HuaweiTLV()
      names.forEachIndexed { i, name ->
        val entry = HuaweiTLV().put(0x04, i.toByte()).put(0x05, name)
        known[name]?.let { slot ->
          slot.portPosition?.let { entry.put(0x0a, it.toByte()) }
          slot.portraitMode?.let { entry.put(0x0b, it.toByte()) }
          slot.timeStyle?.let { entry.put(0x0c, it.toByte()) }
          slot.timeColour?.let { entry.put(0x0d, it) }
          slot.backgroundColour?.let { entry.put(0x0e, it) }
          slot.timeSize?.let { entry.put(0x29, it.toByte()) }
        }
        list.put(0x83, entry)
      }
      tlv.put(0x82, list)
    }
    info.positionIndex?.let { tlv.put(0x06, it.toByte()) }
    info.styleIndex?.let { tlv.put(0x07, it.toByte()) }
    info.dataIndex?.let { tlv.put(0x09, it.toByte()) }
    info.wristSwitch?.let { tlv.put(0x0f, it.toByte()) }
    info.styleApplyAll?.let { tlv.put(0x10, it.toByte()) }
    if (info.dataSlots.isNotEmpty()) {
      val slots = HuaweiTLV()
      for ((container, option) in info.dataSlots) slots.put(0x92, HuaweiTLV().put(0x13, container.toByte()).put(0x14, option.toByte()))
      tlv.put(0x91, slots)
    }
    if (info.selectedOptions.isNotEmpty()) {
      val options = HuaweiTLV()
      for (option in info.selectedOptions) options.put(0x9e, HuaweiTLV().put(0x1f, option.toByte()))
      tlv.put(0x9d, options)
    }
    return tlv
  }

  fun parseSaveStatus(tlv: HuaweiTLV): PhotoSaveStatus =
    PhotoSaveStatus(tlv.getAsInteger(0x7f, -1), tlv.getAsInteger(0x08, 0))

  fun parseFileRequest(tlv: HuaweiTLV): PhotoFileRequest? {
    if (!tlv.contains(0x01)) return null
    return PhotoFileRequest(
      name = tlv.getString(0x01),
      // Huawei Health defaults the type to 3 when the watch sends none and the resource type to -1.
      fileType = tlv.getAsInteger(0x02, FILE_TYPE_PHOTO),
      resourceType = tlv.getAsInteger(0x05, -1),
    )
  }

  fun parseReport(tlv: HuaweiTLV): WatchfaceReport = WatchfaceReport(
    id = if (tlv.contains(0x01)) tlv.getString(0x01) else "",
    version = if (tlv.contains(0x02)) tlv.getString(0x02) else "",
    reportType = tlv.getAsInteger(0x03, -1),
    failedNum = tlv.getAsInteger(0x04, 0),
    code = tlv.getAsInteger(0x7f, STATUS_OK),
  )

  /** The `.png` name of a photo: the watch lists and requests `<name>.png`. */
  fun pngName(name: String): String = if (name.endsWith(PNG_SUFFIX)) name else name + PNG_SUFFIX

  /**
   * The bytes Huawei Health sends for a requested photo: for a resource type other than 1 the `.bin` file that goes with the
   * `.png` name (`HwCommonFileMgr.d(String,int,int)`), for 1 the PNG itself.
   */
  fun contentFor(request: PhotoFileRequest, png: ByteArray, bin: ByteArray): ByteArray = if (request.resourceType == 1) png else bin
}

/**
 * The `.bin` image the watch takes for a photo (`WatchFaceBitmapUtil.a(String,String,int)`): the four bytes `45 23` + format code,
 * width and height as little-endian 16-bit numbers, then the pixels in row order, run-length coded. Three flavours; the watch names
 * the one it wants in tag 0x0b of 27/08.
 */
internal object PhotoBin {
  enum class Format(val option: Int, val code: Int) {
    /** Option 0 (anything but 1 and 2): 32-bit pixels, little-endian ARGB ints. */
    ARGB32(0, 0x8888),

    /** Option 1: 24-bit pixels (blue, green, red). */
    RGB24(1, 0x8808),

    /** Option 2: RGB565, two pixels to a 32-bit word. */
    RGB565(2, 0x65F5),
    ;

    companion object {
      fun fromOption(option: Int): Format = entries.firstOrNull { it.option == option } ?: ARGB32
    }
  }

  private const val HEADER = 0x4523
  private const val MARKER_32 = 591751049 // 0x23456789
  private const val MARKER_24 = 4548489 // 0x456789

  /** [argb] holds `width * height` pixels as `Bitmap.getPixels` returns them (0xAARRGGBB, row by row). */
  fun encode(argb: IntArray, width: Int, height: Int, format: Format): ByteArray {
    require(argb.size == width * height) { "${argb.size} pixels for ${width}x$height" }
    require(width in 1..0xFFFF && height in 1..0xFFFF) { "size ${width}x$height does not fit the header" }
    val out = ByteArrayOutputStream(argb.size / 2 + 16)
    out.write(HEADER shr 8)
    out.write(HEADER and 0xFF)
    out.write(format.code shr 8)
    out.write(format.code and 0xFF)
    le16(out, width)
    le16(out, height)
    when (format) {
      Format.ARGB32 -> encode32(out, argb)
      Format.RGB24 -> encode24(out, argb)
      Format.RGB565 -> encode565(out, argb)
    }
    return out.toByteArray()
  }

  private fun le16(out: ByteArrayOutputStream, v: Int) {
    out.write(v and 0xFF)
    out.write((v shr 8) and 0xFF)
  }

  private fun le24(out: ByteArrayOutputStream, v: Int) {
    out.write(v and 0xFF)
    out.write((v shr 8) and 0xFF)
    out.write((v shr 16) and 0xFF)
  }

  private fun le32(out: ByteArrayOutputStream, v: Int) {
    out.write(v and 0xFF)
    out.write((v shr 8) and 0xFF)
    out.write((v shr 16) and 0xFF)
    out.write((v shr 24) and 0xFF)
  }

  /** `c(DataOutputStream, int[])`: a run of four or more is `marker, pixel, count`; shorter runs are written out. */
  private fun encode32(out: ByteArrayOutputStream, px: IntArray) {
    var run = 1
    for (i in px.indices) {
      if (i == px.size - 1 || px[i] != px[i + 1]) {
        if (run >= 4) {
          le32(out, MARKER_32)
          le32(out, px[i])
          le32(out, run)
        } else {
          repeat(run) { le32(out, px[i]) }
        }
        run = 1
      } else {
        run++
      }
    }
  }

  /** `b(DataOutputStream, int[])`: as above with three bytes a pixel; a pixel that looks like the marker is always written as a run. */
  private fun encode24(out: ByteArrayOutputStream, px: IntArray) {
    var run = 1
    for (i in px.indices) {
      if (i == px.size - 1 || px[i] != px[i + 1]) {
        if (run >= 4 || (px[i] and 0xFFFFFF) == MARKER_24) {
          le24(out, MARKER_24)
          le24(out, px[i])
          le24(out, run)
        } else {
          repeat(run) { le24(out, px[i]) }
        }
        run = 1
      } else {
        run++
      }
    }
  }

  private fun rgb565(p: Int): Int = (((p shr 19) and 31) shl 11) + (((p shr 10) and 63) shl 5) + ((p shr 3) and 31)

  /**
   * `a(DataOutputStream, int[])`: 16-bit pixels packed in pairs. A lone pixel is written together with the one after it (a zero when it
   * is the last), a run of an odd length gives its last pixel to the next pair, a run of eight or more is
   * `marker, pixel pair, pairs`.
   */
  private fun encode565(out: ByteArrayOutputStream, px: IntArray) {
    fun emit(count: Int, at: Int) {
      when {
        count == 1 -> {
          le16(out, rgb565(px[at]))
          le16(out, if (at < px.size - 1) rgb565(px[at + 1]) else 0)
        }
        count < 8 -> repeat(count) { le16(out, rgb565(px[at])) }
        else -> {
          le32(out, MARKER_32)
          le16(out, rgb565(px[at]))
          le16(out, rgb565(px[at]))
          le32(out, count / 2)
        }
      }
    }
    var i = 0
    var run = 1
    while (i < px.size) {
      if (i == px.size - 1 || px[i] != px[i + 1]) {
        if (run == 1) {
          emit(run, i)
          i++
        } else if (run % 2 != 0) {
          emit(run - 1, i)
          i--
        } else {
          emit(run, i)
        }
        run = 1
      } else {
        run++
      }
      i++
    }
  }
}
