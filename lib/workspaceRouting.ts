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

/** Default post-login route for a user with one or more workspace slugs. */
export function defaultRouteForWorkspaceSlugs(slugs: readonly string[]): string {
  const workspaces = slugs
    .map((slug) => getWorkspaceBySlug(slug))
    .filter((ws): ws is WorkspaceConfig => ws !== null);

  const personal = workspaces.find(isPersonalWorkspace);
  if (personal && workspaces.length === 1) {
    return workspaceHomePath(personal);
  }

  const labortech = workspaces.find(isLaborTechWorkspace);
  if (labortech && workspaces.length === 1) {
    return workspaceHomePath(labortech);
  }

  const relationship = workspaces.find(
    (ws) => isRelationshipDeskWorkspace(ws) && !isPersonalWorkspace(ws),
  );
  if (relationship && workspaces.length === 1) {
    return workspaceHomePath(relationship);
  }

  if (workspaces.length === 1) {
    return workspaceHomePath(workspaces[0]);
  }

  return "/login";
}
