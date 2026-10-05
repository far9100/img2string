import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts so the build-only CSP plugin never runs under the tests.
// tests/slow holds the checks that take minutes (`npm run test:slow`, vitest.slow.config.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/slow/**", "node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
