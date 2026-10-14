import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surfaceToPng } from "@/render/canvas";
import { renderProjectSprite } from "@/render/scene";
import { defaultSim } from "@/render/values";
import { TEMPLATES } from "./index";

const out = process.env.RENDER_OUT;

describe("templates", () => {
  for (const template of TEMPLATES) {
    it(`${template.name} builds and renders`, async () => {
      const project = await template.build();
      expect(project.elements[0]?.type).toBe("background");
      expect(project.elements.length).toBeGreaterThan(1);
      const sprite = renderProjectSprite(project, defaultSim());
      const png = await surfaceToPng(sprite.surface);
      expect(png.length).toBeGreaterThan(1000);
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/tpl-${template.id}.png`, png);
      }
    });
  }
});
