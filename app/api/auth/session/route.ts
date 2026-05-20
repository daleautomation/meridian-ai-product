import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolvePostLoginRedirect } from "@/lib/auth/postLoginRouting";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const url = new URL(req.url);
  const next = url.searchParams.get("next");
  return NextResponse.json({
    authenticated: true,
    user,
    redirectTo: resolvePostLoginRedirect(user, next),
  });
}
