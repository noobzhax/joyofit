package com.joyodigitama.huaweiwear

import java.nio.charset.StandardCharsets
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket

/**
 * A feature built on [DataSyncService]. Registered once with [DataSyncService.register]; [register] is
 * called at once so it can add its inbound handlers, [onConnected] after every new watch connection.
 */
internal interface DataSyncFeature {
  val name: String

  /** Add inbound handlers here with `service.onEvent / onConfig / onDictionary / onPoint`. */
  fun register(service: DataSyncService)

  /** Runs once per connection, about a second after the link is up. Throwing is logged and does not stop other features. */
  suspend fun onConnected() = Unit
}

/**
 * DataSync (service 0x37) framework: the four "sample" commands Huawei Health uses for everything under
 * `hw.unitedevice.*` / `hw.sport.*` (calorie intake, activity-ring goals, DST, SOS, ...).
 *
 * Outbound: [sendConfig] (`37/01`), [sendEvent] (`37/02`), [sendSamplePoint] (`37/03`), [sendDictionary] (`37/04`), each gated
 * on the ExpandCapability bit Huawei checks (83, 84, 85, 173), each logging the decision and the outcome.
 *
 * Inbound: watch-initiated `37/01..05` packets are routed by package name and id to handlers registered with
 * [onConfig], [onEvent], [onDictionary], [onPoint]. The watch writes its own package in `src` and the phone's in `wear`;
 * a handler is matched on either orientation. Handlers are `suspend`, run on [scope] (never on the read thread) and may send.
 * The session allows one subscriber per service+command, so this class is the only one for `0x37`.
 */
internal class DataSyncService(
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private class Registration<T>(val phonePkg: String?, val watchPkg: String?, val id: Int?, val handler: suspend (T) -> Unit)

  private val eventHandlers = CopyOnWriteArrayList<Registration<SampleEvent>>()
  private val configHandlers = CopyOnWriteArrayList<Registration<SampleConfigIn>>()
  private val dictHandlers = CopyOnWriteArrayList<Registration<DictQuery>>()
  private val pointHandlers = CopyOnWriteArrayList<Registration<SamplePointIn>>()
  private val features = CopyOnWriteArrayList<DataSyncFeature>()

  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  // Features

  fun register(feature: DataSyncFeature) {
    features += feature
    feature.register(this)
    log("DataSync: feature '${feature.name}' registered")
  }

  // Capability gates

  /** ExpandCapability bit; false until the watch has reported its bitmap. */
  fun supports(bit: Int): Boolean = DeviceCaps.expandCapability(bit)

  fun connected(): Boolean = link.handle() != null

  // Inbound registration. [phonePkg] / [watchPkg] may each be null (wildcard) but not both; [id] null matches every id.

  /** A watch `37/02` event. [handler] receives the event with `phonePkg` / `watchPkg` set to the sides it was matched on. */
  fun onEvent(phonePkg: String?, watchPkg: String?, eventId: Int?, handler: suspend (SampleEvent) -> Unit): AutoCloseable =
    add(eventHandlers, phonePkg, watchPkg, eventId, handler)

  /** A watch `37/01` config; [handler] runs once per config item that matches [configId] (null: all). The item is `event.items`. */
  fun onConfig(phonePkg: String?, watchPkg: String?, configId: Int?, handler: suspend (SampleConfigIn) -> Unit): AutoCloseable =
    add(configHandlers, phonePkg, watchPkg, configId, handler)

  /** A watch `37/04` dictionary request (or push) for [dictId] (null: all). */
  fun onDictionary(phonePkg: String?, watchPkg: String?, dictId: Int?, handler: suspend (DictQuery) -> Unit): AutoCloseable =
    add(dictHandlers, phonePkg, watchPkg, dictId, handler)

  /** A watch `37/03` sample point for [dictId] (null: all). */
  fun onPoint(phonePkg: String?, watchPkg: String?, dictId: Int?, handler: suspend (SamplePointIn) -> Unit): AutoCloseable =
    add(pointHandlers, phonePkg, watchPkg, dictId, handler)

  private fun <T> add(
    list: CopyOnWriteArrayList<Registration<T>>,
    phonePkg: String?,
    watchPkg: String?,
    id: Int?,
    handler: suspend (T) -> Unit,
  ): AutoCloseable {
    require(phonePkg != null || watchPkg != null) { "A DataSync handler needs a phone or a watch package" }
    val registration = Registration(phonePkg, watchPkg, id, handler)
    list += registration
    return AutoCloseable { list.remove(registration) }
  }

  // Outbound. Each returns true when the packet went out; false (with the reason in the log) when the watch is not
  // connected, the capability bit is not set or the write failed. [phonePkg] is `src`, [watchPkg] is `wear`.

  suspend fun sendConfig(
    phonePkg: String,
    watchPkg: String,
    configId: Int,
    data: ByteArray?,
    action: Int = 1,
    modifyMs: Long? = System.currentTimeMillis(),
    what: String = "config $configId",
  ): Boolean = sendConfigs(phonePkg, watchPkg, listOf(ConfigItem(configId, action, data, modifyMs)), what)

  suspend fun sendConfigs(phonePkg: String, watchPkg: String, items: List<ConfigItem>, what: String): Boolean =
    send(DataSyncWire.CMD_CONFIG, what, "$phonePkg -> $watchPkg ids=${items.joinToString { it.configId.toString() }}") { params ->
      DataSyncWire.config(params, phonePkg, watchPkg, items)
    }

  suspend fun sendEvent(
    phonePkg: String,
    watchPkg: String,
    eventId: Int,
    data: ByteArray?,
    level: Int = 0,
    what: String = "event $eventId",
  ): Boolean = send(DataSyncWire.CMD_EVENT, what, "$phonePkg -> $watchPkg id=$eventId level=$level data=${describe(data)}") { params ->
    DataSyncWire.event(params, phonePkg, watchPkg, eventId, level, data)
  }

  suspend fun sendSamplePoint(
    phonePkg: String,
    watchPkg: String,
    dictType: Int,
    values: List<PointValue>,
    startMs: Long? = null,
    endMs: Long? = null,
    metadata: ByteArray? = null,
    what: String = "point $dictType",
  ): Boolean = send(DataSyncWire.CMD_POINT, what, "$phonePkg -> $watchPkg dict=$dictType values=${values.size} start=$startMs end=$endMs") { params ->
    DataSyncWire.samplePoint(params, phonePkg, watchPkg, dictType, values, startMs, endMs, metadata)
  }

  suspend fun sendDictionary(phonePkg: String, watchPkg: String, dictType: Int, rows: List<DictRow>, what: String = "dictionary $dictType"): Boolean =
    send(DataSyncWire.CMD_DICT, what, "$phonePkg -> $watchPkg dict=$dictType rows=${rows.size}") { params ->
      DataSyncWire.dictionary(params, phonePkg, watchPkg, dictType, rows)
    }

  private suspend fun send(command: Int, what: String, detail: String, build: (HuaweiPacket.ParamsProvider) -> HuaweiPacket): Boolean {
    val handle = link.handle()
    if (handle == null) {
      log("DataSync $what: not sent, no connected watch")
      return false
    }
    val bit = DataSyncWire.capabilityFor(command)
    if (bit != null) {
      val ok = supports(bit)
      log("DataSync $what: ${DataSyncWire.commandName(command)} needs ExpandCapability $bit: ${if (ok) "set" else "NOT set"}")
      if (!ok) return false
    }
    return try {
      log("DataSync $what: send $detail")
      handle.session.send(build(handle.session.params), "DataSync $what")
      true
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error("DataSync $what: not sent: ${e.message ?: e.javaClass.simpleName}")
      false
    }
  }

  // Link lifetime

  /** Called with every link state change (WearRuntime), like [PhoneFeatures.onLinkState]. */
  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        if (session === attached) return
        detach()
        attached = session
        for (command in listOf(DataSyncWire.CMD_CONFIG, DataSyncWire.CMD_EVENT, DataSyncWire.CMD_POINT, DataSyncWire.CMD_DICT, DataSyncWire.CMD_COMPACT)) {
          subscriptions += session.subscribe(DataSyncWire.SERVICE.toByte(), command.toByte(), "datasync ${DataSyncWire.commandName(command)}") {
            onPacket(command, it)
          }
        }
        val snapshot = features.toList()
        scope.launch {
          // Let the connect sync's first requests go first; the watch is still settling right after init.
          delay(CONNECT_DELAY_MS)
          for (feature in snapshot) {
            if (attached !== session) return@launch
            try {
              feature.onConnected()
            } catch (e: CancellationException) {
              throw e
            } catch (e: Exception) {
              error("DataSync feature '${feature.name}': onConnected failed: ${e.message ?: e.javaClass.simpleName}")
            }
          }
        }
      }
      LinkState.DISCONNECTED -> detach()
      else -> Unit
    }
  }

  private fun detach() {
    subscriptions.forEach { it.close() }
    subscriptions.clear()
    attached = null
  }

  // Dispatch. Runs on the session's read thread: parse, then hand off.

  private fun onPacket(command: Int, packet: HuaweiPacket) {
    val tlv = packet.getTlv()
    if (tlv == null) {
      error("DataSync ${DataSyncWire.commandName(command)}: watch packet has no readable TLV (decrypt failed?)")
      return
    }
    try {
      when (command) {
        DataSyncWire.CMD_EVENT -> {
          val event = DataSyncWire.parseEvent(tlv)
          log("DataSync event from watch: src=${event.srcPkg} wear=${event.wearPkg} id=${event.eventId} level=${event.level} code=${event.errorCode ?: "-"} data=${describe(event.data)}")
          dispatch(eventHandlers, event.srcPkg, event.wearPkg, event.eventId, event.errorCode, "event") { reg, phone, watch ->
            event.phonePkg = phone
            event.watchPkg = watch
            reg.handler(event)
          }
        }
        DataSyncWire.CMD_CONFIG -> {
          val config = DataSyncWire.parseConfig(tlv)
          val items = config.items.joinToString { "id=${it.configId} action=${it.action} data=${describe(it.data)}" }.ifEmpty { "none" }
          log("DataSync config from watch: src=${config.srcPkg} wear=${config.wearPkg} code=${config.errorCode ?: "-"} $items")
          if (config.items.isEmpty()) {
            dispatch(configHandlers, config.srcPkg, config.wearPkg, null, config.errorCode, "config") { reg, phone, watch ->
              config.phonePkg = phone
              config.watchPkg = watch
              reg.handler(config)
            }
          } else {
            for (item in config.items) {
              val single = SampleConfigIn(config.srcPkg, config.wearPkg, listOf(item), config.errorCode)
              dispatch(configHandlers, config.srcPkg, config.wearPkg, item.configId, config.errorCode, "config") { reg, phone, watch ->
                single.phonePkg = phone
                single.watchPkg = watch
                reg.handler(single)
              }
            }
          }
        }
        DataSyncWire.CMD_DICT -> {
          val query = DataSyncWire.parseDictionary(tlv)
          log("DataSync dictionary from watch: src=${query.srcPkg} wear=${query.wearPkg} dict=${query.dictId} start=${query.startMs} end=${query.endMs} modify=${query.modifyMs} rows=${query.rows.size} code=${query.errorCode ?: "-"}")
          dispatch(dictHandlers, query.srcPkg, query.wearPkg, query.dictId, query.errorCode, "dictionary") { reg, phone, watch ->
            query.phonePkg = phone
            query.watchPkg = watch
            reg.handler(query)
          }
        }
        DataSyncWire.CMD_POINT -> {
          val point = DataSyncWire.parsePoint(tlv)
          log("DataSync point from watch: src=${point.srcPkg} wear=${point.wearPkg} dict=${point.dictId} values=${point.values.size} code=${point.errorCode ?: "-"}")
          dispatch(pointHandlers, point.srcPkg, point.wearPkg, point.dictId, point.errorCode, "point") { reg, phone, watch ->
            point.phonePkg = phone
            point.watchPkg = watch
            reg.handler(point)
          }
        }
        else -> log("DataSync ${DataSyncWire.commandName(command)} from watch: ${tlv}")
      }
    } catch (e: Exception) {
      error("DataSync ${DataSyncWire.commandName(command)}: could not parse the watch's packet: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /**
   * Finds the handlers whose packages match `src` / `wear` in either orientation and runs each on [scope]. A packet with
   * an error code (tag 7F) is the watch's answer to something we sent, not a request: it is logged and not dispatched.
   */
  private fun <T> dispatch(
    list: List<Registration<T>>,
    src: String,
    wear: String,
    id: Int?,
    errorCode: Int?,
    kind: String,
    run: suspend (Registration<T>, String, String) -> Unit,
  ) {
    if (errorCode != null) {
      log("DataSync $kind: watch answer with code $errorCode (100000 is OK), not dispatched")
      return
    }
    var matched = 0
    for (reg in list) {
      if (reg.id != null && reg.id != id) continue
      val (phone, watch) = DataSyncWire.matchPackages(reg.phonePkg, reg.watchPkg, src, wear) ?: continue
      matched++
      scope.launch {
        try {
          run(reg, phone, watch)
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          error("DataSync $kind handler (src=$src wear=$wear id=$id) failed: ${e.message ?: e.javaClass.simpleName}")
        }
      }
    }
    if (matched == 0) log("DataSync $kind: no handler for src=$src wear=$wear id=$id")
  }

  companion object {
    private const val CONNECT_DELAY_MS = 1_000L

    /** UTF-8 text when the bytes are printable (JSON payloads), else hex; for the log only. */
    fun describe(data: ByteArray?): String {
      if (data == null) return "-"
      if (data.isEmpty()) return "(empty)"
      val text = String(data, StandardCharsets.UTF_8)
      val printable = text.all { it == '\n' || it >= ' ' && it != '\uFFFD' }
      return if (printable && data.size > 1) text else data.toHex()
    }
  }
}
