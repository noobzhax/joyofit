package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.util.Collections
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncInterface
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class P2pTest {
  private class SentP2P(
    val cmd: Byte,
    val seq: Short,
    val src: String?,
    val dst: String?,
    val srcFp: String?,
    val dstFp: String?,
    val data: ByteArray?,
    val code: Int,
  )

  private class FakeTransport(private val caps: Set<Int> = emptySet()) : HuaweiP2PManager.Transport {
    val sent: MutableList<SentP2P> = Collections.synchronizedList(ArrayList())
    val logs = ArrayList<String>()

    override fun sendP2P(cmdId: Byte, sequence: Short, srcPackage: String?, dstPackage: String?, srcFingerprint: String?, dstFingerprint: String?, sendData: ByteArray?, sendCode: Int) {
      sent.add(SentP2P(cmdId, sequence, srcPackage, dstPackage, srcFingerprint, dstFingerprint, sendData, sendCode))
    }

    override fun supportsExpandCapability(which: Int) = which in caps

    override fun log(message: String) {
      logs.add(message)
    }
  }

  private fun params() = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }

  private fun hex(s: String): ByteArray = s.hexToBytes()

  /** What a watch sends: P2P cmd 1 (ping), 2 (data) or 3 (answer). */
  private fun watchPacket(cmd: Int, seq: Int, src: String, dst: String, data: ByteArray? = null, code: Int = 0): P2P.P2PCommand.Response {
    val r = P2P.P2PCommand.Response(params())
    r.cmdId = cmd.toByte()
    r.sequenceId = seq.toShort()
    r.srcPackage = src
    r.dstPackage = dst
    r.respData = data
    r.respCode = code
    return r
  }

  // --- packet ---

  @Test
  fun p2pRequestRoundTripsThroughTheSessionFrames() {
    val sender = params()
    val request = P2P.P2PCommand.Request(sender, 2.toByte(), 7.toShort(), "hw.unitedevice.healthmodel", "com.huawei.health.healthyliving", "UniteDeviceManagement", "fp", byteArrayOf(1, 2, 3), 0)
    val frames = request.serialize()
    assertEquals(1, frames.size)
    // The same bytes, fed back as an inbound packet, parse to the P2P response with every field.
    var packet: HuaweiPacket = HuaweiPacket(sender).parse(frames[0])
    packet.parseTlv()
    assertTrue(packet is P2P.P2PCommand.Response)
    val r = packet as P2P.P2PCommand.Response
    assertEquals(0x34, r.serviceId.toInt())
    assertEquals(0x01, r.commandId.toInt())
    assertEquals(2, r.cmdId.toInt())
    assertEquals(7, r.sequenceId.toInt())
    assertEquals("hw.unitedevice.healthmodel", r.srcPackage)
    assertEquals("com.huawei.health.healthyliving", r.dstPackage)
    assertEquals("UniteDeviceManagement", r.srcFingerprint)
    assertEquals("fp", r.dstFingerprint)
    assertArrayEquals(byteArrayOf(1, 2, 3), r.respData)
  }

  @Test
  fun ackCarriesTheResponseCodeAsAnInteger() {
    val request = P2P.P2PCommand.Request(params(), 3.toByte(), 9.toShort(), "a", "b", null, null, null, 0xCF)
    val packet = HuaweiPacket(request.paramsProvider()).parse(request.serialize()[0])
    packet.parseTlv()
    val r = packet as P2P.P2PCommand.Response
    assertEquals(3, r.cmdId.toInt())
    assertEquals(0xCF, r.respCode)
    assertNull(r.respData)
  }

  private fun HuaweiPacket.paramsProvider(): HuaweiPacket.ParamsProvider {
    val field = HuaweiPacket::class.java.getDeclaredField("paramsProvider")
    field.isAccessible = true
    return field.get(this) as HuaweiPacket.ParamsProvider
  }

  // --- manager and base service ---

  @Test
  fun registrationSendsGbsPingAndAnswer0xcaMarksTheDictionaryServiceAvailable() {
    val transport = FakeTransport()
    val manager = HuaweiP2PManager(transport)
    val service = HuaweiP2PDataDictionarySyncService(manager)
    service.register()
    val ping = transport.sent.single()
    assertEquals(1, ping.cmd.toInt())
    assertEquals("com.huawei.health", ping.src)
    assertEquals("hw.watch.health.filesync", ping.dst)
    assertFalse(service.isAvailable)

    manager.handlePacket(watchPacket(3, ping.seq.toInt(), "hw.watch.health.filesync", "com.huawei.health", null, 0xCA))
    assertTrue(service.isAvailable)
  }

  @Test
  fun aWatchDataPacketIsAckedWith0xcfToTheSender() {
    val transport = FakeTransport()
    val manager = HuaweiP2PManager(transport)
    val service = HuaweiP2PDataDictionarySyncService(manager)
    service.register()
    transport.sent.clear()
    manager.handlePacket(watchPacket(2, 40, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", byteArrayOf(0x09)))
    val ack = transport.sent.single()
    assertEquals(3, ack.cmd.toInt())
    assertEquals(40, ack.seq.toInt())
    assertEquals("hw.unitedevice.datadictionarysync", ack.src)
    assertEquals("hw.watch.health.filesync", ack.dst)
    assertEquals(0xCF, ack.code)
  }

  @Test
  fun wakeAppLinksAreAnsweredNotSupported() {
    val transport = FakeTransport()
    val manager = HuaweiP2PManager(transport)
    val tlv = HuaweiTLV().put(0x04, "huaweischeme://healthapp/router/device/screenshot")
    manager.handlePacket(watchPacket(1, 5, "x.y", "hw.unitedevice.wakeapp", tlv.serialize()))
    assertEquals(0xd2, transport.sent.single().code)
  }

  // --- dictionary sync ---

  /** The watch's answer: type byte 1 + TLV {01: operation, 02: class, 83{84{...}}}; [shortInts] writes the integers variable-sized like the request does. */
  private fun dictTlv(dictClass: Int, vararg entries: HuaweiTLV, shortInts: Boolean = false): ByteArray {
    val container = HuaweiTLV()
    for (e in entries) container.put(0x84, e)
    val tlv = HuaweiTLV()
    if (shortInts) {
      tlv.put(0x01, 1.toByte()).put(0x02, HuaweiP2PDataDictionarySyncService.dictToBytes(dictClass))
    } else {
      tlv.put(0x01, 1).put(0x02, dictClass)
    }
    tlv.put(0x83, container)
    return byteArrayOf(0x01) + tlv.serialize()
  }

  private fun double(v: Double) = ByteBuffer.allocate(8).putDouble(v).array()

  private fun entry(start: Long, end: Long, modify: Long, values: Map<Int, ByteArray>, tag: Int = 0x0a): HuaweiTLV {
    val leaf = HuaweiTLV()
    for ((type, bytes) in values) leaf.put(0x88, HuaweiTLV().put(0x09, type).put(tag, bytes))
    return HuaweiTLV().put(0x05, start).put(0x06, end).put(0x0c, modify).put(0x87, leaf)
  }

  private class MemoryStore : HuaweiDictionarySyncInterface.Store {
    val rows = ArrayList<HuaweiDictionarySyncInterface.Row>()
    override fun getLastFetchTimestamp(type: String) = rows.filter { it.type == type }.maxOfOrNull { it.lastTimestamp } ?: 0L
    override fun persist(rows: MutableList<HuaweiDictionarySyncInterface.Row>) {
      this.rows.addAll(rows)
    }
  }

  /** Runs one class through the real service: startSync -> request on the wire -> watch answer -> handler -> store. */
  private fun syncOne(handlerClass: Int, answer: ByteArray, caps: Set<Int>): Pair<MemoryStore, FakeTransport> {
    val transport = FakeTransport(caps)
    val manager = HuaweiP2PManager(transport)
    val service = HuaweiP2PDataDictionarySyncService(manager)
    service.register()
    manager.handlePacket(watchPacket(3, transport.sent[0].seq.toInt(), "hw.watch.health.filesync", "com.huawei.health", null, 0xCA))
    val handler = service.syncHandlers.first { it.dataClass == handlerClass }
    val store = MemoryStore()
    var completed: Boolean? = null
    service.startSync(
      listOf(handlerClass),
      object : HuaweiP2PDataDictionarySyncService.DictionarySyncCallback {
        override fun onGetLastDataSyncTimestamp(dictClass: Int) = handler.getLastDataSyncTimestamp(store)
        override fun onData(dictClass: Int, dictData: MutableList<HuaweiP2PDataDictionarySyncService.DictData>) = handler.handleData(store, dictData)
        override fun onComplete(complete: Boolean) {
          completed = complete
        }
      },
    )
    // The request GB sends: 0x01 type byte + TLV {01:1, 02:class, 05:start, 06:now, 0d:1}.
    val request = transport.sent.last()
    assertEquals(2, request.cmd.toInt())
    assertEquals("hw.unitedevice.datadictionarysync", request.src)
    assertEquals("hw.watch.health.filesync", request.dst)
    assertEquals("UniteDeviceManagement", request.srcFp)
    assertEquals("SystemApp", request.dstFp)
    assertEquals(0x01, request.data!![0].toInt())
    val sent = HuaweiTLV().parse(request.data, 1, request.data.size - 1)
    assertEquals(1L, sent.getBytes(0x01).fold(0L) { acc, b -> (acc shl 8) or (b.toLong() and 0xFF) })
    assertEquals(handlerClass.toLong(), sent.getBytes(0x02).fold(0L) { acc, b -> (acc shl 8) or (b.toLong() and 0xFF) })
    assertEquals(0L, sent.getLong(0x05))
    assertTrue(sent.contains(0x0d))

    manager.handlePacket(watchPacket(2, 77, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", answer))
    // A non-empty page asks for the next one from the last timestamp; an empty page completes.
    if (completed == null) {
      val next = HuaweiTLV().parse(transport.sent.last().data, 1, transport.sent.last().data!!.size - 1)
      assertTrue(next.getLong(0x05) > 0)
      manager.handlePacket(watchPacket(2, 78, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", dictTlv(handlerClass)))
    }
    assertEquals(true, completed)
    return store to transport
  }

  @Test
  fun hrvEntryIsDecodedLikeGb() {
    val (store, _) = syncOne(
      500044,
      dictTlv(500044, entry(1_700_000_000_000, 1_700_000_300_000, 0, mapOf(500044831 to double(42.0)))),
      setOf(235),
    )
    val row = store.rows.single()
    assertEquals("hrv", row.type)
    assertEquals(1_700_000_000_000, row.timestamp)
    assertEquals(1_700_000_300_000, row.lastTimestamp)
    assertEquals(42.0, row.value!!, 0.0)
    assertEquals(42.0, JSONObject(row.valuesJson).getDouble("rmssd"), 0.0)
  }

  @Test
  fun aWatchAnswerWithVariableSizedIntegersIsAlsoRead() {
    val answer = dictTlv(500044, entry(1_700_000_000_000, 1_700_000_300_000, 0, mapOf(500044831 to double(30.0))), shortInts = true)
    val (store, _) = syncOne(500044, answer, setOf(235))
    assertEquals(30.0, store.rows.single().value!!, 0.0)
  }

  @Test
  fun hrvOutOfGbsRangeIsDropped() {
    val (store, _) = syncOne(500044, dictTlv(500044, entry(1_700_000_000_000, 1_700_000_300_000, 0, mapOf(500044831 to double(250.0)))), setOf(235))
    assertTrue(store.rows.isEmpty())
  }

  @Test
  fun emotionKeepsGbsFourValuesAndRanges() {
    val values = mapOf(
      500031195 to double(55.0),
      500031347 to double(61.5),
      500031160 to double(40.0),
      500031842 to double(120.0), // above 100: GB drops it
    )
    val (store, _) = syncOne(500031, dictTlv(500031, entry(1_700_000_000_000, 1_700_000_060_000, 0, values)), setOf(206))
    val row = store.rows.single()
    assertEquals("emotion", row.type)
    assertEquals(55.0, row.value!!, 0.0)
    val json = JSONObject(row.valuesJson)
    assertEquals(55, json.getInt("status"))
    assertEquals(61.5, json.getDouble("valence"), 0.0)
    assertEquals(40, json.getInt("originStatus"))
    assertFalse(json.has("arousal"))
  }

  @Test
  fun skinTemperatureUsesMetricsInGbsRange() {
    val (store, _) = syncOne(400012, dictTlv(400012, entry(1_700_000_000_000, 1_700_000_060_000, 0, mapOf(400012430 to double(34.5)))), setOf(29))
    assertEquals(34.5, store.rows.single().value!!, 0.0)
    val (none, _) = syncOne(400012, dictTlv(400012, entry(1_700_000_000_000, 1_700_000_060_000, 0, mapOf(400012430 to double(12.0)))), setOf(29))
    assertTrue(none.rows.isEmpty())
  }

  @Test
  fun sleepApneaAcceptsLevels1To4() {
    val (store, _) = syncOne(500002, dictTlv(500002, entry(1_700_000_000_000, 1_700_000_060_000, 0, mapOf(500002847 to double(3.0)))), setOf(107))
    assertEquals(3.0, store.rows.single().value!!, 0.0)
    val (none, _) = syncOne(500002, dictTlv(500002, entry(1_700_000_000_000, 1_700_000_060_000, 0, mapOf(500002847 to double(0.0)))), setOf(107))
    assertTrue(none.rows.isEmpty())
  }

  @Test
  fun unknownClassesAreStoredRawByDataType() {
    val values = mapOf(400017111 to double(7.25))
    val (store, _) = syncOne(400017, dictTlv(400017, entry(1_700_000_000_000, 1_700_000_060_000, 0, values)), setOf(75))
    val row = store.rows.single()
    assertEquals("arterial_stiffness", row.type)
    assertNull(row.value)
    assertEquals(7.25, JSONObject(row.valuesJson).getDouble("400017111"), 0.0)
  }

  @Test
  fun aTextValueIsKeptAsText() {
    val tlvEntry = entry(1_700_000_000_000, 1_700_000_060_000, 0, mapOf(10002001 to "ok".toByteArray()), tag = 0x0b)
    val (store, _) = syncOne(10002, dictTlv(10002, tlvEntry), setOf(59))
    assertEquals("ok", JSONObject(store.rows.single().valuesJson).getString("10002001"))
  }

  @Test
  fun gatesFollowGbAndTheWatchBits() {
    // Our Fit 4 Pro: 29, 75, 107, 113, 168, 206, 235 set; 59 and 72 not.
    val watch = HuaweiDictionarySyncInterface.Caps { it in setOf(29, 75, 107, 113, 168, 206, 235) }
    val service = HuaweiP2PDataDictionarySyncService(HuaweiP2PManager(FakeTransport()))
    val supported = service.getAllSupported(watch).keys
    assertEquals(setOf(400012, 500044, 500031, 500002, 400017, 700004), supported)
    assertFalse(10002 in supported)
    assertFalse(200003 in supported)
    assertFalse(500006 in supported)
  }

  @Test
  fun dictClassIsSentAsVariableLengthBigEndian() {
    assertArrayEquals(byteArrayOf(0x07, 0xA1.toByte(), 0x2C), HuaweiP2PDataDictionarySyncService.dictToBytes(500012))
    assertArrayEquals(byteArrayOf(0x07), HuaweiP2PDataDictionarySyncService.dictToBytes(7))
  }

  @Test
  fun aPageThatDoesNotAdvanceEndsTheClassInsteadOfLooping() {
    val transport = FakeTransport()
    val manager = HuaweiP2PManager(transport)
    val service = HuaweiP2PDataDictionarySyncService(manager)
    service.register()
    manager.handlePacket(watchPacket(3, transport.sent[0].seq.toInt(), "hw.watch.health.filesync", "com.huawei.health", null, 0xCA))
    var completed: Boolean? = null
    service.startSync(
      listOf(500044),
      object : HuaweiP2PDataDictionarySyncService.DictionarySyncCallback {
        override fun onGetLastDataSyncTimestamp(dictClass: Int) = 0L
        override fun onData(dictClass: Int, dictData: MutableList<HuaweiP2PDataDictionarySyncService.DictData>) = Unit
        override fun onComplete(complete: Boolean) {
          completed = complete
        }
      },
    )
    // An entry without end or modify time: the next start would be 0 again.
    manager.handlePacket(watchPacket(2, 90, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", dictTlv(500044, entry(5, 0, 0, emptyMap()))))
    assertEquals(true, completed)
  }

  // --- sub message header ---

  @Test
  fun subMessageHeaderIs36BytesLittleEndian() {
    val bytes = HuaweiP2PSubMsg(3, 7, byteArrayOf(0x11, 0x22)).bytes
    assertEquals(38, bytes.size)
    assertArrayEquals(hex("03000000" + "01000000" + "26000000" + "00000000" + "07000000"), bytes.copyOf(20))
    assertArrayEquals(ByteArray(16), bytes.copyOfRange(20, 36))
    assertArrayEquals(byteArrayOf(0x11, 0x22), bytes.copyOfRange(36, 38))
    val parsed = HuaweiP2PSubMsg(bytes)
    assertEquals(3, parsed.type)
    assertEquals(7, parsed.messageId)
    assertArrayEquals(byteArrayOf(0x11, 0x22), parsed.data)
  }

  // --- protobuf ---

  @Test
  fun healthModelRequestMatchesHandComputedBytes() {
    val body = HealthModelMessages.encodeRequestBody(HealthModelMessages.RequestBody(20261014, "2,3", 0, 500))
    assertArrayEquals(hex("0896D1D4091203322C3320F403"), body)
    val request = HealthModelMessages.encodeRequest(2001, 3.0f, body)
    assertArrayEquals(hex("08D10F15000040401A0D0896D1D4091203322C3320F403"), request)

    val decoded = HealthModelMessages.decodeRequest(request)
    assertEquals(2001, decoded.msgType)
    assertEquals(3.0f, decoded.msgVer, 0f)
    val bodyBack = HealthModelMessages.decodeRequestBody(decoded.body)
    assertEquals(20261014, bodyBack.recordDay)
    assertEquals("2,3", bodyBack.requestTaskIds)
    assertEquals(0, bodyBack.pageSize)
    assertEquals(500, bodyBack.packageSize)
  }

  @Test
  fun reportTaskMatchesHandComputedBytesAndRoundTrips() {
    val task = HealthModelMessages.Task(
      taskId = 2, taskTarget = "8000", taskValue = "3210", taskType = 1, taskName = "Steps", progress = 0.40125f, statusDes = "3210/8000",
    )
    val bytes = HealthModelMessages.encodeTask(task)
    assertArrayEquals(hex("080212043830303022043332313040014A0553746570735DA470CD3E6209333231302F38303030"), bytes)
    val back = HealthModelMessages.decodeTask(bytes)
    assertEquals(2, back.taskId)
    assertEquals("8000", back.taskTarget)
    assertEquals("3210", back.taskValue)
    assertEquals(1, back.taskType)
    assertEquals("Steps", back.taskName)
    assertEquals(0.40125f, back.progress, 0f)
    assertEquals("3210/8000", back.statusDes)
  }

  @Test
  fun taskBodyAndNoticeRoundTrip() {
    val body = HealthModelMessages.TaskBody(
      resultCode = 0,
      resultDes = "",
      recordDay = 20261014,
      allTasks = "1,2,3",
      tasks = listOf(HealthModelMessages.Task(1, status = 1, taskName = "Perfect clover"), HealthModelMessages.Task(2, "8000", taskValue = "9000", status = 1, timestamp = 1_700_000_000_123)),
      completedTasks = "2",
      clover = HealthModelMessages.Clover(1f, 0.5f, 0f, 0.25f),
    )
    val back = HealthModelMessages.decodeTaskBody(HealthModelMessages.encodeTaskBody(body))
    assertEquals(20261014, back.recordDay)
    assertEquals("1,2,3", back.allTasks)
    assertEquals("2", back.completedTasks)
    assertEquals(2, back.tasks.size)
    assertEquals(1_700_000_123L / 1_000_000 * 0 + 1_700_000_000_123, back.tasks[1].timestamp)
    assertEquals(0.5f, back.clover!!.left, 0f)
    assertEquals(0.25f, back.clover!!.bottom, 0f)
    assertEquals(0f, back.clover!!.right, 0f)

    val notice = HealthModelMessages.encodeNoticeBody(listOf(HealthModelMessages.Notice(20261014, 5000, "Weekly", "Report ready")))
    val fields = PbReader.fields(notice)
    assertEquals(1, fields.size)
    val inner = PbReader.fields(fields[0].bytes!!)
    assertEquals(listOf(1, 2, 3, 4), inner.map { it.number })
    assertEquals("Report ready", inner[3].asString())
  }

  @Test
  fun truncatedProtobufIsRejected() {
    val ok = HealthModelMessages.encodeRequest(2001, 3.0f, byteArrayOf(1, 2, 3))
    var failed = false
    try {
      PbReader.fields(ok.copyOf(ok.size - 1))
    } catch (e: PbException) {
      failed = true
    }
    assertTrue(failed)
  }

  // --- Healthy Living ---

  private val day = HealthDay(
    recordDay = 20261014,
    steps = 9000,
    stepGoal = 8000,
    exerciseMinutes = 10,
    sleepSeconds = 7 * 3600,
    intakeKcal = 1500.0,
    weightKg = null,
    bloodPressure = false,
    stressMeasured = true,
    timestampMs = 1_700_000_000_000,
  )

  @Test
  fun builderFollowsBxcsLayout() {
    val body = HealthModelBuilder.build(day, HealthGoals(), null)
    // Perfect clover first, then the tasks; the day's task ids are "1," + each wear id.
    assertEquals(listOf(1, 2, 3, 18, 17), body.tasks.map { it.taskId })
    assertEquals("1,2,3,18,17", body.allTasks)
    assertEquals("2,17", body.completedTasks)
    val perfect = body.tasks[0]
    assertEquals("23" + "18" + "17", perfect.taskTarget)
    assertEquals(0, perfect.status) // exercise and sleep are not done
    val steps = body.tasks[1]
    assertEquals("8000", steps.taskTarget)
    assertEquals("9000", steps.taskValue)
    assertEquals(1, steps.status)
    assertEquals(1, steps.taskType)
    assertEquals(1.125f, steps.progress, 0f)
    assertEquals(0, body.tasks[2].taskType) // exercise is only a leaf task without steps
    assertEquals(0f, body.clover!!.bottom, 0f)
    assertEquals(1f, body.clover!!.top, 0f)
    assertEquals(7f / 8f, body.clover!!.left, 1e-6f)
    assertEquals(1f, body.clover!!.right, 0f)
  }

  @Test
  fun requestedIdsFilterTheTaskListButNotAllTasks() {
    val body = HealthModelBuilder.build(day, HealthGoals(), setOf(2))
    assertEquals(listOf(2), body.tasks.map { it.taskId })
    assertEquals("1,2,3,18,17", body.allTasks)
  }

  @Test
  fun everyTaskDonePerfectsTheClover() {
    val full = HealthDay(20261014, 9000, 8000, 45, 9 * 3600, 800.0, 70.0, false, true, 1)
    val body = HealthModelBuilder.build(full, HealthGoals(), null)
    assertEquals(1, body.tasks[0].status)
  }

  @Test
  fun reportsRespectPackageSize() {
    val body = HealthModelBuilder.build(day, HealthGoals(), null)
    val one = HealthModelBuilder.reports(body, 4.0f, 0)
    assertEquals(1, one.size)
    val paged = HealthModelBuilder.reports(body, 4.0f, 200)
    assertTrue(paged.size > 1)
    val decoded = paged.map { HealthModelMessages.decodeTaskBody(HealthModelMessages.decodeReport(it).body) }
    assertEquals(body.tasks.map { it.taskId }, decoded.flatMap { page -> page.tasks.map { it.taskId } })
    for (page in decoded) {
      assertEquals("1,2,3,18,17", page.allTasks)
      assertNotNull(page.clover)
    }
    for (report in paged) assertTrue(report.size <= 100 + 80)
  }

  private class MemoryState : HealthLivingState {
    override var healthLivingEnabled = true
    override var healthLivingMsgVer = 0f
    override var healthLivingPackageSize = 0
    override var healthLivingLastRequestMs = 0L
    override var healthLivingLastReportMs = 0L
    override var healthLivingLastSummary: String? = null
  }

  private val silentEvents = object : WearEvents {
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) = Unit
  }

  private fun healthService(transport: FakeTransport, state: MemoryState): Pair<HuaweiP2PManager, HealthModelService> {
    val manager = HuaweiP2PManager(transport)
    val service = HealthModelService(manager, state, silentEvents, kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default), { day }, { HealthGoals() })
    service.register()
    val ping = transport.sent.single()
    assertEquals(1, ping.cmd.toInt())
    assertEquals("com.huawei.health", ping.src)
    assertEquals("com.huawei.health.healthyliving", ping.dst)
    manager.handlePacket(watchPacket(3, ping.seq.toInt(), "com.huawei.health.healthyliving", "com.huawei.health", null, 0xCA))
    assertEquals(0xCA, service.pingCode)
    transport.sent.clear()
    return manager to service
  }

  @Test
  fun theWatchRequestIsAnsweredWithAReportOnTheSameModule() {
    val transport = FakeTransport(setOf(37))
    val state = MemoryState()
    val (manager, _) = healthService(transport, state)

    val body = HealthModelMessages.encodeRequestBody(HealthModelMessages.RequestBody(20261014, "", 0, 0))
    val request = HealthModelMessages.encodeRequest(2001, 3.0f, body)
    manager.handlePacket(watchPacket(2, 50, "com.huawei.health.healthyliving", "hw.unitedevice.healthmodel", request))

    assertEquals(2, transport.sent.size)
    val ack = transport.sent[0]
    assertEquals(3, ack.cmd.toInt())
    assertEquals(50, ack.seq.toInt())
    assertEquals(0xCF, ack.code)
    assertEquals("hw.unitedevice.healthmodel", ack.src)
    assertEquals("com.huawei.health.healthyliving", ack.dst)

    val report = transport.sent[1]
    assertEquals(2, report.cmd.toInt())
    assertEquals("hw.unitedevice.healthmodel", report.src)
    assertEquals("com.huawei.health.healthyliving", report.dst)
    assertEquals("UniteDeviceManagement", report.srcFp)
    assertEquals(HealthModelService.FINGERPRINT, report.dstFp)
    val decoded = HealthModelMessages.decodeReport(report.data!!)
    assertEquals(2001, decoded.msgType)
    assertEquals(3.0f, decoded.msgVer, 0f)
    val tasks = HealthModelMessages.decodeTaskBody(decoded.body)
    assertEquals(20261014, tasks.recordDay)
    assertEquals(listOf(1, 2, 3, 18, 17), tasks.tasks.map { it.taskId })
    assertEquals("9000", tasks.tasks[1].taskValue)

    assertEquals(3.0f, state.healthLivingMsgVer, 0f)
    assertTrue(state.healthLivingLastRequestMs > 0)
    assertNotNull(state.healthLivingLastSummary)
  }

  @Test
  fun aRequestForAnotherMessageTypeIsAckedButNotAnswered() {
    val transport = FakeTransport(setOf(37))
    val (manager, _) = healthService(transport, MemoryState())
    val request = HealthModelMessages.encodeRequest(2005, 3.0f, ByteArray(0))
    manager.handlePacket(watchPacket(2, 51, "com.huawei.health.healthyliving", "hw.unitedevice.healthmodel", request))
    assertEquals(1, transport.sent.size)
    assertEquals(3, transport.sent[0].cmd.toInt())
  }

  @Test
  fun aSwitchedOffFeatureDoesNotAnswer() {
    val transport = FakeTransport(setOf(37))
    val state = MemoryState().also { it.healthLivingEnabled = false }
    val (manager, _) = healthService(transport, state)
    val request = HealthModelMessages.encodeRequest(2001, 3.0f, ByteArray(0))
    manager.handlePacket(watchPacket(2, 52, "com.huawei.health.healthyliving", "hw.unitedevice.healthmodel", request))
    assertEquals(1, transport.sent.size) // only the ack
  }

  @Test
  fun anOldWatchGetsOneUnpagedReport() {
    val transport = FakeTransport(setOf(37))
    val state = MemoryState()
    val (manager, _) = healthService(transport, state)
    // msgVer 2.0 with a packageSize: Huawei ignores the size below 3.0 (bxr.c).
    val body = HealthModelMessages.encodeRequestBody(HealthModelMessages.RequestBody(20261014, "", 0, 100))
    manager.handlePacket(watchPacket(2, 53, "com.huawei.health.healthyliving", "hw.unitedevice.healthmodel", HealthModelMessages.encodeRequest(2001, 2.0f, body)))
    assertEquals(2, transport.sent.size)
    assertEquals(0, state.healthLivingPackageSize)
  }

  @Test
  fun pushWaitsForARequestThenPingsFirst() {
    val transport = FakeTransport(setOf(37))
    val state = MemoryState()
    val (manager, service) = healthService(transport, state)
    service.push("test")
    assertTrue(transport.sent.isEmpty()) // msgVer unknown: nothing is sent, like Huawei Health

    state.healthLivingMsgVer = 4.0f
    service.push("test")
    val ping = transport.sent.single()
    assertEquals(1, ping.cmd.toInt())
    manager.handlePacket(watchPacket(3, ping.seq.toInt(), "com.huawei.health.healthyliving", "com.huawei.health", null, 0xCA))
    val deadline = System.currentTimeMillis() + 3000
    while (transport.sent.size < 2 && System.currentTimeMillis() < deadline) Thread.sleep(20)
    assertEquals(2, transport.sent.size)
    assertEquals(HealthModelMessages.MSG_TASKS, HealthModelMessages.decodeReport(transport.sent[1].data!!).msgType)
    assertEquals(4.0f, HealthModelMessages.decodeReport(transport.sent[1].data!!).msgVer, 0f)
  }

  // --- courses ---

  private fun sampleCourse() = RunningCourse(
    "JFTEST",
    "Run",
    listOf(
      CourseBlock(1, listOf(CourseStep(CourseStepKind.WARMUP, CourseTarget.TIME, 300))),
      CourseBlock(
        2,
        listOf(
          CourseStep(CourseStepKind.RUN, CourseTarget.DISTANCE, 1000, CourseIntensity.PACE, 300, 330),
          CourseStep(CourseStepKind.REST, CourseTarget.TIME, 60),
        ),
      ),
      CourseBlock(1, listOf(CourseStep(CourseStepKind.COOLDOWN, CourseTarget.TIME, 300))),
    ),
  )

  @Test
  fun courseStorageInfoMatchesHandComputedBytes() {
    val bytes = CourseProtobuf.encode(sampleCourse(), 1_700_000_000)
    assertArrayEquals(
      hex(
        "0A064A465445535410521075106E18FF0120002A03322E30300038004080E2CFAA064801500458046219080110011A130A055244303031100118AC0220FF01280030006230080210021A160A055244303032100018E807200F2890921430E0A7121A120A0552443030341001183C20FF01280030006219080110011A130A055244303035100118AC0220FF0128003000",
      ),
      bytes,
    )
    // exerciseName is the name's UTF-8 bytes, one varint each (dga.e).
    val names = PbReader.fields(bytes).filter { it.number == 2 }.map { it.asInt() }
    assertEquals("Run".toByteArray().map { it.toInt() }, names)
  }

  @Test
  fun courseFileIsHeaderPlusStorageInfo() {
    val payload = CourseProtobuf.encode(sampleCourse(), 1_700_000_000)
    val file = CourseProtobuf.message(CourseProtobuf.BUSINESS_CUSTOM_COURSE, 7, payload)
    assertEquals(36 + payload.size, file.size)
    // businessType 3, version 1, totalLength 36 + n, businessHeadLength 0, messageId 7 (little endian).
    assertArrayEquals(hex("0300000001000000" + "%08X".format(Integer.reverseBytes(36 + payload.size)) + "0000000007000000"), file.copyOf(20))
    assertArrayEquals(payload, file.copyOfRange(36, file.size))
    assertEquals("7courseInfo.bin", CourseProtobuf.fileName(7))
  }

  @Test
  fun courseTotalsAndValidation() {
    val course = sampleCourse()
    assertEquals(CourseTarget.NONE to 0, CourseProtobuf.total(course)) // mixed time and distance
    val timed = RunningCourse("x", "T", listOf(CourseBlock(3, listOf(CourseStep(CourseStepKind.RUN, CourseTarget.TIME, 60)))))
    assertEquals(CourseTarget.TIME to 180, CourseProtobuf.total(timed))
    CourseProtobuf.validate(course)
    fun rejects(c: RunningCourse): Boolean = try {
      CourseProtobuf.validate(c)
      false
    } catch (e: WearException) {
      e.errorCode == ErrorCodes.INVALID_ARGUMENT
    }
    assertTrue(rejects(RunningCourse("x", " ", course.blocks)))
    assertTrue(rejects(RunningCourse("x", "n", emptyList())))
    assertTrue(rejects(RunningCourse("x", "n", listOf(CourseBlock(1, listOf(CourseStep(CourseStepKind.RUN, CourseTarget.TIME, 0)))))))
    assertTrue(rejects(RunningCourse("x", "n", listOf(CourseBlock(1, listOf(CourseStep(CourseStepKind.RUN, CourseTarget.TIME, 60, CourseIntensity.PACE, 330, 300)))))))
  }
}
