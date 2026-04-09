// Meridian AI — tenant config (local dev)
// NOTE: Passwords are plaintext for local development only.
// Replace with hashed credentials before any non-local deployment.

export type ModuleId = "real-estate" | "saas" | "trading" | "watches";

export type Tenant = {
  id: string;
  name: string;
  password: string;
  modules: ModuleId[];
  geo: string[];
};

export type PublicUser = {
  id: string;
  name: string;
  modules: ModuleId[];
  geo: string[];
};

export const TENANTS: Record<string, Tenant> = {
  nicole: {
    id: "nicole",
    name: "Nicole Lonergan",
    password: "nicole",
    modules: ["real-estate"],
    geo: ["64113"],
  },
  ryan: {
    id: "ryan",
    name: "Ryan Smith",
    password: "ryan",
    modules: ["real-estate"],
    geo: ["66206"],
  },
  clayton: {
    id: "clayton",
    name: "Clayton Holmberg",
    password: "clayton",
    modules: ["real-estate"],
    geo: [],
  },
  dylan: {
    id: "dylan",
    name: "Dylan",
    password: "dylan",
    modules: ["watches"],
    geo: [],
  },
};

export function toPublicUser(t: Tenant): PublicUser {
  return { id: t.id, name: t.name, modules: t.modules, geo: t.geo };
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
