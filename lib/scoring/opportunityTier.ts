// Meridian AI — opportunity tier + capital slot classification.
//
// Assigns display tier and capital deployment slot to each DecisionItem.
// Used for UI grouping only — does NOT affect scoring, trust, or decisions.
//
// Tiers:
//   ACTION    — EXECUTE_NOW, EXECUTE_CONTROLLED
//   SECONDARY — PROBE, or STRONG BUY / BUY without acquisition plan
//   MONITOR   — WAIT, MONITOR-labeled items with score >= 5
//   LOW       — PASS, AVOID, WALK, everything else
//
// Capital slots (within ACTION tier only):
//   PRIMARY   — top item that fits within remaining capital
//   BACKUP    — next item that fits
//   OVERFLOW  — actionable but exceeds available capital

import type { DecisionItem } from "@/lib/types";

export type OpportunityTier = "ACTION" | "SECONDARY" | "MONITOR" | "LOW";
export type CapitalSlot = "PRIMARY" | "BACKUP" | "OVERFLOW";

export function classifyTier(item: DecisionItem): OpportunityTier {
  const action = item.acquisitionPlan?.decision?.dominantAction;

  if (action === "EXECUTE_NOW" || action === "EXECUTE_CONTROLLED") return "ACTION";
  if (action === "PROBE") return "SECONDARY";
  if (action === "WAIT") return "MONITOR";

  // Items without acquisition plans — use label + score
  const label = (item.label || "").toUpperCase();
  if (label === "STRONG BUY" || label === "BUY") return "SECONDARY";
  if ((label === "MONITOR" || label === "WATCH") && item.score >= 5) return "MONITOR";

  return "LOW";
}

/**
 * Assign capital deployment slots to ACTION-tier items.
 * Walks items in score order, filling PRIMARY then BACKUP within budget.
 * Does NOT change scoring or tier — purely a display annotation.
 */
function assignCapitalSlots(
  items: DecisionItem[],
  budget: number
): DecisionItem[] {
  let remaining = budget;
  let primaryFilled = false;
  let backupFilled = false;

  return items.map((item) => {
    if (item.opportunityTier !== "ACTION") return item;

    const cost = item.buyPriceUsd ?? item.acquisitionPlan?.openingOffer ?? 0;
    if (cost <= 0) {
      return { ...item, executableNow: false, capitalSlot: "OVERFLOW" as CapitalSlot };
    }

    if (!primaryFilled && cost <= remaining) {
      primaryFilled = true;
      remaining -= cost;
      return { ...item, executableNow: true, capitalSlot: "PRIMARY" as CapitalSlot };
    }

    if (!backupFilled && cost <= remaining) {
      backupFilled = true;
      remaining -= cost;
      return { ...item, executableNow: true, capitalSlot: "BACKUP" as CapitalSlot };
    }

    return { ...item, executableNow: false, capitalSlot: "OVERFLOW" as CapitalSlot };
  });
}

/**
 * Tag all items with opportunity tier, capital slot, and sort.
 * Does not filter — all items are returned.
 */
export function applyOpportunityTiers(
  items: DecisionItem[],
  budget?: number
): DecisionItem[] {
  const TIER_RANK: Record<OpportunityTier, number> = {
    ACTION: 0,
    SECONDARY: 1,
    MONITOR: 2,
    LOW: 3,
  };

  const tagged = items
    .map((item) => ({
      ...item,
      opportunityTier: classifyTier(item),
    }))
    .sort((a, b) => {
      const tierDiff = TIER_RANK[a.opportunityTier!] - TIER_RANK[b.opportunityTier!];
      if (tierDiff !== 0) return tierDiff;
      if (b.score !== a.score) return b.score - a.score;
      const ap = a.freshnessPriority === "HIGH" ? 1 : 0;
      const bp = b.freshnessPriority === "HIGH" ? 1 : 0;
      return bp - ap;
    });

  // Apply capital slots if budget is known
  if (typeof budget === "number" && budget > 0) {
    return assignCapitalSlots(tagged, budget);
  }
  return tagged;
}
