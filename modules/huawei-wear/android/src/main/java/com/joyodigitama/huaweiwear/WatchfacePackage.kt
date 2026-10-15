// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiFwHelper.parseAsWatchFace,
// HuaweiWatchfaceManager.{Resolution,WatchfaceDescription,getRandomName} and devices/huawei/HuaweiInstallHandler
// (the watch face branch of validateInstallation).
package com.joyodigitama.huaweiwear

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.StringReader
import java.util.Locale
import java.util.Random
import java.util.zip.ZipException
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Document
import org.xml.sax.InputSource

/** GB `HuaweiWatchfaceManager.WatchfaceDescription`, from the package's `description.xml`. */
internal class WatchfaceDescription(
  val title: String,
  val titleCn: String,
  val author: String,
  val designer: String,
  /** The theme version code, for example `HWHD13`; see [WatchfaceResolutions]. */
  val screen: String,
  val version: String,
  val font: String,
  val fontCn: String,
  /** Root element `HnTheme` (Honor) instead of `HwTheme` (Huawei). */
  val isHonor: Boolean,
)

/** A validated `.hwt` package: the description and the `watchface.bin` the watch is sent. */
internal class WatchfacePackage(
  val description: WatchfaceDescription,
  val binary: ByteArray,
  /** `preview/cover.jpg` when the package has one. */
  val preview: ByteArray?,
)

/** GB `HuaweiWatchfaceManager.Resolution`: theme version code to `height*width`. */
internal object WatchfaceResolutions {
  private val byThemeVersion = mapOf(
    // Huawei sizes "height*width"
    "HWHD01" to "390*390",
    "HWHD02" to "454*454",
    "HWHD03" to "240*120",
    "HWHD04" to "160*80",
    "HWHD05" to "460*188",
    "HWHD06" to "456*280",
    "HWHD07" to "368*194",
    "HWHD08" to "320*320",
    "HWHD09" to "466*466",
    "HWHD10" to "360*320",
    "HWHD11" to "480*336",
    "HWHD12" to "240*240",
    "HWHD13" to "480*408",
    "HWHD14" to "482*286",
    // Honor sizes
    "HNHD01" to "466*466",
    "HNHD02" to "368*194",
    "HNHD03" to "450*390",
    "HNHD04" to "454*454",
    "HNHD05" to "402*256",
    "QXHD01" to "402*256",
    "QXHD02" to "502*410",
  )

  /**
   * The Watch Fit 4 and Fit 4 Pro: a 1.82 inch AMOLED of 480 x 408 pixels (Huawei's spec sheet), theme
   * version `HWHD13` ("height*width" = 480*408). Huawei's Theme Studio Pro names it "408 x 480".
   */
  const val FIT4_THEME_VERSION = "HWHD13"
  const val FIT4_SCREEN = "480*408"

  fun isKnown(themeVersion: String): Boolean = themeVersion in byThemeVersion

  /** GB `isValid`: false for an unknown theme version. */
  fun isValid(themeVersion: String, screenResolution: String): Boolean = byThemeVersion[themeVersion] == screenResolution

  /** GB `screenByThemeVersion`. */
  fun screenByThemeVersion(themeVersion: String): String = byThemeVersion[themeVersion] ?: "0x0"
}

internal object WatchfacePackages {
  /** A package is read into memory; this is far above any real watch face. */
  const val MAX_PACKAGE_BYTES = 64 * 1024 * 1024

  private const val HUAWEI_ENTRY = "com.huawei.watchface"
  private const val HONOR_ENTRY = "com.honor.watchface"

  /**
   * GB `HuaweiFwHelper.parseAsWatchFace`: the package is a zip with `description.xml`, an optional
   * `preview/cover.jpg` and an entry `com.huawei.watchface` (`com.honor.watchface` for Honor), which is
   * itself a zip holding `watchface.bin`; older packages hold the binary directly.
   * Throws [WearException] ERR_INVALID_ARGUMENT with a message for the user when the file is no watch face.
   */
  fun parse(bytes: ByteArray): WatchfacePackage {
    val descriptionBytes = entry(bytes, "description.xml")
      ?: bad("This is not a watch face package: there is no description.xml in it. Export it as a .hwt file from Huawei Theme Studio Pro.")
    val description = parseDescription(descriptionBytes)
    val entryName = if (description.isHonor) HONOR_ENTRY else HUAWEI_ENTRY
    val outer = entry(bytes, entryName)
      ?: bad("This watch face package has no $entryName entry.")
    // GB: a nested zip with watchface.bin, else the entry itself is the binary.
    val binary = entry(outer, "watchface.bin") ?: outer
    if (binary.isEmpty()) bad("The watch face package contains an empty watch face.")
    return WatchfacePackage(description, binary, entry(bytes, "preview/cover.jpg"))
  }

  fun parseDescription(raw: ByteArray): WatchfaceDescription {
    // GB strips a UTF-8 byte order mark before parsing.
    val offset = if (raw.size >= 3 && raw[0] == 0xEF.toByte() && raw[1] == 0xBB.toByte() && raw[2] == 0xBF.toByte()) 3 else 0
    val text = String(raw, offset, raw.size - offset, Charsets.UTF_8)
    val document: Document = try {
      val factory = DocumentBuilderFactory.newInstance()
      // No entity expansion from a file the user picked; not every XML parser supports the feature.
      try {
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
      } catch (e: Exception) {
        // Not every XML parser supports the feature; the parse below still runs.
      }
      factory.newDocumentBuilder().parse(InputSource(StringReader(text)))
    } catch (e: Exception) {
      bad("description.xml in this package is not valid XML: ${e.message}")
    }
    fun element(tag: String): String {
      val nodes = document.getElementsByTagName(tag)
      return if (nodes.length > 0) nodes.item(0).textContent.trim() else ""
    }
    val isHonor = when (document.documentElement.tagName) {
      "HnTheme" -> true
      "HwTheme" -> false
      else -> bad("description.xml has an unknown root element '${document.documentElement.tagName}' (expected HwTheme).")
    }
    val description = WatchfaceDescription(
      title = element("title"),
      titleCn = element("title-cn"),
      author = element("author"),
      designer = element("designer"),
      screen = element("screen"),
      version = element("version"),
      font = element("font"),
      fontCn = element("font-cn"),
      isHonor = isHonor,
    )
    if (description.screen.isEmpty()) bad("description.xml names no screen (theme version).")
    return description
  }

  /**
   * GB `GBZipFile.getFileFromZip`, null instead of an exception when the entry is missing, is a
   * directory, or [zip] is no zip at all.
   */
  fun entry(zip: ByteArray, name: String): ByteArray? {
    try {
      ZipInputStream(ByteArrayInputStream(zip)).use { stream ->
        while (true) {
          val entry = stream.nextEntry ?: return null
          if (entry.name != name) continue
          if (entry.isDirectory) return null
          val out = ByteArrayOutputStream()
          val buffer = ByteArray(16384)
          while (true) {
            val n = stream.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
          }
          return out.toByteArray()
        }
      }
    } catch (e: ZipException) {
      return null
    } catch (e: IOException) {
      return null
    }
  }

  /**
   * GB `HuaweiInstallHandler.validateInstallation`: the package's theme version has to name the
   * watch's screen (`height*width`). A theme version GB does not know is allowed through (the watch
   * decides); a known one with another size is refused.
   */
  fun checkResolution(description: WatchfaceDescription, height: Int, width: Int, log: (String) -> Unit) {
    val deviceScreen = String.format(Locale.ROOT, "%d*%d", height, width)
    if (!WatchfaceResolutions.isKnown(description.screen)) {
      log("watch face theme version ${description.screen} is not in GB's resolution table; not checked against the watch's $deviceScreen")
      return
    }
    if (!WatchfaceResolutions.isValid(description.screen, deviceScreen)) {
      throw WearException(
        ErrorCodes.INVALID_ARGUMENT,
        "This watch face is made for a ${WatchfaceResolutions.screenByThemeVersion(description.screen)} screen (${description.screen}), " +
          "but the watch reports $deviceScreen. Make it in Theme Studio Pro for this watch's screen.",
      )
    }
  }

  /** Huawei Health `HwWatchFaceManager.getRandomVersion`: three numbers from 1 to 10, joined by dots. */
  fun randomVersion(random: Random = Random()): String =
    String.format(Locale.ROOT, "%d.%d.%d", random.nextInt(10) + 1, random.nextInt(10) + 1, random.nextInt(10) + 1)

  private val usableVersion = Regex("^\\d+(\\.\\d+){1,3}$")

  /**
   * The `<id>_<version>` the face is uploaded under. The id is nine random digits (GB `getRandomName`; Huawei Health's
   * local install always uses `000000001`, which would make two installed faces share an id). The version is the
   * face's own, like a store face (`2184389193_2.10.5`), when it is a plain dotted number; otherwise a random one in
   * Huawei Health's style. GB always used `1.0.0`, a version below the 2.1 to 2.10 range this watch lists.
   */
  fun randomName(random: Random = Random(), version: String? = null): String {
    val usable = version?.trim()?.takeIf { usableVersion.matches(it) } ?: randomVersion(random)
    return String.format(Locale.ROOT, "%09d_%s", random.nextInt(1_000_000_000), usable)
  }

  /** The leading `major.minor` of a version such as `2.10.5`, or null when it has none. */
  fun majorMinor(version: String): Pair<Int, Int>? {
    val parts = version.trim().split('.')
    if (parts.size < 2) return null
    val major = parts[0].toIntOrNull() ?: return null
    val minor = parts[1].toIntOrNull() ?: return null
    return major to minor
  }

  /**
   * Huawei Health `f2.d` (`verifyWatchFaceVersion`) with the watch's other versions as its compatible list: the
   * face's `<version>` has the watch's major version and a minor no higher than the watch's maximum, or is listed
   * among the other versions the watch accepts. A version that cannot be read on either side is left to the watch.
   */
  fun checkVersion(description: WatchfaceDescription, maxVersion: String, otherVersions: String, log: (String) -> Unit) {
    val face = majorMinor(description.version)
    val max = majorMinor(maxVersion)
    if (face == null || max == null) {
      log("watch face version '${description.version}' or the watch's maximum '$maxVersion' cannot be read; not checked")
      return
    }
    if (face.first == max.first && face.second <= max.second) return
    if (otherVersions.split(',').any { majorMinor(it) == face }) return
    throw WearException(
      ErrorCodes.INVALID_ARGUMENT,
      "This watch face was made for watch face version ${face.first}.${face.second} (description.xml version " +
        "${description.version}), but the watch supports up to $maxVersion" +
        (if (otherVersions.isNotBlank()) " (and $otherVersions)" else "") + ". Export it again from Theme Studio Pro for this watch.",
    )
  }

  private fun bad(message: String): Nothing = throw WearException(ErrorCodes.INVALID_ARGUMENT, message)
}
