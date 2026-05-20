import { NextResponse } from "next/server";
import { isSecureSessionRequest, SESSION_COOKIE } from "@/lib/session";

function clearSessionCookie(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureSessionRequest(req),
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET(req: Request) {
  return clearSessionCookie(req);
}

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureSessionRequest(req),
    path: "/",
    maxAge: 0,
  });
  return res;
}
