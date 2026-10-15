package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FileDownloadTest {
  private class Request(val service: Int, val command: Int, val tlv: HuaweiTLV)

  private class RecordingEvents : WearEvents {
    override fun syncComplete(summary: SyncSummary) = Unit
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  /** A watch that answers each written (unencrypted, unsliced) request synchronously. */
  private class FakeWatch(private val respond: (Request) -> List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val requests: MutableList<Request> = Collections.synchronizedList(ArrayList())

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        // With a secret key set, requests carry their TLV encrypted (tags 7C/7D/7E) like on the real link.
        val tlv = HuaweiTLV().parse(f, 6, f.size - 8).also { if (it.contains(0x7C)) it.decrypt(session.params) }
        val request = Request(f[4].toInt() and 0xFF, f[5].toInt() and 0xFF, tlv)
        requests.add(request)
        for (response in respond(request)) session.onData(response)
      }
    }

    fun count(service: Int, command: Int) = requests.count { it.service == service && it.command == command }
  }

  private fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + body
    val head = ByteBuffer.allocate(4 + inner.size)
      .put(0x5A.toByte())
      .putShort((inner.size + 1).toShort())
      .put(0)
      .put(inner)
      .array()
    val crc = CheckSums.getCRC16(head, 0x0000)
    return head + ByteBuffer.allocate(2).putShort(crc.toShort()).array()
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV) = frame(service, command, tlv.serialize())

  private fun setup(respond: (Request) -> List<ByteArray>): Triple<FakeWatch, HuaweiSession, RecordingEvents> {
    val events = RecordingEvents()
    val watch = FakeWatch(respond)
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    return Triple(watch, session, events)
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  @Test
  fun newSyncDownloadsFileInBlocks() = runBlocking {
    val file = ByteArray(10) { it.toByte() }
    val fileId = 0x16 // GB adds the dict id to block requests only when the file id is the sequence data type
    val (watch, session, _) = setup { r ->
      when (r.command) {
        0x01 -> listOf(
          tlvFrame(
            0x2c,
            0x01,
            HuaweiTLV().put(0x01, "sequence_data").put(0x02, 0x16.toByte()).put(0x03, fileId.toByte()).put(0x04, file.size),
          ),
        )
        0x03 -> listOf(
          tlvFrame(
            0x2c,
            0x03,
            HuaweiTLV().put(0x01, fileId.toByte()).put(0x02, 5.toByte()).put(0x03, 3.toShort()).put(0x04, 6).put(0x05, true),
          ),
        )
        0x04 -> {
          val offset = r.tlv.getInteger(0x02)
          val size = r.tlv.getInteger(0x03)
          // The watch pushes the block in 3-byte packets: fileId, offset, unknown, data.
          (offset until offset + size step 3).map { pos ->
            val chunk = file.copyOfRange(pos, minOf(pos + 3, offset + size))
            frame(0x2c, 0x05, byteArrayOf(fileId.toByte()) + ByteBuffer.allocate(4).putInt(pos).array() + byteArrayOf(0) + chunk)
          }
        }
        else -> emptyList()
      }
    }

    val data = FileDownloader(session, RecordingEvents()).download(FileRequest.sequenceData(100, 200, 700013))

    assertArrayEquals(file, data)
    val init = watch.requests.first { it.command == 0x01 }
    assertEquals("sequence_data", init.tlv.getString(0x01))
    assertEquals(0x16, init.tlv.getByte(0x02).toInt())
    assertEquals(100, init.tlv.getInteger(0x05))
    assertEquals(200, init.tlv.getInteger(0x06))
    assertEquals(700013, init.tlv.getInteger(0x0c))
    val blocks = watch.requests.filter { it.command == 0x04 }
    assertEquals(listOf(0 to 6, 6 to 4), blocks.map { it.tlv.getInteger(0x02) to it.tlv.getInteger(0x03) })
    assertEquals(700013, blocks[0].tlv.getInteger(0x04))
    val complete = watch.requests.last { it.service == 0x2c }
    assertEquals(0x06, complete.command)
    assertEquals(fileId, complete.tlv.getByte(0x01).toInt())
    assertEquals(1, complete.tlv.getByte(0x02).toInt())
  }

  @Test
  fun emptyFileIsCompletedWithoutBlocks() = runBlocking {
    val (watch, session, _) = setup { r ->
      when (r.command) {
        0x01 -> listOf(
          tlvFrame(0x2c, 0x01, HuaweiTLV().put(0x01, "sleep_state.bin").put(0x02, 0x0e.toByte()).put(0x03, 1.toByte()).put(0x04, 0)),
        )
        else -> emptyList()
      }
    }

    val data = FileDownloader(session, RecordingEvents()).download(FileRequest.sleepState(true, 1, 2))

    assertEquals(0, data.size)
    assertEquals(0, watch.count(0x2c, 0x04))
    assertEquals(1, watch.count(0x2c, 0x06))
  }

  @Test
  fun answerForOtherFileIsRejected() = runBlocking {
    val (_, session, _) = setup { r ->
      if (r.command == 0x01) {
        listOf(tlvFrame(0x2c, 0x01, HuaweiTLV().put(0x01, "other.bin").put(0x02, 0x0e.toByte()).put(0x03, 1.toByte()).put(0x04, 4)))
      } else {
        emptyList()
      }
    }

    try {
      FileDownloader(session, RecordingEvents()).download(FileRequest.sleepState(true, 1, 2))
      fail("expected a mismatch")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.PROTOCOL, e.errorCode)
      assertTrue(e.message!!.contains("wrong file"))
    }
  }

  @Test
  fun silentWatchTimesOutBlockDownload() = runBlocking {
    val (_, session, _) = setup { r ->
      when (r.command) {
        0x01 -> listOf(tlvFrame(0x2c, 0x01, HuaweiTLV().put(0x01, "sleep_data.bin").put(0x02, 0x0f.toByte()).put(0x03, 2.toByte()).put(0x04, 8)))
        0x03 -> listOf(
          tlvFrame(0x2c, 0x03, HuaweiTLV().put(0x01, 2.toByte()).put(0x02, 1.toByte()).put(0x03, 3.toShort()).put(0x04, 8).put(0x05, true)),
        )
        else -> emptyList()
      }
    }

    try {
      FileDownloader(session, RecordingEvents()).download(FileRequest.sleepData(true, 1, 2))
      fail("expected a timeout")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.TIMEOUT, e.errorCode)
    }
  }

  @Test
  fun oldSyncReusesFileListAndDecryptsBlocks() = runBlocking {
    val files = mapOf("sleep_state.bin" to ByteArray(5) { (0x10 + it).toByte() }, "sleep_data.bin" to ByteArray(3) { (0x20 + it).toByte() })
    lateinit var params: nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket.ParamsProvider
    var current = ""
    val (watch, session, _) = setup { r ->
      when (r.command) {
        0x01 -> listOf(tlvFrame(0x0a, 0x01, HuaweiTLV().put(0x01, "sleep_state.bin;sleep_data.bin")))
        0x02 -> listOf(
          tlvFrame(0x0a, 0x02, HuaweiTLV().put(0x01, "v1").put(0x02, true).put(0x03, 100.toShort()).put(0x04, 4.toShort()).put(0x05, 5.toShort())),
        )
        0x03 -> {
          current = r.tlv.getString(0x01)
          listOf(tlvFrame(0x0a, 0x03, HuaweiTLV().put(0x02, files.getValue(current).size)))
        }
        0x04 -> {
          val offset = r.tlv.getInteger(0x02)
          val size = r.tlv.getInteger(0x03)
          val part = files.getValue(r.tlv.getString(0x01)).copyOfRange(offset, offset + size)
          // Two packets per block, numbered from 0, each with its TLV encrypted like the real watch.
          part.toList().chunked(2).mapIndexed { number, bytes ->
            val encrypted = HuaweiTLV.encryptRaw(params, byteArrayOf(number.toByte()) + bytes.toByteArray())
            frame(0x0a, 0x05, encrypted.serialize())
          }
        }
        else -> emptyList()
      }
    }
    params = session.params
    val downloader = FileDownloader(session, RecordingEvents())

    val state = downloader.download(FileRequest.sleepState(false, 1, 2))
    val data = downloader.download(FileRequest.sleepData(false, 1, 2))

    assertArrayEquals(files.getValue("sleep_state.bin"), state)
    assertArrayEquals(files.getValue("sleep_data.bin"), data)
    // sleep_data rides on the file list of the sleep_state init: no second init or parameters request.
    assertEquals(1, watch.count(0x0a, 0x01))
    assertEquals(1, watch.count(0x0a, 0x02))
    assertEquals(2, watch.count(0x0a, 0x03))
    assertEquals(2, watch.count(0x0a, 0x06))
    val start = watch.requests.first { it.command == 0x01 }.tlv.getObject(0x83)
    assertEquals(1, start.getInteger(0x04))
    assertEquals(2, start.getInteger(0x05))
  }

  @Test
  fun oldSyncDataFileWithoutPrecedingStateInitFails() = runBlocking {
    val (_, session, _) = setup { emptyList() }
    try {
      FileDownloader(session, RecordingEvents()).download(FileRequest.sleepData(false, 1, 2))
      fail("expected an error")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.PROTOCOL, e.errorCode)
    }
  }

  // SleepSync

  private fun capsWithTruSleep(dict: Boolean, newSync: Boolean = true) {
    DeviceCaps.supportedCommands = mapOf(0x07 to byteArrayOf(0x16))
    DeviceCaps.expandCapabilities = ByteArray(32).also { if (dict) it[143 / 8] = (1 shl (143 % 8)).toByte() }
    DeviceCaps.truSleepNewSync = newSync
  }

  private fun sequenceFile(): ByteArray {
    fun value(dictId: Int, type: Int, bytes: ByteArray) =
      HuaweiTLV().put(0x03, dictId).put(0x04, type.toByte()).put(0x05, bytes)
    val summary = HuaweiTLV().put(
      0x81,
      HuaweiTLV()
        .put(0x82, value(700013686, 3, ByteBuffer.allocate(8).putLong(1_700_000_130L).array()))
        .put(0x82, value(700013786, 1, byteArrayOf(0, 0, 0, 1)))
        .put(0x82, value(700013245, 1, byteArrayOf(0, 0, 0, 85))),
    ).serialize()

    fun record(durationSec: Int, status: Int) =
      ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(durationSec).put(status.toByte()).put(ByteArray(3)).array()
    val details = listOf(
      record(120, 1), // light
      record(0, 1), // invalid: skipped, time does not advance
      record(60, 3), // deep
      record(60, 3), // deep, merged with the previous
      record(90, 2), // invalid: not a multiple of 60
      record(180, 4), // awake
      record(60, 9), // unknown stage
    ).reduce { a, b -> a + b }

    val sequence = ByteBuffer.allocate(32 + summary.size + details.size)
      .order(ByteOrder.BIG_ENDIAN)
      .putInt(1_700_000_000)
      .putInt(1_700_005_000)
      .put(1) // data version
      .put(2) // summary type: TLV
      .putShort(summary.size.toShort())
      .putInt(details.size)
      .put(ByteArray(16))
      .put(summary)
      .put(details)
      .array()

    return ByteBuffer.allocate(32 + sequence.size)
      .order(ByteOrder.BIG_ENDIAN)
      .putInt(sequence.size)
      .putInt(700013)
      .putShort(1)
      .putShort(1)
      .put(ByteArray(20))
      .put(sequence)
      .array()
  }

  private data class Seg(val start: Long, val end: Long, val type: Int, val stage: String?)

  @Test
  fun sequenceFileBecomesStagedSegments() {
    val logs = ArrayList<String>()
    val result = SleepSync.parseSequenceFile(sequenceFile(), supportsBedTime = false) { logs.add(it) }

    // fallAsleepTime 1_700_000_130 is cut to the minute: 1_700_000_100.
    val t = 1_700_000_100L
    assertEquals(
      listOf(
        Seg(t, t + 120, 0x06, "light"),
        Seg(t + 120, t + 240, 0x07, "deep"),
        Seg(t + 240, t + 420, 0x5658, "awake"),
        Seg(t + 420, t + 480, 1, null),
      ),
      result.segments.map { Seg(it.start, it.end, it.type, it.stage) },
    )
    assertTrue(logs.any { it.contains("sleepScore=85") })
    // The watch's score is kept for the night the stages start.
    assertEquals(listOf(t to 85), result.scores.map { it.start to it.score })
  }

  @Test
  fun invalidSequenceFileGivesNoSegments() {
    assertEquals(0, SleepSync.parseSequenceFile(ByteArray(10), supportsBedTime = false) { }.segments.size)
  }

  @Test
  fun stageMappingFollowsGbSampleProvider() {
    assertEquals(listOf(0x06, 0x5656, 0x07, 0x5658, 0x5659, 1, 1), listOf(1, 2, 3, 4, 5, 0, 9).map(SleepSync::rawKindForStage))
    assertEquals(
      listOf("light", "rem", "deep", "awake", "light", null),
      listOf(0x06, 0x5656, 0x07, 0x5658, 0x5659, 1).map(SleepSync::stageForRawKind),
    )
    assertNull(SleepSync.stageForRawKind(0x0a))
  }

  @Test
  fun dictionarySleepIsDownloadedWhenGbWouldUseIt() = runBlocking {
    capsWithTruSleep(dict = true)
    val file = sequenceFile()
    val fileId = 3
    val (watch, session, events) = setup { r ->
      when (r.command) {
        0x01 -> listOf(
          tlvFrame(0x2c, 0x01, HuaweiTLV().put(0x01, "sequence_data").put(0x02, 0x16.toByte()).put(0x03, fileId.toByte()).put(0x04, file.size)),
        )
        0x03 -> listOf(
          tlvFrame(0x2c, 0x03, HuaweiTLV().put(0x01, fileId.toByte()).put(0x02, 5.toByte()).put(0x03, 100.toShort()).put(0x04, 4096).put(0x05, true)),
        )
        0x04 -> {
          val offset = r.tlv.getInteger(0x02)
          val size = r.tlv.getInteger(0x03)
          (offset until offset + size step 200).map { pos ->
            val chunk = file.copyOfRange(pos, minOf(pos + 200, offset + size))
            frame(0x2c, 0x05, byteArrayOf(fileId.toByte()) + ByteBuffer.allocate(4).putInt(pos).array() + byteArrayOf(0) + chunk)
          }
        }
        else -> emptyList()
      }
    }

    val segments = SleepSync(session, events).sync(946684800, 1_700_100_000).segments

    assertEquals(listOf("light", "deep", "awake", null), segments.map { it.stage })
    assertEquals(700013, watch.requests.first { it.command == 0x01 }.tlv.getInteger(0x0c))
    assertTrue(events.logs.any { it.contains("supportsDictSleepSync(ExpandCapability 143)=true") })
  }

  @Test
  fun sleepFilesAreSkippedWithoutTruSleepSupport() = runBlocking {
    DeviceCaps.supportedCommands = mapOf(0x07 to byteArrayOf(0x0a, 0x0b))
    val (watch, session, events) = setup { emptyList() }

    val segments = SleepSync(session, events).sync(1, 2).segments

    assertEquals(0, segments.size)
    assertTrue(watch.requests.isEmpty())
    assertTrue(events.logs.any { it.contains("command 0x16 not supported") })
  }

  @Test
  fun truSleepStateRangesBecomeSegmentsWhenDictionaryIsNotSupported() = runBlocking {
    capsWithTruSleep(dict = false)
    val state = ByteBuffer.allocate(0x20).order(ByteOrder.LITTLE_ENDIAN)
      .putInt(1000).putInt(5000).put(ByteArray(8))
      .putInt(7000).putInt(9000).put(ByteArray(8))
      .array()
    val files = mapOf("sleep_state.bin" to (0x0e to state), "sleep_data.bin" to (0x0f to ByteArray(0)))
    val (watch, session, events) = setup { r ->
      when (r.command) {
        0x01 -> {
          val name = r.tlv.getString(0x01)
          val (type, content) = files.getValue(name)
          listOf(
            tlvFrame(0x2c, 0x01, HuaweiTLV().put(0x01, name).put(0x02, type.toByte()).put(0x03, type.toByte()).put(0x04, content.size)),
          )
        }
        0x03 -> listOf(
          tlvFrame(0x2c, 0x03, HuaweiTLV().put(0x01, 0x0e.toByte()).put(0x02, 5.toByte()).put(0x03, 100.toShort()).put(0x04, 4096).put(0x05, true)),
        )
        0x04 -> listOf(
          frame(0x2c, 0x05, byteArrayOf(0x0e) + ByteBuffer.allocate(4).putInt(0).array() + byteArrayOf(0) + state),
        )
        else -> emptyList()
      }
    }

    val segments = SleepSync(session, events).sync(1, 2).segments

    assertEquals(listOf(listOf(1000L, 5000L, 0x06, "light"), listOf(7000L, 9000L, 0x06, "light")), segments.map { listOf(it.start, it.end, it.type, it.stage) })
    assertEquals(2, watch.count(0x2c, 0x01)) // sleep_state.bin and sleep_data.bin
  }
}
