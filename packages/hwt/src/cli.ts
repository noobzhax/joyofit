#!/usr/bin/env bun
/**
 * hwt CLI:  bun src/cli.ts info|extract|roundtrip|dump-layout <file.hwt> [options]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HwtError, bytesEqual, hex } from "./bytes";
import { verifyWatchface } from "./builder";
import { RESOLUTIONS } from "./description";
import { readHwt, writeHwt, type HwtPackage } from "./hwt";
import { decodeImage, encodeImage, readImageHeader } from "./image";
import { decodeLayout, describeLayout, type NamedObject } from "./layout";
import { checkFit4Limits } from "./limits";
import { encodePng } from "./png";
import { inferMessage, type PbField, type PbMessage } from "./protobuf";
import { valueTypeInfo } from "./valuetypes";
import { imageRef, writeWatchface } from "./watchface";

const USAGE = `usage: hwt <command> <file.hwt> [options]

  info <file>                 description, header, image table, layout outline
  extract <file> [outdir]     PNG per image (001.png ...), layout.json, layout.tree.txt, description.xml, previews
  roundtrip <file>            read -> write; compare bytes, re-encode every image
  dump-layout <file> [--tree] named JSON layout (default) or the raw protobuf tree`;

function load(path: string | undefined): { pkg: HwtPackage; bytes: Uint8Array } {
  if (!path) throw new HwtError(USAGE);
  const bytes = new Uint8Array(readFileSync(path));
  return { pkg: readHwt(bytes), bytes };
}

function opacity(blob: Uint8Array): string {
  try {
    const img = decodeImage(blob);
    let opaque = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) opaque++;
    return ((opaque / (img.width * img.height)) * 100).toFixed(1);
  } catch {
    return "?";
  }
}

function treeLines(m: PbMessage, indent: string, out: string[], depth = 0): void {
  for (const f of m.fields) out.push(...fieldLines(f, indent, depth));
}

function fieldLines(f: PbField, indent: string, depth: number): string[] {
  if (f.wire === 0) return [`${indent}${f.field}: ${f.value}`];
  if (f.wire === 2) {
    const inner = f.message ?? (depth < 6 ? inferMessage(f.bytes) : undefined);
    if (inner) {
      const out = [`${indent}${f.field} {`];
      treeLines(inner, `${indent}  `, out, depth + 1);
      out.push(`${indent}}`);
      return out;
    }
    if (f.bytes.every((b) => b >= 0x20 && b < 0x7f)) return [`${indent}${f.field}: ${JSON.stringify(new TextDecoder().decode(f.bytes))}`];
    return [`${indent}${f.field}: <${f.bytes.length} bytes ${hex(f.bytes, 24)}>`];
  }
  return [`${indent}${f.field}: fixed${f.wire === 1 ? 64 : 32} ${hex(f.bytes)}`];
}

function info(path: string | undefined): void {
  const { pkg, bytes } = load(path);
  const d = pkg.description;
  const res = RESOLUTIONS[d.screen];
  console.log(`file          ${path} (${bytes.length} bytes)`);
  console.log(`title         ${d.title} / ${d.titleCn}`);
  console.log(`author        ${d.author || "-"}   designer ${d.designer || "-"}`);
  console.log(`screen        ${d.screen}${res ? ` = ${res.width} x ${res.height} (w x h)` : " (unknown to Gadgetbridge)"}   version ${d.version}   root <${d.root}>`);
  console.log(`container     ${pkg.container}${pkg.nested ? ` (nested zip: ${pkg.nested.entries.map((e) => e.name).join(", ")})` : ""}`);
  console.log(`zip entries   ${pkg.archive.entries.map((e) => `${e.name}${e.name.endsWith("/") ? "" : ` (${e.data.length})`}`).join(", ")}`);
  const wf = pkg.watchface;
  if (!wf) {
    console.log(`watchface     NOT PARSED: ${pkg.watchfaceError}`);
    return;
  }
  const out = writeWatchface(wf);
  const report = verifyWatchface(out);
  console.log(
    `header        version ${wf.version}, layout ${wf.layout.length} B, table ${wf.images.length * 8} B (${wf.images.length} images), bin ${report.header.binLen} B, reserved ${wf.reserved}${wf.irregular ? "   [IRREGULAR table: images read-only]" : ""}`,
  );
  console.log(`signature     ${hex(wf.signature)}`);
  console.log(`consistency   ${report.ok ? "ok" : `PROBLEMS: ${report.problems.join("; ")}`}`);
  console.log("\nimages");
  console.log("  idx  ref   width x height     bytes  opacity%");
  wf.images.forEach((blob, i) => {
    if (!blob.length) {
      console.log(`  ${String(i).padStart(3)}  ${imageRef(i)}   (empty slot)`);
      return;
    }
    const h = readImageHeader(blob);
    console.log(`  ${String(i).padStart(3)}  ${imageRef(i)}   ${String(h.width).padStart(5)} x ${String(h.height).padEnd(5)} ${String(blob.length).padStart(9)}  ${opacity(blob).padStart(7)}`);
  });
  if (wf.version >= 2 && !wf.irregular) {
    const lim = checkFit4Limits(wf, out.length, bytes.length);
    console.log(`\nlimits (HWHD13 rules): ${lim.ok ? "ok" : lim.problems.join("; ")}  [binary ${lim.binaryBytes} B, images in memory ${lim.imageMemoryBytes} B, est. layer ${lim.layerBytes} B]`);
    for (const w of lim.warnings) console.log(`  warning: ${w}`);
  }
  console.log("\nlayout");
  const layout = decodeLayout(wf.layout, wf.version);
  const named = describeLayout(layout);
  if (layout.kind === "v2") outlineV2(named);
  else console.log(JSON.stringify(named, null, 1).split("\n").slice(0, 80).join("\n"));
}

function list(value: unknown): NamedObject[] {
  return Array.isArray(value) ? value.filter((v): v is NamedObject => typeof v === "object" && v !== null && !Array.isArray(v)) : [];
}

function outlineV2(root: NamedObject): void {
  console.log(`  title_en=${JSON.stringify(root.title_en)} title_cn=${JSON.stringify(root.title_cn)}`);
  for (const [i, e] of list(root.element).entries()) {
    console.log(`  element ${i} ${String(e.label).replace("ELEMENT_LABEL_", "")}`);
    const printLayer = (l: NamedObject, indent: string) => {
      const key = Object.keys(l).find((k) => k !== "index" && k !== "draw_type");
      const body = key ? l[key] : undefined;
      const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
      const vt = typeof b.value_type === "number" ? ` value_type=${b.value_type}${valueTypeInfo(b.value_type) ? `(${valueTypeInfo(b.value_type)!.name})` : ""}` : "";
      const res = Array.isArray(b.res_name) ? `[${b.res_name.join(",")}]` : b.res_name ?? "";
      const ambient = b.ambient_mode === "AMBIENT_ONLY" ? " AOD" : b.ambient_mode === "AMBIENT_NORMAL" ? " BOTH" : "";
      console.log(`${indent}layer ${l.index} ${String(l.draw_type).replace("DRAW_TYPE_", "")}${vt} ${res}${ambient}`);
    };
    for (const l of list(e.layer)) printLayer(l, "    ");
    for (const c of list(e.container)) {
      console.log(`    container ${c.index} data_type=${c.data_type ?? "-"}`);
      for (const l of list(c.layer)) printLayer(l, "      ");
    }
  }
}

function extract(path: string | undefined, outDir: string | undefined): void {
  const { pkg } = load(path);
  const dir = outDir ?? `${path}.extracted`;
  mkdirSync(dir, { recursive: true });
  const wf = pkg.watchface;
  if (!wf) throw new HwtError(`cannot extract: ${pkg.watchfaceError}`);
  let written = 0;
  wf.images.forEach((blob, i) => {
    if (!blob.length) return;
    writeFileSync(join(dir, `${imageRef(i)}.png`), encodePng(decodeImage(blob)));
    written++;
  });
  const layout = decodeLayout(wf.layout, wf.version);
  writeFileSync(join(dir, "layout.json"), JSON.stringify(describeLayout(layout), null, 2));
  const tree: string[] = [];
  treeLines(layout.root, "", tree);
  writeFileSync(join(dir, "layout.tree.txt"), tree.join("\n"));
  for (const e of pkg.archive.entries) {
    if (e.name.endsWith("/")) continue;
    if (e.name === pkg.watchfaceEntry) continue;
    const target = join(dir, e.name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, e.data);
  }
  console.log(`extracted ${written} images + layout.json + layout.tree.txt + package entries to ${dir}`);
}

function roundtrip(path: string | undefined): void {
  const { pkg, bytes } = load(path);
  const out = writeHwt(pkg);
  const identical = bytesEqual(out, bytes);
  console.log(`package   ${identical ? "byte-identical" : `DIFFERENT (${bytes.length} -> ${out.length} bytes)`}`);
  let failures = identical ? 0 : 1;
  const wf = pkg.watchface;
  if (wf) {
    let sameMin4 = 0;
    let sameMin2 = 0;
    let lossless = 0;
    let n = 0;
    for (const blob of wf.images) {
      if (!blob.length) continue;
      n++;
      const img = decodeImage(blob);
      const enc = encodeImage(img);
      if (bytesEqual(enc, blob)) sameMin4++;
      else if (bytesEqual(encodeImage(img, { minRun: 2 }), blob)) sameMin2++;
      if (bytesEqual(decodeImage(enc).data, img.data)) lossless++;
      else failures++;
    }
    console.log(`images    ${n} decoded; decode(encode(x)) == x for ${lossless}; re-encode reproduces the original bytes with minRun 4 for ${sameMin4}, only with minRun 2 for ${sameMin2}`);
  }
  if (failures) process.exitCode = 1;
}

function dumpLayout(path: string | undefined, tree: boolean): void {
  const { pkg } = load(path);
  const wf = pkg.watchface;
  if (!wf) throw new HwtError(`no watchface: ${pkg.watchfaceError}`);
  const layout = decodeLayout(wf.layout, wf.version);
  if (tree) {
    const lines: string[] = [];
    treeLines(layout.root, "", lines);
    console.log(lines.join("\n"));
  } else {
    console.log(JSON.stringify(describeLayout(layout), null, 2));
  }
}

const [command, file, ...rest] = process.argv.slice(2);
try {
  if (command === "info") info(file);
  else if (command === "extract") extract(file, rest[0]);
  else if (command === "roundtrip") roundtrip(file);
  else if (command === "dump-layout") dumpLayout(file, rest.includes("--tree"));
  else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
