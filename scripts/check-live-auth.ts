#!/usr/bin/env tsx
/**
 * Live auth checks against a running Next dev/prod server.
 * Run: npm run auth:live
 * Optional: MERIDIAN_BASE_URL=http://127.0.0.1:3000
 */
import assert from "node:assert/strict";

const BASE_URL = (process.env.MERIDIAN_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => console.log(`✓ ${label}`),
    (err) => {
      console.error(`✗ ${label}`);
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}

async function postLogin(username: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

function cookieHeader(setCookie: string | null): string {
  if (!setCookie) return "";
  const match = setCookie.match(/meridian_session=[^;]+/);
  return match?.[0] ?? "";
}

async function fetchWorkspaceSelect(cookie: string) {
  const res = await fetch(`${BASE_URL}/workspace-select`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const html = await res.text();
  return { res, html };
}

async function main() {
  await check(`server reachable at ${BASE_URL}`, async () => {
    const res = await fetch(`${BASE_URL}/login`);
    assert.ok(res.ok, `GET /login failed with ${res.status}`);
  });

  await check("nicole / brookside returns 200 and client portal redirect", async () => {
    const { res, body } = await postLogin("nicole", "brookside");
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.redirectTo, "/login");
  });

  await check("signed-in GET /login shows portal (no auto-redirect to workspace)", async () => {
    const { res } = await postLogin("nicole", "brookside");
    assert.equal(res.status, 200);
    const cookie = cookieHeader(res.headers.get("set-cookie"));
    assert.ok(cookie, "missing session cookie");
    const page = await fetch(`${BASE_URL}/login`, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Signed in/i);
    assert.match(html, /Nicole Lonergan/i);
    assert.match(html, /Continue to Nicole Lonergan Workspace/i);
    assert.match(html, /Sign out/i);
    assert.doesNotMatch(html, /http-equiv="refresh"/i);
  });

  await check("dylan / Meridian returns 200 and client portal redirect", async () => {
    const { res, body } = await postLogin("dylan", "Meridian");
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.redirectTo, "/login");
  });

  await check("dylan workspace-select HTML includes Brookside / Nicole", async () => {
    const { res, body } = await postLogin("dylan", "Meridian");
    assert.equal(res.status, 200);
    const cookie = cookieHeader(res.headers.get("set-cookie"));
    assert.ok(cookie, "missing session cookie");
    const page = await fetchWorkspaceSelect(cookie);
    assert.equal(page.res.status, 200);
    assert.match(page.html, /Brookside Real Estate/i);
    assert.match(page.html, /Nicole Lonergan/i);
    assert.match(page.html, /workspace-select-tile/);
    assert.match(page.html, /Open workspace/);
  });

  await check("dylan workspace-select HTML omits Meridian Demo", async () => {
    const { res, body } = await postLogin("dylan", "Meridian");
    assert.equal(res.status, 200);
    const cookie = cookieHeader(res.headers.get("set-cookie"));
    const page = await fetchWorkspaceSelect(cookie);
    assert.equal(page.res.status, 200);
    assert.doesNotMatch(page.html, /Meridian Demo/);
    assert.doesNotMatch(page.html, /advisor-demo/);
  });

  await check("john / labortech returns client portal redirect", async () => {
    const { res, body } = await postLogin("john", "labortech");
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.redirectTo, "/login");
  });
}

main().then(() => {
  if (process.exitCode) process.exit(process.exitCode);
  console.log("\nAll live auth checks passed.");
});
