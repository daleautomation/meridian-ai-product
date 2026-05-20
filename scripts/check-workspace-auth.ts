#!/usr/bin/env tsx
/**
 * Meridian workspace auth routing — credential + post-login path checks.
 * Run: npm run auth:check
 */
import assert from "node:assert/strict";
import { findTenantByCredentials, TENANTS } from "../config/tenants";
import {
  isPostLoginPathAllowed,
  postLoginRouteForUser,
  resolvePostLoginRedirect,
} from "../lib/auth/postLoginRouting";
import { toPublicUser } from "../config/tenants";

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

check("nicole routes to personal workspace", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(
    postLoginRouteForUser(user),
    "/personal?workspace=nicole-lonergan",
  );
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

check("dylan / Meridian authenticates", () => {
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  assert.equal(t.accessRole, "admin_operator");
});

check("dylan routes to workspace selector", () => {
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  const user = toPublicUser(t);
  assert.equal(postLoginRouteForUser(user), "/workspace-select");
});

check("dylan can open all assigned workspaces", () => {
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
    true,
  );
});

check("no Sarah tenant remains", () => {
  assert.equal(TENANTS.sarah, undefined);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("\nAll workspace auth routing checks passed.");
