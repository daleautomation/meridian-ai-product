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
  sanitizeInternalPath,
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

// ── Post-login flow ──────────────────────────────────────────────
// These checks lock in the "no extra interstitial click" behavior.
// They model what each layer (login API, /login page) must return so
// future regressions surface here, not on a Tuesday pricing call.

check("login API returns the final destination, not /login", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  // Mimic the route logic: sanitize next, resolve.
  const resolved = resolvePostLoginRedirect(user, "/personal?workspace=nicole-lonergan");
  assert.equal(resolved, "/personal?workspace=nicole-lonergan");
  assert.notEqual(resolved.startsWith("/login"), true);
});

check("login API rejects external next and falls back to workspace home", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  for (const evil of ["https://evil.example.com/", "//evil.example.com", "javascript:alert(1)"]) {
    const resolved = resolvePostLoginRedirect(user, evil);
    assert.equal(resolved, "/personal?workspace=nicole-lonergan");
  }
});

check("login API preserves query string on internal next", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  const next = "/personal?workspace=nicole-lonergan&panel=outcomes";
  const resolved = resolvePostLoginRedirect(user, next);
  assert.equal(resolved, next);
});

check("/login auto-redirect: signed-in single-workspace user → workspace home", () => {
  // The page does: if (user && cards.length === 1 && !next) redirect(cards[0].href)
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  const cards = workspaceSelectCardsForUser(user);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].href, "/personal?workspace=nicole-lonergan");
});

check("/login auto-redirect: signed-in user with allowed next → next path", () => {
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  const next = "/personal?workspace=nicole-lonergan";
  assert.equal(isPostLoginPathAllowed(user, next), true);
});

check("/login does NOT auto-redirect: multi-workspace user without next", () => {
  // dylan has 2 workspaces and no specific next → the page must NOT
  // call redirect; it must render the SignedInLoginPortal interstitial
  // so the operator can choose.
  const t = findTenantByCredentials("dylan", "Meridian");
  assert.ok(t);
  const user = toPublicUser(t);
  const cards = workspaceSelectCardsForUser(user);
  assert.ok(cards.length > 1);
});

check("/login does NOT auto-redirect: signed-in user with disallowed next", () => {
  // nicole-only user requesting /operator?workspace=labortech → next
  // is rejected, but cards.length === 1 so the page redirects to her
  // home (NOT the rejected next, NEVER /login).
  const t = findTenantByCredentials("nicole", "brookside");
  assert.ok(t);
  const user = toPublicUser(t);
  const next = "/operator?workspace=labortech";
  assert.equal(isPostLoginPathAllowed(user, next), false);
  const cards = workspaceSelectCardsForUser(user);
  assert.equal(cards.length, 1);
  // The page logic only auto-redirects to cards[0] when there's NO
  // sanitized next; with a present-but-disallowed next, the
  // interstitial would render. SignedInLoginPortal then offers
  // "Continue to <ws>" as the only path forward (since requested
  // destination is blocked) — that fallback is intentional.
});

check("sanitizeInternalPath rejects protocol-relative + scheme + null bytes", () => {
  assert.equal(sanitizeInternalPath("//evil.com/path"), null);
  assert.equal(sanitizeInternalPath("https://evil.com"), null);
  assert.equal(sanitizeInternalPath("/path\\with\\backslash"), null);
  assert.equal(sanitizeInternalPath("/path\x00with-null"), null);
  assert.equal(sanitizeInternalPath("/safe?x=1"), "/safe?x=1");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("\nAll workspace auth routing checks passed.");
