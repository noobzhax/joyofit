package com.joyodigitama.huaweiwear

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteException
import android.os.Build
import java.io.IOException
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants

/** What the notification and profile senders need from the live connection. */
internal class LinkHandle(
  val address: String,
  val session: HuaweiSession,
  val notificationState: HuaweiNotificationState,
)

/**
 * The single active session to a watch: RFCOMM transport + packet session + auth/init/sync, and
 * the [LinkState] machine JS observes. At most one [Connection] exists; every failure while
 * connecting (including every authentication failure) tears it down. The JS module and the
 * background service both drive this one instance.
 */
internal class WearLink(
  context: Context,
  private val events: WearEvents,
  private val settings: WearSettings,
  private val syncStore: SyncStore,
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

    @Volatile
    var handle: LinkHandle? = null

    /** Completes when this connect attempt finishes, so a second caller for the same watch can join it. */
    val ready = CompletableDeferred<Map<String, Any?>>()
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

  /** The live connection for sending notifications and profile data; null unless connected. */
  fun handle(): LinkHandle? = synchronized(lock) {
    val connection = current
    if (connection == null || connection.closed.get() || (state != LinkState.CONNECTED && state != LinkState.SYNCING)) null
    else connection.handle
  }

  /** The connected watch, as `connect` returned it; null unless connected. */
  fun deviceInfo(): Map<String, Any?>? = synchronized(lock) {
    val connection = current
    if (connection == null || (state != LinkState.CONNECTED && state != LinkState.SYNCING)) null else connection.info
  }

  /** True until a HiChain bind with [address] has completed; a bind needs the user to confirm on the watch. */
  fun needsBind(address: String): Boolean = store.forDevice(address.trim().uppercase(Locale.ROOT)).isFirstConnection

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

  /** HuaweiJoyoFit4ProCoordinator.getSupportedDeviceName: Fit 4 and Fit 4 Pro, case-insensitive. */
  private fun isSupportedName(name: String): Boolean {
    val lower = name.lowercase(Locale.ROOT)
    return lower.startsWith(HuaweiConstants.HU_JOYOFIT4_NAME) ||
      lower.startsWith(HuaweiConstants.HU_JOYOFIT4PRO_NAME)
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
    var joining: Connection? = null
    synchronized(lock) {
      val existing = current
      if (existing != null) {
        val info = existing.info
        if (existing.address == address) {
          if (info != null && (state == LinkState.CONNECTED || state == LinkState.SYNCING)) return info
          // Another caller (the background service or JS) is already connecting to this watch.
          if (info == null && !existing.closed.get()) joining = existing
        }
        if (joining == null) {
          throw WearException(
            ErrorCodes.BUSY,
            "Already ${state.wire} with ${existing.address}; disconnect before connecting again",
          )
        }
      }
      if (joining == null) {
        connection = Connection(address, adapter.getRemoteDevice(address), adapter)
        current = connection
        state = LinkState.CONNECTING
      } else {
        connection = joining
      }
    }
    joining?.let { return it.ready.await() }
    events.state(LinkState.CONNECTING, null)
    events.log(LogDirection.INFO, null, null, null, "Connecting to $address (RFCOMM, SDP ${HuaweiConstants.UUID_SERVICE_HUAWEI_SDP})")

    try {
      connection.transport.connect(Timeouts.CONNECT_MS)
      events.log(LogDirection.INFO, null, null, null, "RFCOMM connected")

      setState(connection, LinkState.AUTHENTICATING)
      val identity = store.forDevice(address)
      val authenticator = HuaweiAuthenticator(connection.session, identity, events)
      val authMode = authenticator.authenticate()

      setState(connection, LinkState.INITIALIZING)
      val init = HuaweiInitializer(
        session = connection.session,
        events = events,
        bondedName = bondedName(connection.device),
        protocolVersion = authenticator.protocolVersion,
        profile = settings.profile,
        notificationsEnabled = settings.notificationsEnabled,
      ).run()

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
        connection.handle = LinkHandle(address, connection.session, init.notificationState)
        state = LinkState.CONNECTED
      }
      rememberWatch(address, name, info)
      events.state(LinkState.CONNECTED, null)
      init.batteryLevel?.let { events.battery(it) }
      connection.ready.complete(info)
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

  /** The watch becomes the one background mode follows, and gets its row in the shared database. */
  private fun rememberWatch(address: String, name: String, info: Map<String, Any?>) {
    settings.watchAddress = address
    settings.watchName = name
    try {
      syncStore.upsertDevice(address, name, info["productModel"] as String?, info["softwareVersion"] as String?)
    } catch (e: SQLiteException) {
      events.log(LogDirection.ERROR, null, null, null, "Could not store the watch in the database: ${e.message}")
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
    connection.ready.completeExceptionally(cause)
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

  /**
   * Pulls sleep, steps and totals since the last stored sync, commits them to the shared database
   * and reports a summary (also as `onSyncComplete`).
   */
  suspend fun syncActivity(): SyncSummary {
    val connection = requireConnected()
    if (state == LinkState.SYNCING) {
      throw WearException(ErrorCodes.BUSY, "A sync is already running")
    }
    val summary = connection.operationLock.withLock {
      synchronized(lock) {
        if (current !== connection || state != LinkState.CONNECTED) {
          throw WearException(ErrorCodes.NOT_CONNECTED, "Not connected to a watch (state: ${state.wire})")
        }
        state = LinkState.SYNCING
      }
      events.state(LinkState.SYNCING, null)
      try {
        val last = storage { syncStore.lastSync(connection.address) }
        val from = syncWindowStart(last, System.currentTimeMillis() / 1000)
        val result = ActivitySync(connection.session, events).sync(from)
        val stored = storage { syncStore.save(connection.address, result) }
        stored.withWorkouts(syncWorkouts(connection))
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
    events.syncComplete(summary)
    return summary
  }

  /** Database access off the caller's thread; a failed read or write surfaces as ERR_STORAGE. */
  private suspend fun <T> storage(block: () -> T): T =
    try {
      withContext(Dispatchers.IO) { block() }
    } catch (e: SQLiteException) {
      throw WearException(ErrorCodes.STORAGE, "Database error: ${e.message}", e)
    }

  /**
   * Workout sessions and their GPS tracks, after the activity data is stored. Whatever fails here is logged and
   * does not fail the sync: the steps, sleep and totals are already committed.
   */
  private suspend fun syncWorkouts(connection: Connection): Int {
    val workouts = WorkoutStore(syncStore)
    val sync = WorkoutSync(connection.session, events)
    try {
      val now = (System.currentTimeMillis() / 1000).toInt()
      sync.sync(workouts.syncStart(), now, workouts)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Workout sync failed: ${e.message ?: e.javaClass.simpleName}")
    }
    events.log(LogDirection.INFO, null, null, null, "Workout sync: ${sync.saved} workouts stored")
    return sync.saved
  }
}
