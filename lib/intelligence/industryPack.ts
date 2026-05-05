// Meridian — Industry Pack interface.
//
// An IndustryPack is the per-vertical configuration that drives the
// Lead Intelligence Layer. LaborTech is the first pack. The layer is
// designed so additional industries (HomePro, ServiceCloud, etc.)
// can plug in by exporting their own pack with the same shape — no
// changes to the canonical `buildLeadIntelligence` signature, the
// shared engines, or the UI consumers.
//
// Packs do NOT redefine scoring formulas; they parameterize the
// existing engines (signal labels, objection text, discovery
// questions, UI labels) so the deterministic core stays one
// codepath while messaging shifts per industry.

export interface IndustryPack {
  id: string;
  label: string;

  // Service catalog this industry supports (matches snake_case ids
  // in lib/services/serviceCatalog.ts so the existing service-bucket
  // filters keep working).
  services: string[];

  // Optional per-pack overrides. When a pack omits one of these the
  // engine's built-in tables are used as the fallback.
  scoringWeights?: Record<string, number>;
  objections?: Record<string, { objection: string; counter: string }>;
  discoveryQuestions?: Record<string, string[]>;
  whyNowLines?: Record<string, string>;
  uiLabels?: Record<string, string>;
}

// LaborTech industry pack — the first concrete pack. Its services
// list mirrors the LaborTech service stack the engine already scores.
// Per-service tables (objections / discovery questions / why-now) are
// owned by the engine in `lib/scan/serviceFit.ts` and read through
// the engine itself, so this pack stays a thin manifest.
export const LABORTECH_INDUSTRY_PACK: IndustryPack = {
  id: "labortech",
  label: "LaborTech (local services)",
  services: [
    "reputation_management",
    "seo",
    "website_funnel",
    "google_ads",
    "meta_ads",
    "social_media_management",
    "media_production",
    "voice_ai_agent",
    "chat_ai_agent",
    "appointment_scheduler",
    "crm",
    "email_sms",
    "lead_generation",
    "blog_posting",
    "mobile_app",
    "influencer_marketing",
  ],
};
