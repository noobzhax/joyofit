// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiUploadManager,
// AsynchronousResponse.handleFileUpload / handleWatchface and requests/{SendFileUploadInfo,SendFileUploadHash,
// SendFileUploadAck,SendFileUploadChunk,SendFileUploadComplete,SendWatchfaceConfirm,SendWatchfaceOperation}.
package com.joyodigitama.huaweiwear

import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileUpload
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Watchface

/** The status the watch answers with when it accepts a file (GB `resp.result != 100000`, the 0x7f tags it sends as "ok"). */
internal const val UPLOAD_OK = 100000

/** GB `FileUploadInfo` file types (`FileUpload.Filetype`). */
internal const val FILE_TYPE_WATCHFACE: Byte = FileUpload.Filetype.watchface

/** What GB's `UploadDataBuffer` holds: the bytes to send and their SHA-256, which the watch asks for. */
internal class UploadFile(val fileName: String, val fileType: Byte, val data: ByteArray) {
  val sha256: ByteArray by lazy { MessageDigest.getInstance("SHA-256").digest(data) }
}

/** What the watch reported once the upload ran through. */
internal class UploadOutcome(
  val fileId: Int,
  /** Tag 0x02 of the watch's 0x28/0x07 "result" packet; GB ignores it. Null when the packet had none. */
  val resultStatus: Int?,
  /** `reportType` of the watch's 0x27/0x05 watch face confirmation; null when none arrived in time. */
  val confirmReportType: Int?,
  /** The watch asked for the new face to be made active (reportType 2) and we sent the command. */
  val activateRequested: Boolean,
)

/**
 * The 0x28 chunk packet. GB's `FileNextChunkSend.serialize()` is never used: the chunk is cut into
 * `unitSize` packets by [HuaweiPacket.serializeFileChunk], optionally encrypted like the TLVs.
 */
private class ChunkPacket(
  params: HuaweiPacket.ParamsProvider,
  private val chunk: ByteArray,
  private val position: Int,
  private val unitSize: Int,
  private val fileId: Byte,
  private val encrypted: Boolean,
) : FileUpload.FileNextChunkSend(params) {
  override fun serialize(): List<ByteArray> = serializeFileChunk(chunk, position, unitSize, fileId, encrypted)
}

/**
 * Port of GB's file upload state machine, where the watch drives and the phone answers. GB handles
 * these in `AsynchronousResponse` (every packet is "unrequested"), we collect them through
 * [HuaweiSession.subscribe] and answer in order:
 *
 * ```
 * phone 28/02 FileInfoSend(name, size, type)        watch 28/02 result (100000 = ok)
 * watch 28/03 file id                               phone 28/03 FileHashSend(id, SHA-256)
 * watch 28/04 params (unit, max apply, no_encrypt)  phone 28/04 ack
 * watch 28/05 (bytesUploaded, nextChunkSize)        phone 28/06 chunk, in unit-size packets   (repeats)
 * watch 28/07 result                                phone 28/07 result ack
 * watch 27/05 watch face confirm (reportType)       phone 27/05 confirm, and 27/03 "active" when reportType is 2
 * ```
 *
 * A 28/08 from the watch is its error report. Every watch message must arrive within [stallMs] of
 * the previous one. Failures throw [WearException]: ERR_UPLOAD_REJECTED with the exact code the
 * watch returned, ERR_TIMEOUT, ERR_PROTOCOL or ERR_DISCONNECTED.
 */
internal class FileUploader(
  private val session: HuaweiSession,
  private val events: WearEvents,
  private val onProgress: (bytes: Int, total: Int) -> Unit = { _, _ -> },
  private val stallMs: Long = STALL_MS,
  private val confirmWaitMs: Long = CONFIRM_WAIT_MS,
) {
  private val params get() = session.params

  private class UploadState(val file: UploadFile) {
    var fileId: Byte? = null
    var unitSize = 0
    var maxApplyData = 0
    var noEncrypt: Byte = 0
    var chunks = 0
    var started = false
    var resultStatus: Int? = null
    var resultSent = false
    var confirmReportType: Int? = null
    var activateRequested = false
  }

  suspend fun upload(file: UploadFile): UploadOutcome {
    val state = UploadState(file)
    val incoming = Channel<HuaweiPacket>(Channel.UNLIMITED)
    val subscriptions = listOf(
      FileUpload.FileInfoSend.id,
      FileUpload.FileHashSend.id,
      FileUpload.FileUploadConsultAck.id,
      FileUpload.FileNextChunkParams.id,
      FileUpload.FileUploadResult.id,
      FileUpload.FileUploadDeviceResponse.id,
    ).map { command ->
      session.subscribe(FileUpload.id, command, "file upload ${file.fileName}") { incoming.trySend(it) }
    } + session.subscribe(Watchface.id, Watchface.WatchfaceConfirm.id, "watch face confirm ${file.fileName}") { incoming.trySend(it) }

    try {
      log("start ${file.fileName}: type=${file.fileType.toInt()} size=${file.data.size} sha256=${file.sha256.toHex()}")
      onProgress(0, file.data.size)
      if (!DeviceCaps.supports(FileUpload.id.toInt(), FileUpload.FileInfoSend.id.toInt())) {
        // The Fit 4 does not list service 0x28 in SupportedServices, but GB sends the upload without checking.
        log("the watch did not list FileUpload (28/02) as supported; trying anyway, like GB")
      }
      session.send(
        FileUpload.FileInfoSend.Request(params, file.data.size, file.fileName, file.fileType, null, null, null, null),
        "FileUpload FileInfoSend ${file.fileName}",
      )

      while (!state.resultSent) {
        val packet = next(incoming, stallMs) ?: throw stalled(state)
        handle(state, packet)
      }

      if (file.fileType == FILE_TYPE_WATCHFACE && state.confirmReportType == null) {
        waitForConfirm(state, incoming)
      }
      onProgress(file.data.size, file.data.size)
      log("complete ${file.fileName}: ${state.chunks} chunk requests, result status=${state.resultStatus ?: "none"}, confirm reportType=${state.confirmReportType ?: "none"}")
      return UploadOutcome(
        fileId = (state.fileId ?: 0).toInt() and 0xFF,
        resultStatus = state.resultStatus,
        confirmReportType = state.confirmReportType,
        activateRequested = state.activateRequested,
      )
    } finally {
      for (s in subscriptions) s.close()
      incoming.close()
    }
  }

  /** One watch message, in GB `handleFileUpload` / `handleWatchface` order of concerns. */
  private suspend fun handle(state: UploadState, packet: HuaweiPacket) {
    val service = packet.serviceId
    val command = packet.commandId
    if (service == Watchface.id) {
      handleConfirm(state, packet)
      return
    }
    when (command) {
      FileUpload.FileInfoSend.id -> {
        val response = parsed<FileUpload.FileInfoSend.Response>(packet, "FileInfoSend")
        log("FileInfoSend: watch answered ${response.result}")
        if (response.result != UPLOAD_OK) throw rejected("file info", response.result)
      }
      FileUpload.FileHashSend.id -> {
        val response = parsed<FileUpload.FileHashSend.Response>(packet, "FileHashSend")
        state.fileId = response.fileId
        log("FileHashSend: watch assigned file id ${response.fileId.toInt() and 0xFF}, sending SHA-256")
        session.send(FileUpload.FileHashSend.Request(params, state.file.sha256, response.fileId), "FileUpload hash")
      }
      FileUpload.FileUploadConsultAck.id -> {
        val response = parsed<FileUpload.FileUploadConsultAck.Response>(packet, "FileUploadConsultAck")
        val p = response.fileUploadParams
        log(
          "FileUploadConsultAck: fileId=${p.file_id.toInt() and 0xFF} protocol=${p.protocolVersion} appWaitTime=${p.app_wait_time} " +
            "bitmapEnable=${p.bitmap_enable} unitSize=${p.unit_size} maxApplyDataSize=${p.max_apply_data_size} " +
            "interval=${p.interval} receivedFileSize=${p.received_file_size} noEncrypt=${p.no_encrypt.toInt()}",
        )
        if (p.unit_size <= 0) throw protocol("the watch reported an unusable unit size ${p.unit_size}")
        state.unitSize = p.unit_size
        state.maxApplyData = p.max_apply_data_size
        state.noEncrypt = p.no_encrypt
        state.started = true
        val fileId = state.fileId ?: p.file_id.also { state.fileId = it }
        session.send(FileUpload.FileUploadConsultAck.Request(params, p.no_encrypt, fileId), "FileUpload ack")
      }
      FileUpload.FileNextChunkParams.id -> sendChunk(state, parsed<FileUpload.FileNextChunkParams>(packet, "FileNextChunkParams"))
      FileUpload.FileUploadResult.id -> {
        val fileId = state.fileId
          ?: throw protocol("the watch reported a result before it assigned a file id")
        val status = try {
          packet.parseTlv()
          (packet as? FileUpload.FileUploadResult.Response)?.status?.toInt()
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          log("FileUploadResult: status not readable (${e.message}); GB ignores it")
          null
        }
        state.resultStatus = status
        log("FileUploadResult: watch status=${status ?: "unreadable"}; sending the result ack (GB does not look at the status)")
        state.resultSent = true
        session.send(FileUpload.FileUploadResult.Request(params, fileId), "FileUpload result ack")
      }
      FileUpload.FileUploadDeviceResponse.id -> {
        val response = parsed<FileUpload.FileUploadDeviceResponse.Response>(packet, "FileUploadDeviceResponse")
        val current = state.fileId
        log("FileUploadDeviceResponse: fileId=${response.fileId.toInt() and 0xFF} code=${response.code}")
        // GB: only an error report for the current upload ends it.
        if (current == null || current == response.fileId) throw rejected("device response", response.code)
        log("FileUploadDeviceResponse is for another file id; ignored")
      }
      else -> log("ignored 28/${command.toInt().and(0xFF).toString(16)}")
    }
  }

  /** GB `FileNextChunkParams` -> `SendFileUploadChunk`. */
  private suspend fun sendChunk(state: UploadState, request: FileUpload.FileNextChunkParams) {
    val total = state.file.data.size
    val position = request.bytesUploaded
    val wanted = request.nextchunkSize
    val fileId = state.fileId ?: throw protocol("the watch asked for data before it assigned a file id")
    if (!state.started) throw protocol("the watch asked for data before the unit size was agreed")
    if (position < 0 || position > total) throw protocol("the watch asked for data at $position of a $total byte file")
    if (wanted < 0) throw protocol("the watch asked for $wanted bytes")
    val size = minOf(wanted, total - position)
    state.chunks++
    onProgress(position, total)
    log("FileNextChunkParams: bytesUploaded=$position nextChunkSize=$wanted (${percent(position, total)}%)")
    if (size < wanted) log("the watch asked for $wanted bytes at $position but only $size are left; sending $size")
    if (state.maxApplyData > 0 && wanted > state.maxApplyData) {
      log("the watch asked for $wanted bytes, more than its own maxApplyDataSize ${state.maxApplyData}; sending what it asked for, like GB")
    }
    if (size == 0) return
    val encrypted = state.noEncrypt.toInt() == 0 && params.areTransactionsCrypted()
    val chunk = state.file.data.copyOfRange(position, position + size)
    session.send(
      ChunkPacket(params, chunk, position, state.unitSize, fileId, encrypted),
      "FileUpload chunk offset=$position size=$size unit=${state.unitSize}${if (encrypted) " encrypted" else ""}",
      logFrames = false,
    )
  }

  /** GB `handleWatchface`: answer the confirm; reportType 2 means "make the uploaded face active". */
  private suspend fun handleConfirm(state: UploadState, packet: HuaweiPacket) {
    val response = parsed<Watchface.WatchfaceConfirm.Response>(packet, "WatchfaceConfirm")
    state.confirmReportType = response.reportType
    log("WatchfaceConfirm: ${response.fileName} reportType=${response.reportType}")
    session.send(Watchface.WatchfaceConfirm.Request(params, response.fileName), "WatchfaceConfirm ${response.fileName}")
    if (response.reportType == 0x02) {
      state.activateRequested = true
      try {
        val answer = session.request(
          watchfaceOperationPacket(params, response.fileName, Watchface.WatchfaceOperation.operationActive),
          Timeouts.QUERY_MS,
          "WatchfaceOperation active ${response.fileName}",
        )
        val code = (answer as? Watchface.WatchfaceOperation.Response)?.code?.takeIf { it >= 0 }
        log("WatchfaceOperation active ${response.fileName}: watch answered ${code ?: "no status"}")
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        if (e.errorCode != ErrorCodes.TIMEOUT) throw e
        log("WatchfaceOperation active ${response.fileName}: no answer from the watch")
      }
    }
  }

  /** The watch confirms a finished face with 27/05 shortly after 28/07; its absence is only logged. */
  private suspend fun waitForConfirm(state: UploadState, incoming: Channel<HuaweiPacket>) {
    var waited = 0L
    while (state.confirmReportType == null && waited < confirmWaitMs) {
      val started = System.nanoTime()
      val packet = next(incoming, confirmWaitMs - waited)
      if (packet == null) {
        log("no WatchfaceConfirm from the watch within ${confirmWaitMs}ms")
        return
      }
      handle(state, packet)
      waited += (System.nanoTime() - started) / 1_000_000
    }
  }

  /** The next watch message, or null after [limitMs] without one. A closed session fails at once. */
  private suspend fun next(incoming: Channel<HuaweiPacket>, limitMs: Long): HuaweiPacket? {
    var waited = 0L
    while (waited < limitMs) {
      session.closeCause?.let { throw it }
      val slice = minOf(POLL_MS, limitMs - waited)
      val packet = withTimeoutOrNull(slice) { incoming.receive() }
      if (packet != null) return packet
      waited += slice
    }
    session.closeCause?.let { throw it }
    return null
  }

  private fun stalled(state: UploadState): WearException {
    val stage = when {
      state.fileId == null && !state.started -> "waiting for the watch to accept the file"
      !state.started -> "waiting for the watch to start the transfer"
      else -> "waiting for the watch to ask for data (${state.chunks} chunk requests so far)"
    }
    return WearException(ErrorCodes.TIMEOUT, "File upload ${state.file.fileName}: the watch sent nothing for ${stallMs / 1000} s while $stage")
  }

  private fun rejected(stage: String, code: Int): WearException {
    log("rejected by the watch at $stage: status code $code", error = true)
    return WearException(ErrorCodes.UPLOAD_REJECTED, describeUploadCode(code, stage), statusCode = code)
  }

  private fun protocol(message: String) = WearException(ErrorCodes.PROTOCOL, "File upload: $message")

  /** Type-checks first (GB ResponseTypeMismatchException), then parses the TLV (GB handleResponse). */
  private inline fun <reified T : HuaweiPacket> parsed(packet: HuaweiPacket, what: String): T {
    val typed = packet.expect<T>(what)
    try {
      typed.parseTlv()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      throw protocol("$what could not be parsed: ${e.message}")
    }
    return typed
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, null, null, null, "Upload: $message")

  companion object {
    /** How long the watch may stay silent between two of its messages. */
    const val STALL_MS = 60_000L

    /** How long to wait for the 27/05 confirmation after the transfer finished. */
    const val CONFIRM_WAIT_MS = 10_000L

    private const val POLL_MS = 500L

    private fun percent(done: Int, total: Int) = if (total <= 0) 100 else (done.toLong() * 100 / total).toInt()

    /**
     * GB's `onError` maps three codes to toasts (140004 too many faces or musics, 140008 file exists, 140009 no
     * space); every other code is reported as it came, because what the watch means by it is not documented.
     */
    fun describeUploadCode(code: Int, stage: String): String = when (code) {
      140004 -> "The watch has too many watch faces installed (code 140004). Delete one and try again."
      140008 -> "The watch already has this file (code 140008)."
      140009 -> "The watch does not have enough free space (code 140009)."
      else -> "The watch rejected the file at the $stage step with code $code. This is the status it returned; its meaning is not documented."
    }
  }
}
