package com.joyodigitama.huaweiwear

import android.content.Context
import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Log lines kept in the process for the support report, so it also covers connects no screen saw (the background
 * service). The lines of the last connect attempt are kept apart from the rolling tail: a day of syncs cannot push
 * out what the watch answered while connecting, which is what a report on a new model is for.
 */
internal class SupportLog {
  internal class Line(val seq: Long, val atMs: Long, val text: String)

  private var connect = ArrayList<Line>()
  private val tail = ArrayDeque<Line>()
  private var seq = 0L

  /** A connect attempt starts: from here, lines also go to the connect part until it is full. */
  @Synchronized
  fun connectStarted() {
    connect = ArrayList()
  }

  @Synchronized
  fun add(text: String, atMs: Long = System.currentTimeMillis()) {
    val line = Line(seq++, atMs, text)
    if (connect.size < CONNECT_LINES) connect.add(line)
    tail.addLast(line)
    if (tail.size > TAIL_LINES) tail.removeFirst()
  }

  /** The connect part and the tail, oldest first, each line once. */
  @Synchronized
  fun lines(): List<Line> = (connect + tail).distinctBy { it.seq }.sortedBy { it.seq }

  companion object {
    const val CONNECT_LINES = 600
    const val TAIL_LINES = 400
  }
}

internal object SupportReport {
  private val MAC = Regex("(?i)\\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\\b")
  private val SERIAL = Regex("(?i)serial=\\S+")

  /** Bluetooth addresses and the serial number are left out: the report is shared with people outside the app. */
  fun redact(text: String, serial: String?): String {
    var out = MAC.replace(text, "XX:XX:XX:XX:XX:XX")
    out = SERIAL.replace(out, "serial=(left out)")
    if (!serial.isNullOrBlank() && serial.length >= 4) out = out.replace(serial, "(serial left out)")
    return out
  }

  fun build(
    context: Context,
    watchName: String?,
    device: Map<String, Any?>?,
    linkState: String,
    log: List<SupportLog.Line>,
    nowMs: Long = System.currentTimeMillis(),
  ): String {
    val serial = device?.get("serialNumber") as String?
    val name = device?.get("name") as String? ?: watchName
    val match = WatchModels.match(name)
    val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.ROOT)
    val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT)
    val out = StringBuilder()
    out.appendLine("JoyoFit support report")
    out.appendLine("Created: ${stamp.format(Date(nowMs))}")
    out.appendLine("App: ${appVersion(context)}")
    out.appendLine("Phone: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
    out.appendLine("Watch: ${name ?: "none yet"}")
    out.appendLine("Model: ${match.model?.name ?: "not in the list"} (${match.support.wire})")
    if (device != null) {
      out.appendLine(
        "Product: ${device["productModel"] ?: "?"}, software ${device["softwareVersion"] ?: "?"}, " +
          "hardware ${device["hardwareVersion"] ?: "?"}, auth ${device["authMode"] ?: "?"}",
      )
    }
    out.appendLine("Link: $linkState")
    val commands = DeviceCaps.supportedCommands
    if (commands.isNotEmpty()) {
      out.appendLine("Supported commands (last connect, service: commands):")
      for ((service, list) in commands.toSortedMap()) {
        out.appendLine("  %02x: %s".format(service, list.joinToString(" ") { "%02x".format(it.toInt() and 0xFF) }))
      }
    }
    out.appendLine("ExpandCapability: ${DeviceCaps.expandCapabilities?.toHex() ?: "none"}")
    out.appendLine("Bluetooth addresses and the serial number are left out.")
    out.appendLine()
    out.appendLine("Log, oldest first (${log.size} lines):")
    var previous: Long? = null
    for (line in log) {
      if (previous != null && line.seq > previous + 1) out.appendLine("... ${line.seq - previous - 1} lines left out ...")
      out.append(clock.format(Date(line.atMs))).append(' ').appendLine(line.text)
      previous = line.seq
    }
    return redact(out.toString(), serial)
  }

  private fun appVersion(context: Context): String =
    try {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      "${context.packageName} ${info.versionName} (${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()})"
    } catch (e: Exception) {
      context.packageName
    }
}
