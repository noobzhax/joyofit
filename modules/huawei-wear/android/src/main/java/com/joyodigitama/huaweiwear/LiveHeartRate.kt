package com.joyodigitama.huaweiwear

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData

/**
 * The live heart rate on Today. While the UI wants it ([setActive]) and the watch is connected, the
 * watch is asked for realtime heart rate (FitnessData 07/1C, GB EnableRealtimeHeartRate) and every
 * reading it pushes becomes an `onHeartRate` event. It is switched off again when the UI no longer
 * wants it, and the watch's automatic heart rate is put back to the user's setting, because GB sends
 * both through the same boolean.
 */
internal class LiveHeartRate(
  private val link: WearLink,
  private val settings: WearSettings,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val lock = Any()
  private var attached: HuaweiSession? = null
  private var subscription: AutoCloseable? = null

  /** The session realtime heart rate is switched on in, so it is not asked twice and not left on. */
  private var running: HuaweiSession? = null

  @Volatile
  private var wanted = false

  private val stateMutex = Mutex()
  private val undecoded = AtomicInteger()

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  /** The UI asks for live heart rate (Today on screen) or stops asking (other screen, app in background). */
  fun setActive(active: Boolean) {
    wanted = active
    scope.launch { if (active) start() else stop() }
  }

  /** Called with every link state change: subscribes on a new session, drops everything when the link is gone. */
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        val isNew = synchronized(lock) {
          if (session === attached) {
            false
          } else {
            subscription?.close()
            attached = session
            subscription = session.subscribe(
              HealthSensors.REALTIME_SERVICE,
              HealthSensors.REALTIME_COMMAND,
              "realtime heart rate",
            ) { onPacket(it) }
            running = null
            true
          }
        }
        if (isNew && wanted) scope.launch { start() }
      }
      LinkState.DISCONNECTED -> synchronized(lock) {
        subscription?.close()
        subscription = null
        attached = null
        running = null
      }
      else -> Unit
    }
  }

  private suspend fun start() {
    stateMutex.withLock {
      if (!wanted) return
      val handle = link.handle() ?: return
      if (!DeviceCaps.supports(FITNESS, REALTIME)) {
        log("Live heart rate: the watch does not list FitnessData 07/1C")
        return
      }
      if (synchronized(lock) { running === handle.session }) return
      try {
        handle.operationLock.withLock {
          HealthSensors.send(handle.session, events, listOf(HealthSensors.realtimeRequest(true)))
        }
        synchronized(lock) { running = handle.session }
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.log(LogDirection.ERROR, null, null, null, "Live heart rate not started: ${e.message}")
      }
    }
  }

  private suspend fun stop() {
    stateMutex.withLock {
      if (wanted) return
      val handle = link.handle() ?: return
      if (synchronized(lock) { running !== handle.session }) return
      try {
        handle.operationLock.withLock {
          val restore = ArrayList<SensorRequest>()
          restore += HealthSensors.realtimeRequest(false)
          if (DeviceCaps.supports(FITNESS, AUTOMATIC)) {
            restore += HealthSensors.automaticHeartRateRequest(settings.healthSensors.automaticHeartRate)
          }
          HealthSensors.send(handle.session, events, restore)
        }
        synchronized(lock) { running = null }
      } catch (e: CancellationException) {
        throw e
      } catch (e: WearException) {
        events.log(LogDirection.ERROR, null, null, null, "Live heart rate not stopped: ${e.message}")
      }
    }
  }

  /** Runs on the read thread: decode and hand off. */
  private fun onPacket(packet: HuaweiPacket) {
    val bpm = HealthSensors.decodeRealtime(packet.tlv)
    if (bpm == null) {
      // The raw frame is already in the log; say once in a while that it carried no reading.
      if (undecoded.getAndIncrement() % UNDECODED_LOG_EVERY == 0) {
        log("Live heart rate: pushed packet without a reading (${packet.tlv})")
      }
      return
    }
    events.heartRate(bpm, System.currentTimeMillis())
  }

  private companion object {
    val FITNESS = FitnessData.id.toInt()
    val REALTIME = HealthSensors.REALTIME_COMMAND.toInt()
    val AUTOMATIC = FitnessData.EnableAutomaticHeartrate.id.toInt()
    const val UNDECODED_LOG_EVERY = 10
  }
}
