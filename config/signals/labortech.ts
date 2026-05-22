// LaborTech (John) — roofing contractor lead intelligence weighting.
// Config only; decay and ranking run in lib/recovery/signals (T4–T5).
// Tiers per autonomy/SIGNAL_TRUST_RULES.md §3.1. Roofing vertical only.

import type {
  RampDefinition,
  SignalConfidence,
  SignalDefinition,
  SourceTrustTier,
  WorkspaceSignalConfig,
} from "@/lib/recovery/signals/types";

/** Inverse-time ramp: dormant operator touches gain weight as silence lengthens (§5). */
export const STALE_OPERATOR_TOUCH_RAMP: RampDefinition = {
  kind: "linear",
  startDays: 90,
  endDays: 270,
  startFactor: 0.2,
  endFactor: 1,
};

type AllowedSourceTier = Exclude<SourceTrustTier, "BANNED">;

/** Workspace config fields beyond the base SignalDefinition schema. */
export type LaborTechSignalDefinition = SignalDefinition & {
  allowedSourceTiers: readonly AllowedSourceTier[];
  explanationTemplate: string;
  evidenceLabel: string;
  confidenceFloor: SignalConfidence;
  rampDefinition?: RampDefinition;
};

const LABORTECH_SIGNALS: readonly LaborTechSignalDefinition[] = [
  {
    name: "permit_pulled",
    category: "permit",
    source: "permit:shovels",
    sourceTier: "HIGH",
    defaultWeight: 95, // Ground truth — physical roofing work on the parcel is the top priority.
    defaultHalfLifeDays: 90,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Roofing-related building permit issued for this address on {observedAt} (permit {recordId}).",
    evidenceLabel: "Permit issued",
    confidenceFloor: "HIGH",
  },
  {
    name: "storm_event",
    category: "weather",
    source: "noaa:storms",
    sourceTier: "HIGH",
    defaultWeight: 93, // Storm damage in service zip drives immediate roofing demand.
    defaultHalfLifeDays: 21,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "NOAA storm event affecting this service area on {observedAt} (event {recordId}).",
    evidenceLabel: "Storm event",
    confidenceFloor: "HIGH",
  },
  {
    name: "active_google_ads",
    category: "ads",
    source: "google_ads:transparency",
    sourceTier: "HIGH",
    defaultWeight: 78, // Paid search presence shows intent; still below permit ground truth (§T3).
    defaultHalfLifeDays: 14,
    allowedSourceTiers: ["HIGH", "MED"],
    explanationTemplate:
      "Active Google Ads campaign observed on {observedAt} (transparency record {recordId}).",
    evidenceLabel: "Google Ads activity",
    confidenceFloor: "HIGH",
  },
  {
    name: "recent_business_filing",
    category: "business_filing",
    source: "sos:wa",
    sourceTier: "HIGH",
    defaultWeight: 76, // New or amended SOS filing signals business formation or change.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Secretary of State business filing recorded on {observedAt} (filing {recordId}).",
    evidenceLabel: "Business filing",
    confidenceFloor: "HIGH",
  },
  {
    name: "license_recently_issued",
    category: "licensing",
    source: "licensing:state_board",
    sourceTier: "HIGH",
    defaultWeight: 74, // Fresh contractor license supports new-operator outreach timing.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Contractor license issued or renewed on {observedAt} (license {recordId}).",
    evidenceLabel: "License issued",
    confidenceFloor: "HIGH",
  },
  {
    name: "service_area_match",
    category: "other",
    source: "territory:service_area",
    sourceTier: "MED",
    defaultWeight: 62, // Geographic fit; supports routing, not a solo headline (§3).
    defaultHalfLifeDays: 730,
    allowedSourceTiers: ["MED", "HIGH"],
    explanationTemplate:
      "Business address falls within LaborTech service territory as of {observedAt}.",
    evidenceLabel: "Service area match",
    confidenceFloor: "MED",
  },
  {
    name: "stale_operator_touch",
    category: "crm",
    source: "crm:hubspot",
    sourceTier: "HIGH",
    defaultWeight: 55, // Base weight; inverse-time ramp raises contribution as silence grows (§5).
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "No operator touch logged since {observedAt}; silence over {daysSince} days.",
    evidenceLabel: "Last operator touch",
    confidenceFloor: "HIGH",
    rampDefinition: STALE_OPERATOR_TOUCH_RAMP,
  },
  {
    name: "weak_google_rating",
    category: "places",
    source: "google_places",
    sourceTier: "HIGH",
    defaultWeight: 48, // Low rating matters for positioning; pair with high_review_count for context (§3).
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Google Business Profile rating below threshold on {observedAt} (place {recordId}).",
    evidenceLabel: "Low Google rating",
    confidenceFloor: "MED",
  },
  {
    name: "high_review_count",
    category: "places",
    source: "google_places",
    sourceTier: "HIGH",
    defaultWeight: 36, // Review volume makes a weak rating commercially meaningful; background context.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Google Business Profile review count above threshold on {observedAt} (place {recordId}).",
    evidenceLabel: "High review count",
    confidenceFloor: "MED",
  },
  {
    name: "website_quality_gap",
    category: "other",
    source: "website:quality_scan",
    sourceTier: "MED",
    defaultWeight: 30, // Supporting competitive gap; not a headline without permit or storm pressure.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["MED", "WEAK"],
    explanationTemplate:
      "Website quality scan flagged gaps on {observedAt} (scan {recordId}).",
    evidenceLabel: "Website quality gap",
    confidenceFloor: "MED",
  },
  {
    name: "missing_google_business_profile",
    category: "places",
    source: "google_places",
    sourceTier: "HIGH",
    defaultWeight: 28, // Absence of GBP is observable but secondary to market-pressure signals.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH", "MED"],
    explanationTemplate:
      "No Google Business Profile found for this business on {observedAt}.",
    evidenceLabel: "Missing Google Business Profile",
    confidenceFloor: "MED",
  },
  {
    name: "missing_ssl",
    category: "other",
    source: "website:technical_scan",
    sourceTier: "WEAK",
    defaultWeight: 22, // Technical hygiene gap; supporting only (§3).
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["WEAK", "MED"],
    explanationTemplate:
      "Website served without valid SSL certificate on {observedAt} (host {recordId}).",
    evidenceLabel: "Missing SSL",
    confidenceFloor: "WEAK",
  },
  {
    name: "missing_schema",
    category: "other",
    source: "website:technical_scan",
    sourceTier: "WEAK",
    defaultWeight: 20, // Structured-data gap; background bias, never a solo headline.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["WEAK", "MED"],
    explanationTemplate:
      "Website lacks structured schema markup on {observedAt} (scan {recordId}).",
    evidenceLabel: "Missing schema markup",
    confidenceFloor: "WEAK",
  },
  {
    name: "verified_phone",
    category: "contact_path",
    source: "crm:hubspot",
    sourceTier: "HIGH",
    defaultWeight: 18, // Reachability gates outreach; does not drive why-now ranking (§3).
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Phone number confirmed in CRM on {observedAt} (activity {recordId}).",
    evidenceLabel: "Verified phone",
    confidenceFloor: "WEAK",
  },
  {
    name: "verified_email",
    category: "contact_path",
    source: "hunter.io",
    sourceTier: "HIGH",
    defaultWeight: 18, // Verified email supports contact path; background reachability only.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Email address verified on {observedAt} (Hunter check {recordId}).",
    evidenceLabel: "Verified email",
    confidenceFloor: "WEAK",
  },
] as const;

const config: WorkspaceSignalConfig = {
  slug: "labortech",
  signals: [...LABORTECH_SIGNALS],
  ramps: {
    stale_operator_touch: STALE_OPERATOR_TOUCH_RAMP,
  },
};

export default config;

export { LABORTECH_SIGNALS };
