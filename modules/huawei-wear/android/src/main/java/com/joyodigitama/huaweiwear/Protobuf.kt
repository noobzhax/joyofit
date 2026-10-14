package com.joyodigitama.huaweiwear

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The small slice of the protobuf wire format the Huawei P2P messages need: varints, 32-bit floats
 * and length-delimited fields. No library: the schemas are a few fixed messages (see
 * `HealthModelMessages.kt` and `CourseProtobuf.kt`), and keeping the encoder here means the byte
 * layout is visible and unit-tested against hand-computed vectors.
 *
 * Field encoding follows the proto2/proto3 rules of the generated Huawei classes: varint wire type 0,
 * 32-bit wire type 5, length-delimited wire type 2. Negative `int32` values are written as 10-byte
 * varints like protobuf-java's `writeInt32`.
 */
internal class PbWriter {
  private val out = ByteArrayOutputStream()

  fun varintField(field: Int, value: Long): PbWriter {
    tag(field, WIRE_VARINT)
    varint(value)
    return this
  }

  /** `int32` / `uint32` / `int64` / `bool` fields. */
  fun intField(field: Int, value: Int): PbWriter = varintField(field, value.toLong())

  /** proto3 skips a field that has its default value; proto2 `required` fields must be written even when 0. */
  fun intFieldUnlessZero(field: Int, value: Int): PbWriter = if (value != 0) intField(field, value) else this

  fun longFieldUnlessZero(field: Int, value: Long): PbWriter = if (value != 0L) varintField(field, value) else this

  fun floatField(field: Int, value: Float): PbWriter {
    tag(field, WIRE_32BIT)
    val bits = java.lang.Float.floatToRawIntBits(value)
    for (i in 0 until 4) out.write((bits ushr (8 * i)) and 0xFF)
    return this
  }

  fun floatFieldUnlessZero(field: Int, value: Float): PbWriter = if (value != 0f) floatField(field, value) else this

  fun bytesField(field: Int, value: ByteArray): PbWriter {
    tag(field, WIRE_LEN)
    varint(value.size.toLong())
    out.write(value)
    return this
  }

  fun stringField(field: Int, value: String): PbWriter = bytesField(field, value.toByteArray(Charsets.UTF_8))

  fun stringFieldUnlessEmpty(field: Int, value: String): PbWriter = if (value.isNotEmpty()) stringField(field, value) else this

  fun bytesFieldUnlessEmpty(field: Int, value: ByteArray): PbWriter = if (value.isNotEmpty()) bytesField(field, value) else this

  fun toByteArray(): ByteArray = out.toByteArray()

  private fun tag(field: Int, wire: Int) = varint(((field shl 3) or wire).toLong())

  private fun varint(value: Long) {
    var v = value
    while (v and 0x7FL.inv() != 0L) {
      out.write(((v and 0x7F) or 0x80).toInt())
      v = v ushr 7
    }
    out.write(v.toInt())
  }

  companion object {
    const val WIRE_VARINT = 0
    const val WIRE_64BIT = 1
    const val WIRE_LEN = 2
    const val WIRE_32BIT = 5
  }
}

/** One decoded field; [value] is the varint, the raw 32/64 bits (little endian) or null for length-delimited ones, which are in [bytes]. */
internal class PbField(val number: Int, val wire: Int, val value: Long, val bytes: ByteArray?) {
  fun asInt(): Int = value.toInt()

  fun asFloat(): Float = java.lang.Float.intBitsToFloat(value.toInt())

  fun asString(): String = String(bytes ?: ByteArray(0), Charsets.UTF_8)
}

/** Thrown for a message that is not valid protobuf (truncated field, bad wire type). */
internal class PbException(message: String) : Exception(message)

internal object PbReader {
  /** All fields in wire order; repeated fields appear once per occurrence. */
  fun fields(data: ByteArray): List<PbField> {
    val result = ArrayList<PbField>()
    var pos = 0
    fun readVarint(): Long {
      var shift = 0
      var value = 0L
      while (true) {
        if (pos >= data.size) throw PbException("truncated varint")
        val b = data[pos++].toInt() and 0xFF
        value = value or ((b and 0x7F).toLong() shl shift)
        if (b and 0x80 == 0) return value
        shift += 7
        if (shift > 63) throw PbException("varint too long")
      }
    }
    while (pos < data.size) {
      val key = readVarint()
      val number = (key ushr 3).toInt()
      if (number <= 0) throw PbException("field number $number")
      when (val wire = (key and 7).toInt()) {
        PbWriter.WIRE_VARINT -> result.add(PbField(number, wire, readVarint(), null))
        PbWriter.WIRE_32BIT -> {
          if (pos + 4 > data.size) throw PbException("truncated 32-bit field $number")
          val v = ByteBuffer.wrap(data, pos, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xFFFFFFFFL
          pos += 4
          result.add(PbField(number, wire, v, null))
        }
        PbWriter.WIRE_64BIT -> {
          if (pos + 8 > data.size) throw PbException("truncated 64-bit field $number")
          val v = ByteBuffer.wrap(data, pos, 8).order(ByteOrder.LITTLE_ENDIAN).long
          pos += 8
          result.add(PbField(number, wire, v, null))
        }
        PbWriter.WIRE_LEN -> {
          val len = readVarint()
          if (len < 0 || pos + len > data.size) throw PbException("truncated field $number (length $len)")
          result.add(PbField(number, wire, 0, data.copyOfRange(pos, pos + len.toInt())))
          pos += len.toInt()
        }
        else -> throw PbException("unsupported wire type $wire for field $number")
      }
    }
    return result
  }
}
