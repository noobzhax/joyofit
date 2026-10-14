/**
 * Test and tooling support: renders sprites with `@napi-rs/canvas` in node, with the bundled fontsource fonts
 * registered, so sprite rendering and export run without a browser.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { GlobalFonts, Path2D, createCanvas, loadImage } from "@napi-rs/canvas";
import { registerAssetImage } from "@/model/assets";
import { setCanvasFactory, type Surface } from "@/render/canvas";
import { FONTS } from "@/render/fonts";

const require = createRequire(import.meta.url);

function packageDir(name: string): string {
  return dirname(require.resolve(`${name}/package.json`));
}

let installed = false;

export function installNodeCanvas(): void {
  if (installed) return;
  installed = true;
  setCanvasFactory((w, h) => createCanvas(w, h) as unknown as Surface);
  (globalThis as { Path2D?: unknown }).Path2D = Path2D;

  for (const font of FONTS) {
    if (font.family === "Plus Jakarta Sans Variable") {
      const dir = packageDir("@fontsource-variable/plus-jakarta-sans");
      GlobalFonts.registerFromPath(join(dir, "files", "plus-jakarta-sans-latin-wght-normal.woff2"), font.family);
      continue;
    }
    const slug = font.family.toLowerCase().replace(/ /g, "-");
    const dir = packageDir(`@fontsource/${slug}`);
    for (const weight of font.weights) {
      const file = join(dir, "files", `${slug}-latin-${weight}-normal.woff2`);
      if (existsSync(file)) GlobalFonts.registerFromPath(file, font.family);
    }
  }
}

/** Registers a PNG or JPEG file or buffer as an asset the renderer can use. */
export async function registerTestAsset(id: string, source: string | Buffer): Promise<void> {
  const img = await loadImage(source);
  registerAssetImage(id, { width: img.width, height: img.height, source: img as unknown as CanvasImageSource });
}
