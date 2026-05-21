// Meridian — Auth session cleanup utilities.
//
// Centralizes:
//   • the no-store cache header used on every auth surface
//   • the canonical + legacy cookie names to clear on logout / reset
//
// Logout and the public /reset-session route both pull from here so a
// future bug never re-introduces a cookie name that one path forgets
// to clear. There is no clever logic — this file is a manifest.

import type { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Cookie names Meridian has ever set (or might still receive from a
 * stale customer browser). Logout + /reset-session clear every name
 * in this list. Keeping the list small and append-only — never remove
 * a historic name unless every customer has rotated past it.
 */
export const MERIDIAN_AUTH_COOKIE_NAMES: readonly string[] = [
  SESSION_COOKIE,                 // current canonical
  "meridian_user",                // historic candidate
  "meridian_workspace",           // historic candidate
  "meridian_auth",                // historic candidate
  "meridian_demo",                // demo entry sessions
];

/** No-store Cache-Control header value applied to every auth surface. */
export const AUTH_NO_STORE_CACHE_CONTROL =
  "no-store, no-cache, must-revalidate, max-age=0";

/** Apply the no-store header trio to any response. */
export function applyAuthNoStoreHeaders(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", AUTH_NO_STORE_CACHE_CONTROL);
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

/**
 * Clear every known Meridian auth cookie on the given NextResponse,
 * mirroring the exact path / sameSite / secure flags used by the
 * login route so the browser drops them deterministically.
 */
export function clearAllMeridianAuthCookies(
  res: NextResponse,
  isSecure: boolean,
): NextResponse {
  for (const name of MERIDIAN_AUTH_COOKIE_NAMES) {
    res.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}

/** Path prefixes whose responses must never be cached. */
export const AUTH_NO_STORE_PATHS: readonly string[] = [
  "/login",
  "/workspace-select",
  "/reset-session",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
];

/** True when the request pathname must carry no-store cache headers. */
export function pathRequiresNoStore(pathname: string): boolean {
  return AUTH_NO_STORE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
