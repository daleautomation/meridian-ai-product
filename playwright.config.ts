import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.MERIDIAN_BASE_URL ?? "https://www.meridianai.work").replace(/\/$/, "");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testMatch: /nicole-workspace\.spec\.ts/,
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: /nicole-workspace\.spec\.ts/,
      grep: /@mobile/,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
