// Meridian AI — Design System.
//
// Premium light interface. Apple-inspired clarity.
// Meridian blue as the primary accent. Restrained, minimal, high-end.

export const palette = {
  // ── Backgrounds ──
  bg:           "#F4F7FC",       // soft blue base
  surface:      "#FFFFFF",       // card/panel white
  surfaceGlass: "rgba(255,255,255,0.80)", // frosted panel
  surfaceHover: "#F9FBFE",      // section / hover
  surfaceSelected: "#EFF6FF",   // selected row (very faint blue)

  // ── Meridian blue (primary accent) ──
  blue:         "#2563EB",       // Apple-like system blue
  blueLight:    "#3B82F6",       // lighter variant
  bluePale:     "#EFF6FF",       // very pale blue tint
  blueBorder:   "rgba(37,99,235,0.15)",

  // ── Text ──
  textPrimary:  "#1F2A44",       // near-black, slightly warm for body
  textSecondary:"#64748B",       // slate gray
  textTertiary: "#94A3B8",       // muted
  textDim:      "#CBD5E1",       // very light

  // ── Borders ──
  border:       "#E6ECF5",       // soft blue-gray
  borderLight:  "#EDF1F7",       // soft hairline — visible but quiet
  borderAccent: "rgba(37,99,235,0.20)",

  // ── Semantic ──
  success:      "#16A34A",       // green
  successBg:    "#F0FDF4",
  warning:      "#D97706",       // amber
  warningBg:    "#FFFBEB",
  danger:       "#DC2626",       // red
  dangerBg:     "#FEF2F2",

  // ── Depth / shadow ──
  shadow:       "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:     "0 4px 6px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.03)",
  shadowLg:     "0 10px 15px rgba(0,0,0,0.04), 0 4px 6px rgba(0,0,0,0.02)",

  // ── Legacy (kept for imports that reference these) ──
  midnight:     "#1A1A2E",
  cyan:         "#2563EB",
  cream:        "#D97706",
  cobalt:       "#2563EB",
  nightIndigo:  "#F8FAFC",
  deepSurface:  "#F8FAFC",
  periwinkle:   "#6366F1",
  slateBlue:    "#64748B",
  textPrimary_old: "#F0EFF5",
  lightBg:      "#FAFBFC",
} as const;

export const brand = {
  name: "Meridian",
  tagline: "Who to call first",
  positioning: "Who to call first.",
} as const;

// Legacy exports for backward compat
export const modules = {} as const;

export const publicContent = {
  hero: {
    headline: "Who to call first.",
    subline: "Meridian ranks your trade leads by who is most ready to close — and tells you what to say.",
    trust: "Built for roofing operators. HVAC, plumbing, and remodeling rolling out next.",
    ctaSecondary: "How it works",
  },
  modules: {
    title: "Modules",
    items: [
      { id: "roofing",    label: "Roofing",    status: "LIVE",         desc: "Live trade module. Ranks roofing leads by readiness to close." },
      { id: "hvac",       label: "HVAC",       status: "Coming soon",  desc: "Heating and cooling operators. Sources wiring next." },
      { id: "plumbing",   label: "Plumbing",   status: "Coming soon",  desc: "Plumbing operators. Sources wiring next." },
      { id: "remodeling", label: "Remodeling", status: "Coming soon",  desc: "Remodelers and carpenters. Sources wiring next." },
    ],
    footer: "One platform. One workflow. New trades added as their data sources are wired.",
  },
  about: {
    moduleCapabilities: [
      { label: "Roofing",    capabilities: ["Live ranked call list", "Website + reviews scan", "Plain-English call reasons", "Status pipeline + activity log"] },
      { label: "HVAC",       capabilities: ["Coming soon"] },
      { label: "Plumbing",   capabilities: ["Coming soon"] },
      { label: "Remodeling", capabilities: ["Coming soon"] },
    ],
  },
  pricing: {
    title: "Pricing",
    subtext: "Pay for what you use. No long contracts.",
    tiers: [],
    footer: "Contact us for a build quote.",
  },
  roadmap: {
    items: [
      "HVAC module — sources wiring",
      "Plumbing module — sources wiring",
      "Remodeling module — sources wiring",
    ],
  },
  demo: {
    title: "See it on your data",
    desc: "Bring a list of leads. We'll show you who to call first.",
    timing: "30-minute walkthrough",
    href: "mailto:hello@meridian.ai",
    cta: "Request demo",
  },
  requestModule: {
    title: "Need another trade?",
    desc: "Tell us which trade and which sources you have access to.",
    timing: "Reply within 1 business day",
    href: "mailto:hello@meridian.ai",
    cta: "Request module",
  },
} as const;
