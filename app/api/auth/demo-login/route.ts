import { NextResponse } from "next/server";
import { getTenantById } from "@/config/tenants";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";
import { makeEvent, writeEvent } from "@/lib/tracking/eventLog";

// Meridian — Demo / dev-only one-click login.
//
// Bypasses the form. Useful when the browser login flow is blocked
// by environmental issues (cookie storage on shared public-suffix
// domains, SameSite tab transitions, browser cookie settings).
//
// HARD-GATED: returns 403 outside dev / non-production / ngrok host.
// Never logs the password (this route doesn't take one).

function isAllowedHost(hostHeader: string | null): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase();
  return host.includes("ngrok") || host.includes("localhost") || host.includes("127.0.0.1");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = url.searchParams.get("user")?.toLowerCase().trim() ?? "";
  const workspace = url.searchParams.get("workspace")?.toLowerCase().trim() ?? "";

  if (!isAllowedHost(req.headers.get("host"))) {
    // eslint-disable-next-line no-console
    console.log(`[demo-login] forbidden env=${process.env.NODE_ENV} host="${req.headers.get("host") ?? ""}"`);
    return NextResponse.json({ error: "Demo login disabled in this environment" }, { status: 403 });
  }

  if (!user) {
    return NextResponse.json({ error: "Missing ?user param" }, { status: 400 });
  }

  const tenant = getTenantById(user);
  if (!tenant) {
    // eslint-disable-next-line no-console
    console.log(`[demo-login] tenant_not_found user="${user}"`);
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  // Resolve workspace: explicit param wins, else first workspace on
  // the tenant, else the literal "labortech" fallback for the demo.
  const targetWorkspace =
    workspace
    || tenant.workspaces[0]
    || "labortech";

  const { token, maxAge } = createSessionToken(tenant.id);

  // ngrok-aware Secure flag — same logic as the form login route.
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "";
  const isHttps = fwdProto.split(",").map((s) => s.trim()).includes("https")
    || process.env.NODE_ENV === "production";

  // Build the redirect target using the FORWARDED host so the
  // browser stays on the public URL (ngrok or production domain)
  // instead of being sent to localhost. Next.js's `req.url` resolves
  // to the local origin under proxies, so we reconstruct from the
  // x-forwarded-* headers when present.
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = isHttps ? "https" : (url.protocol.replace(":", "") || "http");
  const redirectUrl = new URL(
    `/operator?workspace=${encodeURIComponent(targetWorkspace)}`,
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

  // Fire-and-forget session_start event.
  try {
    await writeEvent(makeEvent({
      eventType: "session_start",
      userId: tenant.id,
      workspace: targetWorkspace,
      metadata: { entry: "/api/auth/demo-login", userAgent: req.headers.get("user-agent") ?? "" },
    }));
  } catch { /* fail silent */ }

  // eslint-disable-next-line no-console
  console.log(
    `[demo-login] user=${tenant.id} workspace=${targetWorkspace} ` +
    `secure=${isHttps} fwdProto="${fwdProto}" host="${req.headers.get("host") ?? ""}"`,
  );

  return res;
}
