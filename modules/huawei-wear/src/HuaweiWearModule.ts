import { NativeModule, requireNativeModule } from 'expo';

import type {
  BackgroundStatus,
  BondedDevice,
  DeviceInfo,
  HuaweiWearModuleEvents,
  LinkState,
  NotificationAccessStatus,
  NotificationApp,
  SyncSummary,
  UserProfile,
} from './HuaweiWear.types';

declare class HuaweiWearModule extends NativeModule<HuaweiWearModuleEvents> {
  /** Bonded classic-Bluetooth devices. Requires BLUETOOTH_CONNECT on Android 12+. */
  getBondedDevices(): Promise<BondedDevice[]>;
  /**
   * RFCOMM connect + LinkParams + auth + init. Resolves when `connected`. There is one link per
   * process: if the background service is already connecting to or connected with this watch, this
   * joins that link. A successful connect remembers the watch for background mode and resumes a
   * paused auto-reconnect.
   */
  connect(address: string): Promise<DeviceInfo>;
  /** Closes the link. With background mode on, this also pauses auto-reconnect. */
  disconnect(): Promise<void>;
  getState(): LinkState;
  /** The connected watch (also when the background service connected it), or null. */
  getDevice(): DeviceInfo | null;
  refreshBattery(): Promise<number>;
  /**
   * Pulls sleep, steps and today's totals since the last stored sync (7 days on the first sync,
   * otherwise 1 h before `device.last_sync`), writes them to the database and resolves with a summary.
   */
  syncActivity(): Promise<SyncSummary>;
  /** Drops the stored auth key / fake identity so the next connect performs a first-time bind. */
  forgetDevice(address: string): Promise<void>;

  /**
   * Starts the foreground service for `address` (auto-connect, auto-reconnect, periodic sync), or
   * stops it when `address` is null. Requires BLUETOOTH_CONNECT; ask for POST_NOTIFICATIONS first
   * on Android 13+ or the service notification is hidden.
   */
  setBackgroundEnabled(address: string | null): Promise<void>;
  getBackgroundStatus(): BackgroundStatus;
  /** 5 to 1440 minutes. */
  setSyncIntervalMinutes(minutes: number): Promise<void>;

  /** Opens Android's notification access screen for this app. */
  openNotificationAccess(): Promise<void>;
  getNotificationAccess(): NotificationAccessStatus;
  setNotificationsEnabled(enabled: boolean): Promise<void>;
  /** Launcher apps with their forwarding state. Apps without an explicit choice are on unless they are system apps. */
  getNotificationApps(): Promise<NotificationApp[]>;
  setNotificationAppEnabled(packageName: string, enabled: boolean): Promise<void>;

  /** The stored profile, or null if the user never saved one (nothing is sent to the watch then). */
  getUserProfile(): UserProfile | null;
  /**
   * Stores the profile and goal and, if the watch is connected, sends them now. Resolves true when
   * they reached the watch, false when stored only (not connected or unsupported).
   */
  setUserProfile(profile: UserProfile): Promise<boolean>;
}

export default requireNativeModule<HuaweiWearModule>('HuaweiWear');
