// Meridian AI — trade + service-bucket catalog.
//
// Single source of truth for which trades Meridian AI supports and which
// service buckets exist inside each trade. Designed to be the seed for
// trade-aware outreach copy, ranking bias, and operator UI filters.
//
// Scale design:
//   - Adding a new trade is a pure data edit to TRADE_CATALOG; nothing
//     else in the app should branch on a hardcoded trade string.
//   - CompanySnapshot carries optional `trade` + `serviceBucket` fields
//     (lib/state/companySnapshotStore.ts). Leads without them default
//     to TRADE_DEFAULT ("roofing") in the UI.
//   - Service buckets are short, operator-friendly labels; keep them
//     tight so the UI can render them as chips.

export type TradeKey =
  | "roofing"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "landscaping"
  | "concrete"
  | "remodeling";

export type ServiceBucket = {
  // Machine key used in data (stable, snake_case). Never renamed.
  key: string;
  // Operator-facing label.
  label: string;
  // Short pitch line a rep can paraphrase when this bucket is the angle.
  angle: string;
};

export type TradeModule = {
  key: TradeKey;
  label: string;
  // What a rep on this trade is selling, in one line.
  pitch: string;
  serviceBuckets: ServiceBucket[];
};

export const TRADE_DEFAULT: TradeKey = "roofing";

export const TRADE_CATALOG: Record<TradeKey, TradeModule> = {
  roofing: {
    key: "roofing",
    label: "Roofing",
    pitch: "Close the gap between inbound search and booked roofing jobs.",
    serviceBuckets: [
      { key: "storm_damage",    label: "Storm damage / insurance", angle: "Homeowners searching after a storm need to find you fast; visibility gaps cost insurance claims." },
      { key: "full_replacement", label: "Full replacement",        angle: "Replacement buyers research on Google; weak site presence loses them to a competitor." },
      { key: "repairs",          label: "Repairs",                 angle: "Repair buyers need an immediate phone path; funnel gaps send them to the next result." },
      { key: "commercial",       label: "Commercial roofing",      angle: "Commercial buyers vet vendors online; trust gaps disqualify you before the RFP." },
      { key: "maintenance",      label: "Maintenance",             angle: "Recurring-revenue buyers want booking friction = zero; conversion gaps kill retention." },
      { key: "gutters_exterior", label: "Gutters / exterior",      angle: "Exterior cross-sell loses momentum when the site only highlights roofs." },
    ],
  },
  hvac: {
    key: "hvac",
    label: "HVAC",
    pitch: "Capture high-intent HVAC searches and keep emergency calls from bouncing.",
    serviceBuckets: [
      { key: "new_install",      label: "New install",             angle: "New-install buyers compare 3+ quotes online; missing specs cost you the bid." },
      { key: "residential_repair", label: "Residential repair",    angle: "Repair searches are immediate; a broken contact path = call went to a competitor." },
      { key: "commercial_service", label: "Commercial service",    angle: "Facilities managers need vendor legitimacy online before they'll pick up." },
      { key: "maintenance",      label: "Maintenance agreements",  angle: "Recurring service plans need a simple online signup path; funnel gaps = churn." },
      { key: "iaq_duct",         label: "IAQ / duct / filtration", angle: "IAQ is an education sale; weak content = no cross-sell." },
      { key: "emergency",        label: "Emergency replacement",   angle: "24/7 buyers need a phone number at the top of the page; anything else loses the call." },
    ],
  },
  plumbing: {
    key: "plumbing",
    label: "Plumbing",
    pitch: "Capture urgent plumbing leads and stop losing emergency calls to competitors.",
    serviceBuckets: [
      { key: "residential_service", label: "Residential service",   angle: "Everyday repair volume comes from local search; weak SEO = thin pipeline." },
      { key: "sewer_drain",         label: "Sewer / drain",         angle: "Big-ticket sewer jobs start with a Google search; poor trust signals cost the call." },
      { key: "water_heater",        label: "Water heater",          angle: "Water-heater emergencies need an instant call path; conversion gaps lose the job." },
      { key: "commercial",          label: "Commercial plumbing",   angle: "Commercial buyers vet vendors online; missing case studies disqualify you." },
      { key: "remodel",             label: "Remodel / new construction", angle: "Builders and GCs check your site before referring; weak presence = no referrals." },
      { key: "emergency",           label: "Emergency service",     angle: "After-hours calls go to whoever's phone is on the site's top fold." },
    ],
  },
  electrical: {
    key: "electrical",
    label: "Electrical",
    pitch: "Turn local electrical searches into booked service calls.",
    serviceBuckets: [
      { key: "residential_service", label: "Residential service",   angle: "Service calls start on Google Maps; weak GBP = invisible." },
      { key: "panel_rewire",        label: "Panel / rewiring",      angle: "Panel upgrades are a $5–15K ticket; homeowners research hard before calling." },
      { key: "commercial",          label: "Commercial electrical", angle: "Commercial GCs vet vendors online; missing credentials kill the bid." },
      { key: "generator",           label: "Generator / backup",    angle: "Generator buyers plan months ahead; content gaps lose the research phase." },
      { key: "lighting",            label: "Lighting / controls",   angle: "Lighting upgrades are consultative; weak portfolio = no inquiry." },
      { key: "emergency",           label: "Emergency repair",      angle: "Emergency electrical needs 24/7 phone answer; site has to make that obvious." },
    ],
  },
  landscaping: {
    key: "landscaping",
    label: "Landscaping",
    pitch: "Build recurring maintenance revenue by capturing local landscaping search.",
    serviceBuckets: [
      { key: "maintenance",     label: "Maintenance",             angle: "Weekly/monthly contracts require zero-friction signup; funnel gaps kill LTV." },
      { key: "hardscaping",     label: "Hardscaping",             angle: "High-ticket patio/walkway work starts with portfolio search; thin site = no lead." },
      { key: "drainage",        label: "Drainage",                angle: "Drainage problems drive urgent calls; poor mobile site = lost inbound." },
      { key: "irrigation",      label: "Irrigation",              angle: "Irrigation tune-ups are recurring; weak presence = no recurring signups." },
      { key: "design_install",  label: "Design / install",        angle: "Design clients vet craftsmanship via photos; missing portfolio = no consult." },
      { key: "commercial",      label: "Commercial grounds",      angle: "Property managers need vendor legitimacy online before the RFP." },
    ],
  },
  concrete: {
    key: "concrete",
    label: "Concrete",
    pitch: "Capture high-intent concrete work searches in your market.",
    serviceBuckets: [
      { key: "driveways_patios",    label: "Driveways / patios",    angle: "Residential concrete starts with Google search; thin portfolio = no quote request." },
      { key: "foundations",         label: "Foundations",           angle: "Foundation work requires trust signals; weak site disqualifies you early." },
      { key: "flatwork",            label: "Flatwork",              angle: "Flatwork volume comes from GCs referring; they vet your site first." },
      { key: "commercial",          label: "Commercial concrete",   angle: "Commercial bids need credentials online; missing them costs the RFP." },
      { key: "repairs",             label: "Repairs",               angle: "Repair work is reactive; conversion gaps send urgent callers elsewhere." },
      { key: "decorative",          label: "Decorative concrete",   angle: "Decorative is a portfolio sale; weak image content = no inquiry." },
    ],
  },
  remodeling: {
    key: "remodeling",
    label: "Remodeling",
    pitch: "Convert high-intent remodel searches into booked consultations.",
    serviceBuckets: [
      { key: "kitchen",         label: "Kitchen",                 angle: "Kitchen buyers research for months; weak portfolio = no consult booking." },
      { key: "bathroom",        label: "Bathroom",                angle: "Bath remodels are impulse + research; gaps in either cost the lead." },
      { key: "whole_home",      label: "Whole home",              angle: "Whole-home buyers vet credibility hard; thin site = disqualified." },
      { key: "basement",        label: "Basement",                angle: "Basement finishing is ROI-driven; weak content = no clear value pitch." },
      { key: "exterior",        label: "Exterior remodel",        angle: "Exterior buyers compare neighbours' results online; no portfolio = no trust." },
      { key: "additions",       label: "Additions",               angle: "Additions are high-consideration; missing case studies = no consult request." },
    ],
  },
};

// Look up a trade module by key. Falls back to the default trade when
// the input is missing or unknown — never throws.
export function getTradeModule(key: string | undefined | null): TradeModule {
  if (!key) return TRADE_CATALOG[TRADE_DEFAULT];
  const k = key.toLowerCase() as TradeKey;
  return TRADE_CATALOG[k] ?? TRADE_CATALOG[TRADE_DEFAULT];
}

// Look up a single service bucket by trade + bucket key.
export function getServiceBucket(
  tradeKey: string | undefined | null,
  bucketKey: string | undefined | null,
): ServiceBucket | null {
  const trade = getTradeModule(tradeKey);
  if (!bucketKey) return null;
  return trade.serviceBuckets.find((b) => b.key === bucketKey) ?? null;
}

// All trade keys in display order.
export function listTradeKeys(): TradeKey[] {
  return Object.keys(TRADE_CATALOG) as TradeKey[];
}
