// Meridian — trade → service mapping.
//
// Declares which services apply to each trade and how heavily. The
// opportunity layer narrows further to the specific service set per
// bucket — this file is the trade-wide menu the operator could pull
// from when the bucket layer doesn't pin a specific gap.

export type TradeServiceTier = "primary" | "secondary" | "rarely_used";

export type TradeServiceConfig = {
  trade: string;
  primary: string[];
  secondary: string[];
  rarely_used: string[];
};

export const TRADE_SERVICES: Record<string, TradeServiceConfig> = {
  roofing: {
    trade: "roofing",
    primary: ["web_build", "local_seo", "review_automation", "storm_response_landing"],
    secondary: ["conversion_tightening", "estimate_followup_automation", "service_page_buildout"],
    rarely_used: ["panel_upgrade_landing", "ev_charger_landing"],
  },
  hvac: {
    trade: "hvac",
    primary: [
      "emergency_landing_page",
      "local_seo",
      "review_automation",
      "financing_landing",
      "service_page_buildout",
    ],
    secondary: ["estimate_followup_automation", "conversion_tightening"],
    rarely_used: ["portfolio_gallery", "storm_response_landing"],
  },
  carpentry: {
    trade: "carpentry",
    primary: ["portfolio_gallery", "conversion_tightening", "local_seo", "niche_positioning"],
    secondary: ["portfolio_photography", "review_automation", "estimate_followup_automation"],
    rarely_used: ["emergency_landing_page", "financing_landing"],
  },
  painting: {
    trade: "painting",
    primary: [
      "exterior_repaint_landing",
      "cabinet_repaint_landing",
      "commercial_positioning",
      "local_seo",
      "review_automation",
    ],
    secondary: ["portfolio_gallery", "portfolio_photography", "estimate_followup_automation"],
    rarely_used: ["emergency_landing_page", "storm_response_landing"],
  },
  plumbing: {
    trade: "plumbing",
    primary: [
      "emergency_landing_page",
      "local_seo",
      "service_page_buildout",
      "review_automation",
    ],
    secondary: ["estimate_followup_automation", "conversion_tightening"],
    rarely_used: ["financing_landing", "portfolio_gallery"],
  },
  electrical: {
    trade: "electrical",
    primary: [
      "emergency_landing_page",
      "panel_upgrade_landing",
      "ev_charger_landing",
      "commercial_positioning",
      "review_automation",
    ],
    secondary: ["local_seo", "service_page_buildout", "financing_landing"],
    rarely_used: ["storm_response_landing", "portfolio_gallery"],
  },
};

export function getTradeServices(trade: string): TradeServiceConfig | null {
  return TRADE_SERVICES[trade] ?? null;
}
