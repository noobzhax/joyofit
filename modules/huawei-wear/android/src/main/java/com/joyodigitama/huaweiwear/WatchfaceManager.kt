// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiWatchfaceManager
// (requestWatchfaceList, updateWatchfaceNames, setWatchface, deleteWatchface, getFullFileName) and
// requests/{GetWatchfaceParams,GetWatchfacesList,GetWatchfacesNames,SendWatchfaceOperation}.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.net.Uri
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Watchface

/** What the watch reports about watch faces in 0x27/0x01 (GB `WatchfaceDeviceParams`). */
internal class WatchfaceScreen(
  val maxVersion: String,
  val width: Int,
  val height: Int,
  val supportFileType: Int,
  val sort: Int,
  val otherVersions: String,
)

/** One entry of the watch's face list (GB `InstalledWatchfaceInfo`) with the name from 0x27/0x06. */
internal class WatchfaceEntry(
  /** GB `fileName`: the number the watch knows the face by, without the version. */
  val id: String,
  val version: String,
  val name: String,
  val type: Int,
  val expandedType: Int,
) {
  val isCurrent: Boolean get() = (type and 1) == 1
  val isFactory: Boolean get() = ((type shr 1) and 1) == 1
  val isEditable: Boolean get() = ((type shr 3) and 1) == 1
  val isVideo: Boolean get() = ((type shr 4) and 1) == 1
  val isPhoto: Boolean get() = ((type shr 5) and 1) == 1
  val isTryout: Boolean get() = ((type shr 6) and 1) == 1
  val isKaleidoscope: Boolean get() = ((type shr 7) and 1) == 1

  fun toJs(): Map<String, Any?> = mapOf(
    "id" to id,
    "version" to version,
    "name" to name,
    "active" to isCurrent,
    "factory" to isFactory,
    "editable" to isEditable,
    "video" to isVideo,
    "photo" to isPhoto,
    "tryout" to isTryout,
    "kaleidoscope" to isKaleidoscope,
  )
}

/** `WatchfaceList` in `HuaweiWearWatchface.types.ts`. */
internal class WatchfaceList(
  val screen: WatchfaceScreen?,
  val faces: List<WatchfaceEntry>,
  val updatedAtMs: Long,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "width" to screen?.width,
    "height" to screen?.height,
    "maxVersion" to screen?.maxVersion,
    "faces" to faces.map { it.toJs() },
    "updatedAt" to updatedAtMs,
  )
}

/** `WatchfaceInstallResult` in `HuaweiWearWatchface.types.ts`. */
internal class InstallResult(
  val fileName: String,
  val id: String,
  val version: String,
  val name: String,
  val bytes: Int,
  /** Tag 0x02 of the watch's 0x28/0x07 packet (not interpreted by GB). */
  val uploadStatus: Int?,
  /** `reportType` of the watch's 0x27/0x05 confirmation. */
  val confirmReportType: Int?,
  /** The new face is in the watch's list after the upload. */
  val listed: Boolean,
  /** The new face is the active one after the upload. */
  val active: Boolean,
  val message: String,
  val list: WatchfaceList?,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "fileName" to fileName,
    "id" to id,
    "version" to version,
    "name" to name,
    "bytes" to bytes,
    "uploadStatus" to uploadStatus,
    "confirmReportType" to confirmReportType,
    "listed" to listed,
    "active" to active,
    "message" to message,
    "list" to list?.toJs(),
  )
}

/** GB `Watchface.WatchfaceOperation.Request` without its `split("_")[1]`, which throws for a face without a version. */
internal fun watchfaceOperationPacket(params: HuaweiPacket.ParamsProvider, fileName: String, operation: Byte): HuaweiPacket {
  val separator = fileName.indexOf('_')
  val id = if (separator < 0) fileName else fileName.substring(0, separator)
  val version = if (separator < 0) "" else fileName.substring(separator + 1)
  return watchfaceOperationPacket(params, id, version, operation)
}

internal fun watchfaceOperationPacket(params: HuaweiPacket.ParamsProvider, id: String, version: String, operation: Byte): HuaweiPacket =
  HuaweiPacket(params).also {
    it.serviceId = Watchface.id
    it.commandId = Watchface.WatchfaceOperation.id
    it.setTlv(HuaweiTLV().put(0x01, id).put(0x02, version).put(0x03, operation))
  }

/**
 * Watch face list, set active, delete and install over the 0x27 / 0x28 services, on a connected
 * [session]. The callers serialize these with the link's operation lock.
 */
internal class WatchfaceOps(
  private val session: HuaweiSession,
  private val events: WearEvents,
  private val uploadStallMs: Long = FileUploader.STALL_MS,
  private val confirmWaitMs: Long = FileUploader.CONFIRM_WAIT_MS,
  private val queryMs: Long = Timeouts.QUERY_MS,
) {
  private val params get() = session.params

  /** The watch lists its commands and service 0x27 is not among them (an empty list means "not known yet"). */
  private fun watchfaceServiceMissing(): Boolean =
    DeviceCaps.supportedCommands.isNotEmpty() && !DeviceCaps.supportedCommands.containsKey(Watchface.id.toInt())

  private fun requireService() {
    if (watchfaceServiceMissing()) {
      throw WearException(ErrorCodes.UNSUPPORTED, "The watch does not list the watch face service (0x27) in its supported commands")
    }
  }

  /** GB GetWatchfaceParams, gated by `supportsWatchfaceParams` (SupportedCommands 0x27/0x01). Null when not supported or not answered. */
  suspend fun readScreen(): WatchfaceScreen? {
    if (!DeviceCaps.supports(Watchface.id.toInt(), Watchface.WatchfaceParams.id.toInt())) {
      log("WatchfaceParams not requested: the watch does not list 27/01 (GB gate supportsWatchfaceParams)")
      return null
    }
    val response = try {
      session
        .request(Watchface.WatchfaceParams.Request(params), queryMs, "WatchfaceParams")
        .expect<Watchface.WatchfaceParams.Response>("WatchfaceParams")
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      log("WatchfaceParams failed: ${e.message}", error = true)
      return null
    }
    val p = response.params
    log(
      "WatchfaceParams: width=${p.width} height=${p.height} (screen ${p.height}*${p.width}) maxVersion=${p.maxVersion} " +
        "supportFileType=${p.supportFileType.toInt()} sort=${p.sort.toInt()} otherWatchfaceVersions=${p.otherWatchfaceVersions}",
    )
    return WatchfaceScreen(p.maxVersion, p.width, p.height, p.supportFileType.toInt(), p.sort.toInt(), p.otherWatchfaceVersions)
  }

  /** GB requestWatchfaceList + updateWatchfaceNames: 0x27/0x02, then 0x27/0x06 for the names. */
  suspend fun list(): WatchfaceList {
    requireService()
    val screen = readScreen()
    val info = session
      .request(Watchface.DeviceWatchInfo.Request(params), queryMs, "WatchfaceList")
      .expect<Watchface.DeviceWatchInfo.Response>("WatchfaceList")
    val installed = info.watchfaceInfoList ?: emptyList()
    val names: Map<String, String> = if (installed.isEmpty()) {
      emptyMap()
    } else {
      try {
        session
          .request(Watchface.WatchfaceNameInfo.Request(params, installed), queryMs, "WatchfaceNames")
          .expect<Watchface.WatchfaceNameInfo.Response>("WatchfaceNames")
          .watchFaceNames
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
        log("WatchfaceNames failed, listing by id: ${e.message}", error = true)
        emptyMap()
      }
    }
    val faces = installed.map {
      val name = names[it.fileName]?.takeIf { n -> n.isNotBlank() } ?: it.fileName
      WatchfaceEntry(it.fileName, it.version, name, it.type.toInt() and 0xFF, it.expandedType.toInt() and 0xFF)
    }
    for (face in faces) {
      log(
        "WatchfaceList: ${face.id}_${face.version} \"${face.name}\" type=0x${face.type.toString(16)} expanded=0x${face.expandedType.toString(16)}" +
          (if (face.isCurrent) " [active]" else "") + (if (face.isFactory) " [factory]" else ""),
      )
    }
    log("WatchfaceList: ${faces.size} watch face(s)")
    return WatchfaceList(screen, faces, System.currentTimeMillis())
  }

  /** GB `HuaweiWatchfaceManager.setWatchface`, then the list again to check that it took. */
  suspend fun setActive(id: String): WatchfaceList {
    val face = find(list(), id)
    val code = operation(face, Watchface.WatchfaceOperation.operationActive, "active")
    val after = list()
    if (after.faces.firstOrNull { it.id == id }?.isCurrent != true) {
      throw WearException(
        ErrorCodes.UPLOAD_REJECTED,
        "The watch did not make \"${face.name}\" active" + (code?.let { " (it answered $it)" } ?: " (it sent no status)") + ".",
        statusCode = code,
      )
    }
    return after
  }

  /** GB `HuaweiWatchfaceManager.deleteWatchface`, then the list again to check that it is gone. */
  suspend fun delete(id: String): WatchfaceList {
    val face = find(list(), id)
    val code = operation(face, Watchface.WatchfaceOperation.operationDelete, "delete")
    val after = list()
    if (after.faces.any { it.id == id }) {
      throw WearException(
        ErrorCodes.UPLOAD_REJECTED,
        "The watch did not delete \"${face.name}\"" + (code?.let { " (it answered $it)" } ?: " (it sent no status)") + ".",
        statusCode = code,
      )
    }
    return after
  }

  private fun find(list: WatchfaceList, id: String): WatchfaceEntry =
    list.faces.firstOrNull { it.id == id }
      ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "The watch has no watch face with id '$id'")

  /** The status the watch answers with (tag 0x7f), or null when it sends none. */
  private suspend fun operation(face: WatchfaceEntry, operation: Byte, what: String): Int? {
    val label = "WatchfaceOperation $what ${face.id}_${face.version}"
    val answer = session.request(watchfaceOperationPacket(params, face.id, face.version, operation), queryMs, label)
    val code = (answer as? Watchface.WatchfaceOperation.Response)?.code?.takeIf { it >= 0 }
    log("$label: watch answered ${code ?: "without a status"}")
    return code
  }

  /**
   * GB `onInstallApp` for a watch face: validate against the watch's screen, upload as file type 1 with a
   * random `<nine digits>_1.0.0` name, then ask the watch for its list to see whether the face arrived.
   */
  suspend fun install(
    pkg: WatchfacePackage,
    progress: (bytes: Int, total: Int) -> Unit,
    fileName: String = WatchfacePackages.randomName(),
  ): InstallResult {
    requireService()
    val description = pkg.description
    log(
      "Install \"${description.title}\" v${description.version} by ${description.author} (theme ${description.screen}, " +
        "${WatchfaceResolutions.screenByThemeVersion(description.screen)}, ${pkg.binary.size} bytes) as $fileName",
    )
    val screen = readScreen()
    if (screen != null) {
      WatchfacePackages.checkResolution(description, screen.height, screen.width) { log(it) }
    } else {
      log("the watch's screen size is unknown; the package is not checked against it")
    }

    val outcome = FileUploader(session, events, progress, uploadStallMs, confirmWaitMs)
      .upload(UploadFile(fileName, FILE_TYPE_WATCHFACE, pkg.binary))

    val separator = fileName.indexOf('_')
    val id = fileName.substring(0, separator)
    val version = fileName.substring(separator + 1)
    val after = try {
      list()
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      log("the list after the upload could not be read: ${e.message}", error = true)
      null
    }
    val face = after?.faces?.firstOrNull { it.id == id }
    val message = when {
      after == null -> "Uploaded, but the watch did not answer when asked for its watch faces, so the result is unverified."
      face == null -> "The upload finished (watch status ${outcome.resultStatus ?: "none"}) but the watch does not list the new face."
      face.isCurrent -> "Installed and active."
      else -> "Installed."
    }
    log("Install result: $message")
    return InstallResult(
      fileName = fileName,
      id = id,
      version = version,
      name = description.title.ifEmpty { id },
      bytes = pkg.binary.size,
      uploadStatus = outcome.resultStatus,
      confirmReportType = outcome.confirmReportType,
      listed = face != null,
      active = face?.isCurrent == true,
      message = message,
      list = after,
    )
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, null, null, null, "Watchface: $message")
}

/**
 * The watch face part of the module: serializes every operation with the link's operation lock, reads
 * `.hwt` files from the picker's URI and turns progress and outcome into `onUploadProgress` /
 * `onUploadResult` events.
 */
internal class WatchfaceController(
  private val context: Context,
  private val link: WearLink,
  private val events: WearEvents,
) {
  suspend fun list(): Map<String, Any?> = withWatch { ops -> ops.list().toJs() }

  suspend fun setActive(id: String): Map<String, Any?> = withWatch { ops -> ops.setActive(id).toJs() }

  suspend fun delete(id: String): Map<String, Any?> = withWatch { ops -> ops.delete(id).toJs() }

  suspend fun install(uri: String): Map<String, Any?> {
    link.handle() ?: throw notConnected()
    val bytes = withContext(Dispatchers.IO) { readUri(uri) }
    val pkg = WatchfacePackages.parse(bytes)
    val fileName = WatchfacePackages.randomName()
    var lastEmit = 0L
    val progress = { done: Int, total: Int ->
      val now = System.nanoTime() / 1_000_000
      if (done >= total || done == 0 || now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now
        events.uploadProgress(done, total)
      }
    }
    return withWatch { ops ->
      try {
        val result = ops.install(pkg, progress, fileName)
        events.uploadResult(result.listed, result.fileName, result.uploadStatus, result.message)
        result.toJs()
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.uploadResult(false, fileName, e.statusCode, e.message ?: e.errorCode)
        throw e
      }
    }
  }

  private suspend fun <T> withWatch(block: suspend (WatchfaceOps) -> T): T {
    val handle = link.handle() ?: throw notConnected()
    return handle.operationLock.withLock {
      // The link may have dropped while this waited for a sync to end.
      val current = link.handle()
      if (current == null || current.session !== handle.session) throw notConnected()
      block(WatchfaceOps(handle.session, events))
    }
  }

  private fun notConnected() = WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch")

  private fun readUri(uri: String): ByteArray {
    val parsed = Uri.parse(uri)
    try {
      val stream = context.contentResolver.openInputStream(parsed)
        ?: throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not open $uri")
      return stream.use {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16384)
        while (true) {
          val n = it.read(buffer)
          if (n < 0) break
          out.write(buffer, 0, n)
          if (out.size() > WatchfacePackages.MAX_PACKAGE_BYTES) {
            throw WearException(ErrorCodes.INVALID_ARGUMENT, "That file is larger than ${WatchfacePackages.MAX_PACKAGE_BYTES / 1024 / 1024} MiB, too big for a watch face")
          }
        }
        out.toByteArray()
      }
    } catch (e: WearException) {
      throw e
    } catch (e: IOException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "Could not read the file: ${e.message}", e)
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.INVALID_ARGUMENT, "No permission to read the file: ${e.message}", e)
    }
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 200L
  }
}
