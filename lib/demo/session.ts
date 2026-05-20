import { NextResponse } from "next/server";
import { getTenantById, toPublicUser, type Tenant } from "@/config/tenants";
import { createSessionToken, isSecureSessionRequest, SESSION_COOKIE } from "@/lib/session";
import { makeEvent, writeEvent } from "@/lib/tracking/eventLog";
import { isDemoAllowedHost, describeDemoAllowlist } from "@/lib/demo/access";
import { getDemoProfile, type DemoProfile } from "@/lib/demo/profiles";
import { postLoginRouteForUser } from "@/lib/auth/postLoginRouting";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";
import { isPersonalWorkspace, workspaceHomePath } from "@/lib/workspaceRouting";

type DemoSessionInput = {
  req: Request;
  profile?: DemoProfile | null;
  tenant?: Tenant | null;
  workspaceSlug?: string | null;
  entry: string;
  destination?: "operator" | "relationship-priority" | "personal";
};

function forwardedHost(req: Request, url: URL): string {
  return req.headers.get("x-forwarded-host")
    ?? req.headers.get("host")
    ?? url.host;
}

function forbidden(entry: string, host: string) {
  // eslint-disable-next-line no-console
  console.log(`[demo] forbidden entry=${entry} host="${host}" allowlist="${describeDemoAllowlist()}"`);
  return NextResponse.json({ error: "Demo entry disabled in this environment" }, { status: 403 });
}

export function resolveDemoProfile(slug: string | undefined | null): DemoProfile | null {
  return getDemoProfile(slug);
}

export async function createDemoSessionResponse(input: DemoSessionInput) {
  const { req, profile, entry } = input;
  const url = new URL(req.url);
  const fwdHost = forwardedHost(req, url);
  if (!isDemoAllowedHost(fwdHost)) return forbidden(entry, fwdHost);

  const tenant = input.tenant ?? (profile ? getTenantById(profile.tenantId) : null);
  if (!tenant) {
    // eslint-disable-next-line no-console
    console.log(`[demo] tenant_not_found entry=${entry} profile=${profile?.slug ?? ""}`);
    return NextResponse.json({ error: "Demo tenant unavailable" }, { status: 404 });
  }

  const explicitWorkspace =
    input.workspaceSlug
    ?? profile?.workspaceSlug
    ?? url.searchParams.get("workspace")
    ?? null;
  const workspaceSlug = explicitWorkspace ?? tenant.workspaces[0] ?? null;
  const user = toPublicUser(tenant);
  const access = getWorkspaceAccess(user, workspaceSlug);
  if (!access.ok) {
    // eslint-disable-next-line no-console
    console.log(
      `[demo] workspace_denied entry=${entry} tenant=${tenant.id} ` +
      `workspace=${workspaceSlug ?? ""} reason=${access.reason}`,
    );
    return NextResponse.json({ error: "Demo workspace unavailable" }, { status: access.status });
  }

  let token: string;
  let maxAge: number;
  try {
    ({ token, maxAge } = createSessionToken(tenant.id));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[demo] session_create_failed entry=${entry} tenant=${tenant.id} detail="${
        err instanceof Error ? err.message : String(err)
      }"`,
    );
    return NextResponse.json({ error: "Authentication is not configured" }, { status: 500 });
  }

  const destination = input.destination
    ?? (url.searchParams.get("surface") === "personal"
      ? "personal"
      : url.searchParams.get("surface") === "relationship-priority"
        ? "relationship-priority"
        : "operator");
  let resolvedDestination = destination;
  if (destination === "personal" && !isPersonalWorkspace(access.workspace)) {
    resolvedDestination = access.workspace.features.showRelationshipsTab
      ? "relationship-priority"
      : "operator";
  }
  if (destination === "relationship-priority" && !access.workspace.features.showRelationshipsTab) {
    resolvedDestination = isPersonalWorkspace(access.workspace) ? "personal" : "operator";
  }
  if (isPersonalWorkspace(access.workspace) && resolvedDestination === "operator") {
    resolvedDestination = "personal";
  }
  const isHttps = isSecureSessionRequest(req);
  const proto = isHttps ? "https" : "http";
  const redirectPath = explicitWorkspace
    ? workspaceHomePath(access.workspace)
    : postLoginRouteForUser(user);
  const redirectUrl = new URL(redirectPath, `${proto}://${fwdHost}`);
  for (const key of ["mode", "showcase", "vertical", "preset"]) {
    const value = url.searchParams.get(key);
    if (value) redirectUrl.searchParams.set(key, value);
  }
  const res = NextResponse.redirect(redirectUrl, { status: 302 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge,
  });

  try {
    await writeEvent(makeEvent({
      eventType: "session_start",
      userId: tenant.id,
      workspace: access.workspace.slug,
      metadata: {
        entry,
        audience: profile?.audience ?? "client",
        host: fwdHost,
        userAgent: req.headers.get("user-agent") ?? "",
      },
    }));
  } catch { /* fail silent */ }

  // eslint-disable-next-line no-console
  console.log(
    `[demo] session_created entry=${entry} user=${tenant.id} role=${tenant.accessRole} ` +
    `workspace=${access.workspace.slug} secure=${isHttps} host="${fwdHost}"`,
  );
  return res;
}
