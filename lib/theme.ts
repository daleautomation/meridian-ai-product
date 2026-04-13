// Meridian AI — centralized design tokens.
//
// Single source of truth for the visual system. Import from here instead
// of hardcoding hex values. Palette inspired by atmospheric night-sky
// direction — deep indigo base, luminous cyan energy, warm cream contrast.

// ── Core palette ───────────────────────────────────────────────────────

export const palette = {
  // Night / background
  midnight:     "#0C0731",
  nightIndigo:  "#19226D",
  cobalt:       "#1E3092",
  deepSurface:  "#0D0B1E",
  surface:      "#11102A",

  // Primary energy
  cyan:         "#68ECF4",
  cyanRgb:      "104,236,244",

  // Warm contrast
  cream:        "#EDDABA",
  blush:        "#E6C9BF",

  // Soft secondary
  mauve:        "#C4B1B9",
  periwinkle:   "#8E8DBB",
  slateBlue:    "#6B75A4",

  // Text
  textPrimary:  "#F0EFF5",
  textSecondary:"rgba(240,239,245,0.60)",
  textTertiary: "rgba(240,239,245,0.35)",
  textDim:      "rgba(240,239,245,0.20)",

  // Semantic — action signals (palette-native versions)
  execute:      "#68ECF4",  // cyan — strongest positive
  executeRgb:   "104,236,244",
  caution:      "#EDDABA",  // warm cream
  cautionRgb:   "237,218,186",
  risk:         "#E6C9BF",  // soft blush-rose
  riskRgb:      "230,201,191",
  danger:       "#D4726A",  // muted coral (not harsh red)
  dangerRgb:    "212,114,106",

  // Module accents
  luxuryGoods:  "#8E8DBB",  // periwinkle
  luxuryGoodsRgb: "142,141,187",
  homes:        "#6B75A4",  // slate blue
  homesRgb:     "107,117,164",

  // Borders / dividers
  border:       "rgba(240,239,245,0.06)",
  borderLight:  "rgba(240,239,245,0.10)",
  borderAccent: "rgba(104,236,244,0.20)",

  // ── Light mode (public pages) ──
  lightBg:          "#F5F3EF",       // warm pale cream
  lightSurface:     "#EDEAE4",       // slightly deeper cream for cards
  lightText:        "#0C0731",       // midnight as text
  lightTextSecondary: "rgba(12,7,49,0.74)",
  lightTextTertiary:  "rgba(12,7,49,0.48)",
  lightTextDim:       "rgba(12,7,49,0.28)",
  lightBorder:      "rgba(12,7,49,0.10)",
  lightCyanBg:      "rgba(30,48,146,0.06)",
  lightCyanBorder:  "rgba(30,48,146,0.18)",
} as const;

// ── Module definitions (public-facing labels + engine colors) ──────────

export const modules = {
  watches: {
    publicLabel: "Luxury Goods",
    publicDesc: "Acquisition intelligence for watches, collectibles, and high-end assets.",
    accent: palette.luxuryGoods,
    accentRgb: palette.luxuryGoodsRgb,
  },
  "real-estate": {
    publicLabel: "Homes",
    publicDesc: "Off-market sourcing, underwriting, and deal execution for residential acquisitions.",
    accent: palette.homes,
    accentRgb: palette.homesRgb,
  },
} as const;

// ── Brand ──────────────────────────────────────────────────────────────

export const brand = {
  name: "Meridian AI",
  tagline: "Decision Platform",
  positioning: "Find edge. Execute decisively.",
  description: "A modular decision engine that sources, scores, and executes high-value acquisitions across luxury goods and real estate.",
} as const;

// ── Public page content (editable in one place) ────────────────────────

export const publicContent = {
  hero: {
    headline: "Meridian AI",
    subline: "Find underpriced deals — and know exactly what to do next.",
    trust: "Built on real market data across watches and real estate.",
    cta: "Enter Platform",
    ctaAuth: "Enter Platform",
    ctaSecondary: "See It In Action",
  },
  about: {
    title: "About Meridian",
    lead: "A decision engine that surfaces opportunities efficient markets overlook and helps you act on them with clearer judgment.",
    body: "Every module ingests from multiple sources, scores on real economics, filters on trust, and produces one decisive action per opportunity. The platform expands continuously with new modules, new data sources, and sharper tools.",
    moduleCapabilities: [
      {
        label: "Luxury Goods",
        capabilities: [
          "Marketplace and private-seller arbitrage",
          "Trust, liquidity, and margin-aware ranking",
          "Fast action on mispriced high-end assets",
        ],
      },
      {
        label: "Homes",
        capabilities: [
          "Off-market and distress sourcing",
          "Equity-spread and execution-risk evaluation",
          "Faster prioritization of residential opportunities",
        ],
      },
    ],
  },
  modules: {
    title: "Live Modules",
    footer: "Each deal is scored and broken down so you can act fast with confidence.",
    items: [
      {
        id: "watches",
        label: "Luxury Goods",
        desc: "Finds underpriced watches across marketplaces like eBay and Chrono24 — and shows you exactly what to buy and offer.",
        status: "Live",
      },
      {
        id: "real-estate",
        label: "Homes",
        desc: "Finds off-market homes and motivated sellers — and highlights the deals actually worth acting on.",
        status: "Live",
      },
    ],
  },
  roadmap: {
    title: "Always expanding",
    items: [
      "SaaS Revenue Intelligence",
      "Trading Momentum Engine",
      "Collectibles & Alternative Assets",
    ],
  },
  demo: {
    title: "See it live",
    desc: "See real deals — analyzed in real time.",
    timing: "Ready in 24–48 hours",
    cta: "Request a Demo",
    href: "mailto:demo@meridian.ai?subject=Demo Request",
  },
  requestModule: {
    title: "Bring your edge",
    desc: "Bring Meridian to your market and move faster than everyone else.",
    timing: "Built in 5–10 days",
    cta: "Request a Module",
    href: "mailto:modules@meridian.ai?subject=Module Request",
  },
  pricing: {
    title: "Pricing",
    subtext: "Pricing depends on which module you use and how much customization you need. Every setup is scoped to your market.",
    tiers: [
      {
        label: "Existing Modules",
        setup: "$500 – $1,500",
        monthly: "$99 – $599/mo",
        detail: {
          intro: "Existing modules are faster to launch, but pricing depends on setup needs, access level, and how much support or customization is required.",
          sections: [
            { title: "What affects setup", items: ["Onboarding and account setup", "Data source connections", "Light customization", "User training"] },
            { title: "What affects monthly pricing", items: ["Module access level", "Feature depth", "Update and support needs", "Usage volume"] },
          ],
          rubric: [
            { level: "Simple", items: ["Fast onboarding", "Standard module access", "Minimal customization", "Best for individual users"] },
            { level: "Moderate", items: ["Additional data connections", "More support", "Some customization", "Best for active operators"] },
            { level: "Advanced", items: ["Deeper feature access", "Team usage", "Ongoing updates and support", "Best for high-volume use"] },
          ],
        },
      },
      {
        label: "Custom Modules",
        setup: "$2,500 – $7,500+",
        monthly: "Custom pricing",
        detail: {
          intro: "Custom modules take more build work because Meridian has to be shaped around a different market, workflow, or decision process.",
          sections: [
            { title: "What affects build cost", items: ["Market complexity", "Custom logic and scoring", "Data source integration", "Workflow design"] },
            { title: "What affects monthly pricing", items: ["Ongoing support", "Iteration and improvements", "Maintenance", "Usage and scope"] },
          ],
          rubric: [
            { level: "Simple", items: ["Clear use case", "Limited workflow changes", "Few integrations", "Faster build"] },
            { level: "Moderate", items: ["More custom logic", "Multiple data sources", "More workflow shaping", "More setup time"] },
            { level: "Advanced", items: ["Complex market", "Custom scoring logic", "Several integrations", "Ongoing iteration and support"] },
          ],
        },
      },
    ],
    footer: "Most users start with an existing module and expand from there.",
  },
} as const;
