// Meridian — tenant config (local dev)
// NOTE: Passwords are plaintext for local development only.
// Replace with hashed credentials before any non-local deployment.
//
// `workspaces` lists the workspace slugs (config/workspaces.ts) the user
// can enter. A user with one workspace is routed straight in; multiple
// workspaces trigger the picker.

export type ModuleId = "roofing";

export type Tenant = {
  id: string;
  name: string;
  password: string;
  modules: ModuleId[];
  geo: string[];
  workspaces: string[];
};

export type PublicUser = {
  id: string;
  name: string;
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
    password: "meridian",
    modules: ["roofing"],
    geo: [],
    workspaces: ["labortech"],
  },
  john: {
    id: "john",
    name: "John",
    password: "labortech",
    modules: ["roofing"],
    geo: [],
    workspaces: ["labortech"],
  },
  labortech: {
    id: "labortech",
    name: "LaborTech",
    password: "labortech",
    modules: ["roofing"],
    geo: [],
    workspaces: ["labortech"],
  },
};

export function toPublicUser(t: Tenant): PublicUser {
  return { id: t.id, name: t.name, modules: t.modules, geo: t.geo, workspaces: t.workspaces };
}

export function getTenantById(id: string): Tenant | null {
  return TENANTS[id] ?? null;
}

export function findTenantByCredentials(
  username: string,
  password: string
): Tenant | null {
  const t = TENANTS[username.toLowerCase().trim()];
  if (!t) return null;
  if (t.password.length !== password.length) return null;
  let mismatch = 0;
  for (let i = 0; i < t.password.length; i++) {
    mismatch |= t.password.charCodeAt(i) ^ password.charCodeAt(i);
  }
  return mismatch === 0 ? t : null;
}
