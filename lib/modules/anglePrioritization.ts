// Meridian AI — Service Angle Prioritization.
//
// Pure ranker. Reads a BucketPortfolioEntry[] for a trade and produces a
// LaborTech-flavored priority list: Focus Now / Build Next / Monitor.
// Same input → same output. No I/O. No fabricated data.

import type { BucketPortfolioEntry } from "./bucketPortfolio";
import type { TradeId } from "./tradeConfigs";

export type AnglePriorityLabel = "Focus Now" | "Build Next" | "Monitor";

export interface PrioritizedServiceAngle {
  bucketId: string;
  bucketLabel: string;
  priorityRank: number;        // 0-based, lower = higher priority
  priorityLabel: AnglePriorityLabel;
  reason: string;
  count: number;
  highConfidenceCount: number;
  johnServiceAngle: string;
}

// Core sales wedges per trade — these get "Build Next" promotion when
// they have zero leads, because they are LaborTech's strongest pitch
// surface for that trade and worth seeding first.
const CORE_WEDGES: Record<TradeId, ReadonlySet<string>> = {
  roofing: new Set([
    "website_conversion",
    "local_seo_visibility",
    "review_reputation",
  ]),
  hvac: new Set([
    "emergency_service_visibility",
    "seasonal_demand",
    "maintenance_memberships",
  ]),
  carpentry: new Set([
    "portfolio_visibility",
    "quote_request_funnel",
    "local_seo_visibility",
  ]),
  painting: new Set([
    "exterior_repaint_visibility",
    "cabinet_painting_demand",
    "commercial_painting_visibility",
  ]),
  plumbing: new Set([
    "emergency_service_visibility",
    "local_seo_visibility",
    "service_page_gaps",
  ]),
  electrical: new Set([
    "emergency_electrical_visibility",
    "panel_upgrade_demand",
    "ev_charger_installation",
  ]),
};

// Per-trade overrides. Returning null falls back to the generic logic.
function tradeSpecificClassify(
  entry: BucketPortfolioEntry,
  tradeId: TradeId,
): { label: AnglePriorityLabel; reason: string } | null {
  if (tradeId === "roofing") {
    switch (entry.bucketId) {
      case "website_conversion":
        if (entry.count > 0) {
          return {
            label: "Focus Now",
            reason: "Roofers with site/CTA gaps are the cleanest LaborTech pitch.",
          };
        }
        return null;
      case "local_seo_visibility":
        if (entry.count > 0) {
          return {
            label: "Focus Now",
            reason: "Local-pack and review-volume gaps — fastest path to inbound roofing volume.",
          };
        }
        return null;
      case "review_reputation":
        if (entry.count > 0) {
          return {
            label: "Focus Now",
            reason: "Reviews are the trust gate before the call. Pitch reviews automation.",
          };
        }
        return null;
      case "no_website_presence":
        if (entry.count > 0) {
          return {
            label: "Focus Now",
            reason: "Listings with no website convert fastest into a paid one-pager.",
          };
        }
        return null;
      case "storm_response":
        if (entry.count > 0) {
          return {
            label: "Build Next",
            reason: "Storm-positioned roofers — set up a storm landing page before next event.",
          };
        }
        return null;
      case "estimate_followup":
        if (entry.count > 0) {
          return {
            label: "Build Next",
            reason: "Estimates flow but follow-up cadence is leaking deals.",
          };
        }
        return null;
      default:
        return null;
    }
  }
  if (tradeId === "hvac") {
    switch (entry.bucketId) {
      case "emergency_service_visibility":
        if (entry.count > 0) {
          return {
            label: "Focus Now",
            reason: "Emergency HVAC searches are the highest-intent buyer surface.",
          };
        }
        return null;
      case "local_seo_visibility":
        if (entry.count > 0 && entry.highConfidenceCount > 0) {
          return {
            label: "Focus Now",
            reason: "High-confidence local-pack gaps — fastest path to inbound HVAC volume.",
          };
        }
        return null;
      case "review_reputation":
        if (entry.count >= 3) {
          return {
            label: "Focus Now",
            reason: "Several HVAC leads have reputation gaps — pitch reviews automation.",
          };
        }
        return null;
      case "seasonal_demand":
        if (entry.count > 0) {
          return {
            label: "Build Next",
            reason: "Seasonal HVAC demand — set up paid + landing pages before the next cycle.",
          };
        }
        return null;
      case "maintenance_memberships":
        // Always Build Next — recurring revenue wedge LaborTech can sell into.
        return {
          label: "Build Next",
          reason: "Recurring-revenue wedge. Pitch a membership program once leads land.",
        };
      case "financing_visibility":
        if (entry.count === 0 || entry.highConfidenceCount === 0) {
          return {
            label: "Build Next",
            reason: "Financing copy lifts install close-rates — surface monthly pricing.",
          };
        }
        return null;
      default:
        return null;
    }
  }
  return null;
}

function classify(
  entry: BucketPortfolioEntry,
  isCoreWedge: boolean,
): { label: AnglePriorityLabel; reason: string } {
  // Focus Now — has at least one high-confidence lead OR five+ total.
  if (entry.count > 0 && entry.highConfidenceCount > 0) {
    return {
      label: "Focus Now",
      reason: `${entry.highConfidenceCount} high-confidence lead${entry.highConfidenceCount === 1 ? "" : "s"} already classified here.`,
    };
  }
  if (entry.count >= 5) {
    return {
      label: "Focus Now",
      reason: `${entry.count} leads already classified here — work this angle first.`,
    };
  }
  // Build Next — has leads but low confidence, OR is a core wedge with
  // no leads yet (worth seeding because LaborTech sells through it).
  if (entry.count > 0) {
    return {
      label: "Build Next",
      reason: `${entry.count} lead${entry.count === 1 ? "" : "s"} here — build evidence before pushing volume.`,
    };
  }
  if (isCoreWedge) {
    return {
      label: "Build Next",
      reason: "Core sales wedge for this trade. Seed leads to activate.",
    };
  }
  return {
    label: "Monitor",
    reason: "No leads yet. Watch as the portfolio grows.",
  };
}

const LABEL_RANK: Record<AnglePriorityLabel, number> = {
  "Focus Now": 0,
  "Build Next": 1,
  "Monitor": 2,
};

export function prioritizeServiceAngles(
  bucketPortfolio: BucketPortfolioEntry[] | null | undefined,
  tradeId: TradeId,
): PrioritizedServiceAngle[] {
  if (!Array.isArray(bucketPortfolio) || bucketPortfolio.length === 0) return [];
  const wedges = CORE_WEDGES[tradeId] ?? new Set<string>();

  const enriched = bucketPortfolio.map((b) => {
    const isCore = wedges.has(b.bucketId);
    const override = tradeSpecificClassify(b, tradeId);
    const { label, reason } = override ?? classify(b, isCore);
    return { entry: b, isCore, label, reason };
  });

  // Sort: priority label rank → count desc → high-confidence count desc
  // → core wedges first → bucketId for stability.
  enriched.sort((a, b) => {
    const ar = LABEL_RANK[a.label] - LABEL_RANK[b.label];
    if (ar !== 0) return ar;
    if (b.entry.count !== a.entry.count) return b.entry.count - a.entry.count;
    if (b.entry.highConfidenceCount !== a.entry.highConfidenceCount) {
      return b.entry.highConfidenceCount - a.entry.highConfidenceCount;
    }
    if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
    return a.entry.bucketId.localeCompare(b.entry.bucketId);
  });

  return enriched.map((row, i) => ({
    bucketId: row.entry.bucketId,
    bucketLabel: row.entry.bucketLabel,
    priorityRank: i,
    priorityLabel: row.label,
    reason: row.reason,
    count: row.entry.count,
    highConfidenceCount: row.entry.highConfidenceCount,
    johnServiceAngle: row.entry.johnServiceAngle,
  }));
}
