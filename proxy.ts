import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "meridian_session";

// Public paths that do NOT require authentication.
const PUBLIC_PATHS = new Set(["/", "/login", "/about"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public pages, auth API, AI API, and static assets.
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/ai") ||
    pathname.startsWith("/api/mcp") ||
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
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Run on all non-static routes.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
