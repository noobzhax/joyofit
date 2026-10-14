import { describe, expect, test } from "bun:test";
import { bytesEqual } from "../src/bytes";
import { verifyWatchface } from "../src/builder";
import { readHwt, writeHwt } from "../src/hwt";
import { readZip, writeZip } from "../src/zip";
import { parseWatchface, writeWatchface } from "../src/watchface";
import { parsedFixtures } from "./helpers";

const all = parsedFixtures();

describe("fixtures", () => {
  test("there are fixtures for every format generation we claim to support", () => {
    expect(all.filter((f) => f.name.startsWith("fit4pro/")).length).toBeGreaterThanOrEqual(10);
    expect(all.length).toBeGreaterThanOrEqual(18);
  });
});

describe.each(all)("round trip $name", ({ bytes, pkg }) => {
  test("zip: read -> write is byte-identical", () => {
    expect(bytesEqual(writeZip(readZip(bytes)), bytes)).toBe(true);
  });

  test("package: readHwt -> writeHwt is byte-identical (zip framing preserved)", () => {
    const fresh = readHwt(bytes);
    expect(fresh.watchfaceError).toBeUndefined();
    expect(bytesEqual(writeHwt(fresh), bytes)).toBe(true);
  });

  test("watchface binary: parse -> write is byte-identical and regular", () => {
    const wf = pkg.watchface!;
    expect(wf.irregular).toBeUndefined();
    const out = writeWatchface(wf);
    const stored = pkg.container === "nested" ? pkg.nested!.entries.find((e) => e.name === "watchface.bin")!.data : pkg.archive.entries.find((e) => e.name === pkg.watchfaceEntry)!.data;
    expect(bytesEqual(out, stored)).toBe(true);
    expect(bytesEqual(writeWatchface(parseWatchface(out)), out)).toBe(true);
  });

  test("header rules hold (xmllen/maplen/binlen/table offsets)", () => {
    const report = verifyWatchface(writeWatchface(pkg.watchface!));
    expect(report.problems).toEqual([]);
    expect(report.header.tableLen).toBe(report.images * 8);
    expect(report.header.reserved).toBe(0);
  });
});

describe("editing keeps everything else", () => {
  test("changing the title rewrites only description.xml", () => {
    const sample = all.find((f) => f.name === "fit4pro/NikeCombo.hwt")!;
    const pkg = readHwt(sample.bytes);
    pkg.description.title = "NikeCombo edited";
    const out = readHwt(writeHwt(pkg));
    expect(out.description.title).toBe("NikeCombo edited");
    expect(out.description.titleCn).toBe(sample.pkg.description.titleCn);
    for (const e of sample.pkg.archive.entries) {
      if (e.name === "description.xml") continue;
      expect(bytesEqual(out.archive.entries.find((x) => x.name === e.name)!.data, e.data)).toBe(true);
    }
    // the untouched entries keep their original compressed bytes too
    const reread = readZip(writeHwt(pkg));
    const before = readZip(sample.bytes);
    for (const e of before.entries) {
      if (e.name === "description.xml") continue;
      expect(bytesEqual(reread.entries.find((x) => x.name === e.name)!.framing!.localBytes, e.framing!.localBytes)).toBe(true);
    }
  });
});

describe("container kinds", () => {
  test("GT3 samples are nested zips whose watchface.bin parses", () => {
    const nested = all.filter((f) => f.name.includes("gt3"));
    expect(nested.length).toBeGreaterThan(0);
    for (const f of nested) {
      expect(f.pkg.container).toBe("nested");
      expect(f.pkg.nested!.entries.some((e) => e.name === "watchface/watch_face_config.xml")).toBe(true);
    }
  });

  test("Fit 4 Pro samples are flat HWHD13 packages", () => {
    for (const f of all.filter((x) => x.name.startsWith("fit4pro/"))) {
      expect(f.pkg.container).toBe("flat");
      expect(f.pkg.description.screen).toBe("HWHD13");
    }
  });
});
