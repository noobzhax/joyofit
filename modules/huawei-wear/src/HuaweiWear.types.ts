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

/** Sleep segment from FitnessData sleep frames; `type` is the raw watch sleep-state byte. */
export interface SleepSegment {
  start: number;
  end: number;
  type: number;
}

export interface FitnessTotals {
  steps: number;
  calories: number;
  distance: number;
}

export interface SyncResult {
  from: number;
  to: number;
  samples: StepSample[];
  sleep: SleepSegment[];
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

export type HuaweiWearModuleEvents = {
  onStateChange: (event: StateEvent) => void;
  onBattery: (event: BatteryEvent) => void;
  onLog: (event: LogEvent) => void;
};
