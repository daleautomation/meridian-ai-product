// Meridian — per-trade LaborTech service configuration.
//
// Each trade module surfaces a tiered list of LaborTech services.
//   • primary   — what John leads with for this trade
//   • secondary — recurring upsell / cross-sell
//   • advanced  — automation + content lanes once the basics are in
//
// `influencer_marketing` and `mobile_app` are intentionally absent from
// every trade today. Re-enable per trade only when the service is
// staffed for that vertical.

export type ServiceTier = "primary" | "secondary" | "advanced";

export type TradeServiceConfig = {
  trade: string;
  primary: string[];
  secondary: string[];
  advanced: string[];
};

export const TRADE_SERVICE_CONFIG: Record<string, TradeServiceConfig> = {
  roofing: {
    trade: "roofing",
    primary: ["website_funnel", "seo", "google_ads", "reputation_management", "crm"],
    secondary: ["appointment_scheduler", "email_sms", "social_media_management", "meta_ads", "lead_generation"],
    advanced: ["chat_ai_agent", "voice_ai_agent", "blog_posting", "media_production"],
  },
  hvac: {
    trade: "hvac",
    primary: ["website_funnel", "seo", "google_ads", "appointment_scheduler", "reputation_management", "crm"],
    secondary: ["email_sms", "meta_ads", "social_media_management", "lead_generation"],
    advanced: ["chat_ai_agent", "voice_ai_agent", "blog_posting"],
  },
  carpentry: {
    trade: "carpentry",
    primary: ["website_funnel", "seo", "reputation_management", "social_media_management"],
    secondary: ["google_ads", "meta_ads", "crm", "lead_generation"],
    advanced: ["media_production", "blog_posting", "chat_ai_agent"],
  },
  painting: {
    trade: "painting",
    primary: ["website_funnel", "seo", "google_ads", "reputation_management", "social_media_management"],
    secondary: ["meta_ads", "crm", "email_sms", "lead_generation"],
    advanced: ["media_production", "blog_posting", "appointment_scheduler"],
  },
  plumbing: {
    trade: "plumbing",
    primary: ["website_funnel", "seo", "google_ads", "appointment_scheduler", "reputation_management", "crm"],
    secondary: ["email_sms", "lead_generation", "meta_ads"],
    advanced: ["chat_ai_agent", "voice_ai_agent", "blog_posting"],
  },
  electrical: {
    trade: "electrical",
    primary: ["website_funnel", "seo", "google_ads", "reputation_management", "crm"],
    secondary: ["appointment_scheduler", "email_sms", "lead_generation", "meta_ads"],
    advanced: ["chat_ai_agent", "voice_ai_agent", "blog_posting"],
  },
};

export function getTradeServices(trade: string): TradeServiceConfig | null {
  return TRADE_SERVICE_CONFIG[trade] ?? null;
}

// Helper: does this trade surface this service at all (any tier)?
export function tradeOffersService(trade: string, serviceId: string): boolean {
  const cfg = TRADE_SERVICE_CONFIG[trade];
  if (!cfg) return false;
  return cfg.primary.includes(serviceId)
    || cfg.secondary.includes(serviceId)
    || cfg.advanced.includes(serviceId);
}

// Helper: which tier is this service in for this trade?
export function tierForService(trade: string, serviceId: string): ServiceTier | null {
  const cfg = TRADE_SERVICE_CONFIG[trade];
  if (!cfg) return null;
  if (cfg.primary.includes(serviceId)) return "primary";
  if (cfg.secondary.includes(serviceId)) return "secondary";
  if (cfg.advanced.includes(serviceId)) return "advanced";
  return null;
}
