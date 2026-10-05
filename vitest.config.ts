import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts so the build-only CSP plugin never runs under the tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
