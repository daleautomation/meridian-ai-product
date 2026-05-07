import { NextResponse } from "next/server";
import { getTenantById } from "@/config/tenants";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";
import { makeEvent, writeEvent } from "@/lib/tracking/eventLog";

// Meridian — Friendlier demo entry point at /demo/john.
//
// Same behavior as /api/auth/demo-login?user=john&workspace=labortech
// but on a non-/api path so ngrok-free's interstitial / browser cookie
// handling treats it as a normal page navigation. This is the URL
// John clicks; the path is allow-listed in proxy.ts so the auth gate
// doesn't bounce him to /login first.
//
// Fires a session_start tracking event so the post-session review
// shows when John actually entered the workspace.

const TARGET_USER = "john";
const TARGET_WORKSPACE = "labortech";

function isAllowedHost(hostHeader: string | null): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase();
  return host.includes("ngrok") || host.includes("localhost") || host.includes("127.0.0.1");
}

export async function GET(req: Request) {
  if (!isAllowedHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "Demo entry disabled in this environment" }, { status: 403 });
  }

  const tenant = getTenantById(TARGET_USER);
  if (!tenant) {
    return NextResponse.json({ error: "Demo tenant unavailable" }, { status: 500 });
  }

  const { token, maxAge } = createSessionToken(tenant.id);
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "";
  const isHttps =
    fwdProto.split(",").map((s) => s.trim()).includes("https")
    || process.env.NODE_ENV === "production";

  const fwdHost =
    req.headers.get("x-forwarded-host")
    ?? req.headers.get("host")
    ?? new URL(req.url).host;
  const proto = isHttps ? "https" : "http";
  const redirectUrl = new URL(
    `/operator?workspace=${encodeURIComponent(TARGET_WORKSPACE)}`,
    `${proto}://${fwdHost}`,
  );

  const res = NextResponse.redirect(redirectUrl, { status: 302 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge,
  });

  // Fire-and-forget session_start event so the post-session review
  // sees John's first action timestamp.
  try {
    await writeEvent(makeEvent({
      eventType: "session_start",
      userId: tenant.id,
      workspace: TARGET_WORKSPACE,
      metadata: {
        entry: "/demo/john",
        host: fwdHost,
        userAgent: req.headers.get("user-agent") ?? "",
      },
    }));
  } catch { /* fail silent */ }

  // eslint-disable-next-line no-console
  console.log(`[demo/john] redirect→${redirectUrl.toString()} host="${fwdHost}" secure=${isHttps}`);

  return res;
}
