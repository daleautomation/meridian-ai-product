// Meridian AI — Opportunity Bucket Action Config.
//
// Single declarative source of truth for the user-facing language and
// tier assignment of every bucket. The classifier still owns *what* a
// bucket means and how it scores; this file owns *how the user sees
// it*. UI components consume this — they never decide tiers or copy.
//
// Each entry is keyed by `bucketId` (the same id the classifier emits
// and `tradeConfigs.ts` declares). Entries can be globally shared or
// per-trade overridden via `BUCKET_ACTION_OVERRIDES`.
//
// Tiers map 1:1 onto the existing prioritization labels:
//   "call_first"   ← Focus Now
//   "set_up_next"  ← Build Next
//   "wait"         ← Monitor
// `bucketTierFromPriorityLabel` makes the mapping explicit so the
// existing prioritization engine remains the authority. UI copy comes
// from this config; ranking still comes from the engine.

import type { TradeId } from "./tradeConfigs";

export type BucketTier = "call_first" | "set_up_next" | "wait";

export interface BucketAction {
  /** Stable bucket id, matches classifier output and trade config. */
  id: string;
  /** Action-based label shown to the operator. Always reads as a verb. */
  actionLabel: string;
  /** One-line plain-English description. No system language. */
  description: string;
  /** Default tier when no per-trade override + no leads to inform. The
   *  prioritization engine can still override this at runtime via the
   *  bucket's priorityLabel; this is the UI fallback when the trade is
   *  empty or the engine hasn't classified the bucket yet. */
  defaultTier: BucketTier;
}

// ── Default labels per bucketId (cross-trade) ────────────────────────────
// Every bucketId declared in any trade in tradeConfigs.ts has an entry
// here. If new buckets land in the classifier, the UI degrades to the
// label provided by the engine but the *tier* will fall back to
// `set_up_next` until the config is updated.

export const BUCKET_ACTIONS: Record<string, BucketAction> = {
  // Roofing-leaning, but reusable
  website_conversion: {
    id: "website_conversion",
    actionLabel: "Fix their website",
    description: "Their site makes it hard to request a quote.",
    defaultTier: "call_first",
  },
  no_website_presence: {
    id: "no_website_presence",
    actionLabel: "No website at all",
    description: "Listed on Google with no website — easy first sale.",
    defaultTier: "call_first",
  },
  local_seo_visibility: {
    id: "local_seo_visibility",
    actionLabel: "Show up on Google",
    description: "Buyers search nearby and they don't show up.",
    defaultTier: "call_first",
  },
  review_reputation: {
    id: "review_reputation",
    actionLabel: "Fix their reviews",
    description: "Reviews are killing them before the call ever happens.",
    defaultTier: "set_up_next",
  },
  storm_response: {
    id: "storm_response",
    actionLabel: "Win storm jobs",
    description: "Storm money closes in 48 hours and they're missing the window.",
    defaultTier: "set_up_next",
  },
  estimate_followup: {
    id: "estimate_followup",
    actionLabel: "Follow up on their quotes",
    description: "Quotes go out, no one follows up — deals walk.",
    defaultTier: "wait",
  },

  // HVAC + plumbing
  emergency_service_visibility: {
    id: "emergency_service_visibility",
    actionLabel: "Win emergency calls",
    description: "Emergency searches go to whoever shows up first — not them.",
    defaultTier: "call_first",
  },
  seasonal_demand: {
    id: "seasonal_demand",
    actionLabel: "Get ready for the next season",
    description: "Demand cycle is coming and they're not ready for it.",
    defaultTier: "set_up_next",
  },
  maintenance_memberships: {
    id: "maintenance_memberships",
    actionLabel: "Sell a maintenance plan",
    description: "Recurring revenue is sitting on the table.",
    defaultTier: "set_up_next",
  },
  financing_visibility: {
    id: "financing_visibility",
    actionLabel: "Show monthly pricing",
    description: "Buyers want a $/month, they only see a sticker price.",
    defaultTier: "wait",
  },
  service_page_gaps: {
    id: "service_page_gaps",
    actionLabel: "Add missing service pages",
    description: "High-intent searches hit pages that don't exist.",
    defaultTier: "set_up_next",
  },

  // Carpentry + landscaping
  portfolio_visibility: {
    id: "portfolio_visibility",
    actionLabel: "Show off their work",
    description: "The work is good — the portfolio doesn't prove it.",
    defaultTier: "set_up_next",
  },
  quote_request_funnel: {
    id: "quote_request_funnel",
    actionLabel: "Make quoting easier",
    description: "Visitors land, then bail before the quote.",
    defaultTier: "call_first",
  },
  project_photography: {
    id: "project_photography",
    actionLabel: "Better project photos",
    description: "Real projects, amateur photos.",
    defaultTier: "wait",
  },
  niche_specialty_positioning: {
    id: "niche_specialty_positioning",
    actionLabel: "Sell their specialty",
    description: "Their specialty work reads like everyone else's.",
    defaultTier: "set_up_next",
  },
  commercial_maintenance: {
    id: "commercial_maintenance",
    actionLabel: "Win property-manager work",
    description: "Property managers send RFPs to whoever they remember — they don't.",
    defaultTier: "set_up_next",
  },

  // Painting
  exterior_repaint_visibility: {
    id: "exterior_repaint_visibility",
    actionLabel: "Capture exterior repaint demand",
    description: "Neighborhood repaint demand exists, but the site doesn't capture it.",
    defaultTier: "set_up_next",
  },
  cabinet_painting_demand: {
    id: "cabinet_painting_demand",
    actionLabel: "Stand up a cabinet repaint page",
    description: "Highest-margin lane with no dedicated capture page.",
    defaultTier: "set_up_next",
  },
  commercial_painting_visibility: {
    id: "commercial_painting_visibility",
    actionLabel: "Position for commercial RFPs",
    description: "Facility managers issue annual repaint RFPs; positioning wins multi-year work.",
    defaultTier: "set_up_next",
  },
  reputation_proof: {
    id: "reputation_proof",
    actionLabel: "Strengthen before/after proof",
    description: "Buyers vet on photos and reviews; the gallery is the leak.",
    defaultTier: "wait",
  },
};

// ── Per-trade overrides ─────────────────────────────────────────────────
// Same bucket can carry slightly different urgency in different trades.
// HVAC `seasonal_demand` is more urgent before a wave than landscaping's
// off-season. Tier override here is honored only when the engine has
// not produced its own priority label.

export const BUCKET_ACTION_OVERRIDES: Partial<Record<TradeId, Record<string, Partial<BucketAction>>>> = {
  hvac: {
    seasonal_demand: { defaultTier: "call_first" },
    maintenance_memberships: {
      actionLabel: "Sell a service plan",
    },
  },
  plumbing: {
    emergency_service_visibility: { defaultTier: "call_first" },
  },
  electrical: {
    emergency_electrical_visibility: { defaultTier: "call_first" },
    panel_upgrade_demand: { defaultTier: "set_up_next" },
    ev_charger_installation: { defaultTier: "set_up_next" },
  },
  painting: {
    cabinet_painting_demand: { defaultTier: "call_first" },
  },
  roofing: {
    storm_response: { defaultTier: "call_first" },
  },
};

// ── Public lookup helpers ────────────────────────────────────────────────

/** Resolve the action config for a given bucket + trade. Falls back to
 *  a generic placeholder when the config has no entry, so a brand-new
 *  bucket id from the classifier still renders without crashing. */
export function resolveBucketAction(bucketId: string, tradeId: TradeId, fallbackLabel?: string): BucketAction {
  const base = BUCKET_ACTIONS[bucketId];
  const override = BUCKET_ACTION_OVERRIDES[tradeId]?.[bucketId];
  if (!base) {
    return {
      id: bucketId,
      actionLabel: fallbackLabel ?? bucketId,
      description: "Real gap on this lead — you can sell into it.",
      defaultTier: "set_up_next",
    };
  }
  return { ...base, ...(override ?? {}) };
}

/** Map prioritization engine labels onto bucket tiers. The engine is
 *  the runtime authority; this is just a translation layer. */
export function bucketTierFromPriorityLabel(priorityLabel: string | null | undefined): BucketTier | null {
  if (priorityLabel === "Focus Now") return "call_first";
  if (priorityLabel === "Build Next") return "set_up_next";
  if (priorityLabel === "Monitor") return "wait";
  return null;
}

/** Operator-facing tier titles. UI never reads tier IDs directly. */
export const TIER_TITLES: Record<BucketTier, string> = {
  call_first: "Call first",
  set_up_next: "Set up next",
  wait: "Wait",
};

export const TIER_SUBTITLES: Record<BucketTier, string> = {
  call_first: "Money sitting on the phone right now.",
  set_up_next: "Set these up while leads roll in.",
  wait: "Quiet today. Check back as more leads come in.",
};

export const TIER_ORDER: BucketTier[] = ["call_first", "set_up_next", "wait"];
