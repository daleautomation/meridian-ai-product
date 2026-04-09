import { NextResponse } from "next/server";
import { findTenantByCredentials, toPublicUser } from "@/config/tenants";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }
  const tenant = findTenantByCredentials(username, password);
  if (!tenant) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const { token, maxAge } = createSessionToken(tenant.id);
  const res = NextResponse.json({ user: toPublicUser(tenant) });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}
