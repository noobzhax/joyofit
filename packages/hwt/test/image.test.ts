import { describe, expect, test } from "bun:test";
import { HwtError, bytesEqual } from "../src/bytes";
import { decodeImage, encodeImage, IMAGE_HEADER_SIZE, readImageHeader } from "../src/image";
import { decodePng, encodePng } from "../src/png";
import { parsedFixtures, randomImage, rng, solidImage } from "./helpers";

describe("image codec properties", () => {
  test("decode(encode(x)) == x for 300 random images (sizes 1..64, escape-coloured pixels included)", () => {
    const rand = rng(1234);
    for (let n = 0; n < 300; n++) {
      const w = 1 + Math.floor(rand() * 64);
      const h = 1 + Math.floor(rand() * 64);
      const img = randomImage(rand, w, h, { escapePixels: n % 2 === 0 });
      for (const minRun of [2, 3, 4, 8]) {
        const blob = encodeImage(img, { minRun });
        const back = decodeImage(blob);
        expect(back.width).toBe(w);
        expect(back.height).toBe(h);
        expect(bytesEqual(back.data, img.data)).toBe(true);
      }
    }
  });

  test("a single pixel equal to the escape sequence is stored as a run of one", () => {
    // RGBA 45 67 89 23 is BGRA 89 67 45 23, i.e. the escape.
    const img = { width: 1, height: 1, data: Uint8Array.from([0x45, 0x67, 0x89, 0x23]) };
    const blob = encodeImage(img);
    expect(blob.length).toBe(IMAGE_HEADER_SIZE + 12);
    expect(bytesEqual(decodeImage(blob).data, img.data)).toBe(true);
  });

  test("encoder emits runs only when strictly smaller and uses literals otherwise", () => {
    const flat = solidImage(10, 10, [1, 2, 3, 255]);
    expect(encodeImage(flat).length).toBe(IMAGE_HEADER_SIZE + 12); // one run
    const three = { width: 3, height: 1, data: Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]) };
    expect(encodeImage(three).length).toBe(IMAGE_HEADER_SIZE + 12); // 3 literals = 12 bytes, default minRun 4
    expect(encodeImage(three, { minRun: 2 }).length).toBe(IMAGE_HEADER_SIZE + 12); // 1 run = 12 bytes
    const four = solidImage(4, 1, [9, 9, 9, 9]);
    expect(encodeImage(four).length).toBe(IMAGE_HEADER_SIZE + 12);
  });

  test("maxRun splits long runs", () => {
    const img = solidImage(100, 1, [5, 5, 5, 5]);
    const blob = encodeImage(img, { maxRun: 30 });
    expect(blob.length).toBe(IMAGE_HEADER_SIZE + 4 * 12);
    expect(bytesEqual(decodeImage(blob).data, img.data)).toBe(true);
  });

  test("malformed blobs are rejected, not silently padded", () => {
    const good = encodeImage(solidImage(4, 4, [1, 2, 3, 4]));
    expect(() => decodeImage(good.subarray(0, good.length - 1))).toThrow(HwtError);
    expect(() => decodeImage(new Uint8Array([1, 2, 3]))).toThrow(HwtError);
    const badMagic = good.slice();
    badMagic[2] = 0x55;
    expect(() => decodeImage(badMagic)).toThrow(/unsupported image magic/);
    const trailing = new Uint8Array(good.length + 4);
    trailing.set(good);
    expect(() => decodeImage(trailing)).toThrow(/trailing/);
    const tooLong = good.slice();
    tooLong[8 + 8] = 0xff; // count of the first run far beyond 16 pixels
    expect(() => decodeImage(tooLong)).toThrow(HwtError);
  });

  test("PNG writer/reader round trips", () => {
    const rand = rng(7);
    const img = randomImage(rand, 37, 19);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(37);
    expect(bytesEqual(back.data, img.data)).toBe(true);
  });
});

describe("image codec on the samples", () => {
  /**
   * Two older faces (Carrera, Unnamed) were written by an encoder that turns every run of 2+ pixels into an RLE record;
   * every other sample (Fit 4 Pro, GT6, Band 9, GT3, SimpleItalic) uses runs of 4+ only.
   */
  const MIN_RUN_BY_FIXTURE: Record<string, number> = { "unlicensed/Carrera.hwt": 2, "other/Unnamed.hwhd02.hwt": 2 };

  test("every image decodes, decode(encode(x)) == x, and re-encoding reproduces the original bytes", () => {
    let total = 0;
    for (const f of parsedFixtures()) {
      const minRun = MIN_RUN_BY_FIXTURE[f.name] ?? 4;
      const wf = f.pkg.watchface!;
      wf.images.forEach((blob, i) => {
        if (!blob.length) return;
        total++;
        const img = decodeImage(blob);
        const header = readImageHeader(blob);
        expect([img.width, img.height]).toEqual([header.width, header.height]);
        const enc = encodeImage(img, { minRun });
        expect(bytesEqual(decodeImage(enc).data, img.data)).toBe(true);
        if (!bytesEqual(enc, blob)) throw new Error(`${f.name} image ${i}: re-encode with minRun ${minRun} differs from the original`);
      });
    }
    expect(total).toBeGreaterThan(1100);
  });

  test("the default encoder policy (minRun 4) is the one the Fit 4 Pro samples use", () => {
    const wf = parsedFixtures().find((f) => f.name === "fit4pro/SpaceRed.hwt")!.pkg.watchface!;
    const blob = wf.images[2]!;
    expect(bytesEqual(encodeImage(decodeImage(blob)), blob)).toBe(true);
    expect(bytesEqual(encodeImage(decodeImage(blob), { minRun: 2 }), blob)).toBe(false);
  });
});
