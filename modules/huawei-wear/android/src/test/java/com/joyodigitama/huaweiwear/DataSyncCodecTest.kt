package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The service 0x37 builders against the byte examples of `/home/dzul/re/huawei-health/DIET_PROTOCOL.md`
 * (`tools/example.py`, a port of Huawei Health's `cqe` / `yoq`). Static analysis only; nothing here was seen on a watch.
 */
class DataSyncCodecTest {
  // The Fit 4's slice size (observed LinkParams: 1022), so the 451-byte example is one frame.
  private val plain = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false); it.setSliceSize(1022) }

  private fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  /** `5A | len | 00 | service | command | TLV | CRC16` for an unsliced, unencrypted packet. */
  private fun frame(command: Int, tlv: ByteArray): ByteArray {
    val body = byteArrayOf(0x00, 0x37, command.toByte()) + tlv
    val head = byteArrayOf(0x5A, (body.size shr 8).toByte(), body.size.toByte()) + body
    val crc = CheckSums.getCRC16(head, 0)
    return head + byteArrayOf((crc shr 8).toByte(), crc.toByte())
  }

  /** Independent of HuaweiTLV: tag, varint length, value. */
  private fun tlv(tag: Int, value: ByteArray): ByteArray {
    val n = value.size
    val length = if (n < 128) byteArrayOf(n.toByte()) else byteArrayOf(((n shr 7) or 0x80).toByte(), (n and 0x7F).toByte())
    return byteArrayOf(tag.toByte()) + length + value
  }

  private fun serialize(packet: HuaweiPacket): ByteArray {
    val out = packet.serialize()
    assertEquals(1, out.size)
    return out[0]
  }

  private val mealsExample = hex(
    "5b7b2265617454696d65223a313736303430303030302c22686173466f6f64223a747275652c226b696c6f43616c6f726965223a3335302e302c2273756752616e6765223a5b3438302c3732305d2c2277686963684d65616c223a31307d2c7b2265617454696d65223a313736303430303030302c22686173466f6f64223a66616c73652c226b696c6f43616c6f726965223a302e302c2273756752616e6765223a5b3630302c3830305d2c2277686963684d65616c223a32307d2c7b2265617454696d65223a313736303430303030302c22686173466f6f64223a66616c73652c226b696c6f43616c6f726965223a302e302c2273756752616e6765223a5b3438302c3732305d2c2277686963684d65616c223a33307d2c7b2265617454696d65223a313736303430303030302c22686173466f6f64223a66616c73652c226b696c6f43616c6f726965223a302e302c2273756752616e6765223a5b302c3130305d2c2277686963684d65616c223a34307d5d",
  )

  @Test
  fun samplePointMatchesTheDietExample() {
    val packet = DataSyncWire.samplePoint(
      plain, DietPlanner.PHONE_PKG, DietPlanner.WATCH_PKG, DietPlanner.DICT_DIET,
      listOf(PointValue(DietPlanner.DICT_DIET, mealsExample)), startMs = 0, endMs = 0, metadata = null,
    )
    // DIET_PROTOCOL.md: 451 bytes of `37 03 ...` from tools/example.py; the first two bytes are service and command.
    val expected = hex(
      "3703011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c0304000927c204040000000005040000000086830087827d0804000927c2098274",
    ) + mealsExample
    assertEquals(451, expected.size)
    assertArrayEquals(frame(DataSyncWire.CMD_POINT, expected.copyOfRange(2, expected.size)), serialize(packet))
  }

  @Test
  fun configMatchesTheDietExample() {
    val json = "{\"onePointFull\":{\"breakfast\":600,\"lunch\":800,\"dinner\":600},\"caloricDeficitGoal\":500,\"weightInit\":70.0,\"activityCalGoal\":300,\"weightManagerType\":1}"
    val packet = DataSyncWire.config(
      plain, DietPlanner.PHONE_PKG, DietPlanner.WATCH_PKG,
      listOf(ConfigItem(DietPlanner.CONFIG_DIET, 1, json.toByteArray(), 1760400000000L)),
    )
    val expected = hex(
      "3701011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c83812b848128050435a97cf70601010781127b226f6e65506f696e7446756c6c223a7b22627265616b66617374223a3630302c226c756e6368223a3830302c2264696e6e6572223a3630307d2c2263616c6f72696344656669636974476f616c223a3530302c22776569676874496e6974223a37302e302c22616374697669747943616c476f616c223a3330302c227765696768744d616e6167657254797065223a317d080800000199e0044400",
    )
    assertEquals(220, expected.size)
    assertArrayEquals(frame(DataSyncWire.CMD_CONFIG, expected.copyOfRange(2, expected.size)), serialize(packet))
  }

  @Test
  fun eventMatchesTheQuickLogReplyExample() {
    val packet = DataSyncWire.event(plain, DietPlanner.PHONE_PKG, DietPlanner.WATCH_PKG, DietPlanner.EVENT_DIET, 0, DietPlanner.punchReply(0, 0))
    val expected = hex(
      "3702011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c030404c52933040100051b7b2270756e6368526573756c74223a302c226576656e74223a367d",
    )
    assertEquals(84, expected.size)
    // The level is one byte, as Huawei's `cqe.g(4, level)` writes it.
    assertArrayEquals(frame(DataSyncWire.CMD_EVENT, expected.copyOfRange(2, expected.size)), serialize(packet))
  }

  @Test
  fun idsInTheExampleAreTheDocumentedValues() {
    assertEquals(0x927c2, DietPlanner.DICT_DIET)
    assertEquals(0x35a97cf7, DietPlanner.CONFIG_DIET)
    assertEquals(0x4c52933, DietPlanner.EVENT_DIET)
    assertEquals(0x4c52934, DietPlanner.EVENT_VIP)
    assertEquals(0x35a97cf6, DietPlanner.CONFIG_WEIGHT_GOAL)
  }

  @Test
  fun dictionaryRowIsBuiltLikeYoqB() {
    val row = BodyMetricsCodec.restingRow(1650, 1760400000000L, 1760403600000L, 1760403600000L)
    val packet = DataSyncWire.dictionary(plain, BodyMetricsCodec.PHONE_PKG, BodyMetricsCodec.WATCH_PKG, BodyMetricsCodec.DICT_RESTING, listOf(row))
    // Computed from cqe: 84{85{06 start i64, 07 end i64, 08 modify i64, 89{8A{0B key i32, 0C value}}, 0D empty}} after 01 / 02 / 03.
    val expected = hex(
      "011868772e756e6974656465766963652e7765696768744d6772021068772e73706f72742e6469657463616c03040007a13284328530060800000199e0044400070800000199e03b3280080800000199e03b3280890e8a0c0b041dcdab870c04000006720d00",
    )
    assertArrayEquals(frame(DataSyncWire.CMD_DICT, expected), serialize(packet))
  }

  @Test
  fun dictionaryParserReadsBothLayouts() {
    val nested = DataSyncWire.dictionary(
      plain, "p", "w", 500018,
      listOf(DictRow(1000L, 2000L, 3000L, listOf(DictValue(500018055, byteArrayOf(0, 0, 6, 0x72)))), DictRow(4000L, 5000L)),
    )
    val query = DataSyncWire.parseDictionary(nested.getTlv())
    assertEquals(500018, query.dictId)
    assertEquals(2, query.rows.size)
    assertEquals(1000L, query.startMs)
    assertEquals(2000L, query.endMs)
    assertEquals(3000L, query.modifyMs)
    assertEquals(500018055, query.rows[0].values[0].key)
    assertEquals(1650, DataSyncBytes.readInt32(query.rows[0].values[0].value))
    assertNull(query.rows[1].modifyMs)

    // Flat 06 / 07 / 08 at the top (FEATURE_CANDIDATES row 29).
    val flat = HuaweiTLV().put(0x01, "src").put(0x02, "wear").put(0x03, 500018)
      .put(0x06, 10L).put(0x07, 20L).put(0x08, 30L)
    val flatQuery = DataSyncWire.parseDictionary(flat)
    assertEquals(0, flatQuery.rows.size)
    assertEquals(10L, flatQuery.startMs)
    assertEquals(20L, flatQuery.endMs)
    assertEquals(30L, flatQuery.modifyMs)
  }

  @Test
  fun inboundEventConfigAndPointAreParsed() {
    val eventTlv = HuaweiTLV().parse(tlv(1, "in.huawei.motion".toByteArray()) + tlv(2, "hw.sport.config".toByteArray()) + tlv(3, byteArrayOf(0x04, 0xC5.toByte(), 0x29, 0x33)) + tlv(4, byteArrayOf(0)) + tlv(5, "{\"event\":1}".toByteArray()))
    val event = DataSyncWire.parseEvent(eventTlv)
    assertEquals("in.huawei.motion", event.srcPkg)
    assertEquals("hw.sport.config", event.wearPkg)
    assertEquals(80030003, event.eventId)
    assertEquals(0, event.level)
    assertEquals(1, event.json()!!.getInt("event"))
    assertNull(event.errorCode)

    val ack = DataSyncWire.parseEvent(HuaweiTLV().put(0x01, "a").put(0x02, "b").put(0x7F, 100000))
    assertEquals(100000, ack.errorCode)

    val config = DataSyncWire.parseConfig(DataSyncWire.config(plain, "a", "b", listOf(ConfigItem(900200006, 1, byteArrayOf(1, 2), 5L), ConfigItem(900200007, 2))).getTlv())
    assertEquals(2, config.items.size)
    assertEquals(900200006, config.items[0].configId)
    assertEquals(1, config.items[0].action)
    assertArrayEquals(byteArrayOf(1, 2), config.items[0].data)
    assertEquals(5L, config.items[0].modifyMs)
    assertEquals(2, config.items[1].action)
    assertNull(config.items[1].data)

    val point = DataSyncWire.parsePoint(DataSyncWire.samplePoint(plain, "a", "b", 600002, listOf(PointValue(600002, byteArrayOf(0x5B, 0x5D))), 1, 2, byteArrayOf(9)).getTlv())
    assertEquals(600002, point.dictId)
    assertEquals(600002, point.values[0].key)
    assertArrayEquals(byteArrayOf(0x5B, 0x5D), point.values[0].value)
    assertArrayEquals(byteArrayOf(9), point.metadata)
  }

  @Test
  fun jsonIsWrittenCompactInInsertionOrderLikeGson() {
    val json = DataSyncJson.write(
      linkedMapOf("a" to 1, "f" to 350f, "d" to 70.0, "s" to "x\"y", "b" to true, "n" to null, "r" to intArrayOf(1, 2), "l" to listOf(1, "z"), "m" to linkedMapOf("k" to 0)),
    )
    assertEquals("{\"a\":1,\"f\":350.0,\"d\":70.0,\"s\":\"x\\\"y\",\"b\":true,\"n\":null,\"r\":[1,2],\"l\":[1,\"z\"],\"m\":{\"k\":0}}", json)
    assertEquals(1, DataSyncJson.parse("{\"event\":1}".toByteArray())!!.getInt("event"))
    assertNull(DataSyncJson.parse("not json".toByteArray()))
    assertNull(DataSyncJson.parse(null))
  }

  @Test
  fun doublesAreLittleEndianAndIntsBigEndian() {
    assertArrayEquals(hex("0000000000a05140"), DataSyncBytes.doubleLe(70.5))
    assertArrayEquals(hex("00000672"), DataSyncBytes.int32(1650))
    assertEquals(1650, DataSyncBytes.readInt32(hex("0672")))
    assertNull(DataSyncBytes.readInt32(ByteArray(0)))
  }

  @Test
  fun packagesMatchInEitherOrientation() {
    // The watch writes its package in src and the phone's in wear (GB registers by the watch package, Huawei by the phone's).
    assertEquals("hw.unitedevice.weightMgr" to "hw.sport.dietcal", DataSyncWire.matchPackages("hw.unitedevice.weightMgr", null, "hw.sport.dietcal", "hw.unitedevice.weightMgr"))
    // The packet written the other way round.
    assertEquals("hw.unitedevice.weightMgr" to "hw.sport.dietcal", DataSyncWire.matchPackages("hw.unitedevice.weightMgr", "hw.sport.dietcal", "hw.unitedevice.weightMgr", "hw.sport.dietcal"))
    // GB's registration by the watch package only.
    assertEquals("hw.sport.config" to "in.huawei.motion", DataSyncWire.matchPackages(null, "in.huawei.motion", "in.huawei.motion", "hw.sport.config"))
    assertNull(DataSyncWire.matchPackages("hw.unitedevice.weightMgr", null, "a", "b"))
    assertNull(DataSyncWire.matchPackages(null, "in.huawei.motion", "other", "hw.sport.config"))
  }

  @Test
  fun capabilityBitsAreTheOnesHuaweiChecks() {
    assertEquals(83, DataSyncWire.capabilityFor(DataSyncWire.CMD_CONFIG))
    assertEquals(84, DataSyncWire.capabilityFor(DataSyncWire.CMD_EVENT))
    assertEquals(85, DataSyncWire.capabilityFor(DataSyncWire.CMD_POINT))
    assertEquals(173, DataSyncWire.capabilityFor(DataSyncWire.CMD_DICT))
    assertNull(DataSyncWire.capabilityFor(DataSyncWire.CMD_COMPACT))
  }

  @Test
  fun theWatchesBitmapSetsTheBitsTheDocumentSays() {
    // The Watch Fit 4 Pro ExpandCapability from the task: bits 83, 84, 85, 173, 215 and 182 set; 307 and 266 not.
    DeviceCaps.expandCapabilities = hex("FF7F01EA2EC37452E8BEBC72226F8E4B07AEA90D7EFFCC9ACF579945DF4DAD82DBC2041003480404")
    try {
      for (bit in intArrayOf(83, 84, 85, 173, 215, 182)) assertEquals("bit $bit", true, DeviceCaps.expandCapability(bit))
      for (bit in intArrayOf(307, 266)) assertEquals("bit $bit", false, DeviceCaps.expandCapability(bit))
    } finally {
      DeviceCaps.reset()
    }
  }
}
