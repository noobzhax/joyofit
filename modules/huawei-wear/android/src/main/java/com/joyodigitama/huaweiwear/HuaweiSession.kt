// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/{ResponseManager,requests/Request}.
package com.joyodigitama.huaweiwear

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket

/**
 * Request/response layer over a [FrameSink]. Owns the [HuaweiPacket.ParamsProvider] shared by every
 * packet, reassembles inbound bytes like GB's ResponseManager.handleData and hands each complete
 * packet to the first pending request with the same serviceId + commandId (GB's
 * `Request.handleResponse(HuaweiPacket)`). Complete packets nobody is waiting for are GB's
 * "asynchronous responses"; they are only logged.
 */
internal class HuaweiSession(
  private val sink: FrameSink,
  private val events: WearEvents,
) {
  val params = HuaweiPacket.ParamsProvider()

  private class Waiter(val serviceId: Byte, val commandId: Byte, val label: String) {
    val result = CompletableDeferred<HuaweiPacket>()
  }

  // Guards [waiters], [closedBy], [received] and [frame]. Also orders ParamsProvider writes made
  // before a request against the read thread's parse of its response.
  private val lock = Any()
  private val waiters = ArrayList<Waiter>()
  private var closedBy: WearException? = null

  // Reassembly state (ResponseManager.receivedPackets for the single main channel).
  private var received: HuaweiPacket? = null

  // Raw wire bytes of the packet(s) being reassembled, for the rx log only.
  private var frame = ByteArray(0)

  /**
   * Sends [packet] and suspends for its response (GB `Request.doPerform` + `handleResponse`).
   * The response is returned with `parseTlv()` already applied. Throws [WearException] with
   * ERR_TIMEOUT, ERR_PROTOCOL (serialize/parse failure) or ERR_DISCONNECTED (link closed).
   */
  suspend fun request(packet: HuaweiPacket, timeoutMs: Long, label: String): HuaweiPacket {
    val frames: List<ByteArray> = try {
      packet.serialize() ?: throw WearException(ErrorCodes.PROTOCOL, "$label: packet serialized to nothing")
    } catch (e: WearException) {
      throw e
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      throw WearException(ErrorCodes.PROTOCOL, "$label: request could not be created: ${e.message}", e)
    }

    val waiter = Waiter(packet.serviceId, packet.commandId, label)
    synchronized(lock) {
      closedBy?.let { throw it }
      waiters.add(waiter)
    }

    try {
      val mtu = params.mtu
      val wire = ArrayList<ByteArray>(frames.size)
      for ((index, f) in frames.withIndex()) {
        events.log(
          LogDirection.TX,
          packet.serviceId.toInt() and 0xFF,
          packet.commandId.toInt() and 0xFF,
          f.toHex(),
          if (frames.size > 1) "$label (frame ${index + 1}/${frames.size})" else label,
        )
        splitToMtu(f, mtu, wire)
      }
      sink.write(wire)
    } catch (e: IOException) {
      removeWaiter(waiter)
      throw WearException(ErrorCodes.DISCONNECTED, "$label: write failed: ${e.message}", e)
    } catch (e: Throwable) {
      removeWaiter(waiter)
      throw e
    }

    val response = try {
      withTimeout(timeoutMs) { waiter.result.await() }
    } catch (e: TimeoutCancellationException) {
      removeWaiter(waiter)
      throw WearException(
        ErrorCodes.TIMEOUT,
        "$label: no response (service ${waiter.serviceId.hex2()}, command ${waiter.commandId.hex2()}) within $timeoutMs ms",
        e,
      )
    } catch (e: Throwable) {
      removeWaiter(waiter)
      throw e
    }

    try {
      response.parseTlv()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      throw WearException(ErrorCodes.PROTOCOL, "$label: failed to parse response: ${e.message}", e)
    }
    return response
  }

  /** Fails everything in flight and rejects new requests. Idempotent; the first cause wins. */
  fun close(cause: WearException) {
    val pending: List<Waiter>
    synchronized(lock) {
      if (closedBy != null) return
      closedBy = cause
      pending = ArrayList(waiters)
      waiters.clear()
      received = null
      frame = ByteArray(0)
    }
    for (w in pending) w.result.completeExceptionally(cause)
  }

  /**
   * Feeds a raw chunk from the socket; a direct port of ResponseManager.handleData(data, channel)
   * for a single channel, including the "concatenated packets" loop on [HuaweiPacket.getLeft].
   */
  fun onData(chunk: ByteArray) {
    synchronized(lock) {
      if (closedBy != null) return
      var data = chunk
      var left = 0
      do {
        if (left > 0) data = data.copyOfRange(data.size - left, data.size)
        frame += data

        val packet: HuaweiPacket = try {
          val existing = received
          if (existing == null) HuaweiPacket(params).parse(data) else existing.parse(data)
        } catch (e: Exception) {
          // GB catches only ParseException and drops the packet; anything else would leave the
          // reassembly buffer poisoned, so every failure resets it.
          events.log(LogDirection.ERROR, null, null, frame.toHex(), "Packet parse failed: ${e.message}")
          received = null
          frame = ByteArray(0)
          return
        }
        received = packet
        left = packet.left

        if (packet.complete) {
          val raw = frame.copyOf(frame.size - left)
          frame = ByteArray(0)
          dispatch(packet, raw)
          received = null
        } else if (left > 0) {
          // The tail belongs to the next frame and is fed again on the next iteration.
          frame = frame.copyOf(frame.size - left)
        }
      } while (left > 0)
    }
  }

  private fun dispatch(packet: HuaweiPacket, raw: ByteArray) {
    val service = packet.serviceId.toInt() and 0xFF
    val command = packet.commandId.toInt() and 0xFF
    val waiter = waiters.firstOrNull { it.serviceId == packet.serviceId && it.commandId == packet.commandId }
    if (waiter == null) {
      events.log(LogDirection.RX, service, command, raw.toHex(), "asynchronous (no pending request)")
    } else {
      waiters.remove(waiter)
      events.log(LogDirection.RX, service, command, raw.toHex(), "response to ${waiter.label}")
      waiter.result.complete(packet)
    }
  }

  private fun removeWaiter(waiter: Waiter) {
    synchronized(lock) { waiters.remove(waiter) }
  }

  /** Request.doPerform: frames of `mtu` bytes or more are written in `mtu`-sized pieces. */
  private fun splitToMtu(frame: ByteArray, mtu: Int, into: MutableList<ByteArray>) {
    if (mtu <= 0 || frame.size < mtu) {
      into.add(frame)
      return
    }
    var offset = 0
    while (offset < frame.size) {
      val end = minOf(offset + mtu, frame.size)
      into.add(frame.copyOfRange(offset, end))
      offset = end
    }
  }
}
