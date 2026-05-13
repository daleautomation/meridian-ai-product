export type DemoAudience = "client" | "advisor" | "investor" | "public";

export type DemoProfile = {
  slug: string;
  tenantId: string;
  workspaceSlug: string;
  audience: DemoAudience;
  description: string;
};

export const DEMO_PROFILES: Record<string, DemoProfile> = {
  john: {
    slug: "john",
    tenantId: "john",
    workspaceSlug: "labortech",
    audience: "client",
    description: "LaborTech client demo entry",
  },
  max: {
    slug: "max",
    tenantId: "max",
    workspaceSlug: "advisor-demo",
    audience: "advisor",
    description: "Advisor demo entry for Max",
  },
  advisor: {
    slug: "advisor",
    tenantId: "advisor",
    workspaceSlug: "advisor-demo",
    audience: "advisor",
    description: "Generic advisor demo entry",
  },
  investor: {
    slug: "investor",
    tenantId: "investor",
    workspaceSlug: "advisor-demo",
    audience: "investor",
    description: "Investor demo entry",
  },
  public: {
    slug: "public",
    tenantId: "public-demo",
    workspaceSlug: "advisor-demo",
    audience: "public",
    description: "Public controlled demo entry",
  },
};

export function getDemoProfile(slug: string | undefined | null): DemoProfile | null {
  if (!slug) return null;
  return DEMO_PROFILES[slug.toLowerCase().trim()] ?? null;
}
