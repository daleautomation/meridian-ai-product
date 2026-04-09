import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "meridian_session";

export function proxy(req: NextRequest) {
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
    // Protect everything except login, auth API, and Next/static internals.
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
