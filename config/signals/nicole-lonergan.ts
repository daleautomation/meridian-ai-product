// Brookside Real Estate (Nicole Lonergan) — residential signal weighting.
// Config only; decay and ranking run in lib/recovery/signals (T4–T5).
// Tiers per autonomy/SIGNAL_TRUST_RULES.md §3.1.

import type {
  RampDefinition,
  SignalCategory,
  SignalConfidence,
  SignalDefinition,
  SourceTrustTier,
  WorkspaceSignalConfig,
} from "@/lib/recovery/signals/types";

/** Inverse-time ramp: dormant relationships gain weight as silence lengthens (§5). */
export const STALE_RELATIONSHIP_RAMP: RampDefinition = {
  kind: "linear",
  startDays: 180,
  endDays: 365,
  startFactor: 0.15,
  endFactor: 1,
};

type AllowedSourceTier = Exclude<SourceTrustTier, "BANNED">;

/** Workspace config fields beyond the base SignalDefinition schema. */
export type BrooksideSignalDefinition = SignalDefinition & {
  allowedSourceTiers: readonly AllowedSourceTier[];
  explanationTemplate: string;
  evidenceLabel: string;
  /** Minimum confidence for this signal to anchor a card headline (§3, §6). */
  confidenceFloor: SignalConfidence;
  rampDefinition?: RampDefinition;
};

const BROOKSIDE_SIGNALS: readonly BrooksideSignalDefinition[] = [
  {
    name: "seller_probability",
    category: "public_record",
    source: "county_recorder:king_wa",
    sourceTier: "HIGH",
    defaultWeight: 95, // Highest — seller-side public-record movement is the brokerage priority.
    defaultHalfLifeDays: 90,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Recorded seller-side activity on this property (deed transfer, notice of default, or mortgage release) dated {observedAt}.",
    evidenceLabel: "County recorder filing",
    confidenceFloor: "HIGH",
  },
  {
    name: "nod_filing",
    category: "public_record",
    source: "county_recorder:king_wa",
    sourceTier: "HIGH",
    defaultWeight: 90, // Distress filings often precede a listing conversation.
    defaultHalfLifeDays: 90,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Notice of default filed on the property on {observedAt} (recorder instrument {recordId}).",
    evidenceLabel: "Notice of default",
    confidenceFloor: "HIGH",
  },
  {
    name: "mortgage_release",
    category: "mortgage",
    source: "county_recorder:king_wa",
    sourceTier: "HIGH",
    defaultWeight: 88, // Release can signal payoff and a potential move or sale.
    defaultHalfLifeDays: 90,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Mortgage satisfaction or release recorded on {observedAt} (instrument {recordId}).",
    evidenceLabel: "Mortgage release",
    confidenceFloor: "HIGH",
  },
  {
    name: "permit_pulled",
    category: "permit",
    source: "permit:shovels",
    sourceTier: "HIGH",
    defaultWeight: 82, // Physical work on the parcel; useful for timing outreach.
    defaultHalfLifeDays: 90,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Building permit issued for this address on {observedAt} (permit {recordId}).",
    evidenceLabel: "Permit issued",
    confidenceFloor: "HIGH",
  },
  {
    name: "neighborhood_comparable_sale",
    category: "listing",
    source: "mls:idx",
    sourceTier: "MED",
    defaultWeight: 72, // Nearby comp closes support a market-timing call, not a solo headline.
    defaultHalfLifeDays: 180,
    allowedSourceTiers: ["MED", "HIGH"],
    explanationTemplate:
      "Comparable sale within the neighborhood closed on {observedAt} (MLS {recordId}).",
    evidenceLabel: "Nearby comparable sale",
    confidenceFloor: "MED",
  },
  {
    name: "prior_client_recency",
    category: "relationship",
    source: "crm:hubspot",
    sourceTier: "HIGH",
    defaultWeight: 70, // Past clients with recent closing dates are warm re-engagement.
    defaultHalfLifeDays: 1095,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Prior client relationship; last closed transaction recorded on {observedAt}.",
    evidenceLabel: "Prior client closing",
    confidenceFloor: "HIGH",
  },
  {
    name: "crm_interest_signal",
    category: "crm",
    source: "crm:hubspot",
    sourceTier: "HIGH",
    defaultWeight: 65, // Operator-logged interest in CRM is the customer's own truth.
    defaultHalfLifeDays: 180,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "CRM activity logged on {observedAt}: {recordId}.",
    evidenceLabel: "CRM activity",
    confidenceFloor: "HIGH",
  },
  {
    name: "stale_relationship",
    category: "relationship",
    source: "crm:hubspot",
    sourceTier: "HIGH",
    defaultWeight: 58, // Base weight; inverse-time ramp raises contribution as silence grows (§5).
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "No meaningful touch since {observedAt}; relationship cooling over {daysSince} days.",
    evidenceLabel: "Last touch date",
    confidenceFloor: "HIGH",
    rampDefinition: STALE_RELATIONSHIP_RAMP,
  },
  {
    name: "investor_indicator",
    category: "public_record",
    source: "county_recorder:king_wa",
    sourceTier: "WEAK",
    defaultWeight: 28, // Ownership pattern hint only — cannot headline without a HIGH signal (§3).
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["WEAK", "MED"],
    explanationTemplate:
      "Ownership or transfer pattern consistent with investor activity on {observedAt} (instrument {recordId}).",
    evidenceLabel: "Ownership pattern",
    confidenceFloor: "WEAK",
  },
  {
    name: "repeat_client_probability",
    category: "relationship",
    source: "crm:hubspot",
    sourceTier: "WEAK",
    defaultWeight: 22, // Repeat-engagement pattern from CRM history; background bias only (§3).
    defaultHalfLifeDays: 730,
    allowedSourceTiers: ["WEAK", "HIGH"],
    explanationTemplate:
      "Multiple prior transactions with this contact; last engagement on {observedAt}.",
    evidenceLabel: "Repeat client history",
    confidenceFloor: "WEAK",
  },
  {
    name: "verified_email",
    category: "contact_path",
    source: "hunter.io",
    sourceTier: "HIGH",
    defaultWeight: 18, // Reachability supports outreach; not a standalone why-now (§3).
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Email address verified on {observedAt} (Hunter check {recordId}).",
    evidenceLabel: "Verified email",
    confidenceFloor: "WEAK",
  },
  {
    name: "verified_phone",
    category: "contact_path",
    source: "crm:hubspot",
    sourceTier: "HIGH",
    defaultWeight: 18, // Confirmed phone on file; background reachability only.
    defaultHalfLifeDays: 365,
    allowedSourceTiers: ["HIGH"],
    explanationTemplate:
      "Phone number confirmed in CRM on {observedAt} (activity {recordId}).",
    evidenceLabel: "Verified phone",
    confidenceFloor: "WEAK",
  },
] as const;

const config: WorkspaceSignalConfig = {
  slug: "nicole-lonergan",
  signals: [...BROOKSIDE_SIGNALS],
  ramps: {
    stale_relationship: STALE_RELATIONSHIP_RAMP,
  },
};

export default config;

export { BROOKSIDE_SIGNALS };
