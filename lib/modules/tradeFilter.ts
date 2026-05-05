// Meridian AI — Trade-aware lead filter.
//
// Pure, deterministic. Given an arbitrary lead list and a selected trade,
// returns only the leads that genuinely belong to that trade. Roofing
// is the historical default, so leads with no trade field still flow
// through when roofing is selected. Every other trade requires an
// explicit match — we never recycle roofing data as "HVAC leads."

import type { TradeId } from "./tradeConfigs";

interface LeadWithTrade {
  tradeId?: string | null;
  trade?: string | null;
  category?: string | null;
  serviceType?: string | null;
}

function readTradeField(l: LeadWithTrade): string | null {
  const raw = l.tradeId ?? l.trade ?? l.category ?? l.serviceType ?? null;
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/**
 * Returns the subset of leads that belong to `selectedTradeId`. Leads
 * without any trade field are only kept when roofing is selected
 * (existing single-trade callers stay unaffected). Never mutates the
 * input array.
 */
export function filterLeadsForTrade<L extends LeadWithTrade>(
  leads: L[] | null | undefined,
  selectedTradeId: TradeId | string,
): L[] {
  if (!Array.isArray(leads)) return [];
  const target = String(selectedTradeId).toLowerCase();
  return leads.filter((l) => {
    if (!l) return false;
    const t = readTradeField(l);
    if (t == null) {
      // Roofing only inherits the legacy "untagged" leads — every other
      // trade must match explicitly.
      return target === "roofing";
    }
    return t === target;
  });
}

/**
 * True when the selected trade has zero matching leads in the supplied
 * pool. Used to decide whether to show the trade-source empty state.
 */
export function leadsForTradeAreEmpty<L extends LeadWithTrade>(
  leads: L[] | null | undefined,
  selectedTradeId: TradeId | string,
): boolean {
  return filterLeadsForTrade(leads, selectedTradeId).length === 0;
}
