import { defineConfig, devices } from "@playwright/test"

// Local runs reuse an installed browser (PW_CHANNEL=msedge|chrome); CI installs Playwright's Chromium.
const channel = process.env.PW_CHANNEL

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    ...(channel ? { channel } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}), viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...(channel ? { channel } : {}) }, grep: /@mobile/ },
  ],
})
