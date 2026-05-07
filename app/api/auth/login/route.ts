import { NextResponse } from "next/server";
import { findTenantByCredentials, toPublicUser } from "@/config/tenants";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  let body: { username?: string; password?: string; workspace?: string };
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
  const { token, maxAge } = createSessionToken(tenant.id);
  const res = NextResponse.json({ user: toPublicUser(tenant) });
  // ngrok-aware cookie: serves HTTPS to the browser but proxies HTTP
  // to the dev server. Detect the inbound protocol via x-forwarded-
  // proto so SameSite=Lax cookies work both in plain dev (HTTP) and
  // over the ngrok tunnel (HTTPS). NODE_ENV check stays as the
  // production fallback.
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "";
  const isHttps = fwdProto.split(",").map((s) => s.trim()).includes("https")
    || process.env.NODE_ENV === "production";
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
