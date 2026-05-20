import {
  getWorkspaceBySlug,
  resolveWorkspaceIdFromAssignment,
  WORKSPACE_ORDER,
  WORKSPACES,
  type WorkspaceConfig,
} from "@/config/workspaces";
import type { AccessRole, PublicUser, Tenant } from "@/config/tenants";

type Principal = Pick<PublicUser | Tenant, "accessRole" | "workspaces">;

/** Workspace slugs this principal may enter (from tenant assignment only). */
export function effectiveWorkspaceIdsForPrincipal(
  user: Principal,
): string[] {
  return [...new Set((user.workspaces ?? []).map(resolveWorkspaceIdFromAssignment))];
}

/** Assigned workspaces the principal can access by role, in stable display order. */
export function listAccessibleWorkspacesForPrincipal(
  user: Principal,
): WorkspaceConfig[] {
  const allowed = new Set(effectiveWorkspaceIdsForPrincipal(user));
  const out: WorkspaceConfig[] = [];
  const seen = new Set<string>();

  for (const slug of WORKSPACE_ORDER) {
    if (!allowed.has(slug)) continue;
    const ws = WORKSPACES[slug];
    if (!ws || seen.has(ws.id)) continue;
    if (!canRoleAccessWorkspace(user.accessRole, ws)) continue;
    seen.add(ws.id);
    out.push(ws);
  }

  for (const slug of allowed) {
    if (WORKSPACE_ORDER.includes(slug)) continue;
    const ws = WORKSPACES[slug];
    if (!ws || seen.has(ws.id)) continue;
    if (!canRoleAccessWorkspace(user.accessRole, ws)) continue;
    seen.add(ws.id);
    out.push(ws);
  }

  return out;
}

export type WorkspaceAccessResult =
  | { ok: true; workspace: WorkspaceConfig }
  | { ok: false; status: 403 | 404; reason: "unknown_workspace" | "not_assigned" | "role_denied" };

export function canRoleAccessWorkspace(role: AccessRole, workspace: WorkspaceConfig): boolean {
  return workspace.access.allowedRoles.includes(role);
}

export function getWorkspaceAccess(
  user: Principal,
  workspaceSlug: string | undefined | null,
): WorkspaceAccessResult {
  const workspace = getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return { ok: false, status: 404, reason: "unknown_workspace" };
  const assigned = effectiveWorkspaceIdsForPrincipal(user);
  if (!assigned.includes(workspace.slug)) {
    return { ok: false, status: 403, reason: "not_assigned" };
  }
  if (!canRoleAccessWorkspace(user.accessRole, workspace)) {
    return { ok: false, status: 403, reason: "role_denied" };
  }
  return { ok: true, workspace };
}

export function canMutateWorkspace(user: Principal, workspace: WorkspaceConfig): boolean {
  if (workspace.access.readOnlyByDefault) return false;
  return user.accessRole === "client_user" || user.accessRole === "admin_operator";
}

export function isAdminOperator(user: Principal): boolean {
  return user.accessRole === "admin_operator";
}
