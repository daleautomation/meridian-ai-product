// Meridian AI — Bucket Portfolio.
//
// Pure rollup of which service angles a given trade carries and which
// of them currently have leads. Reads from existing TRADE_MODULES +
// the bucket classifier — never fabricates counts. When no leads are
// connected, every bucket reports `count: 0` and `status: "needs_source"`.

import {
  TRADE_MODULES,
  type TradeId,
  type ServiceBucketConfig,
} from "./tradeConfigs";
import {
  primaryBucketForLead,
  type ClassifierLeadLike,
} from "./bucketClassifier";

export interface BucketPortfolioEntry {
  bucketId: string;
  bucketLabel: string;
  johnServiceAngle: string;
  buyerPain: string;
  count: number;
  highConfidenceCount: number;
  status: "ready" | "needs_source";
}

/**
 * Returns one entry per declared service bucket for the trade. Counts
 * reflect how many leads in `leads` classify into that bucket as their
 * primary angle. When `leads` is empty (e.g. trade not yet connected),
 * every entry is `count: 0` / `status: "needs_source"`.
 */
export function buildBucketPortfolio(
  leads: ClassifierLeadLike[] | null | undefined,
  tradeId: TradeId,
): BucketPortfolioEntry[] {
  const cfg = TRADE_MODULES[tradeId];
  if (!cfg) return [];

  const counts = new Map<string, { count: number; high: number }>();
  if (Array.isArray(leads) && leads.length > 0) {
    for (const lead of leads) {
      if (!lead) continue;
      const primary = primaryBucketForLead(lead, tradeId);
      if (!primary) continue;
      const slot = counts.get(primary.bucketId) ?? { count: 0, high: 0 };
      slot.count += 1;
      if (primary.confidence === "high") slot.high += 1;
      counts.set(primary.bucketId, slot);
    }
  }

  return cfg.serviceBuckets.map((b: ServiceBucketConfig) => {
    const slot = counts.get(b.id) ?? { count: 0, high: 0 };
    return {
      bucketId: b.id,
      bucketLabel: b.label,
      johnServiceAngle: b.johnServiceAngle,
      buyerPain: b.buyerPain,
      count: slot.count,
      highConfidenceCount: slot.high,
      status: slot.count > 0 ? "ready" : "needs_source",
    };
  });
}
