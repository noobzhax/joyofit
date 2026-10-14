/** Small byte helpers shared by the codec. Pure Uint8Array/DataView: runs in browsers, Workers and Hermes. */

export class HwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HwtError";
  }
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const textDecoder = new TextDecoder("utf-8");
const textEncoder = new TextEncoder();

export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function utf8Encode(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function hex(bytes: Uint8Array, max = bytes.length): string {
  let s = "";
  const n = Math.min(max, bytes.length);
  for (let i = 0; i < n; i++) s += (bytes[i]! < 16 ? "0" : "") + bytes[i]!.toString(16);
  return bytes.length > max ? `${s}…` : s;
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE), as the zip format uses. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
