import { NextResponse } from "next/server";
import { isSecureSessionRequest } from "@/lib/session";
import {
  applyAuthNoStoreHeaders,
  clearAllMeridianAuthCookies,
} from "@/lib/auth/sessionCleanup";

function buildClearedRedirect(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  clearAllMeridianAuthCookies(res, isSecureSessionRequest(req));
  return applyAuthNoStoreHeaders(res);
}

export async function GET(req: Request) {
  return buildClearedRedirect(req);
}

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  clearAllMeridianAuthCookies(res, isSecureSessionRequest(req));
  return applyAuthNoStoreHeaders(res);
}
