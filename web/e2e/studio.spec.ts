import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { decodeImage, readHwt, verifyWatchface, writeWatchface } from "@joyofit/hwt";

async function open(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("joyofit-studio:help-seen", "1"));
  await page.goto("/");
  await expect(page.getByTestId("face-canvas")).toBeVisible();
}

async function download(page: Page, trigger: () => Promise<void>): Promise<{ name: string; bytes: Uint8Array }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) };
}

test("add a time element, export, and parse the downloaded .hwt", async ({ page }) => {
  await open(page);

  // A fresh face already has a time layer; add a second one through the Add menu.
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Digital time" }).click();
  await expect(page.getByTestId("properties")).toBeVisible();
  await expect(page.getByTestId("layers").getByTestId("layer-time")).toHaveCount(2);

  await page.getByTestId("face-name").fill("Smoke test 1");
  await page.getByTestId("export-hwt").click();
  await expect(page.getByTestId("export-dialog")).toBeVisible();
  await expect(page.getByTestId("checklist")).toBeVisible();
  await expect(page.getByText("Resolution 408 × 480")).toBeVisible();
  await expect(page.getByTestId("download-hwt")).toBeEnabled();

  const file = await download(page, () => page.getByTestId("download-hwt").click());
  expect(file.name).toBe("Smoketest1.hwt");

  const pkg = readHwt(file.bytes);
  expect(pkg.description.screen).toBe("HWHD13");
  expect(pkg.description.title).toBe("Smoke test 1");
  const wf = pkg.watchface!;
  expect(verifyWatchface(writeWatchface(wf)).problems).toEqual([]);
  expect(wf.images.length).toBeGreaterThan(20);
  const thumb = decodeImage(wf.images[0]!);
  expect([thumb.width, thumb.height]).toEqual([228, 269]);
});

test("debug layout and project JSON downloads", async ({ page }) => {
  await open(page);
  await page.getByTestId("export-hwt").click();
  await expect(page.getByTestId("download-hwt")).toBeEnabled();
  const debug = await download(page, () => page.getByTestId("export-debug").click());
  const layout = JSON.parse(Buffer.from(debug.bytes).toString("utf8"));
  expect(layout.screen).toBe("HWHD13");
  expect(layout.layout.element.length).toBeGreaterThan(0);
  const project = await download(page, () => page.getByTestId("export-project-json").click());
  const parsed = JSON.parse(Buffer.from(project.bytes).toString("utf8"));
  expect(parsed.format).toBe("joyofit-studio-project");
  expect(parsed.project.elements.length).toBeGreaterThan(1);
});

test("drag moves a layer, undo and redo restore it, autosave survives a reload", async ({ page }) => {
  await open(page);
  const canvas = page.getByTestId("face-canvas");
  const box = (await canvas.boundingBox())!;
  const zoom = box.width / 408;

  // Click the clock digits (inside the default time element).
  await page.mouse.click(box.x + 200 * zoom, box.y + 235 * zoom);
  const x = page.getByLabel("X", { exact: true });
  await expect(x).toBeVisible();
  const before = Number(await x.inputValue());

  await page.mouse.move(box.x + 200 * zoom, box.y + 235 * zoom);
  await page.mouse.down();
  await page.mouse.move(box.x + 200 * zoom + 40 * zoom, box.y + 235 * zoom + 10 * zoom, { steps: 6 });
  await page.mouse.up();
  const moved = Number(await x.inputValue());
  expect(moved).not.toBe(before);

  await page.keyboard.press("Control+z");
  await expect(x).toHaveValue(String(before));
  await page.keyboard.press("Control+Shift+z");
  await expect(x).toHaveValue(String(moved));

  await page.waitForTimeout(600);
  await page.reload();
  await page.getByTestId("layers").getByTestId("layer-time").click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue(String(moved));
});

test("templates load and export", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-templates").click();
  const card = page.getByTestId("template-classic");
  await expect(card.locator("canvas")).toBeVisible();
  await card.click();
  await expect(page.getByTestId("layers").getByTestId("layer-hand").first()).toBeVisible();
  await page.getByTestId("export-hwt").click();
  await expect(page.getByTestId("download-hwt")).toBeEnabled();
  const file = await download(page, () => page.getByTestId("download-hwt").click());
  expect(file.name).toBe("Classic.hwt");
  const pkg = readHwt(file.bytes);
  expect(pkg.watchface!.images.length).toBeGreaterThan(5);
});

test("preview-only elements are marked and left out of the export", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Calories" }).click();
  await expect(page.getByText("Preview only").first()).toBeVisible();
  await page.getByTestId("export-hwt").click();
  await expect(page.getByText("Calories left out")).toBeVisible();
});

test("the corner handle scales the selected layer", async ({ page }) => {
  await open(page);
  const box = (await page.getByTestId("face-canvas").boundingBox())!;
  const zoom = box.width / 408;
  await page.getByTestId("layers").getByTestId("layer-time").click();
  const size = page.getByLabel("Digit height");
  const before = Number(await size.inputValue());
  const handle = page.locator('[data-handle="se"]');
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 60 * zoom, h.y + h.height / 2 + 30 * zoom, { steps: 8 });
  await page.mouse.up();
  expect(Number(await size.inputValue())).toBeGreaterThan(before);
});

test("an uploaded photo becomes the background and exports as images inside Huawei's size limit", async ({ page }) => {
  await open(page);
  // A noisy picture: it does not compress, which is the case that needs the export to split it.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 560;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7919) % 256;
      img.data[i + 1] = (i * 104729) % 256;
      img.data[i + 2] = (i * 1299709) % 256;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  });
  const buffer = Buffer.from(dataUrl.split(",")[1]!, "base64");

  await page.getByTestId("layers").getByTestId("layer-background").click();
  await page.getByRole("radio", { name: "Photo" }).click();
  await page.getByTestId("upload-input").setInputFiles({ name: "noise.png", mimeType: "image/png", buffer });
  await expect(page.getByLabel("Zoom", { exact: true })).toBeVisible();

  await page.getByTestId("export-hwt").click();
  await expect(page.getByTestId("download-hwt")).toBeEnabled();
  const file = await download(page, () => page.getByTestId("download-hwt").click());
  const wf = readHwt(file.bytes).watchface!;
  expect(wf.images.every((blob) => blob.length <= 750 * 1024)).toBe(true);
  expect(file.bytes.length).toBeGreaterThan(700_000);
});
