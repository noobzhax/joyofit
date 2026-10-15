package com.joyodigitama.huaweiwear

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import android.util.Log
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * A GATT characteristic write refused because the stack still had an operation in flight.
 * Carries the synchronous return of the API-33+ `writeCharacteristic` overload, whose values
 * are `BluetoothStatusCodes` (not `BluetoothGatt.GATT_*`): 201 is
 * `ERROR_GATT_WRITE_REQUEST_BUSY`, "issued to a busy remote device". The message keeps the
 * historical `writeCharacteristic returned <status>` text the connect log reports.
 */
internal class GattWriteBusyException(val status: Int) : IOException("writeCharacteristic returned $status")

/** BLE-side events [GattTransport] consumes; the real link raises them on the GATT callback thread. */
internal interface GattLinkListener {
  fun onNotify(data: ByteArray)
  fun onMtuChanged(mtu: Int)
  fun onDisconnected(cause: IOException?)
}

/**
 * The one GATT connection underneath [GattTransport]. Kept behind this seam so JVM unit tests
 * can drive the transport with a fake; production uses [AndroidGattLink].
 */
internal interface GattLink {
  /** True once service discovery, notification setup and the CCCD write have succeeded. */
  val isReady: Boolean
  /** Connects, discovers services and enables notifications; throws [IOException] when setup fails. */
  suspend fun start()
  /** Writes one MTU-sized chunk; calls are already serialized by the transport. */
  suspend fun writeChunk(chunk: ByteArray)
  fun close()
}

/**
 * Bluetooth LE GATT link to the watch, a drop-in [FrameSink] sibling of [RfcommTransport]:
 * the same `write` / `onData` / `onRemoteClosed` / `close` contract, so [HuaweiSession] and
 * [WearLink] treat it identically. Outbound frames are chunked to the negotiated ATT payload
 * (like [HuaweiSession]'s `splitToMtu`, but against the GATT MTU at this layer); inbound
 * notifies are handed to [onData] whole, in arrival order, and reassembly (segmented and
 * concatenated packets) stays in [HuaweiSession.onData].
 */
internal class GattTransport(
  private val config: BleGattConfig = BleGattConfig(),
  private val onData: (ByteArray) -> Unit,
  /** Called once if the link ends without [close] having been called; null cause means clean EOF. */
  private val onRemoteClosed: (IOException?) -> Unit,
  linkFactory: (GattLinkListener) -> GattLink,
) : FrameSink, GattLinkListener {
  constructor(
    context: Context,
    device: BluetoothDevice,
    config: BleGattConfig = BleGattConfig(),
    onData: (ByteArray) -> Unit,
    onRemoteClosed: (IOException?) -> Unit,
  ) : this(config, onData, onRemoteClosed, { listener -> AndroidGattLink(context, device, config, listener) })

  private val link: GattLink = linkFactory(this)
  private val closed = AtomicBoolean(false)
  private val writeLock = Mutex()

  /** The ATT payload a chunk may carry; follows every [onMtuChanged] renegotiation. */
  @Volatile private var payloadSize: Int = config.mtu - ATT_HEADER_SIZE

  /**
   * Blocks (off the caller's thread) until services are discovered and notifications flow;
   * closing aborts the attempt.
   */
  suspend fun connect(timeoutMs: Long) {
    if (closed.get()) {
      throw WearException(ErrorCodes.DISCONNECTED, "Disconnected before connecting")
    }
    try {
      withTimeout(timeoutMs) { link.start() }
    } catch (e: TimeoutCancellationException) {
      close()
      throw WearException(ErrorCodes.TIMEOUT, "Timed out after $timeoutMs ms setting up the GATT link", e)
    } catch (e: WearException) {
      close()
      throw e
    } catch (e: Throwable) {
      close()
      throw e
    }
    if (closed.get() || !link.isReady) {
      close()
      throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting")
    }
  }

  override suspend fun write(frames: List<ByteArray>) {
    writeLock.withLock {
      if (!link.isReady || closed.get()) throw IOException("GATT link is closed")
      for (frame in frames) {
        for (chunk in splitToPayload(frame, payloadSize)) {
          // Band 11 field evidence: the first LinkParams chunk raced the still-in-flight
          // CCCD/MTU setup operations and the stack refused it with 201 (BUSY). AOSP retries
          // BUSY internally the same way; a bounded retry here absorbs the residual race
          // without masking a wedged link (exhaustion rethrows).
          var attempt = 0
          while (true) {
            try {
              link.writeChunk(chunk)
              break
            } catch (e: GattWriteBusyException) {
              if (attempt >= BUSY_MAX_RETRIES || closed.get()) throw e
              attempt++
              delay(BUSY_RETRY_DELAY_MS)
            }
          }
        }
      }
    }
  }

  override fun onNotify(data: ByteArray) {
    try {
      onData(data)
    } catch (t: Throwable) {
      // One bad frame must not end the link.
      Log.e(TAG, "onData failed", t)
    }
  }

  override fun onMtuChanged(mtu: Int) {
    payloadSize = mtu - ATT_HEADER_SIZE
  }

  override fun onDisconnected(cause: IOException?) {
    if (closed.compareAndSet(false, true)) {
      link.close()
      onRemoteClosed(cause)
    }
  }

  /** Idempotent; does not invoke [onRemoteClosed]. */
  fun close() {
    closed.set(true)
    link.close()
  }

  /** HuaweiSession.splitToMtu semantics, against the GATT payload: short frames go whole. */
  private fun splitToPayload(frame: ByteArray, payload: Int): List<ByteArray> {
    if (payload <= 0 || frame.size < payload) return listOf(frame)
    val chunks: ArrayList<ByteArray> = ArrayList((frame.size + payload - 1) / payload)
    var offset: Int = 0
    while (offset < frame.size) {
      val end: Int = minOf(offset + payload, frame.size)
      chunks.add(frame.copyOfRange(offset, end))
      offset = end
    }
    return chunks
  }

  private companion object {
    const val TAG: String = "HuaweiWear"
    const val ATT_HEADER_SIZE: Int = 3
    /** Retries after the initial attempt when a chunk write hits [GattWriteBusyException]. */
    const val BUSY_MAX_RETRIES: Int = 3
    /** Between BUSY retries; ~300 ms worst case, far inside the LinkParams request timeout. */
    const val BUSY_RETRY_DELAY_MS: Long = 100L
  }
}

/**
 * The production [GattLink]: `connectGatt` with `autoConnect=false`, service discovery,
 * `setCharacteristicNotification` plus the CCCD write, serialized single-flight chunk writes
 * honoring [BleGattConfig.writeType], and the negotiated MTU via `onMtuChanged`
 * (`requestMtu` is best-effort). Ready is reported only after the CCCD write is acked in
 * `onDescriptorWrite`, so the first chunk never races setup (Band 11 refused it with 201).
 */
private class AndroidGattLink(
  private val context: Context,
  private val device: BluetoothDevice,
  private val config: BleGattConfig,
  private val listener: GattLinkListener,
) : GattLink {
  @Volatile private var gatt: BluetoothGatt? = null
  @Volatile private var writeCharacteristic: BluetoothGattCharacteristic? = null
  /** Discovered write characteristic, unpublished until the CCCD ack proves the GATT queue is idle. */
  @Volatile private var setupWrite: BluetoothGattCharacteristic? = null
  @Volatile private var ready: Boolean = false
  override val isReady: Boolean get() = ready

  private val connected = CompletableDeferred<Unit>()
  private val writeLock = Mutex()
  @Volatile private var pendingAck: CompletableDeferred<Unit>? = null

  private val callback: BluetoothGattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        if (!gatt.discoverServices()) {
          failSetup(IOException("GATT service discovery failed to start"))
        }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        pendingAck?.completeExceptionally(IOException("GATT disconnected while a write was in flight"))
        pendingAck = null
        if (!connected.isCompleted) {
          failSetup(IOException("GATT disconnected before services were resolved (status=$status)"))
        } else {
          listener.onDisconnected(IOException("GATT disconnected (status=$status)"))
        }
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        failSetup(IOException("GATT service discovery failed (status=$status)"))
        return
      }
      try {
        val write: BluetoothGattCharacteristic = gatt.getService(config.serviceUuid)
          ?.getCharacteristic(config.writeUuid)
          ?: throw IOException("GATT write characteristic ${config.writeUuid} not found")
        val notify: BluetoothGattCharacteristic = gatt.getService(config.serviceUuid)
          ?.getCharacteristic(config.notifyUuid)
          ?: throw IOException("GATT notify characteristic ${config.notifyUuid} not found")
        if (!gatt.setCharacteristicNotification(notify, true)) {
          throw IOException("setCharacteristicNotification failed")
        }
        val cccd: BluetoothGattDescriptor = notify.getDescriptor(BleGattConfig.CCCD_UUID)
          ?: throw IOException("CCCD descriptor missing on ${config.notifyUuid}")
        val cccdOk: Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
        } else {
          cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          gatt.writeDescriptor(cccd)
        }
        if (!cccdOk) throw IOException("CCCD write failed")
        // Field evidence (Band 11, status 201): reporting ready here races the still-in-flight
        // CCCD write — the first chunk then hits BluetoothGatt's busy gate. Hold the write
        // characteristic until onDescriptorWrite acks; only that completion reports ready.
        setupWrite = write
      } catch (e: IOException) {
        failSetup(e)
      } catch (e: SecurityException) {
        failSetup(e)
      }
    }

    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      val value: ByteArray = characteristic.value ?: return
      deliver(characteristic, value)
    }

    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      deliver(characteristic, value)
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      ackWrite(status)
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      onCccdAck(gatt, descriptor, status)
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) listener.onMtuChanged(mtu)
    }

    private fun deliver(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid != config.notifyUuid) return
      try {
        listener.onNotify(value)
      } catch (t: Throwable) {
        Log.e(TAG, "onNotify failed", t)
      }
    }

    private fun ackWrite(status: Int) {
      val ack: CompletableDeferred<Unit> = pendingAck ?: return
      pendingAck = null
      if (status == BluetoothGatt.GATT_SUCCESS) ack.complete(Unit)
      else ack.completeExceptionally(IOException("GATT write failed (status=$status)"))
    }

    private fun onCccdAck(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (descriptor.uuid != BleGattConfig.CCCD_UUID || connected.isCompleted) return
      if (status != BluetoothGatt.GATT_SUCCESS) {
        setupWrite = null
        failSetup(IOException("CCCD write failed (status=$status)"))
        return
      }
      // The queue is idle now: publish the link before WearLink fires the first chunk.
      writeCharacteristic = setupWrite
      setupWrite = null
      ready = true
      try {
        gatt.requestMtu(BleGattConfig.REQUESTED_MTU)
      } catch (ignored: Exception) {
        // Best-effort: the band answers through onMtuChanged when it accepts.
      }
      connected.complete(Unit)
    }

    private fun failSetup(e: Throwable) {
      pendingAck?.completeExceptionally(IOException("GATT setup failed", e))
      pendingAck = null
      connected.completeExceptionally(e)
    }
  }

  @SuppressLint("MissingPermission")
  override suspend fun start() {
    val attached: BluetoothGatt = try {
      device.connectGatt(context, false, callback)
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    } ?: throw WearException(ErrorCodes.CONNECT_FAILED, "connectGatt returned null")
    gatt = attached
    try {
      connected.await()
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    } catch (e: IOException) {
      throw WearException(ErrorCodes.CONNECT_FAILED, "GATT setup failed: ${e.message}", e)
    }
  }

  @SuppressLint("MissingPermission")
  override suspend fun writeChunk(chunk: ByteArray): Unit = writeLock.withLock {
    withContext(Dispatchers.IO) {
      val attached: BluetoothGatt = gatt ?: throw IOException("GATT link is closed")
      val target: BluetoothGattCharacteristic = writeCharacteristic ?: throw IOException("GATT link is not ready")
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          val ack = CompletableDeferred<Unit>()
          pendingAck = ack
          val status: Int = attached.writeCharacteristic(target, chunk, config.writeType)
          if (status != BluetoothGatt.GATT_SUCCESS) {
            pendingAck = null
            // 201 (BluetoothStatusCodes.ERROR_GATT_WRITE_REQUEST_BUSY) is transient queue
            // contention — retried by GattTransport.write; anything else fails fast.
            if (status == GATT_WRITE_REQUEST_BUSY) throw GattWriteBusyException(status)
            throw IOException("writeCharacteristic returned $status")
          }
          if (config.writeType == BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) {
            withTimeout(WRITE_ACK_TIMEOUT_MS) { ack.await() }
          } else {
            pendingAck = null
          }
        } else {
          target.writeType = config.writeType
          target.value = chunk
          val ack = CompletableDeferred<Unit>()
          pendingAck = ack
          if (!attached.writeCharacteristic(target)) {
            pendingAck = null
            throw IOException("writeCharacteristic failed")
          }
          if (config.writeType == BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) {
            withTimeout(WRITE_ACK_TIMEOUT_MS) { ack.await() }
          } else {
            pendingAck = null
          }
        }
      } catch (e: SecurityException) {
        throw IOException("BLUETOOTH_CONNECT permission denied: ${e.message}", e)
      }
    }
  }

  @SuppressLint("MissingPermission")
  override fun close() {
    val attached: BluetoothGatt = gatt ?: return
    gatt = null
    ready = false
    try {
      attached.disconnect()
    } catch (ignored: Exception) {
      // Already gone; close() below still releases the client.
    }
    try {
      attached.close()
    } catch (ignored: Exception) {
      // Already closed; nothing left to release.
    }
  }

  private companion object {
    const val TAG: String = "HuaweiWear"
    const val WRITE_ACK_TIMEOUT_MS: Long = 5_000L
    /**
     * `BluetoothStatusCodes.ERROR_GATT_WRITE_REQUEST_BUSY` (API 33), inlined as a literal:
     * referencing the framework class would trip minSdk lint on the pre-33 write path.
     */
    const val GATT_WRITE_REQUEST_BUSY: Int = 201
  }
}
