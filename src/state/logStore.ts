import { useSyncExternalStore } from 'react';

import type { LogEvent } from '@/wear';

/** Ring-buffer capacity; older events are dropped first. */
export const LOG_CAPACITY = 500;

/** An event plus a monotonically increasing id, usable as a stable list key. */
export interface LogEntry {
  id: number;
  event: LogEvent;
}

let nextId = 0;
let buffer: readonly LogEntry[] = [];
const listeners = new Set<() => void>();

/** Appends one event, evicting the oldest beyond {@link LOG_CAPACITY}. */
export function pushLog(event: LogEvent): void {
  const entry: LogEntry = { id: nextId++, event };
  buffer =
    buffer.length >= LOG_CAPACITY
      ? [...buffer.slice(buffer.length - LOG_CAPACITY + 1), entry]
      : [...buffer, entry];
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Oldest-first snapshot of the buffer; identity changes only when an event is pushed. */
export function useLogBuffer(): readonly LogEntry[] {
  return useSyncExternalStore(subscribe, () => buffer);
}
