import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "meridian_session";

// Public paths that do NOT require authentication.
const PUBLIC_PATHS = new Set(["/", "/login", "/about", "/roofing-intelligence", "/showcase"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public pages, intake funnels, auth API, AI API, demo entry,
  // delivered Recovery Briefs, and static assets.
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
    // /api/outcomes is gated by the route handler itself: the
    // recovery_brief source is publicly capturable (briefs are shared
    // by direct link); operator_console writes require a session +
    // workspace allow-list match.
    pathname.startsWith("/api/outcomes") ||
    pathname.startsWith("/demo/") ||
    pathname.startsWith("/showcase/") ||
    pathname.startsWith("/brief/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const hasToken = !!token && token.split(".").length === 3;
  if (hasToken) return NextResponse.next();

  // API routes must return JSON, never a redirect — the client expects JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
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
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Run on all non-static routes.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
