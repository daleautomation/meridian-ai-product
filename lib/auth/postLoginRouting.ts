import type { PublicUser } from "@/config/tenants";
import { getWorkspaceBySlug, type WorkspaceConfig } from "@/config/workspaces";
import {
  isLaborTechWorkspace,
  isPersonalWorkspace,
  WORKSPACE_SELECT_PATH,
  workspaceHomePath,
} from "@/lib/workspaceRouting";
import { listAccessibleWorkspacesForPrincipal } from "@/lib/workspaceAccess";

export { WORKSPACE_SELECT_PATH };

/** Sanitize internal redirect paths from login `next` params. */
export function sanitizeInternalPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (trimmed.includes("\\") || trimmed.includes("\0")) return null;
  return trimmed;
}

function workspaceSlugFromPath(path: string): string | null {
  try {
    const url = new URL(path, "http://local");
    return url.searchParams.get("workspace");
  } catch {
    return null;
  }
}

function pathKind(path: string): "operator" | "personal" | "relationship" | "admin" | "select" | "other" {
  if (path.startsWith(WORKSPACE_SELECT_PATH)) return "select";
  if (path.startsWith("/personal")) return "personal";
  if (path.startsWith("/operator/relationship-priority")) return "relationship";
  if (path.startsWith("/operator")) return "operator";
  if (path.startsWith("/admin")) return "admin";
  return "other";
}

/** Whether a signed-in user may open this post-login path. */
export function isPostLoginPathAllowed(user: PublicUser, path: string): boolean {
  const safe = sanitizeInternalPath(path);
  if (!safe) return false;

  const assigned = listAccessibleWorkspacesForPrincipal(user);
  if (assigned.length === 0) return false;

  const kind = pathKind(safe);
  if (kind === "select") return assigned.length > 1 || user.accessRole === "admin_operator";
  if (kind === "admin") return user.accessRole === "admin_operator";

  const slug = workspaceSlugFromPath(safe);
  if (slug) {
    const ws = getWorkspaceBySlug(slug);
    if (!ws) return false;
    return assigned.some((a) => a.slug === ws.slug);
  }

  if (kind === "personal") {
    return assigned.some(isPersonalWorkspace);
  }
  if (kind === "relationship") {
    return assigned.some((ws) => ws.features.showRelationshipsTab && !isPersonalWorkspace(ws));
  }
  if (kind === "operator") {
    return assigned.some(isLaborTechWorkspace)
      || assigned.some((ws) => ws.features.showRelationshipsTab);
  }

  return false;
}

/** Default landing route immediately after successful authentication. */
export function postLoginRouteForUser(user: PublicUser): string {
  const assigned = listAccessibleWorkspacesForPrincipal(user);
  if (assigned.length === 0) return "/login";

  if (assigned.length > 1) {
    return WORKSPACE_SELECT_PATH;
  }

  return workspaceHomePath(assigned[0]);
}

/** Resolve redirect after login, honoring safe `next` when allowed. */
export function resolvePostLoginRedirect(
  user: PublicUser,
  requestedNext?: string | null,
): string {
  const next = sanitizeInternalPath(requestedNext ?? null);
  if (next && isPostLoginPathAllowed(user, next)) {
    return next;
  }
  return postLoginRouteForUser(user);
}

export type WorkspaceSelectCard = {
  slug: string;
  title: string;
  subtitle: string;
  href: string;
  kind: WorkspaceConfig["kind"];
};

export function workspaceSelectCardsForUser(user: PublicUser): WorkspaceSelectCard[] {
  return listAccessibleWorkspacesForPrincipal(user).map((ws) => ({
    slug: ws.slug,
    title: ws.branding?.displayName ?? ws.name,
    subtitle: ws.branding?.accentLabel ?? ws.name,
    href: workspaceHomePath(ws),
    kind: ws.kind,
  }));
}
