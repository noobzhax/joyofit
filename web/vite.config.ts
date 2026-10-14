import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const hwt = fileURLToPath(new URL("../packages/hwt/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), react(), cloudflare()],
  resolve: { alias: { "@joyofit/hwt": hwt, "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 3100, fs: { allow: [".."] } },
});
