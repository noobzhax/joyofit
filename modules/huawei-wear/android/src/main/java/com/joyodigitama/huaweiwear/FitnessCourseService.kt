package com.joyodigitama.huaweiwear

import kotlinx.coroutines.CompletableDeferred
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg

/**
 * P2P module `fitness` (`dfv.getWearPkgName()` = `in.huawei.fitness`, fingerprint `SystemApp`; GB's `HuaweiP2PFitnessData` uses
 * the same triple for trajectories). Messages in both directions start with the 36-byte [HuaweiP2PSubMsg] header; the phone side
 * of a course push is a P2P file ([CourseProtobuf.message]), the watch answers with a message of the same business type and
 * message id (`SportBaseEngineManager.dispatchReceiveData` hands it to the receiver registered for that type, which matches the id).
 * What the answer's body means is not known, so it is only logged and returned to JS.
 */
internal class FitnessCourseService(
  manager: HuaweiP2PManager,
  private val events: WearEvents,
) : HuaweiBaseP2PService(manager) {
  @Volatile
  var pingCode: Int? = null
    private set

  /** Pending course pushes by message id. */
  private val waiting = java.util.concurrent.ConcurrentHashMap<Int, CompletableDeferred<ByteArray>>()

  override fun getModule() = MODULE

  override fun getPackage() = PACKAGE

  override fun getFingerprint() = FINGERPRINT

  override fun registered() {
    sendPing { code, _ ->
      pingCode = code
      log("Courses: ping of $PACKAGE answered 0x%02x (0xca = the watch app is there)".format(code and 0xFF))
    }
  }

  override fun unregister() {
    clearPending()
    for (d in waiting.values) d.cancel()
    waiting.clear()
  }

  /** Expect the watch's answer for [messageId]; complete the result with its body. */
  fun expectAnswer(messageId: Int): CompletableDeferred<ByteArray> =
    CompletableDeferred<ByteArray>().also { waiting[messageId] = it }

  fun forget(messageId: Int) {
    waiting.remove(messageId)
  }

  override fun handleData(data: ByteArray) {
    val message = HuaweiP2PSubMsg(data)
    log("Courses: watch message type=${message.type} version=${message.version} length=${message.totalLength} messageId=${message.messageId} body=${message.data?.toHex() ?: "none"}")
    val pending = waiting.remove(message.messageId)
    if (pending == null) {
      log("Courses: no push is waiting for message id ${message.messageId}")
      return
    }
    pending.complete(message.data ?: ByteArray(0))
  }

  private fun log(message: String) = events.log(LogDirection.INFO, 0x34, 0x01, null, message)

  companion object {
    const val MODULE = "hw.unitedevice.fitness"
    const val PACKAGE = "in.huawei.fitness"
    const val FINGERPRINT = "SystemApp"
  }
}
