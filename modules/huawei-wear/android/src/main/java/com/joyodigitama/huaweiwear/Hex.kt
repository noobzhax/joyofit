package com.joyodigitama.huaweiwear

private val HEX_DIGITS = "0123456789ABCDEF".toCharArray()

internal fun ByteArray.toHex(): String {
  val out = CharArray(size * 2)
  for (i in indices) {
    val v = this[i].toInt() and 0xFF
    out[i * 2] = HEX_DIGITS[v ushr 4]
    out[i * 2 + 1] = HEX_DIGITS[v and 0x0F]
  }
  return String(out)
}

internal fun String.hexToBytes(): ByteArray {
  require(length % 2 == 0) { "Odd-length hex string" }
  return ByteArray(length / 2) { i ->
    val hi = Character.digit(this[i * 2], 16)
    val lo = Character.digit(this[i * 2 + 1], 16)
    require(hi >= 0 && lo >= 0) { "Invalid hex digit at offset ${i * 2}" }
    ((hi shl 4) or lo).toByte()
  }
}

internal fun Byte.hex2(): String = "0x%02x".format(toInt() and 0xFF)
