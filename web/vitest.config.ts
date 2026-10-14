import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@joyofit/hwt": fileURLToPath(new URL("../packages/hwt/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 60_000, setupFiles: ["src/test/setup.ts"] },
});
