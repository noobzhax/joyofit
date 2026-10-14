export type LinkState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'initializing'
  | 'connected'
  | 'syncing';

/** Authentication path negotiated from LinkParams.deviceSupportType + SecurityNegotiation.authType. */
export type AuthMode = 'normal' | 'hichain-lite' | 'hichain' | 'hichain3';

export interface BondedDevice {
  address: string;
  name: string;
  /** Name matches a Huawei Watch Fit 4 / Fit 4 Pro advertisement ("HUAWEI WATCH FIT 4-XXX"). */
  supported: boolean;
}

export interface DeviceInfo {
  address: string;
  name: string;
  productModel: string | null;
  softwareVersion: string | null;
  hardwareVersion: string | null;
  serialNumber: string | null;
  batteryLevel: number | null;
  authMode: AuthMode;
}

/** One-minute activity sample from FitnessData step frames. Timestamps are unix seconds. */
export interface StepSample {
  timestamp: number;
  steps: number;
  calories: number;
  distance: number;
  heartRate: number | null;
  spo2: number | null;
  restingHeartRate: number | null;
}

export type SleepStage = 'light' | 'deep' | 'rem' | 'awake';

/**
 * Sleep segment as stored in the database; `type` is the raw watch sleep-state byte and `stage` the
 * decoded stage, null when the watch gave none.
 */
export interface SleepSegment {
  start: number;
  end: number;
  type: number;
  stage?: SleepStage | null;
}

export interface FitnessTotals {
  steps: number;
  calories: number;
  distance: number;
}

/**
 * What one finished sync reports. The samples and sleep segments themselves are written to the
 * database by the native side; read them back with SQL.
 */
export interface SyncSummary {
  /** Start of the requested window, unix seconds. */
  from: number;
  /** End of the window (= new `device.last_sync`), unix seconds. */
  to: number;
  /** Number of step samples stored by this sync. */
  samples: number;
  /** Number of sleep segments stored by this sync. */
  sleep: number;
  /** Today's totals as reported by the watch. */
  totals: FitnessTotals;
}

export type LogDirection = 'tx' | 'rx' | 'info' | 'error';

export interface LogEvent {
  ts: number;
  direction: LogDirection;
  serviceId: number | null;
  commandId: number | null;
  hex: string | null;
  message: string;
}

export interface StateEvent {
  state: LinkState;
  error: string | null;
}

export interface BatteryEvent {
  level: number;
}

/** Emitted after every stored sync, including syncs run by the background service. */
export interface SyncCompleteEvent extends SyncSummary {}

/** Background connection settings and service state. */
export interface BackgroundStatus {
  /** The foreground service keeps the watch connected and syncs on a timer. */
  enabled: boolean;
  /** The remembered watch: the last one connected or enabled for background, or null. */
  address: string | null;
  /** Name of the remembered watch. */
  name: string | null;
  /** The foreground service is running right now. */
  running: boolean;
  /**
   * Auto-reconnect is paused because the user disconnected in the app. Connecting again (or
   * toggling background off and on) resumes it.
   */
  paused: boolean;
  syncIntervalMinutes: number;
}

export interface NotificationAccessStatus {
  /** The user granted notification access to this app in Android settings. */
  granted: boolean;
  /** Forwarding to the watch is switched on. */
  enabled: boolean;
}

/** An installed launcher app and whether its notifications are forwarded. */
export interface NotificationApp {
  packageName: string;
  label: string;
  enabled: boolean;
}

export type UserSex = 'male' | 'female' | 'unknown';

/** Profile and goal sent to the watch. */
export interface UserProfile {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: UserSex;
  dailyStepGoal: number;
}

export type HuaweiWearModuleEvents = {
  onStateChange: (event: StateEvent) => void;
  onBattery: (event: BatteryEvent) => void;
  onLog: (event: LogEvent) => void;
  onSyncComplete: (event: SyncCompleteEvent) => void;
};
