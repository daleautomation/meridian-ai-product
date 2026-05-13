#!/usr/bin/env node
// Meridian demo workspace smoke test.
//
// Requires a running Next server with SESSION_SECRET configured.
// Example:
//   SESSION_SECRET=local-demo-session-secret npm run dev
//   npm run smoke:demo -- --base-url=http://localhost:3000

import { chromium, expect } from "@playwright/test";

const args = process.argv.slice(2);
const baseUrl = (() => {
  const flag = args.find((arg) => arg.startsWith("--base-url="));
  return (flag ? flag.slice("--base-url=".length) : process.env.MERIDIAN_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
})();

const profiles = ["max", "advisor", "public"];
const consoleProblems = [];
const pageErrors = [];

function logPass(message) {
  console.log(`✓ ${message}`);
}

async function clickTab(page, label) {
  const primaryNav = page.getByRole("navigation", { name: "Primary view" });
  await primaryNav.getByRole("button", { name: label, exact: true }).click();
  await expect(primaryNav.getByRole("button", { name: label, exact: true })).toBeVisible();
}

async function assertDemoWorkspace(page, profile) {
  await page.goto(`${baseUrl}/demo/${profile}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/operator\?workspace=advisor-demo/, { timeout: 60_000 });
  await expect(page.getByText("Demo mode: interactive preview, writes disabled")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("navigation", { name: "Primary view" })).toBeVisible();
  logPass(`/demo/${profile} logs in and lands on advisor-demo`);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("favicon.ico")) return;
    if (text.includes("Failed to load resource") && (text.includes("403") || text.includes("404"))) return;
    consoleProblems.push(text);
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  for (const profile of profiles) {
    await assertDemoWorkspace(page, profile);
  }

  await page.goto(`${baseUrl}/operator?workspace=advisor-demo`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Demo mode: interactive preview, writes disabled")).toBeVisible({ timeout: 60_000 });
  logPass("direct advisor-demo operator route loads with existing demo session");

  for (const tab of ["Calendar", "Scheduling", "History", "Relationships", "Calendar"]) {
    await clickTab(page, tab);
    logPass(`${tab} tab is clickable`);
  }

  await page.getByRole("button", { name: /Shared Queue/ }).click();
  const callsFilter = page.getByRole("button", { name: "Calls", exact: true });
  await callsFilter.click();
  await callsFilter.click();
  logPass("queue and visibility filters are clickable");

  const assistButton = page.getByRole("button", { name: /Open Assist Mode/i }).first();
  await expect(assistButton).toBeVisible({ timeout: 30_000 });
  await assistButton.click();
  await expect(page.getByText(/Call disabled in demo/)).toBeVisible({ timeout: 30_000 });
  logPass("lead inspection panel opens while call execution stays disabled");

  const calledButton = page.getByRole("button", { name: "Called", exact: true }).first();
  await expect(calledButton).toBeDisabled();
  const refreshButton = page.getByRole("button", { name: "Refresh intelligence" }).first();
  await expect(refreshButton).toBeDisabled();
  logPass("mutation controls remain disabled in demo mode");

  const writeStatus = await page.evaluate(async () => {
    const res = await fetch("/api/execution/outcomes", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: "advisor-demo",
        taskId: "smoke-demo-task",
        leadId: "smoke-demo-lead",
        companyKey: "smoke-demo-company",
        sourceSurface: "smoke-demo",
        outcomeStatus: "Called",
      }),
    });
    return res.status;
  });
  if (writeStatus !== 403) {
    throw new Error(`expected advisor-demo write to be blocked with 403, got ${writeStatus}`);
  }
  logPass("advisor-demo outcome write API remains blocked");

  await page.goto(`${baseUrl}/operator?workspace=labortech`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Workspace access blocked/i)).toBeVisible({ timeout: 30_000 });
  logPass("demo session cannot enter LaborTech workspace");

  await page.goto(`${baseUrl}/demo/john`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/operator\?workspace=labortech/, { timeout: 60_000 });
  await expect(page).toHaveURL(/\/operator\?workspace=labortech/);
  const laborTechLabelCount = await page.getByText(/LaborTech workspace/i).count();
  if (laborTechLabelCount === 0) {
    throw new Error("expected LaborTech workspace label after /demo/john login");
  }
  await expect(page.getByText("Demo mode: interactive preview, writes disabled")).toHaveCount(0);
  logPass("/demo/john still lands in LaborTech without demo read-only UI");

  await browser.close();

  if (pageErrors.length > 0 || consoleProblems.length > 0) {
    throw new Error([
      ...pageErrors.map((msg) => `pageerror: ${msg}`),
      ...consoleProblems.map((msg) => `console.error: ${msg}`),
    ].join("\n"));
  }

  console.log("✓ demo smoke test passed");
}

main().catch((err) => {
  console.error(`✗ demo smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
