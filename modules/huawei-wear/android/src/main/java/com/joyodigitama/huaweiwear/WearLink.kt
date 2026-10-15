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
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType

/** What the notification and profile senders need from the live connection. */
internal class LinkHandle(
  val address: String,
  val session: HuaweiSession,
  val notificationState: HuaweiNotificationState,
  /** Held by syncs, battery reads and watch face operations, which must not interleave on the one session. */
  val operationLock: Mutex,
)

/**
 * The single active session to a watch: RFCOMM or BLE GATT transport (per model) + packet session + auth/init/sync, and
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

  /**
   * Extra steps of an activity sync that other features add (the P2P health dictionary sync): run under the operation lock after the
   * workouts, each one logged and isolated, so a failing one never fails the sync whose rows are already committed.
   */
  internal val syncExtensions = java.util.concurrent.CopyOnWriteArrayList<suspend (HuaweiSession) -> Unit>()

  private val lock = Any()
  private var current: Connection? = null

  @Volatile
  private var state = LinkState.DISCONNECTED

  private inner class Connection(val address: String, val device: BluetoothDevice, adapter: BluetoothAdapter, val model: ModelMatch) {
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

    /** A listed model uses its Gadgetbridge coordinator's link; for other names Android's view of the device decides. */
    val transportKind: ModelTransport = model.transportFor(isLeOnly(device))

    /** GB's HuaweiDeviceType for the link: BR, or BLE / AW over GATT. */
    val deviceType: HuaweiDeviceType = model.deviceType(transportKind)

    val transport: WatchTransport = when (transportKind) {
      ModelTransport.BR -> RfcommTransport(
        adapter = adapter,
        device = device,
        sdp = model.sdp,
        onData = { chunk -> session.onData(chunk) },
        onRemoteClosed = { cause -> onRemoteClosed(this, cause) },
      )
      ModelTransport.LE -> BleTransport(
        context = appContext,
        device = device,
        newHonorProtocol = model.newHonorProtocol,
        onData = { chunk -> session.onData(chunk) },
        onRemoteClosed = { cause -> onRemoteClosed(this, cause) },
        log = { line -> events.log(LogDirection.INFO, null, null, null, line) },
      )
    }

    init {
      session = HuaweiSession(transport, events)
      session.params.setTransactionsCrypted(model.crypted)
      // GB HuaweiSupportProvider: the AW70 bands send their workout records with their own layout.
      session.params.setAW(deviceType == HuaweiDeviceType.AW)
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

  /** The last watch this process connected to, as `connect` returned it; kept after it disconnects (support report). */
  @Volatile
  var lastDeviceInfo: Map<String, Any?>? = null
    private set

  /** The Bluetooth name of the watch of the last connect attempt, successful or not (support report). */
  @Volatile
  var lastAttemptName: String? = null
    private set

  /** The link opened in the last connect attempt, successful or not (support report). */
  @Volatile
  var lastAttemptTransport: ModelTransport? = null
    private set

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
          mapOf("address" to device.address, "name" to name) + WatchModels.match(device.name).toJs()
        }
        .sortedBy { (it["name"] as String).lowercase(Locale.ROOT) }
    } catch (e: SecurityException) {
      throw WearException(ErrorCodes.BLUETOOTH_PERMISSION, "BLUETOOTH_CONNECT permission denied: ${e.message}", e)
    }
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
        val device = adapter.getRemoteDevice(address)
        val name = bondedName(device)
        val model = WatchModels.match(name)
        if (!model.connectable) {
          throw WearException(ErrorCodes.UNSUPPORTED, "${name ?: address}: ${model.reason}")
        }
        connection = Connection(address, device, adapter, model)
        lastAttemptName = name
        lastAttemptTransport = connection.transportKind
        current = connection
        state = LinkState.CONNECTING
      } else {
        connection = joining
      }
    }
    joining?.let { return it.ready.await() }
    events.state(LinkState.CONNECTING, null)
    val model = connection.model
    val link = when (connection.transportKind) {
      ModelTransport.BR -> "RFCOMM, SDP ${model.sdp}"
      ModelTransport.LE ->
        "Bluetooth LE GATT (${if (model.newHonorProtocol) "Honor service" else "service 0xFE86"}), device type ${connection.deviceType}"
    }
    events.log(
      LogDirection.INFO,
      null,
      null,
      null,
      "Connecting to $address \"${lastAttemptName ?: "no name"}\": ${model.model?.name ?: "unknown model"} (${model.support.wire}), " +
        "$link, encrypted ${model.crypted}",
    )

    try {
      connection.transport.connect(Timeouts.CONNECT_MS)
      events.log(LogDirection.INFO, null, null, null, "${connection.transportKind.label} connected")

      setState(connection, LinkState.AUTHENTICATING)
      val identity = store.forDevice(address)
      val authenticator = HuaweiAuthenticator(connection.session, identity, events, connection.deviceType)
      val authMode = authenticator.authenticate()

      setState(connection, LinkState.INITIALIZING)
      val init = HuaweiInitializer(
        session = connection.session,
        events = events,
        bondedName = bondedName(connection.device),
        protocolVersion = authenticator.protocolVersion,
        profile = settings.profile,
        notificationsEnabled = settings.notificationsEnabled,
        healthSensors = settings.healthSensors,
        deviceType = connection.deviceType,
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
        "model" to model.model?.name,
        "support" to model.support.wire,
      )

      synchronized(lock) {
        if (connection.closed.get() || current !== connection) {
          throw WearException(ErrorCodes.DISCONNECTED, "Disconnected while connecting")
        }
        connection.info = info
        lastDeviceInfo = info
        connection.handle = LinkHandle(address, connection.session, init.notificationState, connection.operationLock)
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

  /** True when Android knows [device] as Bluetooth LE only, so it has no Classic side to open an RFCOMM socket on. */
  @SuppressLint("MissingPermission")
  private fun isLeOnly(device: BluetoothDevice): Boolean =
    try {
      device.type == BluetoothDevice.DEVICE_TYPE_LE
    } catch (e: SecurityException) {
      false
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
        val summary = stored.withWorkouts(syncWorkouts(connection))
        syncNightHrv(connection)
        postMorningSummary()
        for (extension in syncExtensions) {
          try {
            extension(connection.session)
          } catch (e: CancellationException) {
            throw e
          } catch (e: WearException) {
            if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
            events.log(LogDirection.ERROR, null, null, null, "Sync extension failed: ${e.message}")
          } catch (e: Exception) {
            events.log(LogDirection.ERROR, null, null, null, "Sync extension failed: ${e.message ?: e.javaClass.simpleName}")
          }
        }
        summary
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

  /** The morning summary notification, after the night's sleep and HRV are stored; never fails the sync. */
  private suspend fun postMorningSummary() {
    try {
      MorningSummary.postIfDue(appContext, settings, syncStore, events)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Morning summary failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /**
   * Nightly HRV from the watch's stress records, after the sleep is stored. Whatever fails here is logged and does not fail
   * the sync; only a lost link ends it.
   */
  private suspend fun syncNightHrv(connection: Connection) {
    try {
      NightHrvSync(connection.session, events, syncStore).sync(System.currentTimeMillis() / 1000)
    } catch (e: CancellationException) {
      throw e
    } catch (e: WearException) {
      if (e.errorCode == ErrorCodes.DISCONNECTED) throw e
      events.log(LogDirection.ERROR, null, null, null, "Night HRV failed [${e.errorCode}]: ${e.message}")
    } catch (e: Exception) {
      events.log(LogDirection.ERROR, null, null, null, "Night HRV failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }
}
