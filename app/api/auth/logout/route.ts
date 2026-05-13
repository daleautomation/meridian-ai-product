import { NextResponse } from "next/server";
import { isSecureSessionRequest, SESSION_COOKIE } from "@/lib/session";

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
