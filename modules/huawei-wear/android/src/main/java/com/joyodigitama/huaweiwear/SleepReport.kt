package com.joyodigitama.huaweiwear

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV

/**
 * Drops unstaged segments that lie within [SleepReport.SESSION_GAP_SEC] of a staged one. The watch stores short
 * unstaged spans around a staged night (seen in the evening before it); next to real stages they only stretch the
 * night. An unstaged nap far from any staged sleep stays. Same rule as `withoutStrayUnstaged` in src/features/today/stats.ts.
 */
internal fun withoutStrayUnstaged(segments: List<SleepSegment>): List<SleepSegment> {
  val staged = segments.filter { it.stage != null }
  return segments.filter { s ->
    s.stage != null || staged.none { t -> t.start - s.end <= SleepReport.SESSION_GAP_SEC && s.start - t.end <= SleepReport.SESSION_GAP_SEC }
  }
}

/** One night as the report describes it, seconds per stage from the stored segments. */
internal class SleepNight(
  val start: Long,
  val end: Long,
  val totalSec: Long,
  val lightSec: Long,
  val deepSec: Long,
  val remSec: Long,
  val awakeSec: Long,
) {
  /** Whether any segment carried a decoded stage. */
  val hasStages: Boolean get() = lightSec + deepSec + remSec + awakeSec > 0
}

/**
 * The morning sleep report (a notification card on the watch), after Huawei Health 17.0.8.300 `but`
 * (SleepNotificationManager) and `vgm` (CoreSleepEventHandler). DataSync event `80030001`, phone package
 * `hw.unitedevice.sleepnotification`, watch package `hw.watch.health.sleep`, level 0, gated on ExpandCapability 84.
 *
 * The event data is a TLV of UTF-8 strings (`but.a(DeviceInfo, buu)` with `buu`'s getters mapped by `vgm.c`):
 * `06` title, `07` description, `08` label of the "open" button, `09` label of the "ignore" button, `0a` locale
 * (`xx-YY`), `0b` URI of the "open" action, `0c` URI of the "ignore" action. The watch answers the same event id
 * with data `01` when it showed the card (`but.onDataReceived`); anything else counts as not shown.
 */
internal object SleepReport {
  const val EVENT_ID = 80030001
  const val PHONE_PKG = "hw.unitedevice.sleepnotification"
  const val WATCH_PKG = "hw.watch.health.sleep"

  const val TAG_TITLE = 0x06
  const val TAG_DESCRIPTION = 0x07
  const val TAG_OPEN_LABEL = 0x08
  const val TAG_IGNORE_LABEL = 0x09
  const val TAG_LOCALE = 0x0A
  const val TAG_OPEN_URI = 0x0B
  const val TAG_IGNORE_URI = 0x0C

  /** Segments closer together than this belong to the same session (`SESSION_GAP_SEC` in `src/features/today/stats.ts`). */
  const val SESSION_GAP_SEC = 3 * 3600L

  /** Shorter sessions are naps, not "last night". */
  const val MIN_NIGHT_SEC = 3 * 3600L

  /** A report is only pushed this long after waking up at most; later it is not a morning report any more. */
  const val MAX_AGE_SEC = 8 * 3600L

  /** The latest session of [segments], chained with gaps up to [SESSION_GAP_SEC] (`lastSleepSession` in `stats.ts`). */
  fun lastNight(segments: List<SleepSegment>): SleepNight? {
    if (segments.isEmpty()) return null
    val sorted = withoutStrayUnstaged(segments).sortedBy { it.start }
    var first = sorted.size - 1
    var earliest = sorted[first].start
    while (first > 0 && earliest - sorted[first - 1].end <= SESSION_GAP_SEC) {
      first--
      earliest = minOf(earliest, sorted[first].start)
    }
    var total = 0L
    var light = 0L
    var deep = 0L
    var rem = 0L
    var awake = 0L
    var end = 0L
    for (segment in sorted.subList(first, sorted.size)) {
      val seconds = maxOf(0L, segment.end - segment.start)
      total += seconds
      end = maxOf(end, segment.end)
      when (segment.stage) {
        "light" -> light += seconds
        "deep" -> deep += seconds
        "rem" -> rem += seconds
        "awake" -> awake += seconds
      }
    }
    return SleepNight(earliest, end, total, light, deep, rem, awake)
  }

  /** Whether to push [night] now: a night, ending today, at most [MAX_AGE_SEC] ago and newer than the last one reported. */
  fun shouldPush(night: SleepNight, nowSec: Long, zone: ZoneId, lastReportedEnd: Long): String? {
    if (night.end <= lastReportedEnd) return "already reported (session end ${night.end} <= $lastReportedEnd)"
    if (night.totalSec < MIN_NIGHT_SEC) return "only ${night.totalSec / 60} min of sleep, a nap"
    if (nowSec - night.end > MAX_AGE_SEC) return "ended ${(nowSec - night.end) / 3600} h ago, too late for a morning report"
    val endDay = Instant.ofEpochSecond(night.end).atZone(zone).toLocalDate()
    val today = Instant.ofEpochSecond(nowSec).atZone(zone).toLocalDate()
    if (endDay != today) return "the session ended on $endDay, not today ($today)"
    return null
  }

  /** `7 h 12 min`; minutes only below an hour. */
  fun duration(seconds: Long): String {
    val minutes = (seconds + 30) / 60
    val h = minutes / 60
    val m = minutes % 60
    return if (h == 0L) "$m min" else "$h h ${m.toString().padStart(2, '0')} min"
  }

  class Message(val title: String, val description: String, val openLabel: String, val ignoreLabel: String, val locale: String, val openUri: String, val ignoreUri: String)

  /** The text of the card. No sleep score is made up: JoyoFit stores stages, not a score. */
  fun message(night: SleepNight, zone: ZoneId, locale: Locale): Message {
    val clock = DateTimeFormatter.ofPattern("HH:mm")
    val from = Instant.ofEpochSecond(night.start).atZone(zone).format(clock)
    val to = Instant.ofEpochSecond(night.end).atZone(zone).format(clock)
    val sb = StringBuilder("${duration(night.totalSec)} asleep, $from to $to.")
    if (night.hasStages) {
      val parts = ArrayList<String>()
      if (night.deepSec > 0) parts += "Deep ${duration(night.deepSec)}"
      if (night.remSec > 0) parts += "REM ${duration(night.remSec)}"
      if (night.lightSec > 0) parts += "Light ${duration(night.lightSec)}"
      if (parts.isNotEmpty()) sb.append(' ').append(parts.joinToString(", ")).append('.')
    }
    return Message(
      title = "Sleep report",
      description = sb.toString(),
      openLabel = "Open app",
      ignoreLabel = "Ignore",
      locale = localeTag(locale),
      openUri = "joyofit://today",
      ignoreUri = "joyofit://today",
    )
  }

  /** `xx-YY` like `npn.e` / `CommonUtil.ab`: language and country, `en-US` when the locale has no country. */
  fun localeTag(locale: Locale): String {
    val language = locale.language.ifEmpty { "en" }
    val country = locale.country.ifEmpty { "US" }
    return "$language-$country"
  }

  /** The event data: tags `06..0c` as UTF-8 TLV strings. */
  fun payload(message: Message): ByteArray = HuaweiTLV()
    .put(TAG_TITLE, message.title)
    .put(TAG_DESCRIPTION, message.description)
    .put(TAG_OPEN_LABEL, message.openLabel)
    .put(TAG_IGNORE_LABEL, message.ignoreLabel)
    .put(TAG_LOCALE, message.locale)
    .put(TAG_OPEN_URI, message.openUri)
    .put(TAG_IGNORE_URI, message.ignoreUri)
    .serialize()

  /** The watch's answer: shown when the data reads as the number 1 (`but.onDataReceived`: hex string, `CommonUtil.y(...) == 1`). */
  fun acknowledged(data: ByteArray?): Boolean = DataSyncBytes.readInt32(data) == 1
}
