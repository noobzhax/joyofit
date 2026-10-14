import { defineConfig } from "@playwright/test";

/** Set STUDIO_URL to run the same tests against a deployed site instead of the local dev server. */
const remote = process.env.STUDIO_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: remote ?? "http://localhost:4173", viewport: { width: 1440, height: 900 }, acceptDownloads: true },
  webServer: remote
    ? undefined
    : {
        command: "bunx vite --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: true,
        timeout: 90_000,
      },
});
