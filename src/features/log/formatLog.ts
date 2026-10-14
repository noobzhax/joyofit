import type { LogEvent } from '@/wear';

const hex2 = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;

/** `svc=0x01 cmd=0x07`, or null when the event is not tied to a packet. */
export function formatPacketId(event: LogEvent): string | null {
  if (event.serviceId === null || event.commandId === null) return null;
  return `svc=${hex2(event.serviceId)} cmd=${hex2(event.commandId)}`;
}

/** One plain-text line per event, for the clipboard export. */
export function formatLogLine(event: LogEvent): string {
  const parts = [new Date(event.ts).toISOString(), event.direction.toUpperCase().padEnd(5)];
  const id = formatPacketId(event);
  if (id) parts.push(id);
  if (event.message) parts.push(event.message);
  if (event.hex) parts.push(event.hex);
  return parts.join(' ');
}
