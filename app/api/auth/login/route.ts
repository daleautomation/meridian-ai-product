import { NextResponse } from "next/server";
import { findTenantByCredentials, toPublicUser } from "@/config/tenants";
import { resolvePostLoginRedirect } from "@/lib/auth/postLoginRouting";
import { createSessionToken, isSecureSessionRequest, SESSION_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  let body: { username?: string; password?: string; workspace?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    // eslint-disable-next-line no-console
    console.log("[login-debug] body=invalid_json");
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { username, password, workspace } = body;
  // eslint-disable-next-line no-console
  console.log(`[login-debug] username="${username ?? ""}" workspace="${workspace ?? ""}" passwordLen=${password?.length ?? 0}`);
  if (!username || !password) {
    // eslint-disable-next-line no-console
    console.log("[login-debug] missing_credentials");
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }
  const tenant = findTenantByCredentials(username, password);
  // eslint-disable-next-line no-console
  console.log(`[login-debug] tenantFound=${!!tenant} tenantId="${tenant?.id ?? ""}" workspaces="${tenant?.workspaces.join(",") ?? ""}"`);
  if (!tenant) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  let token: string;
  let maxAge: number;
  try {
    ({ token, maxAge } = createSessionToken(tenant.id));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[login-debug] session_create_failed user=${tenant.id} detail="${
        err instanceof Error ? err.message : String(err)
      }"`,
    );
    return NextResponse.json({ error: "Authentication is not configured" }, { status: 500 });
  }
  const user = toPublicUser(tenant);
  const redirectTo = resolvePostLoginRedirect(user, body.next ?? null);
  const res = NextResponse.json({ user, redirectTo });
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "";
  const isHttps = isSecureSessionRequest(req);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge,
  });
  // eslint-disable-next-line no-console
  console.log(`[login-debug] cookieSet uid=${tenant.id} secure=${isHttps} fwdProto="${fwdProto}"`);
  return res;
}
