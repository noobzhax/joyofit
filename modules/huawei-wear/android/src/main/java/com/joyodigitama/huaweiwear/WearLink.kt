package com.joyodigitama.huaweiwear

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.io.IOException
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants

/**
 * The single active session to a watch: RFCOMM transport + packet session + auth/init/sync, and
 * the [LinkState] machine JS observes. At most one [Connection] exists; every failure while
 * connecting (including every authentication failure) tears it down.
 */
internal class WearLink(
  context: Context,
  private val events: WearEvents,
) {
  private val appContext = context.applicationContext
  private val store = DeviceStore(appContext)

  private val lock = Any()
  private var current: Connection? = null

  @Volatile
  private var state = LinkState.DISCONNECTED

  private inner class Connection(val address: String, val device: BluetoothDevice, adapter: BluetoothAdapter) {
    val closed = AtomicBoolean(false)
    val operationLock = Mutex()

    /** Why this connection ended, when something other than the failing operation ended it. */
    @Volatile
    var closeCause: WearException? = null

    @Volatile
    var info: Map<String, Any?>? = null
    lateinit var session: HuaweiSession
    val transport = RfcommTransport(
      adapter = adapter,
      device = device,
      onData = { chunk -> session.onData(chunk) },
      onRemoteClosed = { cause -> onRemoteClosed(this, cause) },
    )

    init {
      session = HuaweiSession(transport, events)
    }
  }

  fun currentState(): String = state.wire

  // Bluetooth access

  @SuppressLint("MissingPermission")
  fun bondedDevices(): List<Map<String, Any?>> {
    val adapter = requireAdapter()
    try {
      return adapter.bondedDevices
        .map { device ->
          val name = device.name ?: device.address
          mapOf("address" to device.address, "name" to name, "supported" to isSupportedName(name))
        }
        .sortedBy { (it["name"] as String).lowercase(Locale.ROOT) }
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    }
  }

  /** HuaweiWatchFit4ProCoordinator.getSupportedDeviceName: Fit 4 and Fit 4 Pro, case-insensitive. */
  private fun isSupportedName(name: String): Boolean {
    val lower = name.lowercase(Locale.ROOT)
    return lower.startsWith(HuaweiConstants.HU_WATCHFIT4_NAME) ||
      lower.startsWith(HuaweiConstants.HU_WATCHFIT4PRO_NAME)
  }

  private fun requireAdapter(): BluetoothAdapter {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) {
      throw WearException(
        ErrorCodes.BLUETOOTH_PERMISSION,
        "BLUETOOTH_CONNECT permission is not granted; request it before using the watch",
      )
    }
    val adapter = appContext.getSystemService(BluetoothManager::class.java)?.adapter
      ?: throw WearException(ErrorCodes.BLUETOOTH_UNAVAILABLE, "This device has no Bluetooth adapter")
    if (!adapter.isEnabled) {
      throw WearException(ErrorCodes.BLUETOOTH_OFF, "Bluetooth is turned off; turn it on and try again")
    }
    return adapter
  }

  // Connect

  @SuppressLint("MissingPermission")
  suspend fun connect(rawAddress: String): Map<String, Any?> {
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    val adapter = requireAdapter()
    if (!BluetoothAdapter.checkBluetoothAddress(address)) {
      throw WearException(ErrorCodes.INVALID_ADDRESS, "'$rawAddress' is not a Bluetooth address")
    }

    val connection: Connection
    synchronized(lock) {
      current?.let { existing ->
        val info = existing.info
        if (existing.address == address && state == LinkState.CONNECTED && info != null) return info
        throw WearException(
          ErrorCodes.BUSY,
          "Already ${state.wire} with ${existing.address}; disconnect before connecting again",
        )
      }
      connection = Connection(address, adapter.getRemoteDevice(address), adapter)
      current = connection
      state = LinkState.CONNECTING
    }
    events.state(LinkState.CONNECTING, null)
    events.log(LogDirection.INFO, null, null, null, "Connecting to $address (RFCOMM, SDP ${HuaweiConstants.UUID_SERVICE_HUAWEI_SDP})")

    try {
      connection.transport.connect(Timeouts.CONNECT_MS)
      events.log(LogDirection.INFO, null, null, null, "RFCOMM connected")

      setState(connection, LinkState.AUTHENTICATING)
      val identity = store.forDevice(address)
      val authMode = HuaweiAuthenticator(connection.session, identity, events).authenticate()

      setState(connection, LinkState.INITIALIZING)
      val init = HuaweiInitializer(connection.session, events, bondedName(connection.device)).run()

      val name = bondedName(connection.device) ?: init.deviceName ?: address
      val info = mapOf(
        "address" to address,
        "name" to name,
        "productModel" to init.productModel,
        "softwareVersion" to init.softwareVersion,
        "hardwareVersion" to init.hardwareVersion,
        "serialNumber" to init.serialNumber,
        "batteryLevel" to init.batteryLevel,
        "authMode" to authMode.wire,
      )

      synchronized(lock) {
        if (connection.closed.get() || current !== connection) {
          throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting")
        }
        connection.info = info
        state = LinkState.CONNECTED
      }
      events.state(LinkState.CONNECTED, null)
      init.batteryLevel?.let { events.battery(it) }
      return info
    } catch (t: Throwable) {
      if (t is CancellationException) {
        teardown(connection, WearException(ErrorCodes.DISCONNECTED, "Connect cancelled"), null)
        throw t
      }
      // Closed under us (user disconnect, watch dropped the link): report what closed it rather than
      // the I/O error that followed. A protocol-level failure of the operation itself wins.
      val closeCause = connection.closeCause
      val failure: WearException = when {
        closeCause != null && (t !is WearException || t.errorCode == ErrorCodes.DISCONNECTED || t.errorCode == ErrorCodes.CONNECT_FAILED) -> closeCause
        t is WearException -> t
        t is IOException -> WearException(ErrorCodes.CONNECT_FAILED, "Connect failed: ${t.message}", t)
        else -> WearException(ErrorCodes.CONNECT_FAILED, "Connect failed: ${t.message ?: t.javaClass.simpleName}", t)
      }
      events.log(LogDirection.ERROR, null, null, null, "Connect failed [${failure.errorCode}]: ${failure.message}")
      teardown(connection, failure, failure.message)
      throw failure
    }
  }

  @SuppressLint("MissingPermission")
  private fun bondedName(device: BluetoothDevice): String? =
    try {
      device.name
    } catch (e: SecurityException) {
      null
    }

  // Disconnect / teardown

  fun disconnect() {
    val connection = synchronized(lock) { current } ?: return
    events.log(LogDirection.INFO, null, null, null, "Disconnecting from ${connection.address}")
    teardown(connection, WearException(ErrorCodes.DISCONNECTED, "Disconnected"), null)
  }

  /** JS reload / module destroy: close without telling JS. */
  fun shutdown() = disconnect()

  fun forget(rawAddress: String) {
    val address = rawAddress.trim().uppercase(Locale.ROOT)
    val connection = synchronized(lock) { current }
    if (connection != null && connection.address == address) {
      teardown(connection, WearException(ErrorCodes.DISCONNECTED, "Device forgotten"), null)
    }
    store.forget(address)
    events.log(LogDirection.INFO, null, null, null, "Forgot $address: stored auth key and fake identity cleared")
  }

  private fun onRemoteClosed(connection: Connection, cause: IOException?) {
    val reason = "Connection lost: ${cause?.message ?: "closed by the watch"}"
    events.log(LogDirection.ERROR, null, null, null, reason)
    teardown(connection, WearException(ErrorCodes.DISCONNECTED, reason, cause), reason)
  }

  /** Idempotent. Fails in-flight requests with [cause]; reports `disconnected` with [error] to JS. */
  private fun teardown(connection: Connection, cause: WearException, error: String?) {
    if (!connection.closed.compareAndSet(false, true)) return
    connection.closeCause = cause
    connection.session.close(cause)
    connection.transport.close()
    val wasCurrent = synchronized(lock) {
      if (current === connection) {
        current = null
        state = LinkState.DISCONNECTED
        true
      } else {
        false
      }
    }
    if (wasCurrent) events.state(LinkState.DISCONNECTED, error)
  }

  private fun setState(connection: Connection, next: LinkState) {
    synchronized(lock) {
      if (current !== connection || connection.closed.get()) {
        throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while ${state.wire}")
      }
      state = next
    }
    events.state(next, null)
  }

  // Operations on a connected watch

  private fun requireConnected(): Connection = synchronized(lock) {
    val connection = current
    if (connection == null || (state != LinkState.CONNECTED && state != LinkState.SYNCING)) {
      throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch (state: ${state.wire})")
    }
    connection
  }

  suspend fun refreshBattery(): Int {
    val connection = requireConnected()
    return connection.operationLock.withLock {
      val level = connection.session.queryBattery(Timeouts.QUERY_MS)
      events.battery(level)
      level
    }
  }

  suspend fun syncActivity(fromSec: Long): Map<String, Any?> {
    val connection = requireConnected()
    if (state == LinkState.SYNCING) {
      throw WearException(ErrorCodes.BUSY, "A sync is already running")
    }
    return connection.operationLock.withLock {
      synchronized(lock) {
        if (current !== connection || state != LinkState.CONNECTED) {
          throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch (state: ${state.wire})")
        }
        state = LinkState.SYNCING
      }
      events.state(LinkState.SYNCING, null)
      try {
        ActivitySync(connection.session, events).sync(fromSec).toJs()
      } finally {
        val restored = synchronized(lock) {
          if (current === connection && state == LinkState.SYNCING) {
            state = LinkState.CONNECTED
            true
          } else {
            false
          }
        }
        if (restored) events.state(LinkState.CONNECTED, null)
      }
    }
  }
}
