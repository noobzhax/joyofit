/**
 * P2P (service 0x34) features: health metrics from the watch's data dictionary, Healthy Living and the experimental running
 * courses. UNVERIFIED on the watch: the layouts come from Gadgetbridge and Huawei Health 17.0.8.300 static analysis. Native code:
 * `P2pController.kt`, `HealthMetricsSync.kt`, `HealthModelService.kt`, `CourseProtobuf.kt`.
 */

/**
 * One row of `health_metric_status` (read from the database by JS): what the last gate check or sync did for one metric.
 * `supported = 0` means the watch does not set the ExpandCapability bit Gadgetbridge gates that dictionary class on; the metric is skipped.
 */
export interface HealthMetricStatusRow {
  /** Key of `health_metrics.type`: skin_temperature, hrv, emotion, sleep_apnea, arterial_stiffness, blood_pressure, altitude, ams, arrhythmia. */
  type: string;
  dict_class: number;
  title: string;
  supported: number;
  /** The ExpandCapability gate, in words. */
  gate: string;
  /** Unix seconds of the last gate check. */
  checked_at: number;
  /** Unix seconds of the last sync that asked the watch; null when none did yet. */
  synced_at: number | null;
  /** Rows the last sync stored. */
  rows_added: number | null;
  /** Why nothing arrived (not supported, no answer, no new entries), or null. */
  note: string | null;
}

/** One row of `health_metrics`: times are unix seconds, `value` is what a chart plots (null when the layout of the class is not known). */
export interface HealthMetricRow {
  type: string;
  ts: number;
  last_ts: number;
  value: number | null;
  /** JSON object: named fields for the known classes, `{"<dataType>": number | "text"}` for the raw ones. */
  values_json: string;
}

export interface HealthyLivingStatus {
  /** The watch is connected, lists the P2P service and sets ExpandCapability 37 (Huawei's gate). */
  supported: boolean;
  gate: string;
  gateSet: boolean;
  /** The app's switch (on by default). */
  enabled: boolean;
  /** The service is registered on the current link. */
  registered: boolean;
  /** Answer to the registration ping; 0xca (202) means the watch app is there. */
  pingCode: number | null;
  /** `msgVer` of the watch's last request (a protobuf float); null until the watch has asked. */
  msgVer: number | null;
  packageSize: number;
  /** Unix ms. */
  lastRequestAt: number | null;
  lastReportAt: number | null;
  /** One line: the day and tasks of the last report. */
  lastReport: string | null;
}

export interface CoursesStatus {
  /** The experimental switch (off by default). */
  enabled: boolean;
  /** ExpandCapability 41 / 169 (either one is Huawei Health's gate for pushing a course), 295 (weekly plans). */
  gate41: boolean;
  gate169: boolean;
  gate295: boolean;
  /** The P2P service is available on the current link. */
  p2p: boolean;
}

export type CourseStepKind = 'warmup' | 'run' | 'walk' | 'rest' | 'cooldown';
export type CourseTargetKind = 'time' | 'distance' | 'none';
export type CourseIntensityKind = 'none' | 'pace' | 'hrPercent' | 'cadence';

export interface RunningCourseStep {
  kind: CourseStepKind;
  target: CourseTargetKind;
  /** Seconds for `time` (1 to 86400), metres for `distance` (1 to 100000). */
  targetValue: number;
  intensity: CourseIntensityKind;
  /** Bounds in the unit of `intensity`: seconds per km (pace, faster first, 60 to 900), % of max heart rate (20 to 100), steps per minute (100 to 300). */
  low: number;
  high: number;
}

/** `steps` repeated `repeat` times (1 to 99). */
export interface RunningCourseBlock {
  repeat: number;
  steps: RunningCourseStep[];
}

export interface RunningCourse {
  name: string;
  blocks: RunningCourseBlock[];
}

export interface RunningCoursePushResult {
  messageId: number;
  fileName: string;
  bytes: number;
  /** Tag 0x02 of the watch's 28/07 result (Huawei Health reads 1 as accepted); null when it sent none. */
  uploadStatus: number | null;
  /** The watch sent a fitness-module message with this message id. */
  answered: boolean;
  answerHex: string | null;
}
