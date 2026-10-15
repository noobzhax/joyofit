package com.joyodigitama.huaweiwear

import android.bluetooth.BluetoothGattCharacteristic
import java.io.IOException
import java.nio.ByteBuffer
import java.util.Collections
import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GattTransportTest {
  private class FakeGattLink(private val busyFailures: Int = 0) : GattLink {
    val chunks: MutableList<ByteArray> = Collections.synchronizedList(ArrayList())
    @Volatile var started: Boolean = false
    @Volatile var closes: Int = 0
    @Volatile var attempts: Int = 0
    override val isReady: Boolean get() = started
    override suspend fun start() {
      started = true
    }
    override suspend fun writeChunk(chunk: ByteArray) {
      if (!started) throw IOException("GATT link is not ready")
      attempts++
      // Replays the Band 11 field failure: the stack refusing a chunk with
      // `writeCharacteristic returned 201` (BluetoothStatusCodes BUSY).
      if (attempts <= busyFailures) throw GattWriteBusyException(201)
      chunks.add(chunk)
    }
    override fun close() {
      closes++
    }
  }

  private class Harness(config: BleGattConfig = BleGattConfig(), busyFailures: Int = 0) {
    val received: MutableList<ByteArray> = Collections.synchronizedList(ArrayList())
    @Volatile var remoteCloses: Int = 0
    @Volatile var remoteCause: IOException? = null
    @Volatile var link: FakeGattLink? = null
    @Volatile var listener: GattLinkListener? = null
    /**
     * Where inbound notifies go. Session tests repoint it at `session.onData`, the same
     * wiring WearLink uses (`onData = { chunk -> session.onData(chunk) }`).
     */
    @Volatile var onDataHook: (ByteArray) -> Unit = { chunk -> received.add(chunk) }
    val transport: GattTransport = GattTransport(
      config = config,
      onData = { chunk -> onDataHook(chunk) },
      onRemoteClosed = { cause ->
        remoteCloses++
        remoteCause = cause
      },
      linkFactory = { events ->
        FakeGattLink(busyFailures).also { fake ->
          link = fake
          listener = events
        }
      },
    )
  }

  private class RecordingEvents : WearEvents {
    val logs: MutableList<Pair<LogDirection, String>> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add(direction to message)
    }
  }

  /** Unsliced, unencrypted BatteryLevel (01/08) response carrying TLV 01:[level]. */
  private fun batteryFrame(level: Int): ByteArray {
    val body: ByteArray = byteArrayOf(0x01, 0x08, 0x01, 0x01, level.toByte())
    val head: ByteArray = ByteBuffer.allocate(4 + body.size)
      .put(0x5A.toByte())
      .putShort((body.size + 1).toShort())
      .put(0x00)
      .put(body)
      .array()
    val crc: Int = CheckSums.getCRC16(head, 0x0000)
    return ByteBuffer.allocate(head.size + 2).put(head).putShort(crc.toShort()).array()
  }

  /** Post-auth session: requests are encrypted with a (zero) secret key like GB's packet tests. */
  private fun session(sink: FrameSink, events: WearEvents): HuaweiSession =
    HuaweiSession(sink, events).also { it.params.setSecretKey(ByteArray(16)) }

  private suspend fun awaitChunks(link: FakeGattLink, count: Int) {
    withTimeout(2_000) { while (link.chunks.size < count) yield() }
  }

  private suspend fun HuaweiSession.battery(): Int {
    val response: DeviceConfig.BatteryLevel.Response =
      request(DeviceConfig.BatteryLevel.Request(params), 2_000, "BatteryLevel")
        .expect("BatteryLevel")
    return response.level.toInt() and 0xFF
  }

  @Test
  fun configDefaultsUseDocumentedHuaweiUuids() {
    val config: BleGattConfig = BleGattConfig()
    assertEquals(HuaweiConstants.UUID_SERVICE_HUAWEI_SERVICE, config.serviceUuid)
    assertEquals(HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_WRITE, config.writeUuid)
    assertEquals(HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_READ, config.notifyUuid)
    assertEquals(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE, config.writeType)
    assertEquals(23, config.mtu)
    assertEquals(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"), BleGattConfig.CCCD_UUID)
  }

  @Test
  fun writesAreChunkedToNegotiatedMtuAndKeptInOrder() = runBlocking {
    val harness: Harness = Harness()
    harness.transport.connect(2_000)

    val first: ByteArray = ByteArray(50) { index -> index.toByte() }
    val second: ByteArray = ByteArray(10) { 0x7F }
    harness.transport.write(listOf(first, second))

    // Default MTU 23 leaves a 20-byte ATT payload per chunk.
    val chunks: List<ByteArray> = harness.link!!.chunks.toList()
    assertEquals(listOf(20, 20, 10, 10), chunks.map { it.size })
    assertArrayEquals(first + second, chunks.reduce { head, tail -> head + tail })
  }

  @Test
  fun mtuChangeAppliesToLaterWrites() = runBlocking {
    val harness: Harness = Harness()
    harness.transport.connect(2_000)

    harness.transport.write(listOf(ByteArray(60) { 0x01 }))
    assertEquals(listOf(20, 20, 20), harness.link!!.chunks.map { it.size })

    harness.listener!!.onMtuChanged(53)
    harness.transport.write(listOf(ByteArray(60) { 0x02 }))

    val sizes: List<Int> = harness.link!!.chunks.map { it.size }
    assertEquals(listOf(20, 20, 20, 50, 10), sizes)
  }

  @Test
  fun firstChunkBusyIsRetriedAndLinkRecovers() = runBlocking {
    // Band 11 field log: TX svc=0x01 cmd=0x01 LinkParams 5A000B0001010100020003000400F13B
    // (16 bytes, one ATT chunk) immediately followed by `writeCharacteristic returned 201`.
    val harness: Harness = Harness(busyFailures = 1)
    harness.transport.connect(2_000)

    val linkParams: ByteArray = byteArrayOf(
      0x5A, 0x00, 0x0B, 0x00, 0x01, 0x01, 0x01, 0x00,
      0x02, 0x00, 0x03, 0x00, 0x04, 0x00, 0xF1.toByte(), 0x3B,
    )
    harness.transport.write(listOf(linkParams))

    assertEquals(1, harness.link!!.chunks.size)
    assertArrayEquals(linkParams, harness.link!!.chunks[0])
    assertEquals(2, harness.link!!.attempts)
  }

  @Test
  fun persistentBusyFailsAfterBoundedRetries() = runBlocking {
    val harness: Harness = Harness(busyFailures = Int.MAX_VALUE)
    harness.transport.connect(2_000)

    var failure: IOException? = null
    try {
      harness.transport.write(listOf(byteArrayOf(0x01)))
    } catch (e: IOException) {
      failure = e
    }
    assertTrue(failure?.message?.contains("201") == true)
    // 1 initial attempt + GattTransport.BUSY_MAX_RETRIES (3): a wedged queue still surfaces.
    assertEquals(4, harness.link!!.attempts)
  }

  @Test
  fun writeBeforeConnectFails() = runBlocking {
    val harness: Harness = Harness()
    var failed: Boolean = false
    try {
      harness.transport.write(listOf(byteArrayOf(0x01)))
    } catch (e: IOException) {
      failed = true
    }
    assertTrue(failed)
  }

  @Test
  fun segmentedNotifiesAreForwardedInOrder() {
    val harness: Harness = Harness()
    harness.listener!!.onNotify(byteArrayOf(0x01, 0x02, 0x03))
    harness.listener!!.onNotify(byteArrayOf(0x04, 0x05))

    assertEquals(2, harness.received.size)
    assertArrayEquals(byteArrayOf(0x01, 0x02, 0x03, 0x04, 0x05), harness.received[0] + harness.received[1])
  }

  @Test
  fun responseSplitAcrossNotifiesIsReassembledBySession() = runBlocking {
    val harness: Harness = Harness()
    harness.transport.connect(2_000)
    val session: HuaweiSession = session(harness.transport, RecordingEvents())
    harness.onDataHook = { chunk -> session.onData(chunk) }

    val pending = async { session.battery() }
    awaitChunks(harness.link!!, 1)

    val frame: ByteArray = batteryFrame(0x42)
    harness.listener!!.onNotify(frame.copyOfRange(0, 3))
    harness.listener!!.onNotify(frame.copyOfRange(3, 7))
    harness.listener!!.onNotify(frame.copyOfRange(7, frame.size))

    assertEquals(0x42, pending.await())
  }

  @Test
  fun concatenatedPacketsInOneNotifyCompleteSessionRequestsInOrder() = runBlocking {
    val harness: Harness = Harness()
    harness.transport.connect(2_000)
    val session: HuaweiSession = session(harness.transport, RecordingEvents())
    harness.onDataHook = { chunk -> session.onData(chunk) }

    val first = async { session.battery() }
    awaitChunks(harness.link!!, 1)
    // Anchor on the first request's chunk count: one request can produce several chunks,
    // so an absolute count cannot prove the second request transmitted (and registered).
    val afterFirst: Int = harness.link!!.chunks.size
    val second = async { session.battery() }
    awaitChunks(harness.link!!, afterFirst + 1)

    harness.listener!!.onNotify(batteryFrame(0x11) + batteryFrame(0xC8))

    assertEquals(0x11, first.await())
    assertEquals(0xC8, second.await())
  }

  @Test
  fun remoteClosePropagatesExactlyOnce() {
    val harness: Harness = Harness()
    val cause: IOException = IOException("link loss")
    harness.listener!!.onDisconnected(cause)
    harness.listener!!.onDisconnected(IOException("link loss"))
    harness.transport.close()

    assertEquals(1, harness.remoteCloses)
    assertTrue(harness.remoteCause === cause)
    assertTrue(harness.link!!.closes >= 1)
  }

  @Test
  fun closeIsIdempotentAndSuppressesLaterRemoteClose() {
    val harness: Harness = Harness()
    harness.transport.close()
    harness.transport.close()
    harness.listener!!.onDisconnected(IOException("link loss"))

    assertEquals(0, harness.remoteCloses)
    assertTrue(harness.link!!.closes >= 1)
  }
}
