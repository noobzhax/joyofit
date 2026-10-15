// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): service/devices/huawei/HuaweiStressCalibration (startMeasurements /
// stopMeasurements: open the RRI stream with 19/01 {01:3}, collect 19/05 for 60 s, close with 19/01 {01:4}).
package com.joyodigitama.huaweiwear

import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.ceil
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.HrRriTest

/** One stored spot reading, as `measureHrv` returns it (`HrvReading` in `HuaweiWear.types.ts`). Times are unix seconds. */
internal class HrvReadingData(
  val start: Long,
  val end: Long,
  val rmssd: Double,
  val sdnn: Double,
  val meanRr: Double,
  val beats: Int,
  val heartRate: Int,
) {
  fun toJs(): Map<String, Any?> = mapOf(
    "start" to start,
    "end" to end,
    "rmssd" to rmssd,
    "sdnn" to sdnn,
    "meanRr" to meanRr,
    "beats" to beats,
    "heartRate" to heartRate,
  )
}

/**
 * The 1-minute HRV measurement the user starts: realtime RR intervals from the watch's PPG sensor (`19/01 {01: 3}` opens
 * them, the watch pushes `19/05 82{83{04 rri, 05 sqi}...}`, `19/01 {01: 4}` closes). Service 0x19 is also where live heart
 * rate runs ([LiveHeartRate]), so that is paused for the minute and put back afterwards. [collect] is shared with the
 * automatic-stress calibration ([StressSwitch]), which needs the same minute of intervals.
 */
internal class HrvSpot(
  private val link: WearLink,
  private val liveHeartRate: LiveHeartRate,
  private val syncStore: SyncStore,
  private val events: WearEvents,
) {
  /** What one minute of measuring produced; [startMs] and [endMs] are the phone's clock around the window. */
  class Collected(val startMs: Long, val endMs: Long, val beats: List<RriBeat>, val packets: Int)

  private val running = AtomicBoolean(false)

  @Volatile
  private var cancelRequested = false

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  /** True while a measurement owns the sensor. */
  val isRunning: Boolean get() = running.get()

  /** Ends a running measurement early; its promise rejects with [ErrorCodes.HRV_CANCELLED]. */
  fun cancel() {
    if (running.get()) cancelRequested = true
  }

  /** Measures for a minute, stores the result and returns it; throws [WearException] with a code JS can show. */
  suspend fun measure(): HrvReadingData {
    val collected = collect()
    return record(collected) ?: throw tooFewBeats(collected)
  }

  /**
   * Opens the RR stream and collects it for [HrvSpotCodec.MEASURE_MS]. The stream is closed and live heart rate restored
   * whatever ends the minute: done, [cancel], the link dropping, or the caller being cancelled.
   */
  suspend fun collect(): Collected {
    val handle = link.handle() ?: throw WearException(ErrorCodes.NOT_CONNECTED, "The watch is not connected")
    if (!DeviceCaps.supports(HrvSpotCodec.SERVICE, HrvSpotCodec.OPEN_CLOSE)) {
      throw WearException(ErrorCodes.UNSUPPORTED, "This watch does not list the heart rate report command (19/01), so it cannot measure HRV")
    }
    if (liveHeartRate.workoutActive) {
      throw WearException(ErrorCodes.BUSY, "A live workout is using the heart rate sensor; finish it first")
    }
    if (!running.compareAndSet(false, true)) throw WearException(ErrorCodes.BUSY, "An HRV measurement is already running")
    cancelRequested = false
    val session = handle.session
    val lock = Any()
    val beats = ArrayList<RriBeat>()
    var packets = 0
    var subscription: AutoCloseable? = null
    var opened = false
    try {
      liveHeartRate.pause()
      subscription = session.subscribe(HrvSpotCodec.SERVICE.toByte(), HrvSpotCodec.RRI_DATA.toByte(), "HRV RR intervals") { packet ->
        val decoded = HrvSpotCodec.decodeRri(packet.tlv)
        val number = synchronized(lock) {
          beats += decoded
          ++packets
        }
        // The first reports show what the watch really sends (tags, sizes), then a sample.
        if (number <= LOG_FIRST_PACKETS || number % LOG_PACKETS_EVERY == 0) {
          events.log(
            LogDirection.INFO, HrvSpotCodec.SERVICE, HrvSpotCodec.RRI_DATA, null,
            "HRV: report #$number carried ${decoded.size} intervals: ${decoded.joinToString { "${it.rri}ms/q${it.sqi}" }} tlv=${packet.tlv}",
          )
        }
      }
      opened = true
      session.send(HrRriTest.OpenOrClose.Request(session.params, HrvSpotCodec.OPEN), "HRV measurement open (19/01 {01: 3})")
      val startMs = System.currentTimeMillis()
      val startNs = System.nanoTime()
      var lastLeft = -1
      while (true) {
        val elapsedMs = (System.nanoTime() - startNs) / 1_000_000
        if (elapsedMs >= HrvSpotCodec.MEASURE_MS) break
        if (cancelRequested) throw WearException(ErrorCodes.HRV_CANCELLED, "The measurement was cancelled")
        session.closeCause?.let { throw it }
        if (link.handle()?.session !== session) throw WearException(ErrorCodes.DISCONNECTED, "The watch disconnected during the measurement")
        val left = ceil((HrvSpotCodec.MEASURE_MS - elapsedMs) / 1000.0).toInt()
        if (left != lastLeft) {
          lastLeft = left
          events.hrvProgress(left, synchronized(lock) { beats.count { it.sqi != 0 } })
        }
        delay(POLL_MS)
      }
      val endMs = System.currentTimeMillis()
      val snapshot = synchronized(lock) { ArrayList(beats) to packets }
      events.hrvProgress(0, snapshot.first.count { it.sqi != 0 })
      log(summary(snapshot.first, snapshot.second, endMs - startMs))
      return Collected(startMs, endMs, snapshot.first, snapshot.second)
    } finally {
      withContext(NonCancellable) {
        subscription?.close()
        if (opened) {
          try {
            session.send(HrRriTest.OpenOrClose.Request(session.params, HrvSpotCodec.CLOSE), "HRV measurement close (19/01 {01: 4})")
          } catch (e: CancellationException) {
            throw e
          } catch (e: Exception) {
            events.log(LogDirection.ERROR, null, null, null, "HRV measurement not closed on the watch: ${e.message}")
          }
        }
        liveHeartRate.resume()
        running.set(false)
      }
    }
  }

  /** Computes RMSSD / SDNN with [HrvMath], stores the intervals and a `spot` reading; null when too few beats were clean. */
  fun record(collected: Collected): HrvReadingData? {
    val result = HrvMath.compute(collected.beats.map { it.rri }, collected.beats.map { it.sqi }) ?: return null
    val reading = HrvReadingData(
      start = collected.startMs / 1000,
      end = collected.endMs / 1000,
      rmssd = result.rmssd,
      sdnn = result.sdnn,
      meanRr = result.meanRr,
      beats = result.beats,
      heartRate = (60_000.0 / result.meanRr).roundToInt(),
    )
    store(reading, collected)
    log("HRV spot: RMSSD %.1f ms, SDNN %.1f ms, mean RR %.0f ms, %d clean beats of %d".format(
      reading.rmssd, reading.sdnn, reading.meanRr, reading.beats, collected.beats.size,
    ))
    return reading
  }

  private fun store(reading: HrvReadingData, collected: Collected) {
    val timeline = rriTimeline(collected.startMs, collected.beats)
    try {
      val db = syncStore.db()
      db.beginTransaction()
      try {
        for ((tsMs, beat) in timeline) {
          db.execSQL("INSERT OR REPLACE INTO rri_samples (ts_ms, rri, sqi) VALUES (?, ?, ?)", arrayOf<Any>(tsMs, beat.rri, beat.sqi))
        }
        db.execSQL(
          "INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats) VALUES (?, ?, 'spot', ?, ?, ?, ?)",
          arrayOf<Any>(reading.start, reading.end, reading.rmssd, reading.sdnn, reading.meanRr, reading.beats),
        )
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    } catch (e: android.database.sqlite.SQLiteException) {
      throw WearException(ErrorCodes.STORAGE, "The HRV reading could not be stored: ${e.message}", e)
    }
  }

  /** Why [collect]'s intervals gave no reading, in words for the user. */
  fun tooFewBeats(collected: Collected): WearException {
    val usable = collected.beats.count { it.sqi != 0 }
    val message = if (collected.beats.isEmpty()) {
      "The watch sent no beat-to-beat data (${collected.packets} reports). Wear it snug on the wrist, sit still and try again."
    } else {
      "Only $usable of ${collected.beats.size} beats had a clean signal (at least ${HrvMath.MIN_BEATS} are needed). " +
        "Wear the watch snug on the wrist, sit still and try again."
    }
    return WearException(ErrorCodes.HRV_TOO_FEW_BEATS, message)
  }

  private fun summary(beats: List<RriBeat>, packets: Int, windowMs: Long): String {
    val sqi = beats.groupingBy { it.sqi }.eachCount().toSortedMap()
    return "HRV: window ${windowMs} ms, $packets reports, ${beats.size} intervals, sqi histogram $sqi" +
      if (beats.isEmpty()) "" else ", rri min ${beats.minOf { it.rri }} max ${beats.maxOf { it.rri }} ms"
  }

  companion object {
    private const val POLL_MS = 200L
    private const val LOG_FIRST_PACKETS = 5
    private const val LOG_PACKETS_EVERY = 10

    /** `rri_samples.ts_ms`: the phone's start of the window plus the intervals so far (each beat lands at the end of its interval). */
    fun rriTimeline(startMs: Long, beats: List<RriBeat>): List<Pair<Long, RriBeat>> {
      var t = startMs
      return beats.map { beat ->
        t += beat.rri
        t to beat
      }
    }
  }
}
