import { getWorkspaceBySlug, type WorkspaceConfig } from "@/config/workspaces";
import type { AccessRole, PublicUser, Tenant } from "@/config/tenants";

type Principal = Pick<PublicUser | Tenant, "id" | "accessRole" | "workspaces">;

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
  if (!(user.workspaces ?? []).includes(workspace.slug)) {
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
