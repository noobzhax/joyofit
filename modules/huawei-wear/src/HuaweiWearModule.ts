import { NativeModule, requireNativeModule } from 'expo';

import type {
  BondedDevice,
  DeviceInfo,
  HuaweiWearModuleEvents,
  LinkState,
  SyncResult,
} from './HuaweiWear.types';

declare class HuaweiWearModule extends NativeModule<HuaweiWearModuleEvents> {
  /** Bonded classic-Bluetooth devices. Requires BLUETOOTH_CONNECT on Android 12+. */
  getBondedDevices(): Promise<BondedDevice[]>;
  /** RFCOMM connect + LinkParams + auth + ProductInfo + SetTime + Battery. Resolves when `connected`. */
  connect(address: string): Promise<DeviceInfo>;
  disconnect(): Promise<void>;
  getState(): LinkState;
  refreshBattery(): Promise<number>;
  /** Pulls sleep frames, step frames and today's totals recorded at or after `fromSec` (unix seconds). */
  syncActivity(fromSec: number): Promise<SyncResult>;
  /** Drops the stored auth key / fake identity so the next connect performs a first-time bind. */
  forgetDevice(address: string): Promise<void>;
}

export default requireNativeModule<HuaweiWearModule>('HuaweiWear');
