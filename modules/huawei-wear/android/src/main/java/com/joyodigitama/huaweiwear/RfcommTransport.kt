// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/btbr/BtBRQueue.
package com.joyodigitama.huaweiwear

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.UUID

/** Where [HuaweiSession] puts frames. */
internal interface FrameSink {
  /** Writes every element, in order, as one uninterrupted unit. */
  suspend fun write(frames: List<ByteArray>)
}

/** The link [WearLink] opens to a watch: [RfcommTransport] (Bluetooth Classic) or [BleTransport] (Bluetooth LE GATT). */
internal interface WatchTransport : FrameSink {
  /**
   * Suspends until the link is usable for [HuaweiSession] frames, within [timeoutMs] in total. Throws [WearException]
   * (ERR_TIMEOUT, ERR_CONNECT_FAILED, ERR_BLUETOOTH_PERMISSION, ERR_DISCONNECTED); every failure leaves the transport closed.
   */
  suspend fun connect(timeoutMs: Long)

  /** Idempotent; does not invoke the remote-closed callback. */
  fun close()
}

/**
 * Bluetooth Classic RFCOMM link to the watch, resolved through SDP ([sdp]: `UUID_SERVICE_HUAWEI_SDP`, or
 * `UUID_SERVICE_HONOR_SDP` for GB's HonorBRSupport), as GB's BtBRQueue does: discovery cancelled
 * before connecting, one read thread handing raw chunks to [onData], writes serialized.
 */
internal class RfcommTransport(
  private val adapter: BluetoothAdapter,
  private val device: BluetoothDevice,
  private val sdp: UUID,
  private val onData: (ByteArray) -> Unit,
  /** Called once if the link ends without [close] having been called; null cause means clean EOF. */
  private val onRemoteClosed: (IOException?) -> Unit,
) : WatchTransport {
  @Volatile private var socket: BluetoothSocket? = null
  private val closed = AtomicBoolean(false)
  private val writeLock = Mutex()

  /** Blocks (off the caller's thread) until the socket is connected; closing aborts a pending connect. */
  @SuppressLint("MissingPermission")
  override suspend fun connect(timeoutMs: Long) {
    val created = try {
      // Discovery slows down and can fail RFCOMM connects. Cancelling needs BLUETOOTH_SCAN on
      // Android 12+, which this app never requests (it never scans), so it is best-effort.
      try {
        if (adapter.isDiscovering) adapter.cancelDiscovery()
      } catch (ignored: SecurityException) {
        // No BLUETOOTH_SCAN: we never started discovery, so there is nothing of ours to cancel.
      }
      device.createRfcommSocketToServiceRecord(sdp)
    } catch (e: IOException) {
      throw WearException(ErrorCodes.CONNECT_FAILED, "Unable to open RFCOMM socket: ${e.message}", e)
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    }
    socket = created
    // close() may have run before `socket` was published; it could not close this socket then.
    if (closed.get()) {
      closeSocket()
      throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting")
    }

    val connected = CompletableDeferred<Unit>()
    thread(name = "huawei-rfcomm-connect", isDaemon = true) {
      try {
        created.connect()
        connected.complete(Unit)
      } catch (t: Throwable) {
        connected.completeExceptionally(t)
      }
    }

    try {
      withTimeout(timeoutMs) { connected.await() }
    } catch (e: TimeoutCancellationException) {
      close()
      throw WearException(ErrorCodes.TIMEOUT, "Timed out after $timeoutMs ms connecting to ${device.address}", e)
    } catch (e: IOException) {
      close()
      throw WearException(ErrorCodes.CONNECT_FAILED, "RFCOMM connect to ${device.address} failed: ${e.message}", e)
    } catch (e: SecurityException) {
      close()
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    } catch (e: Throwable) {
      // Caller cancelled; unblock the connect thread.
      close()
      throw e
    }

    if (closed.get()) {
      closeSocket()
      throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting")
    }
    startReader(created)
  }

  private fun startReader(connectedSocket: BluetoothSocket) {
    thread(name = "huawei-rfcomm-read", isDaemon = true) {
      val buffer = ByteArray(READ_BUFFER_SIZE)
      var failure: IOException? = null
      try {
        val input = connectedSocket.inputStream
        while (!closed.get()) {
          val n = input.read(buffer)
          if (n < 0) throw IOException("End of stream")
          if (n == 0) continue
          try {
            onData(buffer.copyOf(n))
          } catch (t: Throwable) {
            // GB logs and keeps reading; one bad frame must not end the link.
            android.util.Log.e(TAG, "onData failed", t)
          }
        }
      } catch (e: IOException) {
        failure = e
      }
      if (closed.compareAndSet(false, true)) {
        closeSocket()
        onRemoteClosed(failure)
      }
    }
  }

  override suspend fun write(frames: List<ByteArray>) {
    writeLock.withLock {
      withContext(Dispatchers.IO) {
        val out = socket?.takeIf { !closed.get() }?.outputStream
          ?: throw IOException("RFCOMM socket is closed")
        for (frame in frames) {
          out.write(frame)
          out.flush()
        }
      }
    }
  }

  /** Idempotent; does not invoke [onRemoteClosed]. */
  override fun close() {
    closed.set(true)
    closeSocket()
  }

  private fun closeSocket() {
    val s = socket ?: return
    try {
      s.close()
    } catch (ignored: IOException) {
      // Already closed or the link is gone; nothing left to release.
    }
  }

  private companion object {
    const val TAG = "HuaweiWear"
    const val READ_BUFFER_SIZE = 1024
  }
}
