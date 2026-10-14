import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readHwt, type HwtPackage } from "../src/hwt";
import type { RgbaImage } from "../src/image";

const ROOT = join(import.meta.dir, "..", "fixtures");

export interface Fixture {
  /** Path relative to fixtures/, e.g. `fit4pro/SpaceRed.hwt`. */
  name: string;
  bytes: Uint8Array;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".hwt")) out.push(p);
  }
}

export function fixtures(filter?: (name: string) => boolean): Fixture[] {
  const paths: string[] = [];
  walk(ROOT, paths);
  return paths
    .sort()
    .map((p) => ({ name: relative(ROOT, p), bytes: new Uint8Array(readFileSync(p)) }))
    .filter((f) => !filter || filter(f.name));
}

/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random RGBA image with runs of varying length, transparent regions, and (optionally) escape-coloured pixels. */
export function randomImage(rand: () => number, width: number, height: number, opts: { escapePixels?: boolean } = {}): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  let i = 0;
  while (i < width * height) {
    const run = rand() < 0.5 ? 1 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 60);
    let px: [number, number, number, number];
    const r = rand();
    if (r < 0.2) px = [0, 0, 0, 0];
    else if (opts.escapePixels && r < 0.3) px = [0x45, 0x67, 0x89, 0x23]; // RGBA of the BGRA escape 89 67 45 23
    else px = [Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)];
    for (let k = 0; k < run && i < width * height; k++, i++) data.set(px, i * 4);
  }
  return { width, height, data };
}

/** Flat RGBA image of one colour. */
export function solidImage(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

let parsed: { name: string; bytes: Uint8Array; pkg: HwtPackage }[] | undefined;

/** Every fixture parsed once for the whole test run. Read-only: tests that mutate must call `readHwt(bytes)` themselves. */
export function parsedFixtures(): { name: string; bytes: Uint8Array; pkg: HwtPackage }[] {
  parsed ??= fixtures().map((f) => ({ ...f, pkg: readHwt(f.bytes) }));
  return parsed;
}
