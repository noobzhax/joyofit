package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Collections
import java.util.Random
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** `.hwt` validation, the resolution gate, and list / set active / delete / install against a fake 0x27 watch. */
class WatchfaceTest {
  private fun zip(vararg entries: Pair<String, ByteArray>): ByteArray {
    val out = ByteArrayOutputStream()
    ZipOutputStream(out).use { z ->
      for ((name, data) in entries) {
        z.putNextEntry(ZipEntry(name))
        z.write(data)
        z.closeEntry()
      }
    }
    return out.toByteArray()
  }

  private fun description(root: String = "HwTheme", screen: String = "HWHD13", bom: Boolean = false): ByteArray {
    val xml = """<?xml version="1.0" encoding="UTF-8"?>
<$root>
  <title>Night Run</title>
  <title-cn>夜跑</title-cn>
  <author>Joyo</author>
  <designer>Joyo</designer>
  <screen>$screen</screen>
  <version>2.1.0</version>
  <font>Roboto</font>
  <font-cn>NotoSans</font-cn>
</$root>"""
    val bytes = xml.toByteArray(Charsets.UTF_8)
    return if (bom) byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + bytes else bytes
  }

  private val binary = ByteArray(300) { (it * 5 + 1).toByte() }

  private fun hwt(screen: String = "HWHD13", nested: Boolean = true, root: String = "HwTheme", bom: Boolean = false): ByteArray {
    val inner = if (nested) zip("watchface.bin" to binary, "other.txt" to byteArrayOf(1)) else binary
    val entry = if (root == "HnTheme") "com.honor.watchface" else "com.huawei.watchface"
    return zip(
      "description.xml" to description(root, screen, bom),
      entry to inner,
      "preview/cover.jpg" to byteArrayOf(9, 9, 9),
    )
  }

  // Package

  @Test
  fun packageYieldsDescriptionAndTheNestedWatchfaceBin() {
    val pkg = WatchfacePackages.parse(hwt())
    assertEquals("Night Run", pkg.description.title)
    assertEquals("夜跑", pkg.description.titleCn)
    assertEquals("Joyo", pkg.description.author)
    assertEquals("HWHD13", pkg.description.screen)
    assertEquals("2.1.0", pkg.description.version)
    assertFalse(pkg.description.isHonor)
    assertArrayEquals(binary, pkg.binary)
    assertArrayEquals(byteArrayOf(9, 9, 9), pkg.preview)
  }

  @Test
  fun olderPackagesHoldTheBinaryDirectly() {
    assertArrayEquals(binary, WatchfacePackages.parse(hwt(nested = false)).binary)
  }

  @Test
  fun aByteOrderMarkInDescriptionIsAccepted() {
    assertEquals("Night Run", WatchfacePackages.parse(hwt(bom = true)).description.title)
  }

  @Test
  fun honorPackagesUseTheirOwnEntry() {
    val pkg = WatchfacePackages.parse(hwt(root = "HnTheme"))
    assertTrue(pkg.description.isHonor)
    assertArrayEquals(binary, pkg.binary)
  }

  @Test
  fun aFileWithoutDescriptionIsNotAWatchface() {
    for (bytes in listOf(zip("a.txt" to byteArrayOf(1)), ByteArray(50) { 7 })) {
      try {
        WatchfacePackages.parse(bytes)
        fail("expected a refusal")
      } catch (e: WearException) {
        assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
        assertTrue(e.message!!.contains("description.xml"))
      }
    }
  }

  @Test
  fun aPackageWithoutTheWatchfaceEntryIsRefused() {
    try {
      WatchfacePackages.parse(zip("description.xml" to description()))
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!.contains("com.huawei.watchface"))
    }
  }

  @Test
  fun invalidXmlAndUnknownRootsAreRefused() {
    try {
      WatchfacePackages.parseDescription("<HwTheme><title>x".toByteArray())
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!.contains("not valid XML"))
    }
    try {
      WatchfacePackages.parseDescription(description(root = "Other"))
      fail("expected a refusal")
    } catch (e: WearException) {
      assertTrue(e.message!!.contains("root element"))
    }
  }

  @Test
  fun resolutionTableMatchesGbAndFit4IsHwhd13() {
    assertEquals("480*408", WatchfaceResolutions.screenByThemeVersion("HWHD13"))
    assertEquals("0x0", WatchfaceResolutions.screenByThemeVersion("NOPE"))
    assertTrue(WatchfaceResolutions.isValid("HWHD13", "480*408"))
    assertFalse(WatchfaceResolutions.isValid("HWHD13", "408*480"))
    assertFalse(WatchfaceResolutions.isValid("NOPE", "480*408"))
    assertEquals(WatchfaceResolutions.FIT4_SCREEN, WatchfaceResolutions.screenByThemeVersion(WatchfaceResolutions.FIT4_THEME_VERSION))
  }

  @Test
  fun resolutionGateUsesTheWatchsHeightAndWidth() {
    val face = WatchfacePackages.parse(hwt("HWHD13")).description
    val logs = ArrayList<String>()
    WatchfacePackages.checkResolution(face, height = 480, width = 408) { logs.add(it) }
    assertTrue(logs.isEmpty())
    try {
      WatchfacePackages.checkResolution(WatchfacePackages.parse(hwt("HWHD02")).description, 480, 408) { }
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
      assertTrue(e.message!!.contains("454*454"))
      assertTrue(e.message!!.contains("480*408"))
    }
    // A theme version GB does not know is left to the watch.
    WatchfacePackages.checkResolution(WatchfacePackages.parse(hwt("HWHD99")).description, 480, 408) { logs.add(it) }
    assertTrue(logs.single().contains("not in GB's resolution table"))
  }

  @Test
  fun randomNameIsNineDigitsAndVersionOne() {
    val name = WatchfacePackages.randomName(Random(1))
    assertTrue(Regex("^\\d{9}_1\\.0\\.0$").matches(name))
  }

  // Fake 0x27 watch

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

  private fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + body
    val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
    return head + ByteBuffer.allocate(2).putShort(CheckSums.getCRC16(head, 0x0000).toShort()).array()
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV) = frame(service, command, tlv.serialize())

  private class Face(val id: String, val version: String, val name: String, var type: Int)

  /** A watch with a face list. The upload is accepted and appended unless [dropUploads]. */
  private inner class WatchSim(
    val faces: MutableList<Face> = mutableListOf(Face("1000", "1.0.0", "Factory", 0b11), Face("2000", "1.2.0", "Mine", 0)),
    val width: Int = 408,
    val height: Int = 480,
    val dropUploads: Boolean = false,
    val ignoreOperations: Boolean = false,
    val answerNames: Boolean = true,
  ) : FrameSink {
    lateinit var session: HuaweiSession
    val messages: MutableList<Msg> = Collections.synchronizedList(ArrayList())
    private var uploadName = ""
    private var received = 0
    private var uploadSize = 0
    private var requestedEnd = 0
    private val unit = 100
    private val chunk = 250

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val service = f[4].toInt() and 0xFF
        val command = f[5].toInt() and 0xFF
        val body = f.copyOfRange(6, f.size - 2)
        val msg = if (service == 0x28 && command == 0x06) {
          Msg(service, command, null, HuaweiTLV().parse(body).decryptRaw(session.params))
        } else {
          val tlv = HuaweiTLV().parse(body, 0, body.size)
          if (tlv.contains(0x7C)) tlv.decrypt(session.params)
          Msg(service, command, tlv, body)
        }
        messages.add(msg)
        for (r in respond(msg)) session.onData(r)
      }
    }

    fun all(service: Int, command: Int) = messages.filter { it.service == service && it.command == command }

    private fun nextRequest(): List<ByteArray> {
      val position = requestedEnd
      val size = minOf(chunk, uploadSize - position)
      requestedEnd = position + size
      return listOf(tlvFrame(0x28, 0x05, HuaweiTLV().put(0x02, position).put(0x03, size)))
    }

    private fun respond(m: Msg): List<ByteArray> = when {
      m.service == 0x27 && m.command == 0x01 ->
        listOf(
          tlvFrame(
            0x27,
            0x01,
            HuaweiTLV().put(0x01, "6.0.0").put(0x02, width).put(0x03, height).put(0x04, 1.toByte()).put(0x05, 1.toByte()),
          ),
        )
      m.service == 0x27 && m.command == 0x02 -> {
        val list = HuaweiTLV()
        for (face in faces) {
          list.put(0x82, HuaweiTLV().put(0x03, face.id).put(0x04, face.version).put(0x05, face.type.toByte()))
        }
        listOf(tlvFrame(0x27, 0x02, HuaweiTLV().put(0x81, list)))
      }
      m.service == 0x27 && m.command == 0x06 ->
        if (!answerNames) {
          emptyList()
        } else {
          val names = HuaweiTLV()
          for (face in faces) names.put(0x83, HuaweiTLV().put(0x04, face.id).put(0x05, face.name))
          listOf(tlvFrame(0x27, 0x06, HuaweiTLV().put(0x82, names)))
        }
      m.service == 0x27 && m.command == 0x03 -> {
        val id = m.tlv!!.getString(0x01)
        val version = m.tlv.getString(0x02)
        val op = m.tlv.getByte(0x03).toInt()
        if (!ignoreOperations) {
          if (op == 1) {
            faces.forEach { it.type = it.type and 1.inv() }
            faces.firstOrNull { it.id == id && it.version == version }?.let { it.type = it.type or 1 }
          } else if (op == 2) {
            faces.removeAll { it.id == id }
          }
        }
        listOf(tlvFrame(0x27, 0x03, HuaweiTLV().put(0x7f, 100000)))
      }
      m.service == 0x28 && m.command == 0x02 -> {
        uploadName = m.tlv!!.getString(0x01)
        uploadSize = m.tlv.getInteger(0x02)
        listOf(
          tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 100000)),
          tlvFrame(0x28, 0x03, HuaweiTLV().put(0x01, 4.toByte())),
        )
      }
      m.service == 0x28 && m.command == 0x03 -> listOf(
        tlvFrame(
          0x28,
          0x04,
          HuaweiTLV().put(0x01, 4.toByte()).put(0x02, "1.0").put(0x03, 5000).put(0x04, 0).put(0x05, unit).put(0x06, chunk).put(0x07, 10).put(0x08, 0),
        ),
      )
      m.service == 0x28 && m.command == 0x04 -> nextRequest()
      m.service == 0x28 && m.command == 0x06 -> {
        received += m.payload.size - 6
        when {
          received == uploadSize -> listOf(tlvFrame(0x28, 0x07, HuaweiTLV().put(0x02, 0.toByte())))
          received == requestedEnd -> nextRequest()
          else -> emptyList()
        }
      }
      m.service == 0x28 && m.command == 0x07 -> {
        if (!dropUploads) {
          val id = uploadName.substringBefore('_')
          faces.add(Face(id, uploadName.substringAfter('_'), "Night Run", 0))
        }
        listOf(
          tlvFrame(0x27, 0x05, HuaweiTLV().put(0x01, uploadName.substringBefore('_')).put(0x02, uploadName.substringAfter('_')).put(0x03, 2)),
        )
      }
      else -> emptyList()
    }
  }

  private fun setup(watch: WatchSim = WatchSim()): Triple<WatchSim, WatchfaceOps, RecordingEvents> {
    val events = RecordingEvents()
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(1, 2, 3, 5, 6))
    return Triple(watch, WatchfaceOps(session, events, uploadStallMs = 2_000, confirmWaitMs = 500, queryMs = 400), events)
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  // Ops

  @Test
  fun listReadsParamsFacesAndNames() = runBlocking {
    val (watch, ops, events) = setup()

    val list = ops.list()

    assertEquals(408, list.screen!!.width)
    assertEquals(480, list.screen!!.height)
    assertEquals("6.0.0", list.screen!!.maxVersion)
    assertEquals(listOf("1000", "2000"), list.faces.map { it.id })
    assertEquals(listOf("Factory", "Mine"), list.faces.map { it.name })
    assertEquals(listOf(true, false), list.faces.map { it.isFactory })
    assertTrue(list.faces[0].isCurrent)
    assertFalse(list.faces[1].isCurrent)
    // The 27/02 request carries GB's tags; the 27/06 request names every face.
    val names = watch.all(0x27, 0x06).single().tlv!!
    assertEquals(2, names.getObject(0x82).getObjects(0x83).size)
    assertTrue(events.logs.any { it.contains("WatchfaceParams: width=408 height=480") })
    assertTrue(events.logs.any { it.contains("1000_1.0.0") && it.contains("[active]") })
  }

  @Test
  fun listWithoutNamesFallsBackToIds() = runBlocking {
    val (_, ops, events) = setup(WatchSim(answerNames = false))
    // A silent names query must not fail the list.
    val list = ops.list()
    assertEquals(listOf("1000", "2000"), list.faces.map { it.name })
    assertTrue(events.logs.any { it.startsWith("error:") && it.contains("WatchfaceNames failed") })
  }

  @Test
  fun paramsAreOnlyRequestedWhenTheWatchListsThem() = runBlocking {
    val (watch, ops, events) = setup()
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(2, 3, 6))

    val list = ops.list()

    assertNull(list.screen)
    assertTrue(watch.all(0x27, 0x01).isEmpty())
    assertTrue(events.logs.any { it.contains("GB gate supportsWatchfaceParams") })
  }

  @Test
  fun aWatchWithoutTheServiceIsUnsupported() = runBlocking {
    val (watch, ops, _) = setup()
    DeviceCaps.supportedCommands = mapOf(0x07 to byteArrayOf(1))
    try {
      ops.list()
      fail("expected unsupported")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UNSUPPORTED, e.errorCode)
    }
    assertTrue(watch.messages.isEmpty())
  }

  @Test
  fun setActiveSendsTheOperationWithTheListedVersionAndChecksTheList() = runBlocking {
    val (watch, ops, _) = setup()

    val list = ops.setActive("2000")

    val op = watch.all(0x27, 0x03).single().tlv!!
    assertEquals("2000", op.getString(0x01))
    assertEquals("1.2.0", op.getString(0x02))
    assertEquals(1, op.getByte(0x03).toInt())
    assertEquals(listOf(false, true), list.faces.map { it.isCurrent })
  }

  @Test
  fun setActiveFailsWhenTheWatchDoesNotSwitch() = runBlocking {
    val (_, ops, _) = setup(WatchSim(ignoreOperations = true))
    try {
      ops.setActive("2000")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(100000, e.statusCode)
      assertTrue(e.message!!.contains("did not make"))
    }
  }

  @Test
  fun deleteSendsOperationTwoAndChecksTheFaceIsGone() = runBlocking {
    val (watch, ops, _) = setup()

    val list = ops.delete("2000")

    assertEquals(2, watch.all(0x27, 0x03).single().tlv!!.getByte(0x03).toInt())
    assertEquals(listOf("1000"), list.faces.map { it.id })
  }

  @Test
  fun deleteFailsWhenTheFaceStaysOnTheWatch() = runBlocking {
    val (_, ops, _) = setup(WatchSim(ignoreOperations = true))
    try {
      ops.delete("2000")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
    }
  }

  @Test
  fun operationOnAnUnknownIdIsRejectedBeforeAnythingIsSent() = runBlocking {
    val (watch, ops, _) = setup()
    try {
      ops.delete("999")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
    assertTrue(watch.all(0x27, 0x03).isEmpty())
  }

  @Test
  fun aFaceWithoutAVersionStillGetsAnOperation() {
    val packet = watchfaceOperationPacket(HuaweiSession(object : FrameSink {
      override suspend fun write(frames: List<ByteArray>) = Unit
    }, RecordingEvents()).params, "123_", 1)
    assertEquals("123", packet.getTlv().getString(0x01))
    assertEquals("", packet.getTlv().getString(0x02))
    assertEquals(0x27, packet.serviceId.toInt())
    assertEquals(0x03, packet.commandId.toInt())
  }

  // Install

  @Test
  fun installUploadsTheBinaryAndReportsTheNewFace() = runBlocking {
    val (watch, ops, events) = setup()
    val progress = ArrayList<Pair<Int, Int>>()

    val result = ops.install(WatchfacePackages.parse(hwt()), { done, total -> progress.add(done to total) }, "123456789_1.0.0")

    val info = watch.all(0x28, 0x02).single().tlv!!
    assertEquals("123456789_1.0.0", info.getString(0x01))
    assertEquals(binary.size, info.getInteger(0x02))
    assertEquals(1, info.getByte(0x03).toInt())
    assertTrue(result.listed)
    assertEquals("123456789", result.id)
    assertEquals("Night Run", result.name)
    assertEquals(binary.size, result.bytes)
    assertEquals(0, result.uploadStatus)
    assertEquals(2, result.confirmReportType)
    // reportType 2: the phone asked for it to become active, and this watch did it.
    assertEquals(1, watch.all(0x27, 0x03).size)
    assertTrue(result.active)
    assertEquals("Installed and active.", result.message)
    assertEquals(binary.size to binary.size, progress.last())
    assertEquals(0 to binary.size, progress.first())
    assertTrue(events.logs.any { it.contains("Install result: ") })
    assertEquals(listOf("1000", "2000", "123456789"), result.list!!.faces.map { it.id })
  }

  @Test
  fun installRefusesAFaceForAnotherScreenBeforeSendingAnything() = runBlocking {
    val (watch, ops, _) = setup()
    try {
      ops.install(WatchfacePackages.parse(hwt("HWHD02")), { _, _ -> }, "1_1.0.0")
      fail("expected a refusal")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.INVALID_ARGUMENT, e.errorCode)
    }
    assertTrue(watch.all(0x28, 0x02).isEmpty())
  }

  @Test
  fun installWithoutKnownScreenSkipsTheCheckButStillUploads() = runBlocking {
    val (watch, ops, events) = setup()
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(2, 3, 6))

    val result = ops.install(WatchfacePackages.parse(hwt("HWHD02")), { _, _ -> }, "1_1.0.0")

    assertTrue(result.listed)
    assertEquals(1, watch.all(0x28, 0x02).size)
    assertTrue(events.logs.any { it.contains("screen size is unknown") })
  }

  @Test
  fun anUploadTheWatchDropsIsReportedAsNotListed() = runBlocking {
    val (_, ops, _) = setup(WatchSim(dropUploads = true))

    val result = ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "77_1.0.0")

    assertFalse(result.listed)
    assertFalse(result.active)
    assertNotNull(result.list)
    assertTrue(result.message.contains("does not list the new face"))
    assertEquals(0, result.uploadStatus)
  }

  @Test
  fun installFailureCarriesTheWatchsExactCode() = runBlocking {
    val events = RecordingEvents()
    val sim = WatchSim()
    val rejecting = object : FrameSink {
      override suspend fun write(frames: List<ByteArray>) {
        val f = frames.first()
        if ((f[4].toInt() and 0xFF) == 0x28 && (f[5].toInt() and 0xFF) == 0x02) {
          sim.session.onData(tlvFrame(0x28, 0x02, HuaweiTLV().put(0x7f, 140008)))
        } else {
          sim.write(frames)
        }
      }
    }
    val session = HuaweiSession(rejecting, events).also { it.params.setSecretKey(ByteArray(16)) }
    sim.session = session
    DeviceCaps.supportedCommands = mapOf(0x27 to byteArrayOf(1, 2, 3, 5, 6))
    val ops = WatchfaceOps(session, events, uploadStallMs = 1_000, confirmWaitMs = 100, queryMs = 400)

    try {
      ops.install(WatchfacePackages.parse(hwt()), { _, _ -> }, "5_1.0.0")
      fail("expected a rejection")
    } catch (e: WearException) {
      assertEquals(ErrorCodes.UPLOAD_REJECTED, e.errorCode)
      assertEquals(140008, e.statusCode)
    }
  }
}
