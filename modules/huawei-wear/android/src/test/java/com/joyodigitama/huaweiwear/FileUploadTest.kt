package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Collections
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileUpload
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The 0x28 upload state machine against a fake watch that drives it the way GB's
 * `AsynchronousResponse.handleFileUpload` expects: file info, hash request, parameters, chunk
 * requests, result, and the 0x27/0x05 watch face confirmation.
 */
class FileUploadTest {
  private class Msg(val service: Int, val command: Int, val tlv: HuaweiTLV?, val payload: ByteArray)

  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  /**
   * Decodes the frames the phone writes (unsliced and sliced, like GB's `serializeSliced`) and lets
   * [respond] answer synchronously. Chunk packets (28/06) are not TLV: their payload is the encrypted
   * TLV wrapper of `fileId, index, position, data`, or the plain bytes when the watch said no encryption.
   */
  private class FakeWatch(private val decryptChunks: Boolean, private val respond: (Msg) -> List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val messages: MutableList<Msg> = Collections.synchronizedList(ArrayList())
    var framesWritten = 0
    private var pending: ByteArrayOutputStream? = null
    private var pendingService = 0
    private var pendingCommand = 0

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        framesWritten++
        val body: ByteArray
        when (f[3].toInt()) {
          0 -> {
            pendingService = f[4].toInt() and 0xFF
            pendingCommand = f[5].toInt() and 0xFF
            body = f.copyOfRange(6, f.size - 2)
          }
          1 -> {
            pendingService = f[5].toInt() and 0xFF
            pendingCommand = f[6].toInt() and 0xFF
            pending = ByteArrayOutputStream().also { it.write(f, 7, f.size - 9) }
            continue
          }
          2 -> {
            pending!!.write(f, 5, f.size - 7)
            continue
          }
          else -> {
            pending!!.write(f, 5, f.size - 7)
            body = pending!!.toByteArray()
            pending = null
          }
        }
        deliver(pendingService, pendingCommand, body)
      }
    }

    private fun deliver(service: Int, command: Int, body: ByteArray) {
      val msg = if (service == 0x28 && command == 0x06) {
        val raw = if (decryptChunks) HuaweiTLV().parse(body).decryptRaw(session.params) else body
        Msg(service, command, null, raw)
      } else {
        val tlv = HuaweiTLV().parse(body, 0, body.size)
        if (tlv.contains(0x7C)) tlv.decrypt(session.params)
        Msg(service, command, tlv, body)
      }
      messages.add(msg)
      for (r in respond(msg)) session.onData(r)
    }

    fun all(service: Int, command: Int) = messages.filter { it.service == service && it.command == command }
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

  private fun setup(decryptChunks: Boolean = true, respond: (Msg) -> List<ByteArray>): Triple<FakeWatch, HuaweiSession, RecordingEvents> {
    val events = RecordingEvents()
    val watch = FakeWatch(decryptChunks, respond)
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    return Triple(watch, session, events)
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)

  /** A watch that follows GB's flow for [file]. */
  private class StandardWatch(
    val file: ByteArray,
    val unit: Int,
    val chunk: Int,
    val noEncrypt: Boolean = false,
    val fileId: Int = 7,
    /** `reportType` of the 27/05 confirmation sent after the result; null sends none. */
    val confirmReport: Int? = 2,
    val resultStatus: Int = 0,
  ) {
    val received = ByteArray(file.size)
    var receivedBytes = 0
    var requestedEnd = 0
    val requests = ArrayList<Pair<Int, Int>>()
    val packetIndexes = ArrayList<Int>()
    var nameSeen = ""

    private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
      val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
      val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
      return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
    }

    private fun nextRequest(): List<ByteArray> {
      val position = requestedEnd
      val size = minOf(chunk, file.size - position)
      requestedEnd = position + size
      requests.add(position to size)
      return listOf(tlvFrame(0x28, 0x05, HuaweiTLV().put(0x02, position).put(0x03, size)))
    }

    fun respond(m: Msg): List<ByteArray> = when {
      m.service == 0x28 && m.command == 0x02 -> {
        nameSeen = m.tlv!!.getString(0x01)
        listOf(
          tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 100000)),
          tlvFrame(0x28, 0x03, HuaweiTLV().put(0x01, fileId.toByte())),
        )
      }
      m.service == 0x28 && m.command == 0x03 -> listOf(
        tlvFrame(
          0x28,
          0x04,
          HuaweiTLV()
            .put(0x01, fileId.toByte())
            .put(0x02, "1.0")
            .put(0x03, 5000)
            .put(0x04, 0)
            .put(0x05, unit)
            .put(0x06, chunk)
            .put(0x07, 10)
            .put(0x08, 0)
            .put(0x09, (if (noEncrypt) 1 else 0).toByte()),
        ),
      )
      m.service == 0x28 && m.command == 0x04 -> nextRequest()
      m.service == 0x28 && m.command == 0x06 -> {
        val buffer = ByteBuffer.wrap(m.payload)
        assertEquals(fileId, buffer.get().toInt())
        packetIndexes.add(buffer.get().toInt())
        val position = buffer.getInt()
        val data = ByteArray(buffer.remaining()).also { buffer.get(it) }
        System.arraycopy(data, 0, received, position, data.size)
        receivedBytes += data.size
        when {
          receivedBytes == file.size -> listOf(tlvFrame(0x28, 0x07, HuaweiTLV().put(0x02, resultStatus.toByte())))
          receivedBytes == requestedEnd -> nextRequest()
          else -> emptyList()
        }
      }
      m.service == 0x28 && m.command == 0x07 ->
        confirmReport?.let {
          listOf(tlvFrame(0x27, 0x05, HuaweiTLV().put(0x01, nameSeen.substringBefore('_')).put(0x02, nameSeen.substringAfter('_')).put(0x03, it)))
        } ?: emptyList()
      m.service == 0x27 && m.command == 0x03 -> listOf(tlvFrame(0x27, 0x03, HuaweiTLV().put(0x7f, 100000)))
      else -> emptyList()
    }
  }

  private fun payload(size: Int) = ByteArray(size) { (it * 7 + 3).toByte() }

  @Test
  fun uploadsInTheChunksTheWatchAsksFor() = runBlocking {
    val file = payload(1000)
    val progress = ArrayList<Pair<Int, Int>>()
    val standard = StandardWatch(file, unit = 64, chunk = 300)
    val (watch, session, events) = setup { standard.respond(it) }

    val outcome = FileUploader(session, events, { done, total -> progress.add(done to total) }, stallMs = 2_000, confirmWaitMs = 2_000, settleMs = 100)
      .upload(UploadFile("123456789_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertArrayEquals(file, standard.received)
    assertEquals(listOf(0 to 300, 300 to 300, 600 to 300, 900 to 100), standard.requests)
    // Each chunk is cut into unit-size packets, numbered from 0 inside the chunk.
    assertEquals(listOf(0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1), standard.packetIndexes)

    val info = watch.all(0x28, 0x02).single().tlv!!
    assertEquals("123456789_1.0.0", info.getString(0x01))
    assertEquals(1000, info.getInteger(0x02))
    assertEquals(1, info.getByte(0x03).toInt())
    assertEquals("123456789", info.getString(0x05))
    assertEquals("1.0.0", info.getString(0x06))
    assertFalse(info.contains(0x08))

    val hash = watch.all(0x28, 0x03).single().tlv!!
    assertEquals(7, hash.getByte(0x01).toInt())
    assertArrayEquals(sha256(file), hash.getBytes(0x03))

    val ack = watch.all(0x28, 0x04).single().tlv!!
    assertEquals(100000, ack.getInteger(0x7f))
    assertEquals(7, ack.getByte(0x01).toInt())
    assertFalse("no 0x09 flag when the watch wants encryption", ack.contains(0x09))

    val result = watch.all(0x28, 0x07).single().tlv!!
    assertEquals(100000, result.getInteger(0x7f))
    assertEquals(7, result.getByte(0x01).toInt())

    // reportType 2: the phone confirms and asks the watch to make the face active.
    val confirm = watch.all(0x27, 0x05).single().tlv!!
    assertEquals("123456789", confirm.getString(0x01))
    assertEquals("1.0.0", confirm.getString(0x02))
    assertEquals(100000, confirm.getInteger(0x7f))
    val active = watch.all(0x27, 0x03).single().tlv!!
    assertEquals("123456789", active.getString(0x01))
    assertEquals("1.0.0", active.getString(0x02))
    assertEquals(1, active.getByte(0x03).toInt())

    assertEquals(7, outcome.fileId)
    assertEquals(0, outcome.resultStatus)
    assertEquals(2, outcome.confirmReportType)
    assertTrue(outcome.activateRequested)
    assertEquals(0 to 1000, progress.first())
    assertEquals(1000 to 1000, progress.last())
    assertEquals(progress.map { it.first }, progress.map { it.first }.sorted())
    assertTrue(events.logs.any { it.contains("FileUploadConsultAck") && it.contains("unitSize=64") && it.contains("maxApplyDataSize=300") })
    // The chunk data is not dumped as hex: one summary line per chunk.
    val chunkLogs = events.logs.filter { it.startsWith("tx: FileUpload chunk") }
    assertEquals(4, chunkLogs.size)
    assertTrue(chunkLogs.all { it.contains("hex not logged") && it.length < 160 })
  }

  @Test
  fun noEncryptFlagSendsPlainChunksAndTheAckFlag() = runBlocking {
    val file = payload(500)
    val standard = StandardWatch(file, unit = 128, chunk = 500, noEncrypt = true, confirmReport = 1)
    val (watch, session, events) = setup(decryptChunks = false) { standard.respond(it) }

    val outcome = FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 2_000, settleMs = 100)
      .upload(UploadFile("42_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertArrayEquals(file, standard.received)
    assertEquals(1, watch.all(0x28, 0x04).single().tlv!!.getByte(0x09).toInt())
    assertEquals(1, outcome.confirmReportType)
    assertFalse(outcome.activateRequested)
    assertTrue("no activation for reportType 1", watch.all(0x27, 0x03).isEmpty())
    assertEquals("the confirm is still answered", 1, watch.all(0x27, 0x05).size)
  }

  @Test
  fun chunksLargerThanTheSliceSizeAreSlicedAndReassembled() = runBlocking {
    val file = payload(2000)
    val standard = StandardWatch(file, unit = 700, chunk = 2000)
    val (watch, session, events) = setup { standard.respond(it) }

    FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 2_000, settleMs = 100).upload(UploadFile("9_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertArrayEquals(file, standard.received)
    assertEquals(listOf(0, 1, 2), standard.packetIndexes)
    assertTrue("a 700 byte unit does not fit one 244 byte frame", watch.framesWritten > 10)
  }

  @Test
  fun aWatchAskingForMoreThanIsLeftGetsTheRest() = runBlocking {
    val file = payload(100)
    val standard = StandardWatch(file, unit = 64, chunk = 100)
    val (_, session, events) = setup {
      // The first request asks for 300 bytes of a 100 byte file.
      if (it.service == 0x28 && it.command == 0x04) {
        listOf(tlvFrame(0x28, 0x05, HuaweiTLV().put(0x02, 0).put(0x03, 300)).also { standard.requestedEnd = 100 })
      } else {
        standard.respond(it)
      }
    }

    FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 200, settleMs = 100).upload(UploadFile("5_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertArrayEquals(file, standard.received)
    assertTrue(events.logs.any { it.contains("only 100 are left") })
  }

  @Test
  fun fileInfoRefusedWithTooManyFacesGivesTheKnownMessage() = runBlocking {
    val (watch, session, events) = setup {
      if (it.service == 0x28 && it.command == 0x02) listOf(tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 140004))) else emptyList()
    }
    try {
      FileUploader(session, events, stallMs = 2_000).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, payload(10)))
      fail("expected a rejection")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(140004, e.statusCode)
      assertTrue(e.message!!.contains("too many"))
    }
    assertTrue(watch.all(0x28, 0x03).isEmpty())
    assertTrue(events.logs.any { it.startsWith("error:") && it.contains("status code 140004") })
  }

  @Test
  fun anUnknownRefusalCodeIsReportedExactly() = runBlocking {
    val (_, session, events) = setup {
      if (it.service == 0x28 && it.command == 0x02) listOf(tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 140123))) else emptyList()
    }
    try {
      FileUploader(session, events, stallMs = 2_000).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, payload(10)))
      fail("expected a rejection")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(140123, e.statusCode)
      assertTrue(e.message!!.contains("140123"))
      assertTrue(e.message!!.contains("file info"))
    }
  }

  @Test
  fun deviceErrorReportDuringTheTransferEndsTheUpload() = runBlocking {
    val file = payload(300)
    val standard = StandardWatch(file, unit = 64, chunk = 300)
    val (_, session, events) = setup {
      if (it.service == 0x28 && it.command == 0x04) {
        listOf(tlvFrame(0x28, 0x08, HuaweiTLV().put(0x01, 7.toByte()).put(0x7f, 140009)))
      } else {
        standard.respond(it)
      }
    }
    try {
      FileUploader(session, events, stallMs = 2_000).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, file))
      fail("expected a rejection")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(140009, e.statusCode)
      assertTrue(e.message!!.contains("free space"))
    }
  }

  @Test
  fun deviceErrorReportForAnotherFileIsIgnored() = runBlocking {
    val file = payload(100)
    val standard = StandardWatch(file, unit = 64, chunk = 100)
    var injected = false
    val (_, session, events) = setup {
      if (it.service == 0x28 && it.command == 0x04 && !injected) {
        injected = true
        listOf(tlvFrame(0x28, 0x08, HuaweiTLV().put(0x01, 99.toByte()).put(0x7f, 140009))) + standard.respond(it)
      } else {
        standard.respond(it)
      }
    }

    FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 200, settleMs = 100).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertArrayEquals(file, standard.received)
    assertTrue(events.logs.any { it.contains("another file id; ignored") })
  }

  @Test
  fun zeroUnitSizeIsAProtocolError() = runBlocking {
    val standard = StandardWatch(payload(100), unit = 0, chunk = 100)
    val (_, session, events) = setup { standard.respond(it) }
    try {
      FileUploader(session, events, stallMs = 2_000).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, payload(100)))
      fail("expected a protocol error")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.PROTOCOL, e.errorCode)
      assertTrue(e.message!!.contains("unit size"))
    }
  }

  @Test
  fun aSilentWatchTimesOut() = runBlocking {
    val (_, session, events) = setup { emptyList() }
    try {
      FileUploader(session, events, stallMs = 300).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, payload(10)))
      fail("expected a timeout")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.TIMEOUT, e.errorCode)
      assertTrue(e.message!!.contains("accept the file"))
    }
  }

  @Test
  fun aWatchThatStopsAskingForDataTimesOutWithTheProgressMade() = runBlocking {
    val file = payload(600)
    val standard = StandardWatch(file, unit = 64, chunk = 300)
    val (_, session, events) = setup {
      // Swallow the second chunk request's answer: after the first chunk the watch goes quiet.
      if (it.service == 0x28 && it.command == 0x06 && standard.receivedBytes + (it.payload.size - 6) >= 300) emptyList() else standard.respond(it)
    }
    try {
      FileUploader(session, events, stallMs = 300).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, file))
      fail("expected a timeout")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.TIMEOUT, e.errorCode)
      assertTrue(e.message!!.contains("chunk requests"))
    }
  }

  @Test
  fun aClosedSessionFailsTheUploadAtOnce() = runBlocking {
    val (_, session, events) = setup { emptyList() }
    session.close(WearException(ErrorCodes.DISCONNECTED, "Connection lost"))
    try {
      FileUploader(session, events, stallMs = 30_000).upload(UploadFile("1_1.0.0", FILE_TYPE_WATCHFACE, payload(10)))
      fail("expected a disconnect")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.DISCONNECTED, e.errorCode)
    }
  }

  @Test
  fun missingConfirmationAfterTheTransferIsOnlyLogged() = runBlocking {
    val file = payload(100)
    val standard = StandardWatch(file, unit = 64, chunk = 100, confirmReport = null)
    val (_, session, events) = setup { standard.respond(it) }

    val outcome = FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 300).upload(UploadFile("8_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertNull(outcome.confirmReportType)
    assertFalse(outcome.activateRequested)
    assertTrue(events.logs.any { it.contains("no WatchfaceConfirm") })
  }

  @Test
  fun resultStatusOfTheWatchIsReportedNotInterpreted() = runBlocking {
    val file = payload(100)
    val standard = StandardWatch(file, unit = 64, chunk = 100, confirmReport = null, resultStatus = 3)
    val (_, session, events) = setup { standard.respond(it) }

    val outcome = FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 100).upload(UploadFile("8_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertEquals(3, outcome.resultStatus)
    assertTrue(events.logs.any { it.contains("FileUploadResult: watch status=3") })
  }

  @Test
  fun nonWatchfaceUploadsDoNotWaitForTheWatchfaceConfirm() = runBlocking {
    val file = payload(100)
    val standard = StandardWatch(file, unit = 64, chunk = 100, confirmReport = null)
    val (_, session, events) = setup { standard.respond(it) }

    val started = System.nanoTime()
    FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 5_000).upload(UploadFile("m_1.0.0", FileUpload.Filetype.music, file))

    assertTrue("did not wait for a confirm", (System.nanoTime() - started) / 1_000_000 < 3_000)
  }

  @Test
  fun uploadPacketsParseLikeGbDoes() {
    val params = session0().params
    val consult = tlvFrame(
      0x28,
      0x04,
      HuaweiTLV().put(0x01, 3.toByte()).put(0x02, "1.0").put(0x03, 5000).put(0x04, 1).put(0x05, 1000).put(0x06, 60000).put(0x07, 10).put(0x08, 0),
    )
    val packet = nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket(params).parse(consult)
    assertTrue(packet is FileUpload.FileUploadConsultAck.Response)
    packet.parseTlv()
    val p = (packet as FileUpload.FileUploadConsultAck.Response).fileUploadParams
    assertEquals(1000, p.unit_size)
    assertEquals(60000, p.max_apply_data_size)
    assertEquals("optional tag 0x09 absent means encrypted", 0, p.no_encrypt.toInt())

    val next = nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket(params)
      .parse(tlvFrame(0x28, 0x05, HuaweiTLV().put(0x02, 4096).put(0x03, 8192)))
    assertTrue(next is FileUpload.FileNextChunkParams)
    next.parseTlv()
    assertEquals(4096, (next as FileUpload.FileNextChunkParams).bytesUploaded)
    assertEquals(8192, next.nextchunkSize)
  }

  private fun session0() = HuaweiSession(object : FrameSink {
    override suspend fun write(frames: List<ByteArray>) = Unit
  }, RecordingEvents())

  @Test
  fun chunkSerializationMatchesGbLayout() {
    // serializeFileChunk: per unit packet fileId, index, position (u32 BE), data; unencrypted here.
    val params = session0().params
    val packet = FileUpload.FileNextChunkSend(params)
    val frames = packet.serializeFileChunk(byteArrayOf(1, 2, 3, 4, 5), 100, 2, 9.toByte(), false)
    assertEquals(3, frames.size)
    fun body(f: ByteArray) = f.copyOfRange(6, f.size - 2)
    assertArrayEquals(byteArrayOf(9, 0, 0, 0, 0, 100, 1, 2), body(frames[0]))
    assertArrayEquals(byteArrayOf(9, 1, 0, 0, 0, 102, 3, 4), body(frames[1]))
    assertArrayEquals(byteArrayOf(9, 2, 0, 0, 0, 104, 5), body(frames[2]))
    assertEquals(0x28, frames[0][4].toInt())
    assertEquals(0x06, frames[0][5].toInt())
  }

  @Test
  fun describeUploadCodeKnowsGbsThreeCodes() {
    assertTrue(FileUploader.describeUploadCode(140004, "x").contains("too many"))
    assertTrue(FileUploader.describeUploadCode(140008, "x").contains("already has"))
    assertTrue(FileUploader.describeUploadCode(140009, "x").contains("free space"))
    assertTrue(FileUploader.describeUploadCode(1, "file info").contains("code 1"))
  }

  @Test
  fun describeTlvShowsPrintableValuesAsTextAndTheRestAsHex() {
    val tlv = HuaweiTLV().put(0x01, "123456789_2.8.2").put(0x02, 1_000_000).put(0x03, 1.toByte()).put(0x0a, ByteArray(0)).put(0x7f, 100000)
    assertEquals("01=\"123456789_2.8.2\" 02=000F4240 03=01 0a= 7f=000186A0", describeTlv(tlv))
    assertEquals("(empty)", describeTlv(HuaweiTLV()))
    assertEquals("(none)", describeTlv(null))
  }

  @Test
  fun fileInfoAndHashAreLoggedInTheClearBeforeEncryption() = runBlocking {
    val file = payload(1000)
    val standard = StandardWatch(file, unit = 64, chunk = 300)
    val (_, session, events) = setup { standard.respond(it) }

    FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 2_000, settleMs = 100).upload(UploadFile("123456789_2.8.2", FILE_TYPE_WATCHFACE, file))

    assertTrue(
      events.logs.toString(),
      events.logs.any { it.contains("FileInfoSend TLV before encryption: 01=\"123456789_2.8.2\" 02=000003E8 03=01 05=\"123456789\" 06=\"2.8.2\"") },
    )
    assertTrue(events.logs.any { it.contains("FileHashSend TLV before encryption: 01=07 03=${sha256(file).toHex()}") })
  }

  @Test
  fun aConfirmationThatArrivesSecondsAfterTheResultIsStillHandled() = runBlocking {
    val file = payload(100)
    val standard = StandardWatch(file, unit = 64, chunk = 100, confirmReport = null)
    var live: HuaweiSession? = null
    val (_, session, events) = setup { m ->
      if (m.service == 0x28 && m.command == 0x07) {
        thread {
          Thread.sleep(400)
          live!!.onData(tlvFrame(0x27, 0x05, HuaweiTLV().put(0x01, "8").put(0x02, "1.0.0").put(0x03, 2)))
        }
      }
      standard.respond(m)
    }
    live = session

    val outcome = FileUploader(session, events, stallMs = 2_000, confirmWaitMs = 3_000, settleMs = 100).upload(UploadFile("8_1.0.0", FILE_TYPE_WATCHFACE, file))

    assertEquals(2, outcome.confirmReportType)
    assertTrue(outcome.activateRequested)
    assertEquals(1, standard.requests.size)
  }
}
