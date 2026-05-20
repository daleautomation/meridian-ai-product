import type { AccessRole } from "./tenants";

// Meridian — workspace (tenant) config.
//
// One workspace = one company instance of the product. The public Meridian
// site stays brand-pure; an authenticated workspace can carry an accent
// label ("LaborTech workspace") without renaming the platform.

export type ModuleId =
  | "roofing"
  | "hvac"
  | "plumbing"
  | "carpentry"
  | "painting"
  | "electrical"
  | "remodeling";

export type WorkspaceKind = "labortech" | "relationship" | "personal";

export type WorkspaceConfig = {
  id: string;
  name: string;
  slug: string;
  /** Explicit workspace boundary — drives routing and UX shells. */
  kind: WorkspaceKind;
  defaultModule: ModuleId;
  enabledModules: ModuleId[];
  comingSoonModules: ModuleId[];
  features: {
    showRelationshipsTab: boolean;
    showOpportunitySurfaces: boolean;
  };
  access: {
    allowedRoles: AccessRole[];
    dataMode: "client" | "demo";
    readOnlyByDefault: boolean;
  };
  branding?: {
    displayName?: string;
    accentLabel?: string;
    companyName?: string;
  };
};

export const WORKSPACES: Record<string, WorkspaceConfig> = {
  labortech: {
    id: "labortech",
    name: "LaborTech",
    slug: "labortech",
    kind: "labortech",
    defaultModule: "roofing",
    enabledModules: ["roofing", "hvac", "plumbing", "carpentry", "painting", "electrical"],
    comingSoonModules: ["remodeling"],
    features: {
      showRelationshipsTab: false,
      showOpportunitySurfaces: false,
    },
    access: {
      allowedRoles: ["client_user", "admin_operator"],
      dataMode: "client",
      readOnlyByDefault: false,
    },
    branding: {
      displayName: "LaborTech",
      accentLabel: "LaborTech workspace",
    },
  },
  "advisor-demo": {
    id: "advisor-demo",
    name: "Advisor Demo",
    slug: "advisor-demo",
    kind: "relationship",
    defaultModule: "roofing",
    enabledModules: ["roofing"],
    comingSoonModules: ["hvac", "plumbing", "carpentry", "painting", "electrical", "remodeling"],
    features: {
      showRelationshipsTab: true,
      showOpportunitySurfaces: true,
    },
    access: {
      allowedRoles: ["demo_viewer", "advisor_viewer", "admin_operator"],
      dataMode: "demo",
      readOnlyByDefault: true,
    },
    branding: {
      displayName: "Meridian Demo",
      accentLabel: "Advisor demo workspace",
    },
  },
  "nicole-lonergan": {
    id: "nicole-lonergan",
    name: "Nicole Lonergan",
    slug: "nicole-lonergan",
    kind: "personal",
    defaultModule: "roofing",
    enabledModules: [],
    comingSoonModules: [],
    features: {
      showRelationshipsTab: false,
      showOpportunitySurfaces: false,
    },
    access: {
      allowedRoles: ["client_user", "admin_operator"],
      dataMode: "client",
      readOnlyByDefault: false,
    },
    branding: {
      displayName: "Nicole Lonergan Workspace",
      accentLabel: "Brookside Real Estate relationship workspace",
      companyName: "Brookside Real Estate",
    },
  },
};

export const WORKSPACE_ORDER: string[] = ["labortech", "advisor-demo", "nicole-lonergan"];

/** Short slug alias for Nicole Lonergan's personal workspace URLs. */
const WORKSPACE_SLUG_ALIASES: Record<string, string> = {
  nicole: "nicole-lonergan",
};

export function getWorkspaceBySlug(slug: string | undefined | null): WorkspaceConfig | null {
  if (!slug) return null;
  const normalized = slug.toLowerCase();
  const key = WORKSPACE_SLUG_ALIASES[normalized] ?? normalized;
  return WORKSPACES[key] ?? null;
}

export function resolveWorkspaceIdFromAssignment(slug: string): string {
  return WORKSPACE_SLUG_ALIASES[slug.toLowerCase()] ?? slug.toLowerCase();
}

export function listWorkspacesForUser(workspaceIds: readonly string[]): WorkspaceConfig[] {
  const assigned = new Set(workspaceIds.map(resolveWorkspaceIdFromAssignment));
  const out: WorkspaceConfig[] = [];
  const seen = new Set<string>();

  for (const slug of WORKSPACE_ORDER) {
    if (!assigned.has(slug)) continue;
    const ws = WORKSPACES[slug];
    if (ws && !seen.has(ws.id)) {
      seen.add(ws.id);
      out.push(ws);
    }
  }

  for (const slug of assigned) {
    if (WORKSPACE_ORDER.includes(slug)) continue;
    const ws = WORKSPACES[slug];
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
