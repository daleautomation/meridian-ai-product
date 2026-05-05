// Meridian AI — Trade Modules + Service Buckets.
//
// Single config-driven layer that turns Meridian into a multi-trade,
// problem-aware portfolio engine. There is exactly ONE engine; trades
// are configuration. Roofing remains the default and untouched.
//
// Pure: no I/O, no React, no stateful logic. Lookup helpers return
// stable objects so consumers can rely on identity for memoization.

export type TradeId =
  | "roofing"
  | "hvac"
  | "carpentry"
  | "painting"
  | "plumbing"
  | "electrical";

export type ServiceBucketId = string;

export interface ServiceBucketConfig {
  id: ServiceBucketId;
  label: string;
  description: string;
  buyerPain: string;
  johnServiceAngle: string;
  prioritySignals: string[];
  suggestedOpeningLine: string;
}

export interface TradeModuleConfig {
  id: TradeId;
  label: string;
  market: "kansas_city";
  description: string;
  targetCompanyProfile: string;
  searchTerms: string[];
  serviceBuckets: ServiceBucketConfig[];
}

// ── Shared bucket templates (cross-trade reuse) ────────────────────────

const SHARED_LOCAL_SEO: ServiceBucketConfig = {
  id: "local_seo_visibility",
  label: "Local SEO Visibility",
  description: "Underperforming on Kansas City local search and map pack.",
  buyerPain: "Inbound demand is going to competitors that rank for the same neighborhood + service queries.",
  johnServiceAngle: "Local-pack tightening, city + neighborhood landing pages, GBP optimization.",
  prioritySignals: [
    "weak Google Business Profile",
    "no city/neighborhood service pages",
    "low local pack ranking",
    "no service-area pages",
  ],
  suggestedOpeningLine:
    "I ran a quick local search check on you in KC and noticed three of your zip codes are getting lapped by smaller shops. Worth 60 seconds?",
};

const SHARED_REVIEW_REPUTATION: ServiceBucketConfig = {
  id: "review_reputation",
  label: "Review & Reputation",
  description: "Reviews are stale, sparse, or actively hurting close rate.",
  buyerPain: "Buyers picking between three quotes default to the company with the strongest review profile.",
  johnServiceAngle: "Review automation, response cadence, reputation cleanup.",
  prioritySignals: [
    "low star rating",
    "few total reviews",
    "old most-recent review",
    "unanswered negative reviews",
  ],
  suggestedOpeningLine:
    "Looked at your review profile vs. your top three KC competitors — there's a gap that's costing you tied bids. Quick walk-through?",
};

const SHARED_QUOTE_FUNNEL: ServiceBucketConfig = {
  id: "quote_request_funnel",
  label: "Quote Request Funnel",
  description: "Visitors arrive but the quote/contact path leaks before submit.",
  buyerPain: "Traffic is fine; the form, CTA, or phone-tap on mobile isn't converting.",
  johnServiceAngle: "Conversion-focused landing-page rebuild, mobile CTA, instant-callback form.",
  prioritySignals: [
    "no visible quote form",
    "weak primary CTA",
    "phone number buried",
    "no mobile click-to-call",
  ],
  suggestedOpeningLine:
    "Pulled your site on mobile and the path to a quote takes four taps. Most KC shops are at one. Worth a fix?",
};

const SHARED_PORTFOLIO: ServiceBucketConfig = {
  id: "portfolio_visibility",
  label: "Portfolio Visibility",
  description: "Real work is happening but the portfolio doesn't prove it.",
  buyerPain: "Without before/after proof, premium pricing collapses on a phone call.",
  johnServiceAngle: "Portfolio rebuild, project photography rotation, niche case-study pages.",
  prioritySignals: [
    "no project gallery",
    "stock-photo-only homepage",
    "no before/after pages",
    "no case studies",
  ],
  suggestedOpeningLine:
    "Your work is good — your site doesn't show it. Want a 5-minute walk through how to fix that without a full rebuild?",
};

const SHARED_SEASONAL: ServiceBucketConfig = {
  id: "seasonal_demand",
  label: "Seasonal Demand Capture",
  description: "Seasonal demand spikes hit but the business isn't positioned to absorb them.",
  buyerPain: "First-week-of-heat-wave or first-storm calls go to whoever ranks; not to whoever is best.",
  johnServiceAngle: "Seasonal landing pages, paid demand capture, dispatch readiness.",
  prioritySignals: [
    "no seasonal landing page",
    "no paid local search active",
    "no surge-capacity messaging",
    "no service-window CTA",
  ],
  suggestedOpeningLine:
    "Storm/heat-wave week is coming. Want to see what your top three KC competitors are already running for it?",
};

const SHARED_ESTIMATE_FOLLOWUP: ServiceBucketConfig = {
  id: "estimate_followup",
  label: "Estimate Follow-Up",
  description: "Quotes are going out but follow-up cadence is leaking deals.",
  buyerPain: "Buyers comparing three estimates close with whoever follows up first and most clearly.",
  johnServiceAngle: "Quote follow-up automation, day-3 / day-7 cadence, clear win-back path.",
  prioritySignals: [
    "no quote follow-up email",
    "no SMS cadence",
    "no proposal review portal",
  ],
  suggestedOpeningLine:
    "Quick question — when you send a quote, what's the day-3 follow-up look like? That's where most KC shops bleed deals.",
};

// ── Trade modules ──────────────────────────────────────────────────────

export const TRADE_MODULES: Record<TradeId, TradeModuleConfig> = {
  roofing: {
    id: "roofing",
    label: "Roofing",
    market: "kansas_city",
    description: "Residential and small-commercial roofing contractors in the KC metro.",
    targetCompanyProfile: "Owner-led roofing companies doing 50–500 jobs per year, mixed insurance + retail.",
    searchTerms: ["roofing", "roof repair", "roofer", "storm damage roofing"],
    serviceBuckets: [
      {
        id: "website_conversion",
        label: "Website Conversion",
        description: "Site is live but loses inbound visitors before quote submit.",
        buyerPain: "Storm-damage searchers won't read three paragraphs — if the CTA isn't obvious, they leave.",
        johnServiceAngle: "Conversion-tightening, mobile-first quote path, claim-flow landing pages.",
        prioritySignals: [
          "weak homepage CTA",
          "no claim-flow page",
          "slow mobile load",
          "no instant-callback form",
        ],
        suggestedOpeningLine:
          "Ran your site through a live-check and found three things costing you inbound roofing leads. Quick 60-second walkthrough?",
      },
      {
        id: "no_website_presence",
        label: "No Website Presence",
        description: "Google Places listing with no website at all.",
        buyerPain: "Buyers searching from the map pack tap once, see no site, move on.",
        johnServiceAngle: "Stand up a one-page conversion site, claim the GBP, route inbound calls.",
        prioritySignals: [
          "no website on Google Places",
          "GBP-only presence",
          "phone-only on listing",
        ],
        suggestedOpeningLine:
          "Saw your Google listing but couldn't find a website. Want a one-page site that catches the calls you're already getting?",
      },
      SHARED_LOCAL_SEO,
      SHARED_REVIEW_REPUTATION,
      {
        id: "storm_response",
        label: "Storm Response",
        description: "Storm windows open; the company isn't positioned to capture them.",
        buyerPain: "Hail/wind events spike searches for 48–72 hours; whoever ranks + answers wins.",
        johnServiceAngle: "Storm landing pages, paid search readiness, dispatch + estimator surge plan.",
        prioritySignals: [
          "no storm landing page",
          "no recent-storm posts",
          "no insurance-claim guidance",
          "no surge messaging",
        ],
        suggestedOpeningLine:
          "Last storm cell hit your zip codes hard. Want to see how your top three competitors captured that traffic?",
      },
      SHARED_ESTIMATE_FOLLOWUP,
    ],
  },

  hvac: {
    id: "hvac",
    label: "HVAC",
    market: "kansas_city",
    description: "Residential + light commercial HVAC service and install in the KC metro.",
    targetCompanyProfile: "Owner-led HVAC shops with 5–30 trucks; mix of service + install + maintenance.",
    searchTerms: ["hvac", "heating cooling", "ac repair", "furnace repair"],
    serviceBuckets: [
      SHARED_SEASONAL,
      {
        id: "emergency_service_visibility",
        label: "Emergency Service Visibility",
        description: "Emergency / 24-7 service exists but isn't visible where buyers look.",
        buyerPain: "Heat wave at 9pm: whoever ranks + answers wins; nobody's reading three pages.",
        johnServiceAngle: "Emergency landing page, GBP attributes, paid emergency search, click-to-call.",
        prioritySignals: [
          "no 24/7 messaging",
          "no emergency landing page",
          "no GBP emergency attribute",
          "phone number buried",
        ],
        suggestedOpeningLine:
          "Pulled emergency HVAC searches in your area last week — your name didn't show up in the top six. Quick fix?",
      },
      {
        id: "maintenance_memberships",
        label: "Maintenance Memberships",
        description: "Recurring revenue is being left on the table without a maintenance plan offer.",
        buyerPain: "Single-job customers churn; membership customers compound.",
        johnServiceAngle: "Membership program landing page, signup flow, retention email cadence.",
        prioritySignals: [
          "no membership/maintenance plan page",
          "no recurring offer",
          "no member portal",
        ],
        suggestedOpeningLine:
          "Most KC HVAC shops are converting 1 in 4 service calls into a maintenance member. Where are you on that?",
      },
      {
        id: "financing_visibility",
        label: "Financing Visibility",
        description: "Financing exists but isn't surfaced in the install path.",
        buyerPain: "$8K install with no financing mention closes 30% less than one with payment options.",
        johnServiceAngle: "Financing landing copy, $/mo CTA on install pages, payment calculator.",
        prioritySignals: [
          "no financing page",
          "no $/mo on install pages",
          "no payment calculator",
        ],
        suggestedOpeningLine:
          "Quick check — when you quote a furnace install, do customers see a $/month figure before they see a sticker price? That's the close-rate fix.",
      },
      SHARED_LOCAL_SEO,
    ],
  },

  carpentry: {
    id: "carpentry",
    label: "Carpentry",
    market: "kansas_city",
    description: "Custom carpentry, finish carpentry, and trim contractors in the KC metro.",
    targetCompanyProfile: "1–10 person carpentry shops doing residential remodels, trim, custom builds.",
    searchTerms: ["carpentry", "finish carpenter", "custom trim", "wood working"],
    serviceBuckets: [
      SHARED_PORTFOLIO,
      SHARED_QUOTE_FUNNEL,
      {
        id: "project_photography",
        label: "Project Photography",
        description: "Work is photogenic; photos are absent or amateur.",
        buyerPain: "Carpentry buyers buy on craft proof — bad photos make premium pricing impossible.",
        johnServiceAngle: "Photography rotation, monthly project shoot, before/after curation.",
        prioritySignals: [
          "no project photos",
          "phone-quality photos only",
          "no consistent shooting cadence",
        ],
        suggestedOpeningLine:
          "Your finish work deserves better photos than your site is showing. Want to see what one shoot a month gets you?",
      },
      SHARED_LOCAL_SEO,
      {
        id: "niche_specialty_positioning",
        label: "Niche Specialty Positioning",
        description: "Generic carpentry positioning; not winning premium specialty work.",
        buyerPain: "Buyers searching for built-ins, stair work, or millwork choose specialists.",
        johnServiceAngle: "Specialty landing pages, niche case studies, premium-positioning copy.",
        prioritySignals: [
          "no specialty service pages",
          "generic homepage copy",
          "no niche case studies",
        ],
        suggestedOpeningLine:
          "Most KC carpentry shops fight on price because they all read the same. Want to see the specialty positioning that doesn't?",
      },
    ],
  },

  painting: {
    id: "painting",
    label: "Painting",
    market: "kansas_city",
    description: "Residential, commercial, and cabinet-painting contractors in the KC metro.",
    targetCompanyProfile: "Owner-led painting companies with 3–25 crew; mix of interior, exterior, cabinet, and commercial work.",
    searchTerms: ["painting", "painter", "house painter", "cabinet painting", "commercial painting"],
    serviceBuckets: [
      {
        id: "exterior_repaint_visibility",
        label: "Exterior Repaint Visibility",
        description: "Exterior repaint demand exists; the website doesn't capture it.",
        buyerPain: "Homeowners searching exterior repaint pick whoever ranks for their neighborhood and season.",
        johnServiceAngle: "Exterior painting pages, neighborhood targeting, seasonal demand capture.",
        prioritySignals: [
          "no exterior repaint landing page",
          "no neighborhood targeting",
          "no seasonal demand copy",
        ],
        suggestedOpeningLine:
          "Exterior repaint searches in your zip codes — your name's not in the top six. Want to see the gap?",
      },
      {
        id: "cabinet_painting_demand",
        label: "Cabinet Painting Demand",
        description: "Cabinet repaint is a high-margin lane with no dedicated capture page.",
        buyerPain: "Buyers researching cabinet repaint compare before/after galleries; without yours they go elsewhere.",
        johnServiceAngle: "Cabinet repaint pages, before/after proof, estimate CTA.",
        prioritySignals: [
          "no cabinet repaint page",
          "no before/after gallery",
          "no estimate CTA",
        ],
        suggestedOpeningLine:
          "Cabinet repaint is the highest-margin lane you're not capturing online. Worth a 5-minute fix?",
      },
      {
        id: "commercial_painting_visibility",
        label: "Commercial Painting Visibility",
        description: "Commercial repaint revenue is on the table without a positioning surface for it.",
        buyerPain: "Facility managers issue annual repaint RFPs; whoever's positioned wins multi-year revenue.",
        johnServiceAngle: "Commercial repaint pages, facility manager positioning, bid request CTA.",
        prioritySignals: [
          "no commercial-painting page",
          "no facility-manager positioning",
          "no bid request CTA",
        ],
        suggestedOpeningLine:
          "Facility managers in KC do annual repaint RFPs in the spring. Where do they find you when they Google?",
      },
      {
        id: "local_seo_visibility",
        label: "Local SEO Visibility",
        description: "Underperforming on Kansas City local search and map pack for painting queries.",
        buyerPain: "Inbound demand is going to competitors that rank for the same neighborhood + service queries.",
        johnServiceAngle: "City + neighborhood painting pages, GBP optimization, review growth.",
        prioritySignals: [
          "weak Google Business Profile",
          "no city/neighborhood painting pages",
          "no schema markup",
        ],
        suggestedOpeningLine:
          "You're losing painting leads to a competitor ranking for one neighborhood you don't have a page for. Worth a quick look?",
      },
      {
        id: "reputation_proof",
        label: "Reputation & Proof",
        description: "Reviews and project photos are thin or stale relative to competitors.",
        buyerPain: "Buyers compare 3 painters on review count, recency, and project photos before they call.",
        johnServiceAngle: "Before/after gallery, reviews, project photos, trust signals.",
        prioritySignals: [
          "no before/after gallery",
          "low review count",
          "no recent project photos",
          "no trust signals",
        ],
        suggestedOpeningLine:
          "Buyers vet 3 painters on photos and reviews before calling. Your gallery is the leak. Worth a 5-minute fix?",
      },
    ],
  },

  plumbing: {
    id: "plumbing",
    label: "Plumbing",
    market: "kansas_city",
    description: "Residential + light commercial plumbing service and install in the KC metro.",
    targetCompanyProfile: "Owner-led plumbing shops with 3–20 trucks; service + install + emergency.",
    searchTerms: ["plumbing", "plumber", "drain cleaning", "water heater"],
    serviceBuckets: [
      {
        id: "emergency_service_visibility",
        label: "Emergency Service Visibility",
        description: "Burst-pipe and after-hours work exists but isn't visible where buyers look.",
        buyerPain: "Burst pipe at 11pm: whoever ranks + answers wins; nobody's reading marketing copy.",
        johnServiceAngle: "Emergency landing page, GBP attributes, paid emergency search, click-to-call.",
        prioritySignals: [
          "no 24/7 messaging",
          "no emergency landing page",
          "no GBP emergency attribute",
          "phone buried",
        ],
        suggestedOpeningLine:
          "Pulled emergency plumbing searches in your zip codes — your name didn't crack the top six. Quick fix?",
      },
      SHARED_LOCAL_SEO,
      SHARED_REVIEW_REPUTATION,
      {
        id: "service_page_gaps",
        label: "Service Page Gaps",
        description: "Service pages missing or thin for high-intent searches.",
        buyerPain: "Buyers searching 'water heater install' or 'sewer line' need a page that ranks and converts.",
        johnServiceAngle: "Per-service landing pages, schema, intent-matched CTAs.",
        prioritySignals: [
          "no per-service pages",
          "thin service descriptions",
          "no FAQ blocks",
          "no schema markup",
        ],
        suggestedOpeningLine:
          "Your 'water heater install' page doesn't exist. That's three search terms a month worth of inbound. Want to see the gap?",
      },
      SHARED_ESTIMATE_FOLLOWUP,
    ],
  },

  electrical: {
    id: "electrical",
    label: "Electrical",
    market: "kansas_city",
    description: "Residential + commercial electricians and electrical contractors in the KC metro.",
    targetCompanyProfile: "Owner-led electrical companies with 3–30 crew; service, panel upgrades, EV chargers, generators, and commercial work.",
    searchTerms: ["electrician", "electrical contractor", "panel upgrade", "EV charger", "generator install"],
    serviceBuckets: [
      {
        id: "emergency_electrical_visibility",
        label: "Emergency Electrical Visibility",
        description: "After-hours / urgent electrical demand exists but isn't visible where buyers look.",
        buyerPain: "Outage at 11pm: whoever ranks + answers wins; nobody's reading marketing copy.",
        johnServiceAngle: "Emergency electrician pages, click-to-call, after-hours service positioning.",
        prioritySignals: [
          "no 24/7 messaging",
          "no emergency landing page",
          "no GBP emergency attribute",
          "phone buried",
        ],
        suggestedOpeningLine:
          "Pulled emergency electrician searches in your zip codes — your name didn't crack the top six. Quick fix?",
      },
      {
        id: "panel_upgrade_demand",
        label: "Panel Upgrade Demand",
        description: "Panel upgrade is a high-ticket lane with no dedicated capture page.",
        buyerPain: "Homeowners researching panel upgrade compare financing and inspection terms before they call.",
        johnServiceAngle: "Panel upgrade pages, financing CTA, inspection-ready offer.",
        prioritySignals: [
          "no panel upgrade page",
          "no financing CTA",
          "no inspection-ready copy",
        ],
        suggestedOpeningLine:
          "Panel upgrade buyers want a financing CTA before they call. Yours doesn't exist. Worth a 5-minute fix?",
      },
      {
        id: "ev_charger_installation",
        label: "EV Charger Installation",
        description: "EV charger install demand is rising; no dedicated page captures it.",
        buyerPain: "Buyers search 'EV charger install' + their zip; whoever ranks wins the rebate-driven research phase.",
        johnServiceAngle: "EV charger install pages, rebate guidance, quote request CTA.",
        prioritySignals: [
          "no EV charger page",
          "no rebate guidance",
          "no quote request CTA",
        ],
        suggestedOpeningLine:
          "EV charger install searches in KC are growing every quarter. Right now you're invisible on them. Got a minute?",
      },
      {
        id: "commercial_electrical_visibility",
        label: "Commercial Electrical Visibility",
        description: "Commercial electrical revenue is on the table without a positioning surface for it.",
        buyerPain: "Facility managers vet electrical vendors online before they issue maintenance RFPs.",
        johnServiceAngle: "Commercial service pages, facility manager positioning, maintenance request CTA.",
        prioritySignals: [
          "no commercial-electrical page",
          "no facility-manager positioning",
          "no maintenance request CTA",
        ],
        suggestedOpeningLine:
          "Facility managers in KC do annual electrical maintenance RFPs. Where do they find you when they Google?",
      },
      SHARED_REVIEW_REPUTATION,
    ],
  },
};

export const TRADE_MODULE_ORDER: TradeId[] = [
  "roofing",
  "hvac",
  "carpentry",
  "painting",
  "plumbing",
  "electrical",
];

const VALID_TRADE_IDS = new Set<TradeId>(TRADE_MODULE_ORDER);

export function getTradeModule(tradeId: string | null | undefined): TradeModuleConfig {
  if (typeof tradeId === "string" && VALID_TRADE_IDS.has(tradeId as TradeId)) {
    return TRADE_MODULES[tradeId as TradeId];
  }
  return TRADE_MODULES.roofing;
}

export function getServiceBucket(
  tradeId: string | null | undefined,
  bucketId: string | null | undefined,
): ServiceBucketConfig | null {
  if (!bucketId) return null;
  const trade = getTradeModule(tradeId);
  return trade.serviceBuckets.find((b) => b.id === bucketId) ?? null;
}

export function listServiceBuckets(tradeId: string | null | undefined): ServiceBucketConfig[] {
  return getTradeModule(tradeId).serviceBuckets;
}

export function isTradeId(v: unknown): v is TradeId {
  return typeof v === "string" && VALID_TRADE_IDS.has(v as TradeId);
}
