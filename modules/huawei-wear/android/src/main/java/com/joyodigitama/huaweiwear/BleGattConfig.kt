package com.joyodigitama.huaweiwear

import android.bluetooth.BluetoothGattCharacteristic
import java.util.UUID
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants

/**
 * Which GATT endpoints [GattTransport] talks to, and how.
 *
 * Every default below is an ASSUMPTION pending device validation, taken from the documented
 * constants for older BLE-only Huawei bands (protocol/README.md Transport section:
 * service `0xFE86`, `FE01` write / `FE02` notify). The nRF GATT dump from the physical
 * Band 11 is still pending; when the real UUIDs arrive, construct this config with explicit
 * values instead of the defaults. No transport-logic change is needed for that.
 */
internal data class BleGattConfig(
  /** ASSUMPTION: [HuaweiConstants.UUID_SERVICE_HUAWEI_SERVICE] (`0xFE86`) until the dump says otherwise. */
  val serviceUuid: UUID = HuaweiConstants.UUID_SERVICE_HUAWEI_SERVICE,
  /** ASSUMPTION: [HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_WRITE] (`FE01`) until the dump says otherwise. */
  val writeUuid: UUID = HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_WRITE,
  /** ASSUMPTION: [HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_READ] (`FE02`) until the dump says otherwise. */
  val notifyUuid: UUID = HuaweiConstants.UUID_CHARACTERISTIC_HUAWEI_READ,
  /**
   * ASSUMPTION: [BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE] until a real
   * GATT capture says otherwise. Writes are fire-and-forget at the ATT layer; answers
   * arrive as notifications on the notify characteristic.
   */
  val writeType: Int = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE,
  /**
   * ATT MTU used for chunking before negotiation finishes. ASSUMPTION: the ATT default
   * (23 bytes on the wire, 20 bytes of payload) until `onMtuChanged` reports the
   * negotiated value.
   */
  val mtu: Int = DEFAULT_MTU,
) {
  internal companion object {
    const val DEFAULT_MTU: Int = 23

    /** Bluetooth SIG Client Characteristic Configuration descriptor; not a Huawei UUID. */
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /** MTU requested from the band after notifications are enabled; best-effort. */
    const val REQUESTED_MTU: Int = 247
  }
}
