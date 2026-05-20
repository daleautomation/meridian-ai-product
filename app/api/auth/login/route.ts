import { NextResponse } from "next/server";
import { TENANTS, toPublicUser } from "@/config/tenants";
import { findTenantByCredentials } from "@/config/tenants";
import { normalizeLoginUsername } from "@/lib/auth/credentials";
import { resolvePostLoginRedirect } from "@/lib/auth/postLoginRouting";
import { createSessionToken, isSecureSessionRequest, SESSION_COOKIE } from "@/lib/session";

function loginEnabledTenantUsernames(): string[] {
  return Object.values(TENANTS)
    .filter((t) => t.loginEnabled !== false && t.password.length > 0)
    .map((t) => t.id)
    .sort();
}

export async function POST(req: Request) {
  const host = req.headers.get("host") ?? "";
  let body: { username?: string; password?: string; workspace?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[login-debug] host="${host}" body=invalid_json`);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const workspace = body.workspace;
  const normalized = normalizeLoginUsername(username);
  const loginUsernames = loginEnabledTenantUsernames();
  // eslint-disable-next-line no-console
  console.log(
    `[login-debug] host="${host}" username="${username}" normalized="${normalized}" ` +
      `workspace="${workspace ?? ""}" passwordLen=${password.length} ` +
      `loginTenants=[${loginUsernames.join(",")}]`,
  );
  if (!username.trim() || !password.trim()) {
    // eslint-disable-next-line no-console
    console.log("[login-debug] missing_credentials");
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }
  const tenant = findTenantByCredentials(username, password);
  const tenantExists = normalized in TENANTS;
  // eslint-disable-next-line no-console
  console.log(
    `[login-debug] tenantFound=${!!tenant} tenantExists=${tenantExists} tenantId="${tenant?.id ?? ""}" ` +
      `workspaces="${tenant?.workspaces.join(",") ?? ""}"`,
  );
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
