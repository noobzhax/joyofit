import { ALARM_DAYS, ALARM_SLOTS, type WatchAlarm, type WatchSmartAlarm } from '@/wear';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatAlarmTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

const WEEKDAYS = 1 | 2 | 4 | 8 | 16;
const WEEKEND = 32 | 64;
const EVERY_DAY = WEEKDAYS | WEEKEND;

/** "Once", "Every day", "Weekdays", "Weekends" or the day names. */
export function describeRepeat(repeat: number): string {
  if (repeat === 0) return 'Once';
  if (repeat === EVERY_DAY) return 'Every day';
  if (repeat === WEEKDAYS) return 'Weekdays';
  if (repeat === WEEKEND) return 'Weekends';
  return ALARM_DAYS.filter((day) => (repeat & day.bit) !== 0)
    .map((day) => day.label)
    .join(' ');
}

/** The lowest free watch slot (1 to 5), or null when all five are used. */
export function firstFreeSlot(alarms: readonly WatchAlarm[]): number | null {
  for (let slot = 1; slot <= ALARM_SLOTS; slot += 1) {
    if (!alarms.some((alarm) => alarm.slot === slot)) return slot;
  }
  return null;
}

/** Whole number inside `[min, max]`, or null when the text is not one. */
export function parseBounded(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

export const DEFAULT_SMART_ALARM: WatchSmartAlarm = {
  enabled: false,
  hour: 7,
  minute: 0,
  repeat: 0,
  aheadMinutes: 5,
};
