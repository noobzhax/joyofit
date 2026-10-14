/**
 * Minimal zip reader/writer that keeps the original framing of every entry, so that an archive whose entries
 * were not modified is written back byte-identically (local headers, data descriptors, compressed bytes,
 * central directory fields and the archive comment are all preserved).
 *
 * Inflate/deflate come from fflate. No zip64, no encryption, no multi-disk archives (a `.hwt` uses none).
 */
import { deflateSync, inflateSync } from "fflate";
import { HwtError, concat, crc32, utf8Decode, utf8Encode, view } from "./bytes";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

/** DOS time/date 1980-01-01 00:00:00, used for entries that carry no timestamp so output is deterministic. */
const DOS_EPOCH_DATE = 0x0021;

export interface ZipFraming {
  versionMade: number;
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Extra field of the central directory record. */
  centralExtra: Uint8Array;
  comment: Uint8Array;
  diskStart: number;
  internalAttrs: number;
  externalAttrs: number;
  /** The local record exactly as stored: header, name, extra, compressed data and data descriptor (and any gap up to the next record). */
  localBytes: Uint8Array;
}

export interface ZipEntry {
  /** Entry path, `/`-separated. Directory entries end with `/` and have empty data. */
  name: string;
  /** Uncompressed content. Replace this to modify the entry. */
  data: Uint8Array;
  /** Present for entries read from an archive; absent for entries added in memory. */
  framing?: ZipFraming;
}

export interface ZipArchive {
  entries: ZipEntry[];
  /** End-of-central-directory comment. */
  comment: Uint8Array;
  /** Bytes before the first local record (normally empty). */
  prefix: Uint8Array;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function readZip(bytes: Uint8Array): ZipArchive {
  const dv = view(bytes);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new HwtError("not a zip: no end-of-central-directory record");
  const total = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const commentLen = dv.getUint16(eocd + 20, true);
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0) throw new HwtError("multi-disk zip is not supported");
  if (total === 0xffff || cdOffset === 0xffffffff) throw new HwtError("zip64 is not supported");
  const comment = bytes.slice(eocd + 22, eocd + 22 + commentLen);

  interface Raw {
    name: string;
    versionMade: number;
    versionNeeded: number;
    flags: number;
    method: number;
    time: number;
    date: number;
    crc: number;
    csize: number;
    usize: number;
    centralExtra: Uint8Array;
    comment: Uint8Array;
    diskStart: number;
    internalAttrs: number;
    externalAttrs: number;
    localOffset: number;
  }
  const raws: Raw[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw new HwtError("corrupt zip central directory");
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const flags = dv.getUint16(p + 8, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    raws.push({
      name: utf8Decode(nameBytes),
      versionMade: dv.getUint16(p + 4, true),
      versionNeeded: dv.getUint16(p + 6, true),
      flags,
      method: dv.getUint16(p + 10, true),
      time: dv.getUint16(p + 12, true),
      date: dv.getUint16(p + 14, true),
      crc: dv.getUint32(p + 16, true),
      csize: dv.getUint32(p + 20, true),
      usize: dv.getUint32(p + 24, true),
      centralExtra: bytes.slice(p + 46 + nameLen, p + 46 + nameLen + extraLen),
      comment: bytes.slice(p + 46 + nameLen + extraLen, p + 46 + nameLen + extraLen + cmtLen),
      diskStart: dv.getUint16(p + 34, true),
      internalAttrs: dv.getUint16(p + 36, true),
      externalAttrs: dv.getUint32(p + 38, true),
      localOffset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }

  // A local record spans from its offset to the next record's offset (or the central directory), which also captures data descriptors.
  const bounds = raws.map((r) => r.localOffset).sort((a, b) => a - b);
  const prefixEnd = bounds.length ? bounds[0]! : cdOffset;
  const entries: ZipEntry[] = raws.map((r) => {
    const idx = bounds.indexOf(r.localOffset);
    const end = idx + 1 < bounds.length ? bounds[idx + 1]! : cdOffset;
    const localBytes = bytes.slice(r.localOffset, end);
    if (localBytes.length < 30 || view(localBytes).getUint32(0, true) !== SIG_LOCAL) throw new HwtError(`corrupt zip local header for ${r.name}`);
    const ldv = view(localBytes);
    const dataStart = 30 + ldv.getUint16(26, true) + ldv.getUint16(28, true);
    const csize = r.csize;
    const compressed = localBytes.subarray(dataStart, dataStart + csize);
    if (compressed.length !== csize) throw new HwtError(`truncated zip data for ${r.name}`);
    let data: Uint8Array;
    if (r.method === 0) data = compressed.slice();
    else if (r.method === 8) data = inflateSync(compressed, { out: new Uint8Array(r.usize) });
    else throw new HwtError(`unsupported zip compression method ${r.method} for ${r.name}`);
    if (data.length !== r.usize) throw new HwtError(`zip entry ${r.name}: size mismatch`);
    return {
      name: r.name,
      data,
      framing: {
        versionMade: r.versionMade,
        versionNeeded: r.versionNeeded,
        flags: r.flags,
        method: r.method,
        time: r.time,
        date: r.date,
        crc32: r.crc,
        compressedSize: csize,
        uncompressedSize: r.usize,
        centralExtra: r.centralExtra,
        comment: r.comment,
        diskStart: r.diskStart,
        internalAttrs: r.internalAttrs,
        externalAttrs: r.externalAttrs,
        localBytes,
      },
    };
  });
  return { entries, comment, prefix: bytes.slice(0, prefixEnd) };
}

/** True when `entry.data` still equals what the archive stored, so the original local record can be reused. */
function isPristine(entry: ZipEntry): entry is ZipEntry & { framing: ZipFraming } {
  const f = entry.framing;
  return !!f && entry.data.length === f.uncompressedSize && crc32(entry.data) === f.crc32;
}

export function writeZip(archive: ZipArchive): Uint8Array {
  const parts: Uint8Array[] = [archive.prefix];
  const central: Uint8Array[] = [];
  let offset = archive.prefix.length;

  for (const entry of archive.entries) {
    const nameBytes = utf8Encode(entry.name);
    let f: ZipFraming;
    let local: Uint8Array;
    if (isPristine(entry)) {
      f = entry.framing;
      local = f.localBytes;
    } else {
      const old = entry.framing;
      const isDir = entry.name.endsWith("/");
      const crc = crc32(entry.data);
      let method = 0;
      let body = entry.data;
      if (!isDir && entry.data.length > 0) {
        const deflated = deflateSync(entry.data, { level: 9 });
        if (deflated.length < entry.data.length) {
          method = 8;
          body = deflated;
        }
      }
      const nonAscii = nameBytes.some((b) => b > 0x7f);
      const flags = ((old?.flags ?? 0) & ~FLAG_DESCRIPTOR & ~FLAG_UTF8) | (nonAscii ? FLAG_UTF8 : 0);
      const head = new Uint8Array(30);
      const hv = view(head);
      hv.setUint32(0, SIG_LOCAL, true);
      hv.setUint16(4, old?.versionNeeded ?? (method === 8 ? 20 : 10), true);
      hv.setUint16(6, flags, true);
      hv.setUint16(8, method, true);
      hv.setUint16(10, old?.time ?? 0, true);
      hv.setUint16(12, old?.date ?? DOS_EPOCH_DATE, true);
      hv.setUint32(14, crc, true);
      hv.setUint32(18, body.length, true);
      hv.setUint32(22, entry.data.length, true);
      hv.setUint16(26, nameBytes.length, true);
      hv.setUint16(28, 0, true);
      local = concat([head, nameBytes, body]);
      f = {
        versionMade: old?.versionMade ?? 20,
        versionNeeded: old?.versionNeeded ?? (method === 8 ? 20 : 10),
        flags,
        method,
        time: old?.time ?? 0,
        date: old?.date ?? DOS_EPOCH_DATE,
        crc32: crc,
        compressedSize: body.length,
        uncompressedSize: entry.data.length,
        centralExtra: old?.centralExtra ?? new Uint8Array(0),
        comment: old?.comment ?? new Uint8Array(0),
        diskStart: 0,
        internalAttrs: old?.internalAttrs ?? 0,
        externalAttrs: old?.externalAttrs ?? (isDir ? 0x10 : 0),
        localBytes: local,
      };
    }
    const rec = new Uint8Array(46);
    const rv = view(rec);
    rv.setUint32(0, SIG_CENTRAL, true);
    rv.setUint16(4, f.versionMade, true);
    rv.setUint16(6, f.versionNeeded, true);
    rv.setUint16(8, f.flags, true);
    rv.setUint16(10, f.method, true);
    rv.setUint16(12, f.time, true);
    rv.setUint16(14, f.date, true);
    rv.setUint32(16, f.crc32, true);
    rv.setUint32(20, f.compressedSize, true);
    rv.setUint32(24, f.uncompressedSize, true);
    rv.setUint16(28, nameBytes.length, true);
    rv.setUint16(30, f.centralExtra.length, true);
    rv.setUint16(32, f.comment.length, true);
    rv.setUint16(34, f.diskStart, true);
    rv.setUint16(36, f.internalAttrs, true);
    rv.setUint32(38, f.externalAttrs, true);
    rv.setUint32(42, offset, true);
    central.push(concat([rec, nameBytes, f.centralExtra, f.comment]));
    parts.push(local);
    offset += local.length;
  }

  const cd = concat(central);
  const eocd = new Uint8Array(22);
  const ev = view(eocd);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, archive.entries.length, true);
  ev.setUint16(10, archive.entries.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, archive.comment.length, true);
  return concat([...parts, cd, eocd, archive.comment]);
}
