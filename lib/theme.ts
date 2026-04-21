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
  borderLight:  "#F1F5F9",       // barely-there
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
  name: "Meridian AI",
  tagline: "Roofing Engine",
  positioning: "Close more deals. Faster.",
} as const;

// Legacy exports for backward compat
export const modules = {} as const;
export const publicContent = {} as const;
