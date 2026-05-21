#!/usr/bin/env tsx
/**
 * Meridian workspace auth routing — credential + post-login path checks.
 * Run: npm run auth:check
 */
import assert from "node:assert/strict";
import { findTenantByCredentials, TENANTS, toPublicUser } from "../config/tenants";
import { passwordsMatch } from "../lib/auth/credentials";
import {
  isPostLoginPathAllowed,
  postLoginRouteForUser,
  resolvePostLoginRedirect,
  workspaceSelectCardsForUser,
} from "../lib/auth/postLoginRouting";
import { listAccessibleWorkspacesForPrincipal } from "../lib/workspaceAccess";

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${label}`);
  } catch (err) {
    console.error(`✗ ${label}`);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

check("john / labortech authenticates", () => {
  const t = findTenantByCredentials("john", "labortech");
  assert.ok(t);
  assert.equal(t.id, "john");
});

check("john routes to LaborTech operator", () => {
  const t = findTenantByCredentials("john", "labortech");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(postLoginRouteForUser(user), "/operator?workspace=labortech");
  assert.equal(resolvePostLoginRedirect(user, null), "/operator?workspace=labortech");
});

check("john cannot access Nicole personal workspace", () => {
  const t = findTenantByCredentials("john", "labortech");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(
    isPostLoginPathAllowed(user, "/personal?workspace=nicole-lonergan"),
    false,
  );
  assert.equal(
    resolvePostLoginRedirect(user, "/personal?workspace=nicole-lonergan"),
    "/operator?workspace=labortech",
  );
});

check("nicole / brookside authenticates", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  assert.equal(t.id, "nicole");
});

check("nicole / brookside trims whitespace", () => {
  const t = findTenantByCredentials(" nicole ", " brookside ");
  assert.ok(t);
  assert.equal(t.id, "nicole");
});

check("nicole routes to personal workspace", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(
    postLoginRouteForUser(user),
    "/personal?workspace=nicole-lonergan",
  );
});

check("nicole workspace home is reachable from portal continue", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  const cards = workspaceSelectCardsForUser(user);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, "/personal?workspace=nicole-lonergan");
});

check("john workspace home is reachable from portal continue", () => {
  const t = findTenantByCredentials("john", "labortech");
  assert.ok(t);
  const user = toPublicUser(t);
  const cards = workspaceSelectCardsForUser(user);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, "/operator?workspace=labortech");
});

check("nicole cannot access LaborTech", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(isPostLoginPathAllowed(user, "/operator?workspace=labortech"), false);
  assert.equal(
    resolvePostLoginRedirect(user, "/operator?workspace=labortech"),
    "/personal?workspace=nicole-lonergan",
  );
});

check("dylan / Meridian authenticates (exact case)", () => {
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  assert.equal(t.accessRole, "admin_operator");
});

check("dylan / meridian authenticates (case-insensitive)", () => {
  const t = findTenantByCredentials("dylan", "meridian");
  assert.ok(t);
});

check("dylan routes to workspace selector", () => {
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(postLoginRouteForUser(user), "/workspace-select");
});

check("dylan workspace selector includes LaborTech and Brookside", () => {
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  const user = toPublicUser(t);
  const cards = workspaceSelectCardsForUser(user);
  assert.equal(cards.length, 2);
  assert.ok(cards.find((c) => c.slug === "labortech"));
  assert.equal(cards.find((c) => c.slug === "advisor-demo"), undefined);
  const nicole = cards.find((c) => c.slug === "nicole-lonergan");
  assert.ok(nicole);
  assert.match(nicole.title, /Brookside Real Estate/i);
  assert.match(nicole.title, /Nicole Lonergan/i);
  assert.equal(nicole.href, "/personal?workspace=nicole-lonergan");
  assert.equal(cards.find((c) => c.slug === "labortech")?.href, "/operator?workspace=labortech");
});

check("dylan assigned workspaces exclude advisor demo", () => {
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  const listed = listAccessibleWorkspacesForPrincipal(toPublicUser(t));
  assert.equal(listed.length, 2);
  assert.ok(listed.some((ws) => ws.slug === "nicole-lonergan"));
  assert.equal(listed.some((ws) => ws.slug === "advisor-demo"), false);
});

check("dylan can open assigned workspaces only", () => {
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(isPostLoginPathAllowed(user, "/operator?workspace=labortech"), true);
  assert.equal(
    isPostLoginPathAllowed(user, "/personal?workspace=nicole-lonergan"),
    true,
  );
  assert.equal(
    isPostLoginPathAllowed(user, "/operator/relationship-priority?workspace=advisor-demo"),
    false,
  );
});

check("password helper rejects wrong secret", () => {
  assert.equal(passwordsMatch("brookside", "labortech"), false);
});

check("no Sarah tenant remains", () => {
  assert.equal(TENANTS.sarah, undefined);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("\nAll workspace auth routing checks passed.");
