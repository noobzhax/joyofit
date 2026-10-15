// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiFileDownloadManager and
// service/devices/huawei/requests/{GetFileDownloadInit,GetFileParameters,GetFileInfo,GetFileBlock,GetFileDownloadComplete}Request
// (RRI file: FileRequest.rriFileRequest, getDownloadParameters file type 0x04).
package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileDownloadService0A
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileDownloadService2C

/** The file kinds GB's download manager is asked for by the sleep sync (HuaweiFileDownloadManager.FileType). */
internal enum class DownloadFileType(val service2c: FileDownloadService2C.FileType) {
  SLEEP_STATE(FileDownloadService2C.FileType.SLEEP_STATE),
  SLEEP_DATA(FileDownloadService2C.FileType.SLEEP_DATA),
  SEQUENCE_DATA(FileDownloadService2C.FileType.SEQUENCE_DATA),
  RRI(FileDownloadService2C.FileType.RRI),
  GPS(FileDownloadService2C.FileType.GPS),
}

/** GB HuaweiFileDownloadManager.FileRequest for files the phone asks for. */
internal class FileRequest private constructor(
  val filename: String,
  val type: DownloadFileType,
  /** True: service 0x2C. False: the older service 0x0A. */
  val newSync: Boolean,
  val startTime: Int,
  val endTime: Int,
  val dictId: Int,
  /** GPS files only: the watch's workout number (GB `FileRequest.workoutId`). */
  val workoutId: Short = 0,
) {
  override fun toString(): String =
    "$filename (${type.name}, ${if (newSync) "service 2C" else "service 0A"}, start=$startTime end=$endTime" +
      (if (dictId > 0) " dict=$dictId" else "") + ")"

  companion object {
    fun sleepState(newSync: Boolean, start: Int, end: Int) =
      FileRequest("sleep_state.bin", DownloadFileType.SLEEP_STATE, newSync, start, end, 0)

    fun sleepData(newSync: Boolean, start: Int, end: Int) =
      FileRequest("sleep_data.bin", DownloadFileType.SLEEP_DATA, newSync, start, end, 0)

    fun sequenceData(start: Int, end: Int, dictId: Int) =
      FileRequest("sequence_data", DownloadFileType.SEQUENCE_DATA, true, start, end, dictId)

    /** GB `FileRequest.rriFileRequest`: `rrisqi_data.bin`, service 0x2C when SettingRelated said `rriNewSync`, else 0x0A. */
    fun rri(newSync: Boolean, start: Int, end: Int) =
      FileRequest("rrisqi_data.bin", DownloadFileType.RRI, newSync, start, end, 0)

    /**
     * GB `FileRequest.workoutGpsFileRequest`: new sync asks for `<n>_gps.bin` over service 0x2C (start/end
     * 0); old sync has no name yet, the 0x0A init answers with the list of the workout's files.
     */
    fun workoutGps(newSync: Boolean, workoutId: Short) =
      FileRequest(if (newSync) "${workoutId.toInt()}_gps.bin" else "", DownloadFileType.GPS, newSync, 0, 0, 0, workoutId)
  }
}

/**
 * Port of HuaweiFileDownloadManager for downloads the phone starts (no incoming P2P files, no
 * SHA-256 verification: GB only verifies device-initiated files). Instead of GB's callback state
 * machine each [download] is a suspend call; the 0x05 data packets the watch pushes after a block
 * request reach it through [HuaweiSession.subscribe] (GB's FileDataReceiver). Failures throw
 * [WearException] (ERR_TIMEOUT, ERR_PROTOCOL for GB's HuaweiFileDownload*Exception cases,
 * ERR_DISCONNECTED). Downloads must not overlap, like GB's `isBusy` queue.
 */
internal class FileDownloader(
  private val session: HuaweiSession,
  private val events: WearEvents,
) {
  private val params get() = session.params

  /**
   * Old sync only. GB's shortcut: after the first init the following requests whose name is in the
   * returned list skip init and parameters and reuse `filenames`, `maxBlockSize` and `timeout`.
   */
  private class OldSyncContext(val filenames: List<String>, val maxBlockSize: Int, val timeoutSec: Int)

  private var oldSync: OldSyncContext? = null

  suspend fun download(request: FileRequest): ByteArray {
    log("Download ${request}: start")
    val data = if (request.newSync) downloadNewSync(request) else downloadOldSync(request)
    log("Download ${request.filename}: complete, ${data.size} bytes")
    return data
  }

  // Service 0x2C: FileDownloadInit -> (FileRequestHash only for incoming files) -> FileInfo -> blocks -> complete.

  private suspend fun downloadNewSync(request: FileRequest): ByteArray {
    val name = request.filename
    val expectedType = request.type.service2c
    val init = session
      .request(
        FileDownloadService2C.FileDownloadInit.Request(
          params,
          name,
          expectedType,
          request.startTime,
          request.endTime,
          request.dictId,
        ),
        REQUEST_MS,
        "FileDownloadInit $name",
      )
      .expect<FileDownloadService2C.FileDownloadInit.Response>("FileDownloadInit $name")
    log("FileDownloadInit $name: fileName=${init.fileName} type=${init.fileType} fileId=${init.fileId.toInt() and 0xFF} size=${init.fileSize}")

    // GB HuaweiFileDownloadFileMismatchException: the answer must be for the file we asked for.
    if (request.filename != init.fileName) {
      throw protocol("$name: data for wrong file received. Expected name $name, got name ${init.fileName}")
    }
    if (expectedType != init.fileType) {
      throw protocol("$name: data for wrong file received. Expected type $expectedType, got type ${init.fileType}")
    }
    val fileId = init.fileId
    val fileSize = init.fileSize
    if (fileSize < 0) {
      // GB: the watch reports 0xFFFFFFFF (with an error status TLV) for a sequence_data file it has no data for.
      throw protocol("$name: invalid file size reported by device: $fileSize")
    }
    if (fileSize == 0) {
      completeNewSync(fileId, name)
      return ByteArray(0)
    }
    checkSize(name, fileSize)

    val info = session
      .request(FileDownloadService2C.FileInfo.Request(params, fileId), REQUEST_MS, "FileInfo $name")
      .expect<FileDownloadService2C.FileInfo.Response>("FileInfo $name")
    log(
      "FileInfo $name: fileId=${info.fileId.toInt() and 0xFF} timeout=${info.timeout.toInt() and 0xFF} " +
        "burstSize=${info.burstSize} maxBlockSize=${info.maxBlockSize} noEncrypt=${info.noEncrypt}",
    )
    if (info.fileId != fileId) {
      throw protocol("$name: data for wrong file received. Expected id ${fileId.toInt() and 0xFF}, got id ${info.fileId.toInt() and 0xFF}")
    }

    val data = receiveBlocks(
      service = FileDownloadService2C.id.toByte(),
      name = name,
      fileSize = fileSize,
      maxBlockSize = info.maxBlockSize,
      timeoutSec = info.timeout.toInt() and 0xFF,
      requestBlock = { offset, size ->
        FileDownloadService2C.RequestBlock(params, fileId, offset, size, info.noEncrypt, request.dictId)
      },
      accept = { packet, position ->
        val block = packet.expect<FileDownloadService2C.BlockResponse>("file data $name")
        // GB: for new sync the file id must match.
        if (block.fileId != fileId) {
          throw protocol("$name: data for wrong file received. Expected id ${fileId.toInt() and 0xFF}, got id ${block.fileId.toInt() and 0xFF}")
        }
        if (block.offset != position) {
          log("$name: block offset ${block.offset} does not match received bytes $position (GB does not check)")
        }
        block.data
      },
    )
    completeNewSync(fileId, name)
    return data
  }

  private suspend fun completeNewSync(fileId: Byte, name: String) {
    // GetFileDownloadCompleteRequest: status 1 = ok (GB only sends 2 when SHA-256 verification fails).
    session.send(FileDownloadService2C.FileDownloadCompleteRequest(params, fileId, 1.toByte()), "FileDownloadComplete $name")
  }

  // Service 0x0A: FileDownloadInit (sleep files) -> FileParameters -> FileInfo -> blocks -> complete.

  private suspend fun downloadOldSync(request: FileRequest): ByteArray {
    var name = request.filename
    val context: OldSyncContext = when (request.type) {
      DownloadFileType.SLEEP_STATE -> {
        val init = session
          .request(
            FileDownloadService0A.FileDownloadInit.SleepFilesRequest(params, request.startTime, request.endTime),
            REQUEST_MS,
            "FileDownloadInit $name (old sync)",
          )
          .expect<FileDownloadService0A.FileDownloadInit.Response>("FileDownloadInit $name")
        val names = init.fileNames.toList()
        log("FileDownloadInit $name (old sync): files=${names.joinToString(";")}")
        if (name !in names) {
          throw protocol("$name: file $name cannot be downloaded using this method. Only the following files are supported: $names")
        }
        // GetFileParametersRequest: fileType 0x01 = sleep files.
        val parameters = session
          .request(FileDownloadService0A.FileParameters.Request(params, 0x01.toByte()), REQUEST_MS, "FileParameters $name")
          .expect<FileDownloadService0A.FileParameters.Response>("FileParameters $name")
        log(
          "FileParameters $name: version=${parameters.version} packetSize=${parameters.packetSize} " +
            "maxBlockSize=${parameters.maxBlockSize} timeout=${parameters.timeout}",
        )
        OldSyncContext(names, parameters.maxBlockSize.toInt(), parameters.timeout.toInt()).also { oldSync = it }
      }
      // GB: SLEEP_DATA has no init of its own on the old service; it only ever rides on the file
      // list of the SLEEP_STATE request that ran before it.
      DownloadFileType.SLEEP_DATA -> {
        val shared = oldSync ?: throw protocol("$name: no file list from a preceding sleep_state init (old sync)")
        if (name !in shared.filenames) {
          throw protocol("$name: file $name cannot be downloaded using this method. Only the following files are supported: ${shared.filenames}")
        }
        log("FileDownloadInit $name (old sync): reusing file list ${shared.filenames.joinToString(";")}")
        shared
      }
      // GB HuaweiFileDownloadManager (old sync, GPS): the init answers with the workout's file list, only the
      // `_gps.bin` file is downloaded; parameters are fetched with fileType 0x02.
      DownloadFileType.GPS -> {
        val label = "workout ${request.workoutId.toInt()} GPS (old sync)"
        val init = session
          .request(
            FileDownloadService0A.FileDownloadInit.GpsFileRequest(params, request.workoutId),
            REQUEST_MS,
            "FileDownloadInit $label",
          )
          .expect<FileDownloadService0A.FileDownloadInit.Response>("FileDownloadInit $label")
        val names = init.fileNames.toList()
        log("FileDownloadInit $label: files=${names.joinToString(";")}")
        val gpsNames = names.filter { "_gps.bin" in it }
        if (gpsNames.isEmpty()) throw protocol("$label: no _gps.bin file in $names")
        if (gpsNames.size > 1) log("$label: ${gpsNames.size} GPS files, downloading the first only")
        name = gpsNames.first()
        val parameters = session
          .request(FileDownloadService0A.FileParameters.Request(params, 0x02.toByte()), REQUEST_MS, "FileParameters $name")
          .expect<FileDownloadService0A.FileParameters.Response>("FileParameters $name")
        log(
          "FileParameters $name: version=${parameters.version} packetSize=${parameters.packetSize} " +
            "maxBlockSize=${parameters.maxBlockSize} timeout=${parameters.timeout}",
        )
        OldSyncContext(names, parameters.maxBlockSize.toInt(), parameters.timeout.toInt())
      }
      // GB getDownloadParameters: RRI parameters use fileType 0x04. The init answers with the file list
      // (GetFileDownloadInitRequest builds FileDownloadInit.RriFileRequest for RRI) and must contain the name.
      DownloadFileType.RRI -> {
        val init = session
          .request(
            FileDownloadService0A.FileDownloadInit.RriFileRequest(params, request.startTime, request.endTime),
            REQUEST_MS,
            "FileDownloadInit $name (old sync)",
          )
          .expect<FileDownloadService0A.FileDownloadInit.Response>("FileDownloadInit $name")
        val names = init.fileNames.toList()
        log("FileDownloadInit $name (old sync): files=${names.joinToString(";")}")
        if (name !in names) {
          throw protocol("$name: file $name cannot be downloaded using this method. Only the following files are supported: $names")
        }
        val parameters = session
          .request(FileDownloadService0A.FileParameters.Request(params, 0x04.toByte()), REQUEST_MS, "FileParameters $name")
          .expect<FileDownloadService0A.FileParameters.Response>("FileParameters $name")
        log(
          "FileParameters $name: version=${parameters.version} packetSize=${parameters.packetSize} " +
            "maxBlockSize=${parameters.maxBlockSize} timeout=${parameters.timeout}",
        )
        OldSyncContext(names, parameters.maxBlockSize.toInt(), parameters.timeout.toInt())
      }
      DownloadFileType.SEQUENCE_DATA -> throw protocol("$name: unknown download type for old sync")
    }

    val info = session
      .request(FileDownloadService0A.FileInfo.Request(params, name), REQUEST_MS, "FileInfo $name (old sync)")
      .expect<FileDownloadService0A.FileInfo.Response>("FileInfo $name")
    log("FileInfo $name (old sync): fileLength=${info.fileLength} transferType=${info.transferType} createTime=${info.fileCreateTime}")
    val fileSize = info.fileLength
    if (fileSize < 0) throw protocol("$name: invalid file size reported by device: $fileSize")
    if (fileSize == 0) {
      completeOldSync(name)
      return ByteArray(0)
    }
    checkSize(name, fileSize)

    var lastPacketNumber = -1
    val data = receiveBlocks(
      service = FileDownloadService0A.id.toByte(),
      name = name,
      fileSize = fileSize,
      maxBlockSize = context.maxBlockSize,
      timeoutSec = context.timeoutSec,
      newBlock = { lastPacketNumber = -1 },
      requestBlock = { offset, size -> FileDownloadService0A.RequestBlock.Request(params, name, offset, size) },
      accept = { packet, _ ->
        val block = packet.expect<FileDownloadService0A.BlockResponse>("file data $name")
        val decodeError = block.e
        if (decodeError is HuaweiPacket.CryptoException) {
          log("$name: data could be decoded as TLV, but not decrypted (${decodeError.message})")
        }
        // GB compares the byte counter with `number - 1`; compared modulo 256 here so a block of
        // more than 127 packets cannot trip over the signed byte.
        val number = block.number.toInt() and 0xFF
        if (((lastPacketNumber + 1) and 0xFF) != number) {
          throw protocol("$name: data for wrong file received. Expected packet number ${(lastPacketNumber + 1) and 0xFF}, got $number")
        }
        lastPacketNumber = number
        block.data
      },
    )
    completeOldSync(name)
    return data
  }

  private suspend fun completeOldSync(name: String) {
    session.send(FileDownloadService0A.FileDownloadCompleteRequest(params), "FileDownloadComplete $name (old sync)")
  }

  /**
   * GB downloadNextFileBlock + handleFileData: asks for `min(remaining, maxBlockSize)` bytes, then
   * collects the 0x05 packets the watch pushes until the block (or the file) is complete. Every
   * packet restarts the watch-given timeout, like GB's handler.postDelayed in FileDataReceiver.
   */
  private suspend fun receiveBlocks(
    service: Byte,
    name: String,
    fileSize: Int,
    maxBlockSize: Int,
    timeoutSec: Int,
    newBlock: () -> Unit = {},
    requestBlock: (offset: Int, size: Int) -> HuaweiPacket,
    accept: (packet: HuaweiPacket, position: Int) -> ByteArray,
  ): ByteArray {
    if (maxBlockSize <= 0) throw protocol("$name: device reported max block size $maxBlockSize")
    val timeoutMs = (if (timeoutSec > 0) timeoutSec else DEFAULT_BLOCK_TIMEOUT_SEC) * 1000L
    val buffer = ByteBuffer.allocate(fileSize)
    val incoming = Channel<HuaweiPacket>(Channel.UNLIMITED)
    val subscription = session.subscribe(service, BLOCK_RESPONSE_COMMAND, "file data $name") { incoming.trySend(it) }
    try {
      while (buffer.position() < fileSize) {
        val blockStart = buffer.position()
        val blockSize = minOf(fileSize - blockStart, maxBlockSize)
        newBlock()
        session.send(requestBlock(blockStart, blockSize), "FileBlock $name offset=$blockStart size=$blockSize")

        while (buffer.position() < fileSize && buffer.position() - blockStart < maxBlockSize) {
          val packet = withTimeoutOrNull(timeoutMs) { incoming.receive() }
            ?: throw WearException(
              ErrorCodes.TIMEOUT,
              "$name: timeout was hit! no file data within ${timeoutMs}ms at ${buffer.position()}/$fileSize bytes",
            )
          try {
            packet.parseTlv()
          } catch (e: CancellationException) {
            throw e
          } catch (e: Exception) {
            throw WearException(ErrorCodes.PROTOCOL, "$name: failed to parse file data: ${e.message}", e)
          }
          val chunk = accept(packet, buffer.position())
          if (chunk.size > buffer.remaining()) {
            // GB would die on a BufferOverflowException here.
            throw protocol("$name: downloaded file is larger than expected (${buffer.position() + chunk.size} > $fileSize)")
          }
          buffer.put(chunk)
        }
        log("$name: ${buffer.position()}/$fileSize bytes")
      }
    } finally {
      subscription.close()
      incoming.close()
    }
    return buffer.array()
  }

  private fun checkSize(name: String, fileSize: Int) {
    if (fileSize > MAX_FILE_SIZE) throw protocol("$name: device reported an implausible file size $fileSize")
  }

  private fun protocol(message: String) = WearException(ErrorCodes.PROTOCOL, message)

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private companion object {
    const val REQUEST_MS = 10_000L

    /** Both file download services answer block requests with command 0x05. */
    const val BLOCK_RESPONSE_COMMAND: Byte = 0x05

    /** Used when the watch reports a block timeout of 0. */
    const val DEFAULT_BLOCK_TIMEOUT_SEC = 10

    /** GB parses sequence files up to 20 MiB ("To avoid of downloading of very big file and OOM"). */
    const val MAX_FILE_SIZE = 32 * 1024 * 1024
  }
}
