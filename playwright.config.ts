import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.MERIDIAN_BASE_URL ?? "https://www.meridianai.work").replace(/\/$/, "");
const storageState = process.env.PLAYWRIGHT_STORAGE_STATE;
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders = bypassSecret
  ? { "x-vercel-protection-bypass": bypassSecret }
  : undefined;

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
    ...(storageState ? { storageState } : {}),
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
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
