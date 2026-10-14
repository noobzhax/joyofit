const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `HH:MM` in local time from unix seconds. */
export function formatClock(sec: number): string {
  const d = new Date(sec * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `HH:MM:SS.mmm` in local time from unix milliseconds. */
export function formatClockMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** `7 h 05 min`, `42 min`, or `0 min`. */
export function formatDuration(totalSec: number): string {
  const minutes = Math.round(totalSec / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${pad(m)} min` : `${m} min`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString();
}

/** The contract gives no distance unit; metres is assumed (unverified). */
export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export function formatDateTime(sec: number): string {
  return new Date(sec * 1000).toLocaleString();
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `14:05` for today, `Oct 12, 14:05` for any other day. Unix seconds, local time. */
export function formatSyncTime(sec: number): string {
  const d = new Date(sec * 1000);
  if (d.toDateString() === new Date().toDateString()) return formatClock(sec);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${formatClock(sec)}`;
}

/** `just now`, `5 min ago`, `3 h ago`; older than a day falls back to {@link formatSyncTime}. Unix seconds. */
export function formatAgo(sec: number, nowSec: number): string {
  const ago = Math.max(0, nowSec - sec);
  if (ago < 60) return 'just now';
  if (ago < 3600) return `${Math.floor(ago / 60)} min ago`;
  if (ago < 86_400) return `${Math.floor(ago / 3600)} h ago`;
  return formatSyncTime(sec);
}
