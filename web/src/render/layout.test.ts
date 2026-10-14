import { describe, expect, it } from "vitest";
import { newDate, newTime, newWidget } from "@/model/defaults";
import { layoutDate, layoutTime, layoutWidget } from "./layout";
import { renderHand, renderRing } from "./shapes";
import { newHand, newRing } from "@/model/defaults";
import { drawRingProgress, clockAngle } from "./shapes";
import { newSprite, spriteRgba } from "./canvas";
import { handAngle } from "./scene";

describe("layout", () => {
  it("places hour and minute pairs with the colon between them", () => {
    const l = layoutTime(newTime({ tracking: 0, showSeconds: false }));
    const roles = l.parts.map((p) => (p.kind === "digits" ? p.role : p.kind));
    expect(roles).toEqual(["hour", "colon", "minute"]);
    const [hour, colon, minute] = l.parts as unknown as [{ x: number; set: { cellW: number } }, { x: number }, { x: number }];
    expect(colon.x).toBe(2 * hour.set.cellW);
    expect(minute.x).toBeGreaterThan(colon.x);
    expect(l.w).toBe(minute.x + 2 * hour.set.cellW);
  });

  it("stacks minutes under hours and aligns seconds to the minutes' baseline", () => {
    const l = layoutTime(newTime({ layout: "stack", showSeconds: true }));
    const hour = l.parts.find((p) => p.kind === "digits" && p.role === "hour")!;
    const minute = l.parts.find((p) => p.kind === "digits" && p.role === "minute")!;
    const second = l.parts.find((p) => p.kind === "digits" && p.role === "second")!;
    expect(minute.y).toBeGreaterThan(hour.y);
    expect(second.x).toBeGreaterThan(minute.x);
    expect(second.y + (second as { set: { baseline: number } }).set.baseline).toBeCloseTo(minute.y + (minute as { set: { baseline: number } }).set.baseline, 0);
  });

  it("adds an AM/PM word set for the 12 hour clock", () => {
    const l = layoutTime(newTime({ ampm: true }));
    const ampm = l.parts.find((p) => p.kind === "words");
    expect(ampm && ampm.kind === "words" && ampm.words).toEqual(["AM", "PM"]);
  });

  it("lays the date out in weekday, day, month order and skips parts that are off", () => {
    const all = layoutDate(newDate({ parts: ["month", "weekday", "day"] }));
    expect(all.parts.map((p) => (p.kind === "words" ? p.role : p.kind === "digits" ? p.role : p.kind))).toEqual(["weekday", "day", "month"]);
    const xs = all.parts.map((p) => p.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(layoutDate(newDate({ parts: ["day"] })).parts).toHaveLength(1);
  });

  it("puts a widget icon beside or above its number", () => {
    const side = layoutWidget(newWidget("steps", { layout: "side" }));
    const icon = side.parts.find((p) => p.kind === "icon")!;
    const number = side.parts.find((p) => p.kind === "digits")!;
    expect(number.x).toBeGreaterThan(icon.x);
    const stack = layoutWidget(newWidget("heartRate", { layout: "stack" }));
    const sn = stack.parts.find((p) => p.kind === "digits")!;
    expect(sn.kind === "digits" && sn.align).toBe("center");
    expect(sn.y).toBeGreaterThan(stack.parts.find((p) => p.kind === "icon")!.y);
    expect(layoutWidget(newWidget("battery", { showIcon: false })).parts).toHaveLength(1);
  });
});

describe("shapes", () => {
  it("draws a hand pointing up with the pivot below the tip", () => {
    for (const shape of ["classic", "baton", "sword", "needle"] as const) {
      const h = renderHand(newHand("minute", { shape, length: 120, width: 10, tail: 20 }), null);
      expect(h.pivotY).toBeGreaterThan(100);
      expect(h.pivotY).toBeLessThan(h.sprite.height);
      expect(h.pivotX).toBeCloseTo(h.sprite.width / 2, 0);
      const { data, width } = spriteRgba(h.sprite);
      // The tip row near the top is inked, and the pivot pixel is inked.
      const at = (x: number, y: number) => data[(y * width + x) * 4 + 3]!;
      expect(at(h.pivotX, h.pivotY)).toBeGreaterThan(0);
      expect(at(h.pivotX, 6)).toBeGreaterThan(0);
    }
  });

  it("measures hand angles from 12 o'clock", () => {
    const t = new Date(2026, 9, 14, 3, 0, 0, 0).getTime();
    expect(handAngle("hour", t)).toBeCloseTo(90, 5);
    expect(handAngle("minute", t)).toBeCloseTo(0, 5);
    const half = new Date(2026, 9, 14, 6, 30, 30, 0).getTime();
    expect(handAngle("minute", half)).toBeCloseTo(183, 5);
    expect(handAngle("second", half)).toBeCloseTo(180, 5);
  });

  it("clips a ring's progress to the fraction of its sweep", () => {
    const el = newRing("steps", { size: 100, thickness: 20, startAngle: 0, sweep: 360, color: "#FFFFFF", trackColor: "#000000" });
    const ring = renderRing(el);
    const { sprite, ctx } = newSprite(100, 100);
    drawRingProgress(ctx, ring, el, 0, 0, 0.5);
    const { data, width } = spriteRgba(sprite);
    const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3]!;
    // Half progress from 12 o'clock clockwise fills the right side and leaves the left side empty.
    expect(alpha(92, 50)).toBeGreaterThan(200);
    expect(alpha(8, 50)).toBe(0);
    expect(clockAngle(90)).toBeCloseTo(0, 5);
  });
});
