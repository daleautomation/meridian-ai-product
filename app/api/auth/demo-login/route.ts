import { NextResponse } from "next/server";
import { getTenantById } from "@/config/tenants";
import { createDemoSessionResponse, resolveDemoProfile } from "@/lib/demo/session";

// Meridian — Demo / dev-only one-click login.
//
// Bypasses the form. Useful when the browser login flow is blocked
// by environmental issues (cookie storage on shared public-suffix
// domains, SameSite tab transitions, browser cookie settings).
//
// HARD-GATED: returns 403 outside dev / non-production / approved
// hosts. Allowlist is shared with /demo/john via lib/demo/access.ts
// so a single env var (MERIDIAN_DEMO_ALLOWED_HOSTS) controls both.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = url.searchParams.get("user")?.toLowerCase().trim() ?? "";
  const workspace = url.searchParams.get("workspace")?.toLowerCase().trim() ?? "";

  if (!user) {
    return NextResponse.json({ error: "Missing ?user param" }, { status: 400 });
  }

  const profile = resolveDemoProfile(user);
  const tenant = profile ? null : getTenantById(user);
  if (!tenant) {
    if (profile) {
      return createDemoSessionResponse({
        req,
        profile,
        workspaceSlug: workspace || profile.workspaceSlug,
        entry: "/api/auth/demo-login",
      });
    }
    // eslint-disable-next-line no-console
    console.log(`[demo-login] tenant_not_found user="${user}"`);
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  return createDemoSessionResponse({
    req,
    tenant,
    workspaceSlug: workspace || tenant.workspaces[0],
    entry: "/api/auth/demo-login",
  });
}
