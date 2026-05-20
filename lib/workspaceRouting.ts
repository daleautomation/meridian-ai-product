import type { WorkspaceConfig } from "@/config/workspaces";
import { getWorkspaceBySlug } from "@/config/workspaces";

export type WorkspaceKind = WorkspaceConfig["kind"];

export function isPersonalWorkspace(workspace: WorkspaceConfig): boolean {
  return workspace.kind === "personal";
}

export function isLaborTechWorkspace(workspace: WorkspaceConfig): boolean {
  return workspace.kind === "labortech";
}

export function isRelationshipDeskWorkspace(workspace: WorkspaceConfig): boolean {
  return workspace.kind === "relationship" || workspace.features.showRelationshipsTab;
}

/** Canonical entry path for a workspace — keeps LaborTech and Personal separate. */
export function workspaceHomePath(workspace: WorkspaceConfig): string {
  if (isPersonalWorkspace(workspace)) {
    return `/personal?workspace=${workspace.slug}`;
  }
  if (isRelationshipDeskWorkspace(workspace) && !isLaborTechWorkspace(workspace)) {
    return `/operator/relationship-priority?workspace=${workspace.slug}`;
  }
  return `/operator?workspace=${workspace.slug}`;
}

export function workspaceImportPath(workspace: WorkspaceConfig): string {
  if (isPersonalWorkspace(workspace)) {
    return `/personal/import?workspace=${workspace.slug}`;
  }
  return `/operator/import?workspace=${workspace.slug}`;
}

import type { PublicUser } from "@/config/tenants";
import { listAccessibleWorkspacesForPrincipal } from "@/lib/workspaceAccess";

export const WORKSPACE_SELECT_PATH = "/workspace-select";

/** Default post-login route for workspace slug list. */
export function defaultRouteForWorkspaceSlugs(slugs: readonly string[]): string {
  const workspaces = slugs
    .map((slug) => getWorkspaceBySlug(slug))
    .filter((ws): ws is WorkspaceConfig => ws !== null);

  if (workspaces.length > 1) {
    return WORKSPACE_SELECT_PATH;
  }

  if (workspaces.length === 1) {
    return workspaceHomePath(workspaces[0]);
  }

  return "/login";
}

/** When a multi-workspace user hits a surface without ?workspace=, send to selector. */
export function shouldRedirectToWorkspaceSelect(
  user: Pick<PublicUser, "workspaces" | "accessRole">,
): boolean {
  return listAccessibleWorkspacesForPrincipal(user).length > 1;
}
