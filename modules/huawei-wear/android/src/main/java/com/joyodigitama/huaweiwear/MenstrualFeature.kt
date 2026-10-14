package com.joyodigitama.huaweiwear

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Menstrual

/**
 * The menstrual calendar on the watch plus the log behind it. Two transports, both after Huawei Health 17.0.8.300
 * (`neh` HwMenstrualManager, `neb` HwMenstrualDictionaryManager, see [MenstrualCodec]):
 *  - classic service 0x32: switches, capability, update notice, the watch's requests for the modify time, the cycle list
 *    and the daily status frames, all answered from [CycleModel];
 *  - DataSync dictionary 400018 (`hw.unitedevice.physiological` / `hw.watch.health.physiological`, ExpandCapability 173
 *    and 174): the watch asks for logged flow and cramps, the phone answers at most 10 rows.
 *
 * Off until the user enables it. While off the watch's 0x32 requests are answered with the "no data" error and nothing is
 * pushed. Gated on SupportedCommands 0x32/01 (`isSupportMenstrual`, `lso.d`). Predictions are an average-cycle estimate.
 */
internal class MenstrualFeature(
  private val settings: WatchExtrasSettings,
  private val store: CycleStore,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) : DataSyncFeature {
  override val name = "menstrual"

  private lateinit var service: DataSyncService
  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()

  /** The daily frames the watch is paging through: the key days at the time of its `06` request, and the frame size. */
  @Volatile
  private var frames: Pair<List<Pair<LocalDate, Int>>, Int> = emptyList<Pair<LocalDate, Int>>() to 0

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  override fun register(service: DataSyncService) {
    this.service = service
    service.onDictionary(DICT_PHONE_PKG, DICT_WATCH_PKG, MenstrualCodec.DICT_ID.toInt()) { onDictionaryQuery(it) }
  }

  override suspend fun onConnected() {
    if (!settings.cycleEnabled) {
      log("Menstrual: off in settings, nothing sent")
      return
    }
    syncToWatch("connected")
  }

  // Link

  /** Called with every link state change (WatchExtras): subscribes to the watch's 0x32 requests on a new session. */
  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        if (session === attached) return
        detach()
        attached = session
        for (command in listOf(MenstrualCodec.CMD_MODIFY_TIME, MenstrualCodec.CMD_CYCLES, MenstrualCodec.CMD_FRAME_COUNT, MenstrualCodec.CMD_BODY_STATUS)) {
          subscriptions += session.subscribe(MenstrualCodec.SERVICE.toByte(), command.toByte(), "menstrual $command") { onWatchPacket(command, it) }
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

  // Gates

  /** Why the calendar cannot be sent to the connected watch, or null when it can. */
  fun gate(): String? {
    if (!service.connected()) return "no watch connected"
    if (!DeviceCaps.supports(MenstrualCodec.SERVICE, MenstrualCodec.CMD_SWITCHES)) return "the watch does not list the menstrual service (0x32 command 01)"
    return null
  }

  private val dictionary: Boolean get() = service.supports(MenstrualCodec.CAP_DICTIONARY) && service.supports(DataSyncWire.CAP_DICT)

  // Phone -> watch

  private suspend fun sendClassic(command: Int, body: HuaweiTLV, what: String) {
    val handle = link.handle() ?: return log("Menstrual $what: not sent, no connected watch")
    log("Menstrual $what: send 0x32/%02x".format(command))
    handle.session.send(Menstrual.Message(handle.session.params, command.toByte(), body), "Menstrual $what")
  }

  private fun bitfield(): Int = settings.cycleSwitches.bitfield(service.supports(MenstrualCodec.CAP_EASY_PREGNANCY_SWITCH))

  /**
   * Capability, switches, then the update notice that makes the watch ask again; flow and cramps go as dictionary rows when the
   * watch has ExpandCapability 173 and 174 (`neh.c`: the last 60 days in 10-day windows, at most 10 rows each).
   */
  suspend fun syncToWatch(reason: String) {
    if (!settings.cycleEnabled) return log("Menstrual: sync ($reason) skipped, off in settings")
    gate()?.let { return log("Menstrual: sync ($reason) skipped, $it") }
    try {
      log("Menstrual: sync to the watch ($reason); dictionary ${if (dictionary) "yes (ExpandCapability 174 and 173)" else "no"}")
      sendClassic(MenstrualCodec.CMD_CAPABILITY, MenstrualCodec.capability(dictionary), "capability")
      sendClassic(MenstrualCodec.CMD_SWITCHES, MenstrualCodec.switches(bitfield()), "switches")
      sendClassic(MenstrualCodec.CMD_UPDATE_NOTICE, MenstrualCodec.updateNotice(), "update notice")
      if (dictionary) pushDictionary(System.currentTimeMillis() - HISTORY_MS, System.currentTimeMillis(), 0L)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error("Menstrual: sync ($reason) failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /** Turns the master reminder switch off on the watch when the feature is disabled (best effort). */
  suspend fun sendDisabled() {
    gate()?.let { return log("Menstrual: master switch not cleared on the watch, $it") }
    try {
      sendClassic(MenstrualCodec.CMD_SWITCHES, MenstrualCodec.switches(settings.cycleSwitches.copy(master = false).bitfield(service.supports(MenstrualCodec.CAP_EASY_PREGNANCY_SWITCH))), "switches (off)")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error("Menstrual: could not clear the switches: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  // Watch -> phone (0x32). Runs on the read thread: parse, then hand off.

  private fun onWatchPacket(command: Int, packet: HuaweiPacket) {
    val tlv = packet.getTlv()
    if (tlv == null) {
      error("Menstrual 0x32/%02x: the watch's packet has no readable TLV".format(command))
      return
    }
    log("Menstrual: watch asks 0x32/%02x tlv=$tlv".format(command))
    scope.launch {
      try {
        answer(command, tlv)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Menstrual 0x32/%02x: ${e.message ?: e.javaClass.simpleName}".format(command))
      }
    }
  }

  private suspend fun answer(command: Int, tlv: HuaweiTLV) {
    if (!settings.cycleEnabled) {
      log("Menstrual 0x32/%02x: off in settings, answering with no data".format(command))
      sendClassic(command, MenstrualCodec.noData(), "no data")
      return
    }
    val zone = ZoneId.systemDefault()
    val now = Instant.now()
    val today = now.atZone(zone).toLocalDate()
    when (command) {
      MenstrualCodec.CMD_MODIFY_TIME -> {
        val modified = withContext(Dispatchers.IO) { store.lastModified() }
        sendClassic(command, MenstrualCodec.modifyTime(modified), "modify time ${modified ?: "none"}")
      }
      MenstrualCodec.CMD_CYCLES -> {
        val request = MenstrualCodec.parseCycleRequest(tlv)
        if (request == null) {
          log("Menstrual 0x32/03: the watch sent an error or no request, not answered")
          return
        }
        val (model, modified) = withContext(Dispatchers.IO) { CycleModel(store.periods(), today) to (store.lastModified() ?: 0L) }
        val entries = model.entries(request.historyCycles, request.futureCycles)
        log("Menstrual 0x32/03: history=${request.historyCycles} future=${request.futureCycles} flags 0a=${request.tag0a} 0b=${request.tag0b} 0c=${request.tag0c}: ${entries.size} cycle(s), cycle ${model.averageCycleDays} d, period ${model.averagePeriodDays} d")
        sendClassic(
          command,
          MenstrualCodec.cycleList(entries, request, now.epochSecond, modified, model.averageCycleDays, model.averagePeriodDays, zone),
          "cycle list",
        )
      }
      MenstrualCodec.CMD_FRAME_COUNT -> {
        val request = MenstrualCodec.parseFrameRequest(tlv)
        if (request == null) {
          log("Menstrual 0x32/06: the watch sent an error, not answered")
          return
        }
        val model = withContext(Dispatchers.IO) { CycleModel(store.periods(), today) }
        val days = model.keyDays(request.historyDays, request.futureDays)
        frames = days to request.frameSize
        val count = MenstrualCodec.frameCount(days.size, request.frameSize)
        log("Menstrual 0x32/06: history=${request.historyDays} d future=${request.futureDays} d frame=${request.frameSize}: ${days.size} key day(s), $count frame(s)")
        sendClassic(command, MenstrualCodec.frameCountAnswer(count), "frame count $count")
      }
      MenstrualCodec.CMD_BODY_STATUS -> {
        val index = MenstrualCodec.parseBodyStatusRequest(tlv)
        val (days, size) = frames
        val frame = index?.let { MenstrualCodec.bodyStatusFrame(it, days, size, zone) }
        if (frame == null) {
          log("Menstrual 0x32/07: no frame $index (have ${days.size} day(s), frame size $size), not answered")
          return
        }
        sendClassic(command, frame, "frame $index")
      }
    }
  }

  // DataSync dictionary 400018

  private suspend fun onDictionaryQuery(query: DictQuery) {
    if (!settings.cycleEnabled) {
      log("Menstrual: dictionary ${query.dictId} query ignored, off in settings")
      return
    }
    if (query.rows.any { row -> row.values.isNotEmpty() }) {
      log("Menstrual: the watch sent edited flow values in dictionary ${query.dictId}; Huawei Health only reads the time window, JoyoFit does too")
    }
    val zone = ZoneId.systemDefault()
    val start = query.startMs ?: 0L
    val end = query.endMs ?: 0L
    val modify = query.modifyMs ?: 0L
    val since = Instant.ofEpochMilli(maxOf(start, 0L)).atZone(zone).toLocalDate()
    val days = withContext(Dispatchers.IO) { store.days(since) }
    val rows = MenstrualCodec.dictionaryRows(days, start, end, modify, zone)
    log("Menstrual: dictionary ${query.dictId} query start=$start end=$end modify=$modify: ${rows.size} row(s) of ${days.size} logged day(s)")
    if (rows.isEmpty()) return
    service.sendDictionary(query.phonePkg, query.watchPkg, MenstrualCodec.DICT_ID.toInt(), rows, what = "menstrual flow")
  }

  /** Proactive push like `neh.c()`: 10-day windows from [fromMs] to [toMs]. */
  private suspend fun pushDictionary(fromMs: Long, toMs: Long, modifyMs: Long) {
    val zone = ZoneId.systemDefault()
    val days = withContext(Dispatchers.IO) { store.days(Instant.ofEpochMilli(fromMs).atZone(zone).toLocalDate()) }
    var windowStart = fromMs
    while (windowStart < toMs) {
      val windowEnd = windowStart + TEN_DAYS_MS
      val rows = MenstrualCodec.dictionaryRows(days, windowStart, windowEnd, modifyMs, zone)
      if (rows.isNotEmpty()) {
        service.sendDictionary(DICT_PHONE_PKG, DICT_WATCH_PKG, MenstrualCodec.DICT_ID.toInt(), rows, what = "menstrual flow push")
      }
      windowStart = windowEnd
    }
  }

  // JS side

  /** Everything the Cycle screen shows. Blocking (database); call off the main thread. */
  fun overview(): Map<String, Any?> {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val periods = store.periods()
    val model = CycleModel(periods, today)
    val days = store.days(today.minusDays(OVERVIEW_DAYS))
    val predictions = model.predictedStarts(CycleModel.PREDICTED_CYCLES).map { start ->
      val ovulation = start.minusDays(CycleModel.LUTEAL_DAYS)
      mapOf(
        "start" to start.toString(),
        "end" to start.plusDays(model.averagePeriodDays - 1L).toString(),
        "fertileStart" to ovulation.minusDays(CycleModel.FERTILE_BEFORE).toString(),
        "fertileEnd" to ovulation.plusDays(CycleModel.FERTILE_AFTER).toString(),
        "ovulation" to ovulation.toString(),
      )
    }
    val switches = settings.cycleSwitches
    return mapOf(
      "today" to today.toString(),
      "enabled" to settings.cycleEnabled,
      "periods" to periods.map { mapOf("start" to it.start.toString(), "end" to it.end?.toString()) },
      "days" to days.map { mapOf("day" to it.day.toString(), "flow" to it.flow, "cramps" to it.cramps) },
      "predictions" to predictions,
      "averageCycleDays" to model.averageCycleDays,
      "averagePeriodDays" to model.averagePeriodDays,
      "periodOngoing" to model.periodOngoing,
      "daysLate" to model.daysLate(),
      "switches" to mapOf(
        "master" to switches.master,
        "periodStart" to switches.periodStart,
        "periodEnd" to switches.periodEnd,
        "fertileStart" to switches.fertileStart,
        "fertileEnd" to switches.fertileEnd,
        "easyPregnancy" to switches.easyPregnancy,
      ),
      "watchConnected" to service.connected(),
      "watchSupported" to (gate() == null),
      "watchNote" to (gate() ?: "the watch lists the menstrual service${if (dictionary) " and flow dictionary" else ""}"),
      "easyPregnancySwitch" to service.supports(MenstrualCodec.CAP_EASY_PREGNANCY_SWITCH),
    )
  }

  fun setEnabled(enabled: Boolean) {
    settings.cycleEnabled = enabled
    scope.launch { if (enabled) syncToWatch("enabled") else sendDisabled() }
  }

  fun setSwitches(switches: MenstrualCodec.Switches) {
    settings.cycleSwitches = switches
    scope.launch { syncToWatch("switches changed") }
  }

  private fun changed(reason: String) {
    scope.launch { syncToWatch(reason) }
  }

  private fun nowSec(): Long = System.currentTimeMillis() / 1000

  private fun today(): LocalDate = LocalDate.now(ZoneId.systemDefault())

  private fun refuse(message: String?) {
    if (message != null) throw WearException(ErrorCodes.INVALID_ARGUMENT, message)
  }

  fun startPeriod(day: String) {
    val date = CycleLogRules.parseDay(day)
    refuse(CycleLogRules.checkStart(store.periods(), date, today()))
    store.startPeriod(date, nowSec())
    log("Cycle log: period started $date")
    changed("period started")
  }

  fun endPeriod(day: String) {
    val date = CycleLogRules.parseDay(day)
    refuse(CycleLogRules.checkEnd(store.periods(), date, today()))
    store.endPeriod(date, nowSec())
    log("Cycle log: period ended $date")
    changed("period ended")
  }

  fun addPeriod(start: String, end: String) {
    val from = CycleLogRules.parseDay(start)
    val to = CycleLogRules.parseDay(end)
    refuse(CycleLogRules.checkRange(store.periods(), from, to, today()))
    store.addPeriod(from, to, nowSec())
    log("Cycle log: period added $from..$to")
    changed("period added")
  }

  fun deletePeriod(start: String) {
    val date = CycleLogRules.parseDay(start)
    store.deletePeriod(date)
    log("Cycle log: period $date deleted")
    changed("period deleted")
  }

  fun logDay(day: String, flow: Int, cramps: Int) {
    val date = CycleLogRules.parseDay(day)
    refuse(CycleLogRules.checkLevels(date, today(), flow, cramps))
    store.logDay(date, flow, cramps, nowSec())
    log("Cycle log: $date flow=$flow cramps=$cramps")
    changed("symptoms logged")
  }

  private companion object {
    const val DICT_PHONE_PKG = "hw.unitedevice.physiological"
    const val DICT_WATCH_PKG = "hw.watch.health.physiological"
    const val DAY_MS = 86_400_000L
    const val TEN_DAYS_MS = 10 * DAY_MS
    const val HISTORY_MS = 60 * DAY_MS
    const val OVERVIEW_DAYS = 120L
  }
}
