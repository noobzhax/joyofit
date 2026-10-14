package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService

/**
 * P2P module `healthmodel` (Healthy Living / Health Clover tasks). Module, watch package and fingerprint are
 * `bxe` (`HL_DeviceManager`) of Huawei Health 17.0.8.300: `getManagerModule()` = `HEALTH_MODEL_MODULE`,
 * `getWearPkgName()` = `com.huawei.health.healthyliving`, `getWearFingerprint()` below. Flow (`bxr`, `HL_PolicyControl`):
 *
 * 1. The watch sends a P2P data packet whose payload is a `HealthModelRequestMessage.Request` with `msgType` 2001;
 *    its body holds the day (`recordDay`), the task ids wanted, `pageSize` and, from `msgVer` 3.0 on, `packageSize`.
 * 2. The phone answers with one or more `HealthModelReportMessage.Report`s (`msgType` 2001, same `msgVer`), each a
 *    P2P data packet to the same package, built by [HealthModelBuilder]. The reply needs no ping first.
 * 3. Unasked, Huawei Health pings the watch app (answer 0xca = 202), waits a second and sends the day again when its
 *    data changed or the watch connected; it only does so once a request has told it `msgVer` / `packageSize`.
 *    [push] does the same.
 *
 * The payload is the bare protobuf (no leading type byte), like the other GB P2P services that carry bytes.
 */
internal class HealthModelService(
  manager: HuaweiP2PManager,
  private val settings: HealthLivingState,
  private val events: WearEvents,
  private val scope: CoroutineScope,
  private val dayLoader: (requestedDay: Int) -> HealthDay,
  private val goals: () -> HealthGoals,
) : HuaweiBaseP2PService(manager) {
  @Volatile
  var pingCode: Int? = null
    private set

  override fun getModule() = MODULE

  override fun getPackage() = PACKAGE

  override fun getFingerprint() = FINGERPRINT

  override fun registered() {
    sendPing { code, _ ->
      pingCode = code
      log("Healthy Living: ping of $PACKAGE answered 0x%02x (0xca = the watch app is there)".format(code and 0xFF))
    }
  }

  override fun unregister() {
    clearPending()
  }

  override fun handleData(data: ByteArray) {
    if (!settings.healthLivingEnabled) {
      log("Healthy Living: request ignored, the feature is switched off in the app")
      return
    }
    log("Healthy Living: request payload ${data.size} bytes: ${data.toHex()}")
    val request = try {
      HealthModelMessages.decodeRequest(data)
    } catch (e: PbException) {
      log("Healthy Living: request is not protobuf: ${e.message}", error = true)
      return
    }
    log("Healthy Living: request msgType=${request.msgType} msgVer=${request.msgVer} body=${request.body.size} bytes")
    if (request.msgType != HealthModelMessages.MSG_TASKS) {
      // bxr.c: "request is null or not 2001 type" is only logged.
      log("Healthy Living: msgType ${request.msgType} is not 2001 (tasks); ignored like Huawei Health")
      return
    }
    val body = try {
      HealthModelMessages.decodeRequestBody(request.body)
    } catch (e: PbException) {
      log("Healthy Living: request body is not protobuf: ${e.message}", error = true)
      return
    }
    // bxr.c: packageSize is only honoured from msgVer 3.0 on.
    val packageSize = if (request.msgVer >= HealthModelMessages.VERSION_PAGING) body.packageSize else 0
    log("Healthy Living: recordDay=${body.recordDay} requestTaskIds='${body.requestTaskIds}' pageSize=${body.pageSize} packageSize=${body.packageSize} (used $packageSize)")
    settings.healthLivingMsgVer = request.msgVer
    settings.healthLivingPackageSize = packageSize
    settings.healthLivingLastRequestMs = System.currentTimeMillis()
    val ids = body.requestTaskIds.split(',').mapNotNull { it.trim().toIntOrNull() }.toSet()
    send(body.recordDay, ids, request.msgVer, packageSize, "request")
  }

  /**
   * Sends today's report unasked, as `bxr.d` does: ping, and on 0xca send after a second. Does nothing until the watch has
   * made a request (msgVer unknown), like Huawei Health.
   */
  fun push(reason: String) {
    val version = settings.healthLivingMsgVer
    if (version <= 0f) {
      log("Healthy Living: not pushing ($reason): the watch has not asked for tasks yet, its msgVer is unknown")
      return
    }
    sendPing { code, _ ->
      pingCode = code
      if ((code and 0xFF) != 0xCA) {
        log("Healthy Living: not pushing ($reason): ping answered 0x%02x, not 0xca".format(code and 0xFF))
        return@sendPing
      }
      scope.launch {
        delay(PUSH_DELAY_MS)
        send(0, emptySet(), version, settings.healthLivingPackageSize, "push: $reason")
      }
    }
  }

  private fun send(requestedDay: Int, ids: Set<Int>, msgVer: Float, packageSize: Int, why: String) {
    val day = dayLoader(requestedDay)
    val body = HealthModelBuilder.build(day, goals(), ids)
    val reports = HealthModelBuilder.reports(body, msgVer, packageSize)
    val summary = "day ${day.recordDay}: ${body.tasks.joinToString(" ") { "#${it.taskId}=${it.taskValue.ifEmpty { "-" }}/${it.taskTarget.ifEmpty { "-" }}${if (it.status > 0) "✓" else ""}" }}" +
      " clover top=${body.clover?.top} left=${body.clover?.left} right=${body.clover?.right}"
    log("Healthy Living: reporting ($why) $summary in ${reports.size} report(s) of ${reports.joinToString("+") { it.size.toString() }} bytes")
    for ((index, report) in reports.withIndex()) {
      sendCommand(report) { code, _ ->
        log("Healthy Living: report ${index + 1}/${reports.size} acknowledged by the watch with 0x%02x (0xcf = received)".format(code and 0xFF))
      }
    }
    settings.healthLivingLastReportMs = System.currentTimeMillis()
    settings.healthLivingLastSummary = summary
  }

  private fun log(message: String, error: Boolean = false) =
    events.log(if (error) LogDirection.ERROR else LogDirection.INFO, 0x34, 0x01, null, message)

  companion object {
    const val MODULE = "hw.unitedevice.healthmodel"
    const val PACKAGE = "com.huawei.health.healthyliving"

    /** `bxe.getWearFingerprint()`. */
    const val FINGERPRINT = "com.huawei.health.healthyliving_BBLV5gbaG5WYtIAUCOwrnqycG0TTHvDSFCf1skDcwpWT+tu2wJ2tOwPYFzjV+ZsiVJrV1nO/KsbJ687t7b9a6Jg="

    /** `bxr.d`: Huawei Health waits one second after the ping before sending. */
    const val PUSH_DELAY_MS = 1000L
  }
}
