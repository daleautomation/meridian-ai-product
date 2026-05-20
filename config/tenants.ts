import {
  normalizeLoginUsername,
  passwordsMatch,
} from "@/lib/auth/credentials";

// Meridian — tenant config (local dev)
// NOTE: Passwords are plaintext for local development only.
// Replace with hashed credentials before any non-local deployment.
//
// `workspaces` lists the workspace slugs (config/workspaces.ts) the user
// can enter. A user with one workspace is routed straight in; multiple
// workspaces trigger the picker.

export type ModuleId = "roofing";

export type AccessRole =
  | "demo_viewer"
  | "advisor_viewer"
  | "client_user"
  | "admin_operator";

export type Tenant = {
  id: string;
  name: string;
  password: string;
  loginEnabled?: boolean;
  accessRole: AccessRole;
  modules: ModuleId[];
  geo: string[];
  workspaces: string[];
};

export type PublicUser = {
  id: string;
  name: string;
  accessRole: AccessRole;
  modules: ModuleId[];
  geo: string[];
  workspaces: string[];
};

// ── Field-test demo credentials ─────────────────────────────────────
// Single source of truth. Update here to rotate any account; the
// login route, session, and workspace routing all read from this map.
// Passwords are plaintext for the field-test demo only — replace
// with hashed credentials before any non-demo deployment.
export const TENANTS: Record<string, Tenant> = {
  dylan: {
    id: "dylan",
    name: "Dylan",
    password: "Meridian",
    accessRole: "admin_operator",
    modules: ["roofing"],
    geo: [],
    workspaces: ["labortech", "nicole-lonergan"],
  },
  nicole: {
    id: "nicole",
    name: "Nicole Lonergan",
    password: "brookside",
    accessRole: "client_user",
    modules: ["roofing"],
    geo: [],
    workspaces: ["nicole-lonergan"],
  },
  john: {
    id: "john",
    name: "John",
    password: "labortech",
    accessRole: "client_user",
    modules: ["roofing"],
    geo: [],
    workspaces: ["labortech"],
  },
  labortech: {
    id: "labortech",
    name: "LaborTech",
    password: "labortech",
    accessRole: "client_user",
    modules: ["roofing"],
    geo: [],
    workspaces: ["labortech"],
  },
  max: {
    id: "max",
    name: "Max",
    password: "",
    loginEnabled: false,
    accessRole: "advisor_viewer",
    modules: ["roofing"],
    geo: [],
    workspaces: ["advisor-demo"],
  },
  advisor: {
    id: "advisor",
    name: "Advisor Demo",
    password: "",
    loginEnabled: false,
    accessRole: "advisor_viewer",
    modules: ["roofing"],
    geo: [],
    workspaces: ["advisor-demo"],
  },
  investor: {
    id: "investor",
    name: "Investor Demo",
    password: "",
    loginEnabled: false,
    accessRole: "advisor_viewer",
    modules: ["roofing"],
    geo: [],
    workspaces: ["advisor-demo"],
  },
  "public-demo": {
    id: "public-demo",
    name: "Demo Viewer",
    password: "",
    loginEnabled: false,
    accessRole: "demo_viewer",
    modules: ["roofing"],
    geo: [],
    workspaces: ["advisor-demo"],
  },
};

export function toPublicUser(t: Tenant): PublicUser {
  return {
    id: t.id,
    name: t.name,
    accessRole: t.accessRole,
    modules: t.modules,
    geo: t.geo,
    workspaces: t.workspaces,
  };
}

export function getTenantById(id: string): Tenant | null {
  return TENANTS[id] ?? null;
}

export function findTenantByCredentials(
  username: string,
  password: string,
): Tenant | null {
  const t = TENANTS[normalizeLoginUsername(username)];
  if (!t) return null;
  if (t.loginEnabled === false) return null;
  if (!passwordsMatch(t.password, password)) return null;
  return t;
}
