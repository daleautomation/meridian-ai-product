// Meridian AI — portfolio-aware context engine.
//
// Pure functions. Given a list of items + total budget + already-allocated
// capital, recomputes capitalContext / urgency on each item's acquisitionPlan
// to reflect the live capital position.
//
// Rules (deterministic):
//   1. cost > remaining           → last-slot, urgency=passive (cannot deploy)
//   2. only viable item in budget → anchor, urgency=act-now ("LAST viable")
//   3. cost > 70% of remaining    → anchor, urgency bumped one tier
//   4. existing last-slot         → urgency stepped down (reinforce conservative)
//   5. existing anchor + capital partially committed → reasoning prefix only
//
// All adjustments PREPEND a "Portfolio: …" prefix to negotiationReasoning so
// the AI naturally surfaces the portfolio framing when citing the plan.
//
// What's NOT touched: price ladder (opening/target/ceiling), trust locks,
// hardCeiling. Portfolio reshapes urgency and context, never the math.

import type { DecisionItem } from "@/lib/types";

const URGENCY_UP: Record<string, string> = {
  passive: "this-month",
  "this-month": "this-week",
  "this-week": "act-now",
  "act-now": "act-now",
};

const URGENCY_DOWN: Record<string, string> = {
  "act-now": "this-week",
  "this-week": "this-month",
  "this-month": "passive",
  passive: "passive",
};

export type PortfolioSummary = {
  totalBudget: number;
  allocated: number;
  remaining: number;
  actionableInBudget: number;
};

export function applyPortfolioContext(
  items: DecisionItem[],
  totalBudget: number,
  allocatedCapital: number
): { items: DecisionItem[]; portfolio: PortfolioSummary } {
  const remaining = totalBudget - allocatedCapital;

  // Count items that are actionable (non-red label) AND fit in remaining capital
  const actionableInBudget = items.filter(
    (i) =>
      i.acquisitionPlan != null &&
      i.labelType !== "red" &&
      typeof i.buyPriceUsd === "number" &&
      i.buyPriceUsd > 0 &&
      i.buyPriceUsd <= remaining
  );

  const updated = items.map((item) => {
    if (!item.acquisitionPlan) return item;
    const cost = item.buyPriceUsd;
    if (typeof cost !== "number" || cost <= 0) return item;

    const plan = { ...item.acquisitionPlan };
    let portfolioNote: string | null = null;

    if (cost > remaining) {
      // Cannot afford
      plan.capitalContext = "last-slot";
      plan.urgency = "passive";
      portfolioNote = `Portfolio: cost $${cost.toLocaleString("en-US")} exceeds remaining capital $${Math.max(0, remaining).toLocaleString("en-US")}. Cannot deploy without freeing up another position first.`;
    } else if (
      actionableInBudget.length === 1 &&
      actionableInBudget[0].id === item.id
    ) {
      // LAST viable opportunity
      plan.capitalContext = "anchor";
      plan.urgency = "act-now";
      portfolioNote = `Portfolio: LAST viable deal in $${remaining.toLocaleString("en-US")} remaining capital. No fallback in pipeline — commit now or lose the slot.`;
    } else if (cost > remaining * 0.7) {
      // Big position relative to remaining
      plan.capitalContext = "anchor";
      plan.urgency = (URGENCY_UP[plan.urgency] ?? plan.urgency) as typeof plan.urgency;
      portfolioNote = `Portfolio: deploys ${Math.round((cost / remaining) * 100)}% of remaining $${remaining.toLocaleString("en-US")}. This is an anchor commitment — full conviction or skip.`;
    } else if (plan.capitalContext === "last-slot") {
      // Reinforce conservative posture
      plan.urgency = (URGENCY_DOWN[plan.urgency] ?? plan.urgency) as typeof plan.urgency;
      portfolioNote = `Portfolio: low-priority slot in pipeline; $${remaining.toLocaleString("en-US")} of capital available with stronger alternatives elsewhere. Don't push hard here.`;
    } else if (plan.capitalContext === "anchor" && allocatedCapital > 0) {
      // Anchor in active pipeline
      portfolioNote = `Portfolio: anchor deal in active pipeline ($${allocatedCapital.toLocaleString("en-US")} already in motion). Commit fully — top priority for remaining capital.`;
    }

    if (portfolioNote) {
      plan.negotiationReasoning = `${portfolioNote} ${plan.negotiationReasoning}`;
    }

    return { ...item, acquisitionPlan: plan };
  });

  return {
    items: updated,
    portfolio: {
      totalBudget,
      allocated: allocatedCapital,
      remaining,
      actionableInBudget: actionableInBudget.length,
    },
  };
}

// Sum lastOfferSent across active negotiations (not rejected/walked).
export function computeAllocatedFromStore(
  store: Record<
    string,
    { negotiationState: { sellerResponse: string }; lastOfferSent?: number }
  >
): number {
  let allocated = 0;
  for (const stored of Object.values(store)) {
    const sr = stored.negotiationState.sellerResponse;
    if (sr === "rejected") continue;
    if (typeof stored.lastOfferSent === "number" && stored.lastOfferSent > 0) {
      allocated += stored.lastOfferSent;
    }
  }
  return allocated;
}
