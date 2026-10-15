// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiEphemerisManager and
// requests/SendEphemeris*; packets/{Ephemeris,EphemerisFileUpload}. The download side follows Huawei Health's HwEphemerisManager.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums

/** The 0x1C packet that carries file bytes to the watch: `index, bytes` per frame (GB `FileNextChunkSend.serializeFileChunk1c`). */
private class AgpsChunkPacket(
  params: HuaweiPacket.ParamsProvider,
  private val chunk: ByteArray,
  private val transferSize: Short,
  private val packetCount: Int,
) : HuaweiPacket(params) {
  init {
    serviceId = 0x1C.toByte()
    commandId = 0x05.toByte()
    complete = true
    isEncrypted = params.areTransactionsCrypted()
  }

  override fun serialize(): List<ByteArray> = serializeFileChunk1c(chunk, transferSize, packetCount)
}

private fun agpsUnsigned(bytes: ByteArray?): Long? {
  if (bytes == null || bytes.isEmpty() || bytes.size > 8) return null
  var value = 0L
  for (b in bytes) value = (value shl 8) or (b.toLong() and 0xFF)
  return value
}

private fun HuaweiTLV.agpsInt(tag: Int): Long? = agpsUnsigned(getBytes(tag, null))

private fun HuaweiTLV.agpsString(tag: Int): String? = getBytes(tag, null)?.let { String(it, Charsets.UTF_8) }

/**
 * The phone's half of the watch's AGPS / ephemeris request (service 0x1F), so an outdoor workout does not sit on "Locating..."
 * until the satellites have been found the slow way. The watch drives; every step is its own message:
 *
 * ```
 * watch 1F/01 {81{02 op, 03 time}}          phone 1F/01 {7F 100000}   (100007 without network)
 *                                           phone 1F/02 {81}          ParameterConsult
 * watch 1F/02 {81{04 time, 05 version,      phone downloads, then 1F/03 {01 state}   3 ready, 4 failed, 5 unsupported
 *               06 tag list, children 03 urls}}
 * watch 1C/01 file list, 1C/02 consult, 1C/03 file info, 1C/04 data request, 1C/06 done
 *                                           phone 1C/01..04 answers, 1C/05 data frames, 1C/06 answer
 * ```
 *
 * Served: version 0 (Broadcom LTO, saved as `gpslocation.dat`), version 1 and 2 (config server lookup, no credential) and
 * version 3 `HW_AGNSS` (what the Fit 4 Pro asks for first). The other version 3 tags need Huawei's proprietary decoder or an
 * account credential; they are answered with state 4 like Huawei Health does when its own download fails.
 *
 * Network work runs on the IO dispatcher; the watch's messages are handled in order on one coroutine per connection and never
 * on the session's reader thread.
 */
internal class EphemerisLink(
  context: Context,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val cache = EphemerisCache(appContext)
  private val lock = Any()
  private var run: Run? = null

  private class Incoming(val service: Int, val command: Int, val packet: HuaweiPacket)

  /** What the watch asked for in one 1C/02 ... 1C/06 round (GB `UploadParameters` and the current file). */
  private class Transfer(val transferSize: Int, val maxDataSize: Int, val fileType: Int) {
    var name: String? = null
    var data: ByteArray? = null
    var frames = 0
  }

  /** One connection: its subscriptions, the in-order message loop and everything the exchange has produced so far. */
  private class Run(val session: HuaweiSession, val address: String) {
    val inbox = Channel<Incoming>(Channel.UNLIMITED)
    val subscriptions = ArrayList<AutoCloseable>()
    var actor: Job? = null

    /** Huawei Health's `downloadState`: 0 idle, 1 consulted, 2 downloading, 3 ready, 4 failed, 5 unsupported. */
    @Volatile var state = 0

    /** An op 1 was accepted and not yet failed (Huawei Health keeps its per-device record until state 4 or 5). */
    @Volatile var task = false

    @Volatile var download: Job? = null

    /** Files the watch may pull, by the name it asks for; filled by downloads, read by the file service handlers. Guarded by `this`. */
    val ready = LinkedHashMap<String, ByteArray>()

    /** Only touched from [actor]. */
    var transfer: Transfer? = null

    fun stop() {
      subscriptions.forEach { it.close() }
      subscriptions.clear()
      inbox.close()
      download?.cancel()
      actor?.cancel()
    }
  }

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, "AGPS: $message")

  private fun logError(message: String) = events.log(LogDirection.ERROR, null, null, null, "AGPS: $message")

  /** Logcat only: the tag list and URLs can carry the user's rough position, so they stay out of the shareable support log. */
  private fun logRaw(message: String) {
    android.util.Log.i("JoyoFit", "AGPS: $message")
  }

  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val handle = link.handle() ?: return
        val fresh: Run
        synchronized(lock) {
          if (run?.session === handle.session) return
          run?.stop()
          fresh = Run(handle.session, handle.address)
          run = fresh
        }
        attach(fresh)
      }
      LinkState.DISCONNECTED -> synchronized(lock) {
        run?.stop()
        run = null
      }
      else -> Unit
    }
  }

  private fun attach(run: Run) {
    val wanted = listOf(
      Triple(AGPS_SERVICE, 0x01, "operator request"),
      Triple(AGPS_SERVICE, 0x02, "parameter consult answer"),
      Triple(AGPS_SERVICE, 0x03, "file status answer"),
      Triple(FILE_SERVICE, 0x01, "file list request"),
      Triple(FILE_SERVICE, 0x02, "file consult"),
      Triple(FILE_SERVICE, 0x03, "file info request"),
      Triple(FILE_SERVICE, 0x04, "data request"),
      Triple(FILE_SERVICE, 0x05, "data ack"),
      Triple(FILE_SERVICE, 0x06, "upload done"),
    )
    for ((service, command, label) in wanted) {
      run.subscriptions += run.session.subscribe(service.toByte(), command.toByte(), "AGPS $label") {
        run.inbox.trySend(Incoming(service, command, it))
      }
    }
    run.actor = scope.launch {
      for (message in run.inbox) {
        try {
          handle(run, message)
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          logError("%02x/%02x handler failed: %s".format(message.service, message.command, e.message ?: e.javaClass.simpleName))
        }
      }
    }
    log(
      "ready; watch lists 1F/01=${DeviceCaps.supports(AGPS_SERVICE, 1)} 1F/02=${DeviceCaps.supports(AGPS_SERVICE, 2)} " +
        "1F/03=${DeviceCaps.supports(AGPS_SERVICE, 3)} 1C/01=${DeviceCaps.supports(FILE_SERVICE, 1)} 1C/04=${DeviceCaps.supports(FILE_SERVICE, 4)}",
    )
  }

  private suspend fun handle(run: Run, message: Incoming) {
    if (message.service == AGPS_SERVICE) {
      when (message.command) {
        0x01 -> onOperator(run, message.packet)
        0x02 -> onConsult(run, message.packet)
        0x03 -> log("watch answered the file status: ${describeTlv(message.packet.getTlv())}")
      }
    } else {
      when (message.command) {
        0x01 -> onFileList(run, message.packet)
        0x02 -> onFileConsult(run, message.packet)
        0x03 -> onFileInfo(run, message.packet)
        0x04 -> onDataRequest(run, message.packet)
        0x05 -> run.transfer?.let { it.frames++ }
        0x06 -> onUploadDone(run, message.packet)
      }
    }
  }

  private suspend fun tx(run: Run, service: Int, command: Int, content: HuaweiTLV, label: String) {
    try {
      run.session.send(RawPacket(run.session.params, service, command, content), "AGPS $label")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      logError("$label not sent: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  // 1F: operator request, consult, download, status

  private suspend fun onOperator(run: Run, packet: HuaweiPacket) {
    val tlv = packet.getTlv()
    val body = if (tlv != null && tlv.contains(0x81)) tlv.getObject(0x81) else null
    val op = body?.agpsInt(0x02)?.toInt() ?: -1
    val timeBytes = body?.getBytes(0x03, null)
    log("watch asks for ephemeris data: op $op, time ${agpsUnsigned(timeBytes)}")
    when (op) {
      1 -> {
        // Huawei Health clears its record for the watch on every op 1 and starts over; so does this.
        run.download?.cancel()
        run.task = true
        run.state = 0
        if (!online()) {
          run.task = false
          log("no network; answering 100007")
          tx(run, AGPS_SERVICE, 0x01, HuaweiTLV().put(0x7F, CODE_NO_NETWORK), "operator answer (no network)")
          return
        }
        log("answering 100000 and asking the watch for its parameters (1F/02)")
        tx(run, AGPS_SERVICE, 0x01, HuaweiTLV().put(0x7F, CODE_OK), "operator answer")
        tx(run, AGPS_SERVICE, 0x02, HuaweiTLV().put(0x81), "parameter consult")
      }
      2 -> {
        if (!run.task) {
          log("progress request but no request is running; ignored")
          return
        }
        // Huawei Health `mtp.a(String, mtv)`: 81{02: 02, 03: the watch's own time bytes, 04: downloadState}.
        val answer = HuaweiTLV().put(0x02, 2.toByte()).put(0x03, timeBytes ?: ByteArray(0)).put(0x04, run.state.toByte())
        log("progress request; answering state ${run.state}")
        tx(run, AGPS_SERVICE, 0x01, HuaweiTLV().put(0x81, answer), "progress answer")
      }
      else -> log("unknown operation $op; ignored")
    }
  }

  private fun online(): Boolean = try {
    val manager = appContext.getSystemService(ConnectivityManager::class.java)
    val network = manager?.activeNetwork
    if (manager == null) true
    else if (network == null) false
    else manager.getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
  } catch (e: SecurityException) {
    // Without the permission there is no way to tell; the download itself will fail and say so.
    true
  }

  private class Consult(val version: Int, val tag: String, val urls: List<String>)

  private fun onConsult(run: Run, packet: HuaweiPacket) {
    if (!run.task) {
      log("consult answer without a running request; ignored")
      return
    }
    val tlv = packet.getTlv()
    val body = if (tlv != null && tlv.contains(0x81)) tlv.getObject(0x81) else null
    if (body == null) {
      log("consult answer without a 0x81 container: ${describeTlv(tlv)}")
      sendStatusLater(run, STATE_FAILED, "no parameters in the consult answer")
      return
    }
    val version = body.agpsInt(0x05)?.toInt() ?: -1
    val tag = body.agpsString(0x06).orEmpty()
    val urls = body.allContainerObjects.mapNotNull { child -> if (child.contains(0x03)) child.agpsString(0x03) else null }
    log("consult answer: device time ${body.agpsInt(0x04)}, download version $version, tag ${tag.length} chars, ${urls.size} urls")
    logRaw("consult tag=\"$tag\" urls=$urls")
    run.state = 1
    run.download?.cancel()
    run.download = scope.launch { download(run, Consult(version, tag, urls)) }
  }

  private fun sendStatusLater(run: Run, state: Int, why: String) {
    run.download?.cancel()
    run.download = scope.launch { sendStatus(run, state, why) }
  }

  private suspend fun download(run: Run, consult: Consult) {
    run.state = 2
    val started = System.currentTimeMillis()
    val outcome = try {
      withTimeout(DOWNLOAD_TIMEOUT_MS) { withContext(Dispatchers.IO) { fetch(consult) } }
    } catch (e: CancellationException) {
      if (e is kotlinx.coroutines.TimeoutCancellationException) {
        logError("download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000} s")
        null
      } else {
        throw e
      }
    }
    val files = outcome?.files.orEmpty()
    val state = when {
      files.isNotEmpty() -> STATE_READY
      consult.version !in 0..3 -> STATE_UNSUPPORTED
      else -> STATE_FAILED
    }
    if (files.isNotEmpty()) {
      synchronized(run) { run.ready.putAll(files) }
      log("download finished in ${System.currentTimeMillis() - started} ms: ${files.entries.joinToString { "${it.key} ${it.value.size} bytes" }}")
    }
    sendStatus(run, state, outcome?.notes?.joinToString("; ").orEmpty())
  }

  private suspend fun sendStatus(run: Run, state: Int, why: String) {
    kotlin.coroutines.coroutineContext.ensureActive()
    run.state = state
    if (state != STATE_READY) run.task = false
    log("sending file status $state (${stateName(state)})${if (why.isEmpty()) "" else ": $why"}")
    tx(run, AGPS_SERVICE, 0x03, HuaweiTLV().put(0x01, state.toByte()), "file status $state")
  }

  private fun stateName(state: Int) = when (state) {
    STATE_READY -> "ready"
    STATE_FAILED -> "failed"
    STATE_UNSUPPORTED -> "unsupported"
    else -> "?"
  }

  private class Fetched {
    val files = LinkedHashMap<String, ByteArray>()
    val notes = ArrayList<String>()
  }

  /** Blocking; runs on the IO dispatcher. Never throws for a failed download: that is a note and a missing file. */
  private fun fetch(consult: Consult): Fetched {
    val out = Fetched()
    when (consult.version) {
      0 -> fetchBroadcom(consult, out)
      1, 2 -> fetchConfigured(consult, out)
      3 -> fetchHuawei(consult, out)
      else -> out.notes += "download version ${consult.version} is not known"
    }
    return out
  }

  /** `cache` first, then the network (and then the cache for next time). Throws [AgpsFetchException]. */
  private fun cachedGet(url: String, maxAgeMs: Long, headers: Map<String, String>, label: String, transform: (ByteArray) -> ByteArray = { it }): ByteArray {
    cache.read(url, maxAgeMs)?.let {
      log("$label: from the cache, ${it.size} bytes")
      return it
    }
    val started = System.currentTimeMillis()
    val body = transform(EphemerisNet.get(url, headers))
    if (body.isEmpty()) throw AgpsFetchException("empty response")
    log("$label: downloaded ${body.size} bytes in ${System.currentTimeMillis() - started} ms")
    cache.write(url, body)
    return body
  }

  /** Version 0: Broadcom LTO. The watch names the URL(s); the file is `gpslocation.dat`. */
  private fun fetchBroadcom(consult: Consult, out: Fetched) {
    val urls = consult.urls.ifEmpty { listOf(EphemerisNet.LTO_HOST + EphemerisNet.LTO_PATH) }
    for (original in urls) {
      // Huawei Health rewrites the old Broadcom host to the new one; the same path on the new host is what is served.
      val url = if (original.endsWith(EphemerisNet.LTO_PATH)) EphemerisNet.LTO_HOST + EphemerisNet.LTO_PATH else original
      try {
        out.files[LTO_FILE] = cachedGet(url, LTO_MAX_AGE_MS, mapOf("Charset" to "UTF-8"), "LTO")
        return
      } catch (e: AgpsFetchException) {
        logError("LTO download failed: ${e.message}")
        out.notes += "LTO: ${e.message}"
      }
    }
  }

  /** Version 1 and 2 ("Sony" path): config id -> JSON with a download URL -> the file under its own name. */
  private fun fetchConfigured(consult: Consult, out: Fetched) {
    val ids = consult.tag.split(';').map { it.trim() }.filter { it.isNotEmpty() }.flatMap {
      if (consult.version == 2 && it.equals("RXN_EE", ignoreCase = true)) listOf("rxn_ee_gps", "rxn_ee_gal", "rxn_ee_bds") else listOf(it)
    }
    if (ids.isEmpty()) {
      out.notes += "no config ids in the tag"
      return
    }
    for (id in ids) {
      try {
        val downloadUrl = EphemerisNet.parseConfigDownloadUrl(EphemerisNet.get(EphemerisNet.CONFIG_BASE + id, EphemerisNet.configHeaders()))
          ?: throw AgpsFetchException("config answer for $id has no usable download entry")
        val name = EphemerisNet.lastPathSegment(downloadUrl)
        if (name.isEmpty()) throw AgpsFetchException("download url of $id has no file name")
        out.files[name] = cachedGet(downloadUrl, CONFIG_MAX_AGE_MS, emptyMap(), "config $id")
      } catch (e: AgpsFetchException) {
        logError("config $id failed: ${e.message}")
        out.notes += "$id: ${e.message}"
      }
    }
  }

  /** Version 3: one entry per `;`, `<path>/<TAG>`; only `HW_AGNSS` can be served here. */
  private fun fetchHuawei(consult: Consult, out: Fetched) {
    val entries = consult.tag.split(';').map { it.trim() }.filter { it.isNotEmpty() }
    if (entries.isEmpty()) {
      out.notes += "empty tag list"
      return
    }
    for (entry in entries) {
      when {
        entry.contains("HW_AGNSS") -> fetchAgnss(entry, out)
        entry.contains("HW_PGNSS_PRED") -> decline(out, "HW_PGNSS_PRED", "needs Huawei's native P-GNSS decoder")
        entry.contains("HW_PGNSS_TRANS") -> decline(out, "HW_PGNSS_TRANS", "nothing to download for it")
        entry.contains("HW_RSMC_") -> decline(out, "HW_RSMC", "needs a Huawei account credential")
        entry.contains("HW_PRECSION_ION") -> decline(out, "HW_PRECSION_ION", "needs a Huawei account credential and decoder")
        else -> decline(out, "unknown tag", "not one of the tags Huawei Health handles")
      }
    }
  }

  private fun decline(out: Fetched, tag: String, why: String) {
    log("$tag declined: $why")
    out.notes += "$tag declined"
  }

  private fun fetchAgnss(entry: String, out: Fetched) {
    // gtt.b: everything before the last "/" is the path under the GRS base; the last segment is the tag.
    val path = if (entry.contains('/')) entry.substringBeforeLast('/').trimStart('/') else ""
    if (path.isEmpty()) {
      logError("HW_AGNSS entry has no path")
      out.notes += "HW_AGNSS: entry has no path"
      return
    }
    val url = EphemerisNet.AGNSS_BASE + path
    logRaw("HW_AGNSS url=$url")
    try {
      out.files[AGNSS_FILE] = cachedGet(url, AGNSS_MAX_AGE_MS, EphemerisNet.agnssHeaders(), "HW_AGNSS", EphemerisNet::gunzipIfNeeded)
    } catch (e: AgpsFetchException) {
      logError("HW_AGNSS download failed: ${e.message}")
      out.notes += "HW_AGNSS: ${e.message}"
    }
  }

  // 1C: the watch pulls the files (GB handleFileSendRequest ... handleFileDoneRequest)

  private fun fileNames(run: Run): List<String> = synchronized(run) { run.ready.keys.toList() }

  private suspend fun onFileList(run: Run, packet: HuaweiPacket) {
    val tlv = packet.getTlv()
    val fileType = tlv?.agpsInt(0x02)?.toInt() ?: -1
    val productId = tlv?.agpsString(0x03).orEmpty()
    val names = fileNames(run)
    log("file list request: type $fileType, product \"$productId\"; offering ${names.size} files")
    run.transfer = null
    // GB leaves type 0 (files by product id) unimplemented; there is nothing to match it against here either.
    val content = if (fileType == 1 && names.isNotEmpty()) HuaweiTLV().put(0x01, names.joinToString(";")) else HuaweiTLV().put(0x7F, CODE_FAILED)
    tx(run, FILE_SERVICE, 0x01, content, "file list")
  }

  private suspend fun onFileConsult(run: Run, packet: HuaweiPacket) {
    val tlv = packet.getTlv() ?: return
    val watchCode = tlv.agpsInt(0x7F)
    if (watchCode != null && watchCode != 0L) {
      logError("watch reported error $watchCode in the file consult")
      run.transfer = null
      return
    }
    val protocol = tlv.agpsString(0x01).orEmpty()
    val transferSize = tlv.agpsInt(0x03)?.toInt() ?: 0
    val maxDataSize = tlv.agpsInt(0x04)?.toInt() ?: 0
    val fileType = tlv.agpsInt(0x06)?.toInt() ?: 0
    log("file consult: protocol \"$protocol\", transfer size $transferSize, max data $maxDataSize, type $fileType")
    if (transferSize <= 0 || maxDataSize <= 0 || !((protocol.isNotEmpty() && fileType == 0) || fileType == 1)) {
      run.transfer = null
      tx(run, FILE_SERVICE, 0x02, HuaweiTLV().put(0x7F, CODE_FAILED), "file consult answer (refused)")
      return
    }
    run.transfer = Transfer(transferSize, maxDataSize, fileType)
    tx(run, FILE_SERVICE, 0x02, HuaweiTLV().put(0x7F, CODE_OK), "file consult answer")
  }

  private suspend fun onFileInfo(run: Run, packet: HuaweiPacket) {
    val name = packet.getTlv()?.agpsString(0x01).orEmpty()
    val transfer = run.transfer
    val data = synchronized(run) { run.ready[name] }
    if (transfer == null || transfer.fileType != 1 || data == null) {
      log("file info request for \"$name\" refused (${if (transfer == null) "no consult" else if (data == null) "not available" else "unsupported type"})")
      run.transfer = null
      tx(run, FILE_SERVICE, 0x03, HuaweiTLV().put(0x7F, CODE_FAILED), "file info answer (refused)")
      return
    }
    transfer.name = name
    transfer.data = data
    transfer.frames = 0
    val crc = CheckSums.getCRC16(data, 0x0000)
    log("file info: $name ${data.size} bytes, crc16 %04x".format(crc))
    tx(run, FILE_SERVICE, 0x03, HuaweiTLV().put(0x02, data.size).put(0x03, crc.toShort()), "file info answer")
  }

  private suspend fun onDataRequest(run: Run, packet: HuaweiPacket) {
    val tlv = packet.getTlv() ?: return
    val name = tlv.agpsString(0x01).orEmpty()
    val offset = tlv.agpsInt(0x02)?.toInt() ?: -1
    val wanted = tlv.agpsInt(0x03)?.toInt() ?: -1
    val transfer = run.transfer
    val data = transfer?.data
    if (transfer == null || data == null || name.isEmpty() || name != transfer.name || offset < 0 || offset > data.size) {
      log("data request for \"$name\" at $offset refused")
      run.transfer = null
      tx(run, FILE_SERVICE, 0x04, HuaweiTLV().put(0x7F, CODE_FAILED), "data answer (refused)")
      return
    }
    // The name the watch stores the file under is the SHA-256 of this phone-side address plus the plain name (GB getHexDigest).
    val storedName = EphemerisNet.addressDigest(run.address) + name
    tx(run, FILE_SERVICE, 0x04, HuaweiTLV().put(0x7F, CODE_OK).put(0x02, storedName).put(0x03, offset), "data answer")
    val size = minOf(data.size - offset, transfer.maxDataSize)
    if (size <= 0) return
    val frameSize = minOf(transfer.transferSize, Short.MAX_VALUE.toInt())
    val count = (size + frameSize - 1) / frameSize
    log("sending $name bytes $offset..${offset + size} of ${data.size} (asked for $wanted) in $count frames")
    try {
      run.session.send(
        AgpsChunkPacket(run.session.params, data.copyOfRange(offset, offset + size), frameSize.toShort(), count),
        "AGPS $name chunk",
        logFrames = false,
      )
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      logError("chunk of $name not sent: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  private suspend fun onUploadDone(run: Run, packet: HuaweiPacket) {
    val result = packet.getTlv()?.agpsInt(0x01)
    val transfer = run.transfer
    log("upload done: result $result, file ${transfer?.name}, ${transfer?.frames ?: 0} data acks")
    run.transfer = null
    tx(run, FILE_SERVICE, 0x06, HuaweiTLV().put(0x7F, CODE_OK), "upload done answer")
  }

  private companion object {
    const val AGPS_SERVICE = 0x1F
    const val FILE_SERVICE = 0x1C

    const val CODE_OK = 100000
    const val CODE_FAILED = 100001
    const val CODE_NO_NETWORK = 100007

    const val STATE_READY = 3
    const val STATE_FAILED = 4
    const val STATE_UNSUPPORTED = 5

    const val AGNSS_FILE = "HW_AGNSS_RTCM_33"
    const val LTO_FILE = "gpslocation.dat"

    // Short-lived orbit data is only good for a while; GB refuses anything older than 30 minutes. The LTO file predicts 7 days.
    const val AGNSS_MAX_AGE_MS = 30L * 60 * 1000
    const val LTO_MAX_AGE_MS = 6L * 60 * 60 * 1000
    const val CONFIG_MAX_AGE_MS = 6L * 60 * 60 * 1000

    // Huawei Health drops a request that has not finished after 2 minutes.
    const val DOWNLOAD_TIMEOUT_MS = 120_000L
  }
}
