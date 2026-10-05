import { defineConfig, devices } from "@playwright/test";

// The e2e tests run against the built site (npm run build + preview), which is what GitHub Pages serves.
// Locally they use the installed Microsoft Edge (no browser download); CI installs Chromium.
// Port 4337 is img2string's own: img2shadow previews on 4317, img2fold on 4327 and line2fourier on 4173, and
// reuseExistingServer must never pick up the wrong site (DECISIONS D-22).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4337/",
    serviceWorkers: "block",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://127.0.0.1:4337/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "msedge", testIgnore: /(bench|mobile)\.spec\.ts/, use: { ...devices["Desktop Edge"], channel: "msedge", viewport: { width: 1440, height: 900 } } },
    { name: "chromium", testIgnore: /(bench|mobile)\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], channel: process.env.CI ? undefined : "msedge" } },
    { name: "bench", testMatch: /bench\.spec\.ts/, timeout: 300_000, use: { channel: "msedge", headless: false, viewport: { width: 1600, height: 1000 } } },
  ],
});
