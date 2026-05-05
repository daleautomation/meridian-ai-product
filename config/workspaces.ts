// Meridian — workspace (tenant) config.
//
// One workspace = one company instance of the product. The public Meridian
// site stays brand-pure; an authenticated workspace can carry an accent
// label ("LaborTech workspace") without renaming the platform.

export type ModuleId = "roofing" | "hvac" | "plumbing" | "remodeling";

export type WorkspaceConfig = {
  id: string;
  name: string;
  slug: string;
  defaultModule: ModuleId;
  enabledModules: ModuleId[];
  comingSoonModules: ModuleId[];
  branding?: {
    displayName?: string;
    accentLabel?: string;
  };
};

export const WORKSPACES: Record<string, WorkspaceConfig> = {
  labortech: {
    id: "labortech",
    name: "LaborTech",
    slug: "labortech",
    defaultModule: "roofing",
    enabledModules: ["roofing"],
    comingSoonModules: ["hvac", "plumbing", "remodeling"],
    branding: {
      displayName: "LaborTech",
      accentLabel: "LaborTech workspace",
    },
  },
};

export const WORKSPACE_ORDER: string[] = ["labortech"];

export function getWorkspaceBySlug(slug: string | undefined | null): WorkspaceConfig | null {
  if (!slug) return null;
  return WORKSPACES[slug.toLowerCase()] ?? null;
}

export function listWorkspacesForUser(workspaceIds: readonly string[]): WorkspaceConfig[] {
  const seen = new Set<string>();
  const out: WorkspaceConfig[] = [];
  for (const id of workspaceIds) {
    const ws = WORKSPACES[id];
    if (ws && !seen.has(ws.id)) {
      seen.add(ws.id);
      out.push(ws);
    }
  }
  return out;
}

export function defaultWorkspaceFor(workspaceIds: readonly string[]): WorkspaceConfig | null {
  const list = listWorkspacesForUser(workspaceIds);
  return list[0] ?? null;
}
