import type { WatchMealLoggedEvent } from './HuaweiWearDiet.types';
import type { UploadProgressEvent, UploadResultEvent } from './HuaweiWearWatchface.types';
import type { FaceCustomization } from './HuaweiWearFaceCustom.types';

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
  /** Small calories (cal, 1/1000 kcal), as the watch's step frames count them. */
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
  /** kcal. */
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
  /** Workouts stored (new, or completed after an earlier cut-off download) by this sync's workout phase. */
  workouts: number;
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

export type HealthConnectAvailability = 'available' | 'update-required' | 'unavailable';

/** Health Connect record types JoyoFit writes; also the names in `granted` / `missing`. */
export type HealthConnectRecordType =
  | 'Steps'
  | 'HeartRate'
  | 'OxygenSaturation'
  | 'RestingHeartRate'
  | 'Distance'
  | 'ActiveCaloriesBurned'
  | 'SleepSession'
  | 'ExerciseSession';

/** State of the Health Connect export (write only; JoyoFit never reads Health Connect). */
export interface HealthConnectStatus {
  /** `update-required`: the Health Connect app on the phone must be updated first. */
  availability: HealthConnectAvailability;
  /** Every sync is written to Health Connect (set by `setHealthConnectEnabled`). */
  enabled: boolean;
  /** Record types with write permission. */
  granted: HealthConnectRecordType[];
  /** Record types without write permission; these are skipped by the export. */
  missing: HealthConnectRecordType[];
  /** An export is running right now. */
  exporting: boolean;
  /** Unix seconds of the last export that finished without error, or null. */
  lastExportSec: number | null;
  /** Why the last export failed, or null. */
  lastError: string | null;
  /** What the last export wrote, e.g. `steps=120 distance=120 ... workouts=1`, or null. */
  lastCounts: string | null;
}

/** Records written by one Health Connect export (a backfill). */
export interface HealthConnectExportResult {
  steps: number;
  distance: number;
  calories: number;
  heartRate: number;
  spo2: number;
  restingHeartRate: number;
  sleep: number;
  workouts: number;
}

export type TemperatureUnit = 'celsius' | 'fahrenheit';

/** `current`: the phone's coarse location. `city`: the city chosen with `setWeatherCity`. */
export type WeatherLocationMode = 'current' | 'city';

/** A city found by Open-Meteo geocoding. */
export interface WeatherPlace {
  /** Shown on the watch; null for a current position that could not be named. */
  name: string | null;
  latitude: number;
  longitude: number;
  /** Region and country, e.g. "West Java, Indonesia". */
  detail: string | null;
}

/** Weather settings and what the last push to the watch did. */
export interface WeatherStatus {
  /** Off by default: weather needs the internet and the phone's location. */
  enabled: boolean;
  unit: TemperatureUnit;
  locationMode: WeatherLocationMode;
  /** Minutes between pushes while the watch is connected (default 60). */
  intervalMinutes: number;
  /** The chosen city, used when `locationMode` is `city`. */
  city: WeatherPlace | null;
  /** ACCESS_COARSE_LOCATION (or fine) is granted. Needed for `current`. */
  locationPermission: boolean;
  /** The connected watch lists the weather service; null when no watch is connected. */
  watchSupported: boolean | null;
  /** Unix seconds of the last push that reached the watch in this process, or null. */
  lastPushAt: number | null;
  /** Why the last attempt failed, or null. */
  lastError: string | null;
  /** Temperature of the last push, whole degrees Celsius. */
  lastTemperatureC: number | null;
  /** Huawei icon name of the last push, e.g. `SUNNY`, `LIGHT_RAIN`. */
  lastCondition: string | null;
  lastLocationName: string | null;
}

/** A live heart-rate reading the watch pushed (`onHeartRate`); only while `setLiveHeartRate(true)` is in effect. */
export interface HeartRateEvent {
  bpm: number;
  /** Unix milliseconds, the phone's receive time. */
  ts: number;
}

/** Which sensor commands the connected watch lists (Gadgetbridge's `HuaweiState.supports*`). */
export interface HealthSensorSupport {
  heartRate: boolean;
  realtimeHeartRate: boolean;
  spo2: boolean;
  truSleep: boolean;
  highHeartRateAlert: boolean;
  lowHeartRateAlert: boolean;
}

/** What the watch's health sensors are set to. Everything but the alerts is on by default, as in Huawei Health. */
export interface HealthSensorsUpdate {
  /** Continuous heart rate: the watch records a reading about every minute. Without it, no heart rate reaches the app. */
  automaticHeartRate: boolean;
  /** Automatic SpO2 readings. */
  automaticSpo2: boolean;
  /** TruSleep, the sleep tracking the sleep files come from. */
  truSleep: boolean;
  /** bpm that triggers an alert on the watch; 0 = off, else 100 to 150. */
  highHeartRateAlert: number;
  /** bpm that triggers an alert on the watch; 0 = off, else 40 to 50. */
  lowHeartRateAlert: number;
}

export interface HealthSensorsStatus extends HealthSensorsUpdate {
  /** What the connected watch supports; null when no watch is connected (nothing is known then). */
  supported: HealthSensorSupport | null;
}

/** Where a watch-started workout is: counting down on the watch, recording, paused, or finished. */
export type LiveWorkoutStatus = 'preparing' | 'running' | 'paused' | 'ended';

/**
 * A workout started on the watch, followed live (`getLiveWorkout`, `onLiveWorkout`). The watch pushes its numbers
 * about every second; every metric is null until it has sent one.
 */
export interface LiveWorkout {
  /** Phone time (Unix ms) the workout was first seen; changes with every new workout. */
  id: number;
  status: LiveWorkoutStatus;
  /**
   * `watch`: the watch's own numbers. `gps` / `manual`: JoyoFit's session on the watch's realtime heart rate, started
   * because the watch asked for the phone's GPS or by hand; time is counted by the phone and calories are estimated.
   */
  source: 'watch' | 'gps' | 'manual';
  /** Huawei sport type (1 running, 2 walking, 3 cycling, 5 indoor running, 7 indoor cycling, 13 indoor walking ...). */
  sportType: number | null;
  sportName: string | null;
  /** Unix ms of the last change, phone time. */
  updatedAt: number;
  endedAt: number | null;
  /** Workout time on the watch, seconds (pauses excluded), as of `updatedAt`. */
  durationSec: number | null;
  heartRate: number | null;
  /** Heart-rate zone as the watch numbers it (unverified). */
  heartRateZone: number | null;
  /** 220 - age from the profile (35 when none is saved); the fat and carb estimate uses it. */
  maxHeartRate: number;
  distanceM: number | null;
  /** kcal burned in the workout. */
  calories: number | null;
  activeCalories: number | null;
  speedKmh: number | null;
  paceSecPerKm: number | null;
  /** Steps per minute. */
  stepRate: number | null;
  steps: number | null;
  /** Cycling cadence, rpm. */
  cadence: number | null;
  altitudeM: number | null;
  riseM: number | null;
  descentM: number | null;
  aerobicTe: number | null;
  anaerobicTe: number | null;
  /** JoyoFit's estimate (the watch sends no such figure): grams of fat and carbohydrate burned so far. */
  fatGrams: number;
  carbGrams: number;
  /** Share of energy from fat at the current heart rate, 0 to 1, same estimate. */
  fatShare: number | null;
}

export type HuaweiWearModuleEvents = {
  onStateChange: (event: StateEvent) => void;
  onBattery: (event: BatteryEvent) => void;
  onLog: (event: LogEvent) => void;
  onUploadProgress: (event: UploadProgressEvent) => void;
  onUploadResult: (event: UploadResultEvent) => void;
  onSyncComplete: (event: SyncCompleteEvent) => void;
  onHeartRate: (event: HeartRateEvent) => void;
  onWatchMealLogged: (event: WatchMealLoggedEvent) => void;
  /** The watch reported a face's options without being asked, e.g. the user edited the face on the watch. */
  onFaceCustomization: (event: FaceCustomization) => void;
  /** A workout started on the watch changed state or pushed new numbers. */
  onLiveWorkout: (event: LiveWorkout) => void;
};
