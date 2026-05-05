// Meridian AI — Trade Source Readiness.
//
// Pure config + readiness check. Declares which data sources each trade
// module needs to operate, references env-var names only (never values),
// and lets the UI show a calm empty state when a trade isn't wired up.
//
// No I/O, no API calls. The actual integrations are deliberately out of
// scope here — this file only describes what is needed and reports
// which env vars are present in the current process.

import type { TradeId } from "./tradeConfigs";

export type SourceId =
  | "google_places"
  | "website_scanner"
  | "review_data"
  | "local_seo_scan"
  | "emergency_keywords"
  | "portfolio_scanner"
  | "developer_directories"
  | "project_bid_indicators"
  | "seasonal_services";

export interface TradeSourceConfig {
  tradeId: TradeId;
  requiredSources: SourceId[];
  optionalSources: SourceId[];
  /** Env-var names this trade benefits from. Never values. */
  envVars: string[];
}

// Env-var contract. Single source of truth for what *could* be set.
// Adding a new var here surfaces it in `getTradeSourceReadiness`
// without touching the per-trade config.
export const TRADE_ENV_VARS = {
  GOOGLE_PLACES_API_KEY: "GOOGLE_PLACES_API_KEY",
  SERPAPI_API_KEY:       "SERPAPI_API_KEY",
  APOLLO_API_KEY:        "APOLLO_API_KEY",
  CLEARBIT_API_KEY:      "CLEARBIT_API_KEY",
  BUILTWITH_API_KEY:     "BUILTWITH_API_KEY",
  PAGESPEED_API_KEY:     "PAGESPEED_API_KEY",
} as const;

export const TRADE_SOURCES: Record<TradeId, TradeSourceConfig> = {
  roofing: {
    tradeId: "roofing",
    requiredSources: ["google_places", "website_scanner"],
    optionalSources: ["review_data", "local_seo_scan"],
    envVars: ["GOOGLE_PLACES_API_KEY", "PAGESPEED_API_KEY"],
  },
  hvac: {
    tradeId: "hvac",
    requiredSources: ["google_places", "website_scanner"],
    optionalSources: ["emergency_keywords", "review_data"],
    envVars: ["GOOGLE_PLACES_API_KEY", "SERPAPI_API_KEY", "PAGESPEED_API_KEY"],
  },
  carpentry: {
    tradeId: "carpentry",
    requiredSources: ["google_places", "website_scanner"],
    optionalSources: ["portfolio_scanner", "review_data"],
    envVars: ["GOOGLE_PLACES_API_KEY", "PAGESPEED_API_KEY"],
  },
  painting: {
    tradeId: "painting",
    requiredSources: ["google_places", "website_scanner"],
    optionalSources: ["portfolio_scanner", "review_data"],
    envVars: ["GOOGLE_PLACES_API_KEY", "PAGESPEED_API_KEY"],
  },
  plumbing: {
    tradeId: "plumbing",
    requiredSources: ["google_places", "website_scanner"],
    optionalSources: ["emergency_keywords", "review_data"],
    envVars: ["GOOGLE_PLACES_API_KEY", "SERPAPI_API_KEY", "PAGESPEED_API_KEY"],
  },
  electrical: {
    tradeId: "electrical",
    requiredSources: ["google_places", "website_scanner"],
    optionalSources: ["emergency_keywords", "review_data"],
    envVars: ["GOOGLE_PLACES_API_KEY", "PAGESPEED_API_KEY"],
  },
};

export interface TradeSourceReadiness {
  tradeId: TradeId;
  requiredSources: SourceId[];
  optionalSources: SourceId[];
  missingEnvVars: string[];
  ready: boolean;
  message: string;
}

// Universe of env-var names this module knows about. Exported so the
// server can iterate process.env once and hand the result to the client.
export const ALL_TRADE_ENV_VARS: readonly string[] = Object.values(TRADE_ENV_VARS);

/**
 * Pure readiness check. Caller MUST supply the set of env-var names that
 * are currently connected on the server — this function never reads
 * process.env directly so it is safe to call from client components.
 *
 * The server (e.g. app/operator/page.tsx) is the only place env vars
 * are read; it forwards the resulting set as a serializable prop.
 */
export function getTradeSourceReadiness(
  tradeId: TradeId,
  connectedEnvVars: ReadonlySet<string> = new Set(),
): TradeSourceReadiness {
  const cfg = TRADE_SOURCES[tradeId];
  if (!cfg) {
    return {
      tradeId,
      requiredSources: [],
      optionalSources: [],
      missingEnvVars: [],
      ready: false,
      message: "Unknown trade module.",
    };
  }
  const missingEnvVars = cfg.envVars.filter((name) => !connectedEnvVars.has(name));
  const ready = missingEnvVars.length === 0;
  const message = ready
    ? "All declared sources connected."
    : missingEnvVars.includes("GOOGLE_PLACES_API_KEY")
      ? "Connect Google Places to populate this module."
      : `Connect ${missingEnvVars.join(", ")} to populate this module.`;
  return {
    tradeId,
    requiredSources: cfg.requiredSources,
    optionalSources: cfg.optionalSources,
    missingEnvVars,
    ready,
    message,
  };
}
