import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "meridian_session";

// Public paths that do NOT require authentication.
const PUBLIC_PATHS = new Set(["/", "/login", "/about"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public pages, auth API, and static assets.
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // Coarse check only — server-side getSession() does cryptographic verification.
  if (!token || token.split(".").length !== 3) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all non-static routes.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
