import { defineConfig } from "vitest/config";

// The long checks (minutes, not seconds): brute force over every winding order. Run with `npm run test:slow`;
// they are not part of `npm test` or CI.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/slow/**/*.test.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
