import { describe, expect, it } from "vitest";
import { spriteRgba } from "./canvas";
import { dateWords, digitsOf, fontSizeForDigitHeight, renderDigitSet, renderWordSet, WEEKDAYS, type GlyphStyle } from "./glyphs";
import { digitList, clockFields } from "./values";

const style: GlyphStyle = { font: { family: "Outfit", weight: 500 }, digitHeight: 80, color: "#FFFFFF", outline: null };

function inkBox(sprite: Parameters<typeof spriteRgba>[0]) {
  const { data, width, height } = spriteRgba(sprite);
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 8) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, maxX, minY, maxY, width, height };
}

describe("digit sprites", () => {
  const set = renderDigitSet(style);

  it("makes ten digits and a colon with one shared cell size", () => {
    expect(set.digits).toHaveLength(10);
    for (const d of set.digits) expect([d.width, d.height]).toEqual([set.cellW, set.cellH]);
    expect(set.colon.height).toBe(set.cellH);
    expect(set.colon.width).toBeLessThan(set.cellW);
  });

  it("scales the ink to the requested digit height", () => {
    const heights = set.digits.map((d) => {
      const box = inkBox(d);
      return box.maxY - box.minY + 1;
    });
    // The tallest digit is the requested height, within the rounding of the font size.
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(76);
    expect(Math.max(...heights)).toBeLessThanOrEqual(86);
  });

  it("keeps the ink inside the cell and on a shared baseline", () => {
    for (const d of set.digits) {
      const box = inkBox(d);
      expect(box.minX).toBeGreaterThanOrEqual(0);
      expect(box.maxX).toBeLessThan(set.cellW);
      expect(box.maxY).toBeLessThan(set.cellH);
    }
    const zero = inkBox(set.digits[0]!);
    const eight = inkBox(set.digits[8]!);
    expect(Math.abs(zero.maxY - eight.maxY)).toBeLessThanOrEqual(2);
  });

  it("applies the color and keeps transparent pixels transparent", () => {
    const { data } = spriteRgba(set.digits[1]!);
    let opaque = 0;
    let transparent = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) {
        opaque++;
        expect([data[i], data[i + 1], data[i + 2]]).toEqual([255, 255, 255]);
      } else if (data[i + 3] === 0) transparent++;
    }
    expect(opaque).toBeGreaterThan(100);
    expect(transparent).toBeGreaterThan(opaque);
  });

  it("grows the cell by the outline width and draws the outline color", () => {
    const outlined = renderDigitSet({ ...style, outline: { color: "#FF0000", width: 4 } });
    expect(outlined.cellW).toBeGreaterThan(set.cellW);
    const { data } = spriteRgba(outlined.digits[0]!);
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 255 && data[i] === 255 && data[i + 1] === 0) red++;
    expect(red).toBeGreaterThan(50);
  });

  it("reuses a rendered set for the same style", () => {
    expect(renderDigitSet({ ...style })).toBe(set);
    expect(renderDigitSet({ ...style, color: "#00FF00" })).not.toBe(set);
  });

  it("derives a font size from the digit height", () => {
    const small = fontSizeForDigitHeight(style.font, 40);
    const large = fontSizeForDigitHeight(style.font, 80);
    expect(large / small).toBeCloseTo(2, 1);
  });
});

describe("word sprites", () => {
  it("gives every word the same cell, with the widest word setting its width", () => {
    const words = dateWords("weekday", true);
    const set = renderWordSet(words, style);
    expect([...set.words.keys()]).toEqual(words);
    for (const sprite of set.words.values()) expect([sprite.width, sprite.height]).toEqual([set.cellW, set.cellH]);
  });

  it("counts weekdays Monday first, as the watch does", () => {
    expect(WEEKDAYS[0]).toBe("MON");
    expect(WEEKDAYS[6]).toBe("SUN");
    expect(dateWords("weekday", false)[0]).toBe("Mon");
    expect(dateWords("month", true)).toHaveLength(12);
  });
});

describe("value helpers", () => {
  it("pads digit lists", () => {
    expect(digitList(7, 2)).toEqual([0, 7]);
    expect(digitList(6842, 1)).toEqual([6, 8, 4, 2]);
    expect(digitsOf(123456, 5)).toEqual([2, 3, 4, 5, 6]);
  });

  it("reads clock fields, with a 12 hour option", () => {
    const t = new Date(2026, 9, 14, 15, 5, 9).getTime();
    expect(clockFields(t, false)).toMatchObject({ hour: 15, minute: 5, second: 9, pm: true, day: 14, month: 9, weekday: 2 });
    expect(clockFields(t, true).hour).toBe(3);
    expect(clockFields(new Date(2026, 9, 14, 0, 0, 0).getTime(), true).hour).toBe(12);
  });
});
