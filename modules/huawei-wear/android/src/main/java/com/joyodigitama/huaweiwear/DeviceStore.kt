// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): HuaweiSupportProvider.{createSecretKey,getSecretKey,setSecretKey,createRandomMacAddress,createAndroidID}.
package com.joyodigitama.huaweiwear

import android.content.Context
import android.content.SharedPreferences
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto
import nodomain.freeyourgadget.gadgetbridge.util.StringUtils

/**
 * Per-device private SharedPreferences holding the identity the watch binds to: auth key, the fake
 * MAC and fake Android id Gadgetbridge presents to the watch, and whether a bind has completed.
 * Mirrors HuaweiSupportProvider.createSecretKey/getSecretKey/setSecretKey/createRandomMacAddress/
 * createAndroidID.
 */
internal class DeviceStore(context: Context) {
  private val appContext = context.applicationContext

  fun forDevice(address: String): DeviceIdentity = DeviceIdentity(address, prefs(address))

  /** Drops the auth key, fake identity and bond flag so the next connect is a first-time bind. */
  fun forget(address: String) {
    prefs(address).edit().clear().commit()
  }

  private fun prefs(address: String): SharedPreferences =
    appContext.getSharedPreferences(
      "huawei_wear_" + address.uppercase().replace(":", ""),
      Context.MODE_PRIVATE,
    )
}

internal class DeviceIdentity(
  /** The watch's real Bluetooth address, as GB's `getDeviceMac()` (fed to HuaweiCrypto.createSecretKey). */
  val deviceAddress: String,
  private val prefs: SharedPreferences,
) {
  /** GB initializeDevice(): create the fake MAC and android id before the first request. */
  fun ensureCreated() {
    macAddress
    androidId
  }

  /** Fake `FF:FF:FF:xx:xx:xx` address, as GB `createRandomMacAddress`. */
  val macAddress: String
    get() {
      val stored = prefs.getString(KEY_MAC, null)
      if (!stored.isNullOrEmpty()) return stored
      val random = SecureRandom()
      val mac = StringBuilder("FF:FF:FF")
      repeat(3) { mac.append(String.format(":%02x", random.nextInt(255))) }
      val created = mac.toString().uppercase()
      prefs.edit().putString(KEY_MAC, created).apply()
      return created
    }

  /** Fake Android id, as GB `createAndroidID`: hex of 16 random bytes. */
  val androidId: String
    get() {
      val stored = prefs.getString(KEY_ANDROID_ID, null)
      if (!stored.isNullOrEmpty()) return stored
      val created = StringUtils.bytesToHex(HuaweiCrypto.generateNonce())
      prefs.edit().putString(KEY_ANDROID_ID, created).apply()
      return created
    }

  /** GB `getAndroidId()`. */
  val androidIdBytes: ByteArray
    get() = androidId.toByteArray(StandardCharsets.UTF_8)

  /** GB `getMacAddress()`. */
  val macAddressBytes: ByteArray
    get() = macAddress.toByteArray(StandardCharsets.UTF_8)

  /** GB `getSerial()`: the last three bytes of the fake MAC as 6 hex characters. */
  val serialBytes: ByteArray
    get() = macAddress.replace(":", "").substring(6, 12).toByteArray(StandardCharsets.UTF_8)

  /** Stored auth key (GB `getSecretKey()` without the NPE on a missing key). */
  var authKey: ByteArray?
    get() = prefs.getString(KEY_AUTH, null)?.takeIf { it.isNotEmpty() }?.hexToBytes()
    set(value) {
      val editor = prefs.edit()
      if (value == null) editor.remove(KEY_AUTH) else editor.putString(KEY_AUTH, value.toHex())
      editor.apply()
    }

  /** GB `createSecretKey()`: make a random 16-byte auth key if none is stored; returns the key. */
  fun createSecretKey(): ByteArray {
    authKey?.let { return it }
    val created = HuaweiCrypto.generateNonce()
    authKey = created
    return created
  }

  /**
   * GB's `firstConnection` flag: true until a bind has completed. A stored key alone does not count
   * because the HiChain bind writes the key mid-way (operationCode 1 step 3) before it has finished.
   */
  val isFirstConnection: Boolean
    get() = !prefs.getBoolean(KEY_BONDED, false) || authKey == null

  fun markBonded() {
    prefs.edit().putBoolean(KEY_BONDED, true).apply()
  }

  private companion object {
    const val KEY_AUTH = "authkey"
    const val KEY_MAC = "fake_mac_address"
    const val KEY_ANDROID_ID = "fake_android_id"
    const val KEY_BONDED = "bonded"
  }
}
