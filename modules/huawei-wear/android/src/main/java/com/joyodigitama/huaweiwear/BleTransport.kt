// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/btle/BtLEQueue and service/devices/huawei/HuaweiLESupport
// (GATT service 0xFE86 with FE01 to write and FE02 to notify; Honor's own service for isNewHonorProtocol models).
package com.joyodigitama.huaweiwear

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.os.Build
import android.util.Log
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants

/**
 * Bluetooth LE link to a Huawei or Honor band: the same packet stream as [RfcommTransport], carried by GATT. The phone writes
 * to the write characteristic and the watch answers with notifications on the read one, so notification payloads go to
 * [onData] exactly as RFCOMM read chunks do (the session reassembles packets, whatever the chunking).
 *
 * Like GB's BtLEQueue: connect without autoConnect, discover services, enable notifications on the read characteristic, and
 * run one GATT operation at a time. There is no Android bonding: GB's HuaweiLECoordinator uses BONDING_STYLE_NONE because the
 * watch authenticates through the Huawei protocol itself. Not like GB: autoConnect is off (it is on in HuaweiLESupport), so a
 * watch that is out of range fails the connect instead of waiting for it.
 */
internal class BleTransport(
  private val context: Context,
  private val device: BluetoothDevice,
  /** GB isNewHonorProtocol: Honor's service and characteristics instead of 0xFE86 with FE01 and FE02. */
  newHonorProtocol: Boolean,
  private val onData: (ByteArray) -> Unit,
  /** Called once if the link ends after [connect] returned and without [close] having been called. */
  private val onRemoteClosed: (IOException?) -> Unit,
  /** Connect progress for the support report (negotiated MTU, services, write type). */
  private val log: (String) -> Unit,
) : WatchTransport {
  private val readUuid: UUID =
    if (newHonorProtocol) HuaweiConstants.UUID_CHARACTERISTIC_HONOR_READ else HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_READ
  private val writeUuid: UUID =
    if (newHonorProtocol) HuaweiConstants.UUID_CHARACTERISTIC_HONOR_WRITE else HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_WRITE

  private val gatt = AtomicReference<BluetoothGatt?>(null)
  private val closed = AtomicBoolean(false)
  private val writeLock = Mutex()

  @Volatile private var writeCharacteristic: BluetoothGattCharacteristic? = null
  @Volatile private var writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT

  /** ATT MTU in force; one write carries at most this minus the 3 byte ATT header. 23 until the watch agrees to more. */
  @Volatile private var attMtu = DEFAULT_ATT_MTU

  // Connect phase: completed by the GATT callbacks, failed when the link drops or [close] runs.
  private val linkUp = CompletableDeferred<Unit>()
  private val mtuDone = CompletableDeferred<Unit>()
  private val servicesDone = CompletableDeferred<Unit>()

  /** The GATT status of the one write or descriptor write in flight; Android allows only one at a time. */
  private val operation = AtomicReference<CompletableDeferred<Int>?>(null)

  // Guards [ready] and [lostBeforeReady] together, so a drop between the last connect step and [connect] returning is not missed.
  private val stateLock = Any()
  private var ready = false
  private var lostBeforeReady: IOException? = null

  /** Notifications are handed over on this thread, in order, so the binder thread that delivers GATT callbacks never runs session code. */
  private val reader = Executors.newSingleThreadExecutor { r -> Thread(r, "huawei-ble-read").apply { isDaemon = true } }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        linkUp.complete(Unit)
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
        linkLost(IOException("Bluetooth LE link ended: ${statusText(status)}"))
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) attMtu = mtu
      mtuDone.complete(Unit)
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) {
        servicesDone.complete(Unit)
      } else {
        servicesDone.completeExceptionally(IOException("Service discovery failed: ${statusText(status)}"))
      }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      operation.get()?.complete(status)
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      operation.get()?.complete(status)
    }

    // Android 12 and older call this one; 13 and newer call the one with the value.
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (characteristic.uuid == readUuid) deliver(characteristic.value)
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid == readUuid) deliver(value)
    }
  }

  /**
   * Opens the GATT link, requests a larger MTU, finds the Huawei characteristics and turns notifications on, all within
   * [timeoutMs]. Closing aborts it.
   */
  @SuppressLint("MissingPermission")
  override suspend fun connect(timeoutMs: Long) {
    try {
      withTimeout(timeoutMs) { open() }
    } catch (e: TimeoutCancellationException) {
      close()
      throw WearException(ErrorCodes.TIMEOUT, "Timed out after $timeoutMs ms connecting to ${device.address} over Bluetooth LE", e)
    } catch (e: WearException) {
      close()
      throw e
    } catch (e: IOException) {
      close()
      throw WearException(ErrorCodes.CONNECT_FAILED, "Bluetooth LE connect to ${device.address} failed: ${e.message}", e)
    } catch (e: SecurityException) {
      close()
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    } catch (e: Throwable) {
      // Caller cancelled; release the GATT client.
      close()
      throw e
    }

    val lost = synchronized(stateLock) {
      ready = true
      lostBeforeReady
    }
    if (lost != null || closed.get()) {
      close()
      throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting", lost)
    }
  }

  @SuppressLint("MissingPermission")
  private suspend fun open() {
    val client = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
      ?: throw IOException("Android did not create a GATT client")
    gatt.set(client)
    // close() may have run before the client was published; it could not release it then.
    if (closed.get()) {
      release()
      throw IOException("Disconnected while connecting")
    }

    linkUp.await()
    log("GATT connected")

    // Best effort: a watch that never answers must not hold the connect up. The frames are cut to what the ATT MTU carries
    // in write(), so a small MTU only costs speed.
    if (client.requestMtu(REQUESTED_MTU)) withTimeoutOrNull(MTU_TIMEOUT_MS) { mtuDone.await() }
    log("ATT MTU $attMtu")

    if (!client.discoverServices()) throw IOException("Android refused to start service discovery")
    servicesDone.await()

    val read = findCharacteristic(client, readUuid)
    val write = findCharacteristic(client, writeUuid)
    if (read == null || write == null) {
      throw WearException(
        ErrorCodes.CONNECT_FAILED,
        "The watch has no Huawei GATT characteristics (${if (read == null) "read $readUuid" else "write $writeUuid"} is missing); " +
          "services found: ${client.services.joinToString(", ") { it.uuid.toString() }}",
      )
    }
    // GB leaves the characteristic's write type as Android sets it: no response when the characteristic allows it.
    writeType = when {
      write.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0 -> BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
      write.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0 -> BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      else -> throw WearException(ErrorCodes.CONNECT_FAILED, "GATT characteristic $writeUuid cannot be written")
    }
    writeCharacteristic = write
    log("GATT services: ${client.services.joinToString(", ") { it.uuid.toString() }}; write ${if (writeType == BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) "without" else "with"} response")

    enableNotifications(client, read)
    log("GATT notifications on")
  }

  /** GB's `getCharacteristic(uuid)`: the characteristic is looked up in every service the watch offers. */
  private fun findCharacteristic(client: BluetoothGatt, uuid: UUID): BluetoothGattCharacteristic? =
    client.services.firstNotNullOfOrNull { it.getCharacteristic(uuid) }

  @SuppressLint("MissingPermission")
  @Suppress("DEPRECATION")
  private suspend fun enableNotifications(client: BluetoothGatt, read: BluetoothGattCharacteristic) {
    if (!client.setCharacteristicNotification(read, true)) throw IOException("Android refused to enable notifications on $readUuid")
    val cccd = read.getDescriptor(CLIENT_CONFIG_UUID)
    if (cccd == null) {
      // GB's notify() does the same: the local flag is set and the watch is left to push.
      log("GATT characteristic $readUuid has no client configuration descriptor")
      return
    }
    val value = if (read.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY == 0 &&
      read.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
    ) {
      BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
    } else {
      BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    }
    val status = gattOperation("enable notifications", DESCRIPTOR_TIMEOUT_MS) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        client.writeDescriptor(cccd, value) == BluetoothStatusCodes.SUCCESS
      } else {
        cccd.value = value
        client.writeDescriptor(cccd)
      }
    }
    if (status != BluetoothGatt.GATT_SUCCESS) throw IOException("Enabling notifications failed: ${statusText(status)}")
  }

  /**
   * Starts one GATT operation with [start] and waits for its callback, for the GATT status it carries. Throws [IOException]
   * when Android refuses to start it, it does not finish within [timeoutMs], or the link drops meanwhile.
   */
  private suspend fun gattOperation(what: String, timeoutMs: Long, start: () -> Boolean): Int {
    val result = CompletableDeferred<Int>()
    operation.set(result)
    try {
      if (closed.get()) throw IOException("Bluetooth LE link is closed")
      if (!start()) throw IOException("Android refused to start: $what")
      return withTimeoutOrNull(timeoutMs) { result.await() }
        ?: throw IOException("$what: no answer from the watch within $timeoutMs ms")
    } finally {
      operation.compareAndSet(result, null)
    }
  }

  /** Every element in order, each cut to what one ATT write carries, one write in flight at a time. */
  @SuppressLint("MissingPermission")
  @Suppress("DEPRECATION")
  override suspend fun write(frames: List<ByteArray>) {
    writeLock.withLock {
      val client = gatt.get()?.takeIf { !closed.get() } ?: throw IOException("Bluetooth LE link is closed")
      val characteristic = writeCharacteristic ?: throw IOException("Bluetooth LE link is not ready")
      val type = writeType
      try {
        for (frame in frames) {
          var offset = 0
          while (offset < frame.size) {
            val size = minOf(frame.size - offset, maxOf(attMtu - ATT_HEADER_BYTES, DEFAULT_ATT_MTU - ATT_HEADER_BYTES))
            val chunk = if (offset == 0 && size == frame.size) frame else frame.copyOfRange(offset, offset + size)
            val status = gattOperation("write", WRITE_TIMEOUT_MS) {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                client.writeCharacteristic(characteristic, chunk, type) == BluetoothStatusCodes.SUCCESS
              } else {
                characteristic.writeType = type
                characteristic.value = chunk
                client.writeCharacteristic(characteristic)
              }
            }
            if (status != BluetoothGatt.GATT_SUCCESS) throw IOException("GATT write failed: ${statusText(status)}")
            offset += size
          }
        }
      } catch (e: SecurityException) {
        throw IOException("BLUETOOTH_CONNECT permission denied: ${e.message}", e)
      }
    }
  }

  private fun deliver(value: ByteArray?) {
    if (value == null || value.isEmpty() || closed.get()) return
    // Older Android reuses the characteristic's value array for the next notification.
    val chunk = value.copyOf()
    try {
      reader.execute {
        try {
          onData(chunk)
        } catch (t: Throwable) {
          // GB logs and keeps reading; one bad frame must not end the link.
          Log.e(TAG, "onData failed", t)
        }
      }
    } catch (ignored: RejectedExecutionException) {
      // Closed while the callback was running.
    }
  }

  /** The link ended: fails whatever waits for the watch, and tells [onRemoteClosed] if [connect] already returned. */
  private fun linkLost(cause: IOException) {
    failPending(cause)
    val wasReady = synchronized(stateLock) {
      if (!ready) lostBeforeReady = cause
      ready
    }
    if (wasReady && closed.compareAndSet(false, true)) {
      release()
      onRemoteClosed(cause)
    }
  }

  private fun failPending(cause: IOException) {
    linkUp.completeExceptionally(cause)
    mtuDone.completeExceptionally(cause)
    servicesDone.completeExceptionally(cause)
    operation.get()?.completeExceptionally(cause)
  }

  /** Idempotent; does not invoke [onRemoteClosed]. */
  override fun close() {
    closed.set(true)
    failPending(IOException("Bluetooth LE link closed"))
    release()
  }

  @SuppressLint("MissingPermission")
  private fun release() {
    reader.shutdown()
    val client = gatt.getAndSet(null) ?: return
    try {
      client.disconnect()
    } catch (ignored: SecurityException) {
      // BLUETOOTH_CONNECT was revoked: the system drops the link with the client below.
    }
    try {
      client.close()
    } catch (ignored: SecurityException) {
      // Same.
    }
  }

  private companion object {
    const val TAG = "HuaweiWear"

    /** What Android asks for by default; the watch answers with what it supports. */
    const val REQUESTED_MTU = 512
    const val DEFAULT_ATT_MTU = 23
    const val ATT_HEADER_BYTES = 3

    const val MTU_TIMEOUT_MS = 3_000L
    const val DESCRIPTOR_TIMEOUT_MS = 5_000L
    const val WRITE_TIMEOUT_MS = 5_000L

    /** Client Characteristic Configuration descriptor. */
    val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    fun statusText(status: Int): String {
      val meaning = when (status) {
        BluetoothGatt.GATT_SUCCESS -> "success"
        8 -> "connection timeout"
        19 -> "the watch ended the connection"
        22 -> "the phone ended the connection"
        62 -> "connection failed to establish"
        133 -> "generic GATT error"
        BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION, BluetoothGatt.GATT_INSUFFICIENT_ENCRYPTION -> "not bonded"
        else -> null
      }
      return if (meaning != null) "GATT status $status ($meaning)" else "GATT status $status"
    }
  }
}
