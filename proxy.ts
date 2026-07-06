import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthNoStoreHeaders,
  pathRequiresNoStore,
} from "@/lib/auth/sessionCleanup";

const SESSION_COOKIE = "meridian_session";

// Public paths that do NOT require authentication.
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/about",
  "/roofing-intelligence",
  "/showcase",
  // /reset-session is intentionally public so a stale-browser customer
  // can self-recover without needing valid credentials first.
  "/reset-session",
]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public pages, intake funnels, auth API, outcome capture,
  // demo entry, delivered Recovery Briefs, and static assets.
  //
  // /brief/* is intentionally public: briefs are founder-delivered artifacts
  // shared via direct link to prospects and customers, and the public
  // "See a sample brief" CTA depends on this. Access control is the
  // obscurity of the per-customer slug, not authentication.
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/intake") ||
    pathname.startsWith("/api/intake") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/mcp") ||
    // The morning-brief operator authenticates itself (CRON_SECRET bearer for the
    // Vercel cron, or an admin session for the manual refresh button).
    pathname.startsWith("/api/operator/morning-brief") ||
    // /api/outcomes is gated by the route handler itself: the
    // recovery_brief source is publicly capturable (briefs are shared
    // by direct link); operator_console writes require a session +
    // workspace allow-list match.
    pathname.startsWith("/api/outcomes") ||
    pathname.startsWith("/demo/") ||
    pathname.startsWith("/showcase/") ||
    pathname.startsWith("/brief/") ||
    pathname.startsWith("/reset-session") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return withAuthCacheGuard(NextResponse.next(), pathname);
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const hasToken = !!token && token.split(".").length === 3;
  if (hasToken) return withAuthCacheGuard(NextResponse.next(), pathname);

  // API routes must return JSON, never a redirect — the client expects JSON.
  if (pathname.startsWith("/api/")) {
    return withAuthCacheGuard(
      NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
      pathname,
    );
  }

  const url = req.nextUrl.clone();
  const intended = `${pathname}${req.nextUrl.search}`;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", intended);
  console.log(
    `[auth-proxy] redirect_to_login path="${pathname}" ` +
    `cookiePresent=${!!token} cookieShape=${hasToken ? "session" : token ? "invalid" : "missing"}`,
  );
  return withAuthCacheGuard(NextResponse.redirect(url), pathname);
}

/**
 * Apply no-store cache headers to responses for auth-sensitive paths.
 * Centralizes the rule so a stale Chrome bundle can never linger on
 * /login, /workspace-select, /reset-session, or any /api/auth/* route.
 */
function withAuthCacheGuard(res: NextResponse, pathname: string): NextResponse {
  if (pathRequiresNoStore(pathname)) {
    applyAuthNoStoreHeaders(res);
  }
  return res;
}

export const config = {
  matcher: [
    // Run on all non-static routes.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
