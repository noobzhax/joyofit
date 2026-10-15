/** Phone-side feature switches and the Android permissions they need. */
export interface PhoneFeatures {
  /** The watch's find-my-phone button rings this phone. */
  findPhoneEnabled: boolean;
  /** Incoming calls are shown on the watch. */
  callsEnabled: boolean;
  /** The watch's accept and reject buttons answer or end the call on the phone. */
  callControlEnabled: boolean;
  /** READ_PHONE_STATE: needed to see incoming calls. */
  readPhoneState: boolean;
  /** READ_CALL_LOG: lets Android pass the caller's number. */
  readCallLog: boolean;
  /** READ_CONTACTS: shows the contact name instead of the number. */
  readContacts: boolean;
  /** This build can learn who is calling. False in the Google Play build, which has neither READ_CALL_LOG nor READ_CONTACTS. */
  callerIdSupported: boolean;
  /** ANSWER_PHONE_CALLS: needed to accept or reject a call from the watch. */
  answerPhoneCalls: boolean;
  /** The connected watch reported find-device support. False while disconnected. */
  findWatchSupported: boolean;
}

/** Weekday bits of `WatchAlarm.repeat`; 0 means once. */
export const ALARM_DAYS = [
  { bit: 1, label: 'Mon' },
  { bit: 2, label: 'Tue' },
  { bit: 4, label: 'Wed' },
  { bit: 8, label: 'Thu' },
  { bit: 16, label: 'Fri' },
  { bit: 32, label: 'Sat' },
  { bit: 64, label: 'Sun' },
] as const;

/** The watch has five alarm slots, numbered 1 to 5. */
export const ALARM_SLOTS = 5;

/** One of the watch's five alarm slots. */
export interface WatchAlarm {
  /** Watch slot, 1 to 5. */
  slot: number;
  enabled: boolean;
  hour: number;
  minute: number;
  /** Bitmask of `ALARM_DAYS`; 0 = once. */
  repeat: number;
  name: string;
}

/** The watch's single smart alarm: it wakes you within `aheadMinutes` before the set time. */
export interface WatchSmartAlarm {
  enabled: boolean;
  hour: number;
  minute: number;
  repeat: number;
  aheadMinutes: number;
}

/** What `setAlarms` sends: exactly the alarms the watch keeps (a missing slot is deleted). */
export interface WatchAlarmsUpdate {
  event: WatchAlarm[];
  /** Sent only when not null; the watch cannot delete its smart alarm, only disable it. */
  smart: WatchSmartAlarm | null;
}

/** Alarms last read from or pushed to the watch. */
export interface WatchAlarms extends WatchAlarmsUpdate {
  /** Unix milliseconds of the last exchange with the watch; null before the first. */
  updatedAt: number | null;
  /** The connected watch lists alarm support. False while disconnected. */
  supported: boolean;
  /** The connected watch also has a smart alarm. False while disconnected. */
  smartSupported: boolean;
}
