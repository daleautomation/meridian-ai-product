// Meridian AI — Portfolio Stack.
//
// Pure aggregator: groups a set of leads by trade, then by primary
// service bucket. Used today only for dev diagnostics; ready for a
// future small UI surface without backend work.

import {
  TRADE_MODULE_ORDER,
  TRADE_MODULES,
  isTradeId,
  type TradeId,
} from "./tradeConfigs";
import {
  primaryBucketForLead,
  type ClassifierLeadLike,
} from "./bucketClassifier";

export interface PortfolioBucketEntry {
  bucketId: string;
  bucketLabel: string;
  count: number;
  highConfidenceCount: number;
  exampleLeadIds: string[];
}

export interface PortfolioStackEntry {
  tradeId: TradeId;
  tradeLabel: string;
  totalLeads: number;
  buckets: PortfolioBucketEntry[];
}

interface PortfolioLeadLike extends ClassifierLeadLike {
  id?: string | number | null;
  key?: string | number | null;
  tradeId?: string | null;
  trade?: string | null;
  category?: string | null;
}

function leadIdOf(l: PortfolioLeadLike): string | null {
  const raw = l.id ?? l.key ?? null;
  if (raw == null) return null;
  return String(raw);
}

function pickTrade(l: PortfolioLeadLike, fallback: TradeId): TradeId {
  const raw = l.tradeId ?? l.trade ?? l.category ?? null;
  return isTradeId(raw) ? raw : fallback;
}

export function buildPortfolioStack(
  leads: PortfolioLeadLike[] | null | undefined,
  tradeIds?: TradeId[],
): PortfolioStackEntry[] {
  if (!Array.isArray(leads) || leads.length === 0) return [];

  const allowed = new Set<TradeId>(
    Array.isArray(tradeIds) && tradeIds.length > 0 ? tradeIds : TRADE_MODULE_ORDER,
  );

  // tradeId → bucketId → entry
  const byTrade = new Map<TradeId, Map<string, PortfolioBucketEntry>>();
  const totalsByTrade = new Map<TradeId, number>();

  for (const lead of leads) {
    if (!lead) continue;
    const trade = pickTrade(lead, "roofing");
    if (!allowed.has(trade)) continue;

    totalsByTrade.set(trade, (totalsByTrade.get(trade) ?? 0) + 1);

    const primary = primaryBucketForLead(lead, trade);
    if (!primary) continue;

    const tradeBuckets = byTrade.get(trade) ?? new Map<string, PortfolioBucketEntry>();
    const existing = tradeBuckets.get(primary.bucketId);
    const cfg = TRADE_MODULES[trade].serviceBuckets.find((b) => b.id === primary.bucketId);
    const label = cfg?.label ?? primary.bucketId;
    const leadId = leadIdOf(lead);

    if (existing) {
      existing.count += 1;
      if (primary.confidence === "high") existing.highConfidenceCount += 1;
      if (leadId && existing.exampleLeadIds.length < 5) existing.exampleLeadIds.push(leadId);
    } else {
      tradeBuckets.set(primary.bucketId, {
        bucketId: primary.bucketId,
        bucketLabel: label,
        count: 1,
        highConfidenceCount: primary.confidence === "high" ? 1 : 0,
        exampleLeadIds: leadId ? [leadId] : [],
      });
    }
    byTrade.set(trade, tradeBuckets);
  }

  const out: PortfolioStackEntry[] = [];
  for (const trade of TRADE_MODULE_ORDER) {
    if (!allowed.has(trade)) continue;
    const total = totalsByTrade.get(trade) ?? 0;
    if (total === 0) continue;
    const bucketsMap = byTrade.get(trade) ?? new Map();
    const buckets = Array.from(bucketsMap.values()).sort((a, b) => b.count - a.count);
    out.push({
      tradeId: trade,
      tradeLabel: TRADE_MODULES[trade].label,
      totalLeads: total,
      buckets,
    });
  }

  return out;
}
