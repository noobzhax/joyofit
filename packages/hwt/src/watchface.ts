/**
 * `com.huawei.watchface` (a.k.a. `watchface.bin`) binary container.
 *
 * ```
 * 0   u16le version     1 or 2 in every sample (2 = layout schema "v2", 1 = older)
 * 2   u16le layoutLen   bytes of protobuf layout that follow the header ("xmllen" in the community docs)
 * 4   u32le tableLen    bytes of image table; 8 per image ("maplen")
 * 8   u32le binLen      bytes from the end of the table to the end of the file
 * 12  u32le reserved    0 in every sample
 * 16  layout[layoutLen] protobuf
 *     table[tableLen]   per image: u32le offset, u32le size (offset is from the start of the bin area)
 *     bin[binLen]       8 byte signature, then the image blobs back to back
 * ```
 *
 * "Regular" files (all 19 samples): the table tiles the bin area exactly — image k starts where image k-1 ended, the
 * first at offset 8 — and `binLen` equals the number of bytes left in the file. They are modelled as
 * `layout + signature + images[]` and the header, table and offsets are recomputed on write.
 * Anything else is "irregular": header, table and bin area are kept verbatim so the file still round-trips; only the
 * layout can be replaced (the header's layout length is patched).
 *
 * A table entry with size 0 (Carrera has one at index 0) is an unused slot: the image list keeps an empty blob there so
 * that image references (1-based, 3 digit strings such as "004") keep pointing at the same slot.
 */
import { HwtError, concat, view } from "./bytes";

export const WATCHFACE_HEADER_SIZE = 16;
export const SIGNATURE_SIZE = 8;
export const TABLE_ENTRY_SIZE = 8;

export interface IrregularBody {
  /** The 16 header bytes as stored. */
  header: Uint8Array;
  /** The image table as stored. */
  table: Uint8Array;
  /** The bin area (signature + images) as stored. */
  bin: Uint8Array;
}

export interface WatchfaceBinary {
  /** Header u16 at offset 0. */
  version: number;
  /** Header u32 at offset 12 (always 0 in samples). */
  reserved: number;
  /** Raw protobuf layout section. Replace it (e.g. with `encodeLayout(...)`) to change the layout. */
  layout: Uint8Array;
  /** First 8 bytes of the bin area. `55 55 55 55 01 00 00 01` or `2e 2e 2e 2e 01 00 00 01` in samples; meaning of the first four bytes unknown. */
  signature: Uint8Array;
  /** Image blobs (8 byte image header included), slot i is referred to by `imageRef(i)`. Empty = unused slot. */
  images: Uint8Array[];
  /** Set when the file did not match the regular layout; `images` is then read-only (derived where the table points inside the bin area). */
  irregular?: IrregularBody;
}

/** Layout image reference for slot `index` (0-based): 1-based, zero padded to 3 digits. */
export function imageRef(index: number): string {
  return String(index + 1).padStart(3, "0");
}

/** Slot index for a layout image reference, or -1 if it is not a plain decimal reference. */
export function imageIndex(ref: string): number {
  return /^\d+$/.test(ref) ? Number(ref) - 1 : -1;
}

export function parseWatchface(bytes: Uint8Array): WatchfaceBinary {
  if (bytes.length < WATCHFACE_HEADER_SIZE) throw new HwtError(`watchface binary too short (${bytes.length} bytes)`);
  const dv = view(bytes);
  const version = dv.getUint16(0, true);
  const layoutLen = dv.getUint16(2, true);
  const tableLen = dv.getUint32(4, true);
  const binLen = dv.getUint32(8, true);
  const reserved = dv.getUint32(12, true);
  const tableStart = WATCHFACE_HEADER_SIZE + layoutLen;
  const binStart = tableStart + tableLen;
  if (binStart > bytes.length) throw new HwtError(`watchface header claims ${binStart} bytes of layout+table but the file has ${bytes.length}`);
  if (version < 1 || version > 9) throw new HwtError(`unexpected watchface version ${version}`);
  const layout = bytes.slice(WATCHFACE_HEADER_SIZE, tableStart);
  const table = bytes.subarray(tableStart, binStart);
  const bin = bytes.subarray(binStart);
  const count = Math.floor(tableLen / TABLE_ENTRY_SIZE);

  const entries: { offset: number; size: number }[] = [];
  const tv = view(table);
  for (let i = 0; i < count; i++) entries.push({ offset: tv.getUint32(i * 8, true), size: tv.getUint32(i * 8 + 4, true) });

  let regular = tableLen % TABLE_ENTRY_SIZE === 0 && binLen === bin.length && bin.length >= SIGNATURE_SIZE;
  let running = SIGNATURE_SIZE;
  if (regular) {
    for (const e of entries) {
      if (e.offset !== running || running + e.size > bin.length) {
        regular = false;
        break;
      }
      running += e.size;
    }
    if (regular && running !== bin.length) regular = false;
  }

  if (regular) {
    return {
      version,
      reserved,
      layout,
      signature: bin.slice(0, SIGNATURE_SIZE),
      images: entries.map((e) => bin.slice(e.offset, e.offset + e.size)),
    };
  }
  return {
    version,
    reserved,
    layout,
    signature: bin.slice(0, SIGNATURE_SIZE),
    images: entries.map((e) => (e.offset + e.size <= bin.length ? bin.slice(e.offset, e.offset + e.size) : new Uint8Array(0))),
    irregular: { header: bytes.slice(0, WATCHFACE_HEADER_SIZE), table: table.slice(), bin: bin.slice() },
  };
}

export function writeWatchface(wf: WatchfaceBinary): Uint8Array {
  if (wf.layout.length > 0xffff) throw new HwtError(`layout is ${wf.layout.length} bytes; the header stores it in 16 bits (max 65535)`);
  if (wf.irregular) {
    const header = wf.irregular.header.slice();
    const hv = view(header);
    hv.setUint16(0, wf.version, true);
    hv.setUint16(2, wf.layout.length, true);
    hv.setUint32(12, wf.reserved, true);
    return concat([header, wf.layout, wf.irregular.table, wf.irregular.bin]);
  }
  if (wf.signature.length !== SIGNATURE_SIZE) throw new HwtError(`signature must be ${SIGNATURE_SIZE} bytes`);
  const table = new Uint8Array(wf.images.length * TABLE_ENTRY_SIZE);
  const tv = view(table);
  let running = SIGNATURE_SIZE;
  wf.images.forEach((img, i) => {
    tv.setUint32(i * 8, running, true);
    tv.setUint32(i * 8 + 4, img.length, true);
    running += img.length;
  });
  if (running > 0xffffffff) throw new HwtError("images exceed 4 GiB");
  const header = new Uint8Array(WATCHFACE_HEADER_SIZE);
  const hv = view(header);
  hv.setUint16(0, wf.version, true);
  hv.setUint16(2, wf.layout.length, true);
  hv.setUint32(4, table.length, true);
  hv.setUint32(8, running, true);
  hv.setUint32(12, wf.reserved, true);
  return concat([header, wf.layout, table, wf.signature, ...wf.images]);
}

/** Throws unless the file is regular, i.e. image slots can be added, replaced and removed safely. */
export function assertEditable(wf: WatchfaceBinary): void {
  if (wf.irregular) throw new HwtError("this watchface binary has an irregular image table; images cannot be edited, only the layout");
}
