import { defineConfig } from "vite";
import { cspPlugin } from "./scripts/csp-plugin.ts";

// base './': the built page works from any folder, e.g. https://<user>.github.io/<repo>/ (GitHub Pages).
export default defineConfig({
  base: "./",
  plugins: [cspPlugin()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0, // the PDF font and every other asset stay files of their own, never data: URLs
    chunkSizeWarningLimit: 1500,
  },
});
