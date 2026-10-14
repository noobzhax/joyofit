import { surfaceToPng, type Surface } from "@/render/canvas";
import type { AssetImage } from "@/render/shapes";

/**
 * Uploaded images (photo backgrounds, stickers, custom hands). Blobs live in IndexedDB so a project
 * survives a reload without bloating localStorage; elements only hold an asset id. The decoded bitmaps
 * are cached here for the renderer.
 */
export interface AssetRecord {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

interface Loaded {
  record: AssetRecord;
  image: AssetImage;
}

const DB_NAME = "joyofit-studio";
const STORE = "assets";
const loaded = new Map<string, Loaded>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assetsVersion(): number {
  return version;
}

function openDb(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    return await promise;
  } finally {
    db.close();
  }
}

export function getAsset(id: string | null): AssetImage | null {
  return id ? (loaded.get(id)?.image ?? null) : null;
}

export function getAssetRecord(id: string): AssetRecord | null {
  return loaded.get(id)?.record ?? null;
}

async function decode(record: AssetRecord): Promise<void> {
  const bitmap = await createImageBitmap(record.blob);
  loaded.set(record.id, { record, image: { width: bitmap.width, height: bitmap.height, source: bitmap } });
}

/** Scales the longest side down to `maxSide` and re-encodes: JPEG for photos, PNG where transparency matters. */
async function normalise(file: Blob, maxSide: number, keepAlpha: boolean): Promise<{ blob: Blob; type: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  if (!keepAlpha) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const type = keepAlpha ? "image/png" : "image/jpeg";
  return { blob: await canvas.convertToBlob({ type, quality: 0.9 }), type };
}

export async function addAssetFromFile(file: File, kind: "photo" | "sprite"): Promise<string> {
  const { blob, type } = await normalise(file, kind === "photo" ? 1600 : 1024, kind === "sprite");
  const record: AssetRecord = { id: crypto.randomUUID(), name: file.name, type, blob };
  await idb("readwrite", (s) => s.put(record));
  await decode(record);
  bump();
  return record.id;
}

/** Restores every stored asset on start. */
export async function loadAllAssets(): Promise<void> {
  try {
    const records = await idb<AssetRecord[]>("readonly", (s) => s.getAll());
    await Promise.all(records.map((r) => decode(r).catch(() => undefined)));
  } catch {
    // IndexedDB can be unavailable (private mode): the project still opens, uploaded images are just missing.
  }
  bump();
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
  return promise;
}

export async function assetsToDataUrls(ids: string[]): Promise<Record<string, { name: string; dataUrl: string }>> {
  const out: Record<string, { name: string; dataUrl: string }> = {};
  for (const id of ids) {
    const rec = loaded.get(id)?.record;
    if (rec) out[id] = { name: rec.name, dataUrl: await blobToDataUrl(rec.blob) };
  }
  return out;
}

export async function importAssetDataUrls(assets: Record<string, { name: string; dataUrl: string }>): Promise<void> {
  for (const [id, a] of Object.entries(assets)) {
    const blob = await (await fetch(a.dataUrl)).blob();
    const record: AssetRecord = { id, name: a.name, type: blob.type, blob };
    await idb("readwrite", (s) => s.put(record)).catch(() => undefined);
    await decode(record);
  }
  bump();
}

/** Registers an already decoded blob without persisting (templates that build their own artwork). */
export async function addAssetFromBlob(blob: Blob, name: string): Promise<string> {
  const record: AssetRecord = { id: crypto.randomUUID(), name, type: blob.type, blob };
  await idb("readwrite", (s) => s.put(record)).catch(() => undefined);
  await decode(record);
  bump();
  return record.id;
}

/** Test seam: registers an in-memory image under a fixed id. */
export function registerAssetImage(id: string, image: AssetImage): void {
  loaded.set(id, { record: { id, name: id, type: "image/png", blob: new Blob() }, image });
  bump();
}

/**
 * Registers artwork drawn by code (template dials, sample backdrops). In a browser it is stored like an upload so
 * it survives a reload and is embedded in project files; without IndexedDB (tests) it only lives in memory.
 */
export async function addGeneratedAsset(surface: Surface, name: string): Promise<string> {
  if (typeof indexedDB === "undefined") {
    const id = crypto.randomUUID();
    registerAssetImage(id, { width: surface.width, height: surface.height, source: surface as unknown as CanvasImageSource });
    return id;
  }
  const png = await surfaceToPng(surface);
  return addAssetFromBlob(new Blob([png as BlobPart], { type: "image/png" }), name);
}
