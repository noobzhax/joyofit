import { NativeModule, requireNativeModule } from 'expo';

import type {
  BackgroundStatus,
  BondedDevice,
  DeviceInfo,
  HealthConnectExportResult,
  HealthConnectStatus,
  HuaweiWearModuleEvents,
  LinkState,
  NotificationAccessStatus,
  NotificationApp,
  SyncSummary,
  UserProfile,
  WeatherLocationMode,
  WeatherPlace,
  WeatherStatus,
} from './HuaweiWear.types';
import type { PhoneFeatures, WatchAlarms, WatchAlarmsUpdate } from './HuaweiWearPhone.types';
import type { WatchfaceInstallResult, WatchfaceList } from './HuaweiWearWatchface.types';

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

  /**
   * Makes the watch ring and vibrate (`start` true) or stops it. Needs a connected watch that
   * reports find-device support (ERR_UNSUPPORTED otherwise, ERR_NOT_CONNECTED when disconnected).
   * The command is fire-and-forget like Gadgetbridge's: it resolves once sent.
   */
  findWatch(start: boolean): Promise<void>;
  /** Switches, permission state and find-watch support for find my phone and calls. */
  getPhoneFeatures(): PhoneFeatures;
  /** When on, the watch's find-my-phone button rings this phone (background service included). Off also silences a ringing phone. */
  setFindPhoneEnabled(enabled: boolean): Promise<void>;
  /** Show incoming calls on the watch. Request READ_PHONE_STATE (and ideally READ_CALL_LOG and READ_CONTACTS) first. */
  setCallsEnabled(enabled: boolean): Promise<void>;
  /** Let the watch accept or reject a ringing call. Request ANSWER_PHONE_CALLS first. */
  setCallControlEnabled(enabled: boolean): Promise<void>;

  /** The alarms last read from or pushed to the watch (empty before the first read). */
  getAlarms(): WatchAlarms;
  /** Reads the alarms from the connected watch, stores and returns them. */
  refreshAlarms(): Promise<WatchAlarms>;
  /**
   * Pushes the alarms to the connected watch, then reads them back and resolves with what the
   * watch holds. Rejects with ERR_INVALID_ARGUMENT for bad slots (1 to 5, unique) or ranges.
   */
  setAlarms(alarms: WatchAlarmsUpdate): Promise<WatchAlarms>;

  /** Health Connect availability, granted write permissions, switch and last export. */
  getHealthConnectStatus(): Promise<HealthConnectStatus>;
  /**
   * Shows Health Connect's permission dialog for every write permission not yet granted and
   * resolves with the status afterwards. Does nothing but resolve when all are granted. After two
   * denials Android stops showing the dialog: use `openHealthConnectSettings`.
   */
  requestHealthConnectPermissions(): Promise<HealthConnectStatus>;
  /**
   * Switches the export of every later sync on or off. Switching on needs at least one granted
   * write permission and first writes everything already stored (backfill), so it can take a
   * while. Switching off leaves written records in Health Connect.
   */
  setHealthConnectEnabled(enabled: boolean): Promise<HealthConnectStatus>;
  /** Writes all stored data again (idempotent: records are replaced, not duplicated). */
  backfillHealthConnect(): Promise<HealthConnectExportResult>;
  /** Opens the Health Connect app settings, where permissions and data can be managed. */
  openHealthConnectSettings(): Promise<void>;

  /** Weather settings and the outcome of the last push. */
  getWeatherStatus(): WeatherStatus;
  /**
   * Switches weather on or off. On, with the watch connected, it pushes now and then every
   * `intervalMinutes`; the watch's own weather request is answered either way (with a
   * "weather disabled" error when off). Requests the phone's location only in `current` mode:
   * ask for ACCESS_COARSE_LOCATION first.
   */
  setWeatherEnabled(enabled: boolean): Promise<void>;
  /** Display unit on the watch. Values are always sent in °C, as Gadgetbridge does. */
  setWeatherUnit(unit: 'celsius' | 'fahrenheit'): Promise<void>;
  setWeatherLocationMode(mode: WeatherLocationMode): Promise<void>;
  /** 15 to 1440 minutes. */
  setWeatherIntervalMinutes(minutes: number): Promise<void>;
  /**
   * Searches Open-Meteo geocoding ("Bandung" or "Bandung, Indonesia") and stores the first match
   * as the city. Rejects when nothing matches or the internet is out.
   */
  setWeatherCity(query: string): Promise<WeatherPlace>;
  /** Fetches and pushes now. Rejects with what went wrong (no watch, no location, no network...). */
  refreshWeather(): Promise<WeatherStatus>;

  /**
   * The watch's watch faces (active marker, factory flag, name), with the screen size the watch
   * reported. Needs a connected watch (ERR_NOT_CONNECTED), and one that lists the watch face
   * service (ERR_UNSUPPORTED).
   */
  listWatchfaces(): Promise<WatchfaceList>;
  /**
   * Uploads a Huawei Theme Studio Pro `.hwt` package from a `file://` or `content://` URI (the
   * document picker's), as file type 1 with a random `<nine digits>_1.0.0` name, and reads the watch's
   * list afterwards. Emits `onUploadProgress` while the watch pulls the data and `onUploadResult` at
   * the end. Rejects with ERR_INVALID_ARGUMENT for a file that is no watch face or is made for another
   * screen, ERR_UPLOAD_REJECTED with the exact status code when the watch refuses, ERR_TIMEOUT when it
   * goes silent. A resolved result with `listed: false` means the watch took the upload but dropped the face.
   */
  installWatchface(uri: string): Promise<WatchfaceInstallResult>;
  /** Makes the face with this id active; resolves with the list read afterwards, rejects if the watch did not switch. */
  setActiveWatchface(id: string): Promise<WatchfaceList>;
  /** Deletes the face with this id; resolves with the list read afterwards, rejects if the face is still there. */
  deleteWatchface(id: string): Promise<WatchfaceList>;
}

export default requireNativeModule<HuaweiWearModule>('HuaweiWear');
