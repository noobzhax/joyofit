package com.joyodigitama.huaweiwear

import android.content.Context
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.GZIPInputStream
import org.json.JSONArray
import org.json.JSONException

/** A download the watch asked for failed (no network, HTTP error, unreadable body); the message goes to the log. */
internal class AgpsFetchException(message: String, cause: Throwable? = null) : IOException(message, cause)

/**
 * The HTTP side of the watch's ephemeris requests, as Huawei Health makes them (see `AGPS_PROTOCOL.md`): blocking, so callers run it
 * on the IO dispatcher. Only https, bodies capped at [MAX_BYTES], no credentials of any kind.
 */
internal object EphemerisNet {
  /** GRS `getAgnssPluginUrl` for the "dra" region; the watch supplies the path of a `HW_AGNSS` entry. */
  const val AGNSS_BASE = "https://geo-dra.platform.hicloud.com/"

  /** GRS `getNewBatchPluginUrl`: version 1 and 2 config ids are appended to it. */
  const val CONFIG_BASE = "https://configserver-dra.platform.hicloud.com/servicesupport/updateserver/data/"

  /** GRS `domainbroadnewurl`; version 0 URLs ending in [LTO_PATH] are rewritten to it, like Huawei Health does. */
  const val LTO_HOST = "https://gllto.glpals.com"
  const val LTO_PATH = "/7day/v6/latest/lto.dat"

  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val READ_TIMEOUT_MS = 30_000
  private const val MAX_BYTES = 8 * 1024 * 1024

  /** `gty.d`: the three headers Huawei Health sends for `HW_AGNSS`. */
  fun agnssHeaders(): Map<String, String> = mapOf(
    "X-Request-ID" to UUID.randomUUID().toString(),
    "Content-Type" to "application/json",
    "X-Device-Type" to "SportsHealth",
  )

  /** `mtm.e` / `PgnssManager`: headers of the config-server lookup of versions 1 and 2. */
  fun configHeaders(): Map<String, String> = mapOf(
    "App-ID" to "HealthApp",
    "traceId" to UUID.randomUUID().toString(),
  )

  fun get(url: String, headers: Map<String, String> = emptyMap()): ByteArray {
    if (!url.startsWith("https://")) throw AgpsFetchException("refusing non-https url")
    val connection = try {
      URL(url).openConnection() as HttpURLConnection
    } catch (e: IOException) {
      throw AgpsFetchException("bad url: ${e.message}", e)
    }
    try {
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.requestMethod = "GET"
      for ((name, value) in headers) connection.setRequestProperty(name, value)
      val status = connection.responseCode
      if (status != 200) {
        val reason = try {
          connection.errorStream?.use { stream ->
            val buffer = ByteArray(256)
            String(buffer, 0, stream.read(buffer).coerceAtLeast(0), Charsets.UTF_8).take(120)
          }
        } catch (e: IOException) {
          null
        }
        throw AgpsFetchException("HTTP $status${if (reason.isNullOrBlank()) "" else ": $reason"}")
      }
      return connection.inputStream.use { readCapped(it, MAX_BYTES) }
    } catch (e: AgpsFetchException) {
      throw e
    } catch (e: IOException) {
      throw AgpsFetchException("${e.javaClass.simpleName}: ${e.message}", e)
    } finally {
      connection.disconnect()
    }
  }

  private fun readCapped(input: InputStream, limit: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val n = input.read(buffer)
      if (n < 0) break
      if (out.size() + n > limit) throw AgpsFetchException("response larger than $limit bytes")
      out.write(buffer, 0, n)
    }
    return out.toByteArray()
  }

  /**
   * The `HW_AGNSS` body is a gzip stream (`gts.a`). The platform's HttpURLConnection already unwraps a `Content-Encoding: gzip`
   * response, so a body that still starts with the gzip magic is the payload's own layer; anything else is already plain.
   */
  fun gunzipIfNeeded(data: ByteArray): ByteArray {
    if (data.size < 2 || data[0] != 0x1F.toByte() || data[1] != 0x8B.toByte()) return data
    val out = ByteArrayOutputStream()
    try {
      GZIPInputStream(ByteArrayInputStream(data)).use { input ->
        val buffer = ByteArray(8192)
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          if (out.size() + n > MAX_BYTES) throw AgpsFetchException("unzipped response larger than $MAX_BYTES bytes")
          out.write(buffer, 0, n)
        }
      }
    } catch (e: AgpsFetchException) {
      throw e
    } catch (e: IOException) {
      throw AgpsFetchException("gunzip failed: ${e.message}", e)
    }
    return out.toByteArray()
  }

  /**
   * Version 1/2 config answer: a JSON array whose first element needs `ver`, `downloadUrl`, `signature` and `fileId` (`mts.a`);
   * returns the download URL, or null when the answer is not usable. The signature is not checked: its salting is not known.
   */
  fun parseConfigDownloadUrl(body: ByteArray): String? =
    try {
      val first = JSONArray(String(body, Charsets.UTF_8)).optJSONObject(0)
      if (first == null || !first.has("ver") || !first.has("signature") || !first.has("fileId")) null
      else first.optString("downloadUrl", "").takeIf { it.isNotEmpty() }
    } catch (e: JSONException) {
      null
    }

  fun lastPathSegment(url: String): String = url.substringBefore('?').substringAfterLast('/')

  /** `HuaweiEphemerisManager.getHexDigest`: SHA-256 of the watch address without colons, lowercase hex. */
  fun addressDigest(address: String): String =
    MessageDigest.getInstance("SHA-256").digest(address.replace(":", "").toByteArray(Charsets.UTF_8)).toHex().lowercase()
}

/**
 * Downloads kept in the app's files so the watch's repeated requests (it asks again every ~20 s while it is locating) do not
 * refetch. Keyed by URL; the age is the file's modification time.
 */
internal class EphemerisCache(context: Context) {
  private val dir = File(context.applicationContext.filesDir, "agps")

  private fun file(url: String): File {
    val key = MessageDigest.getInstance("SHA-256").digest(url.toByteArray(Charsets.UTF_8)).toHex().lowercase().take(32)
    return File(dir, "$key.bin")
  }

  /** The cached body of [url] when it is younger than [maxAgeMs]. */
  fun read(url: String, maxAgeMs: Long): ByteArray? {
    val f = file(url)
    if (!f.isFile || System.currentTimeMillis() - f.lastModified() > maxAgeMs) return null
    return try {
      f.readBytes().takeIf { it.isNotEmpty() }
    } catch (e: IOException) {
      null
    }
  }

  fun write(url: String, data: ByteArray) {
    try {
      if (!dir.isDirectory && !dir.mkdirs()) return
      val target = file(url)
      val tmp = File(dir, target.name + ".tmp")
      tmp.writeBytes(data)
      if (!tmp.renameTo(target)) tmp.delete()
      prune()
    } catch (e: IOException) {
      // A cache that cannot be written only costs a refetch.
    }
  }

  private fun prune() {
    val cutoff = System.currentTimeMillis() - PRUNE_AGE_MS
    dir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
  }

  private companion object {
    const val PRUNE_AGE_MS = 24L * 60 * 60 * 1000
  }
}
