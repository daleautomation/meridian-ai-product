// GET /api/watches/allocate?budget=20000
//
// Tenant-aware capital allocation for the watches module. Loads the user's
// pipeline via the watches adapter, runs the allocation engine, returns the
// optimal subset as JSON. Requires the watches module on the user's account.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadWatchesItems } from "@/lib/adapters/watches";
import { allocateCapital } from "@/lib/scoring/allocation";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.modules.includes("watches")) {
    return NextResponse.json(
      { error: "Watches module not enabled for this account" },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const budgetParam = url.searchParams.get("budget");
  const budget = budgetParam ? Number(budgetParam) : 20000;

  if (!Number.isFinite(budget) || budget <= 0) {
    return NextResponse.json(
      { error: "Invalid budget query param — must be a positive number" },
      { status: 400 }
    );
  }

  const items = await loadWatchesItems(user.id);
  const result = allocateCapital(budget, items);

  return NextResponse.json({
    budget: result.budget,
    totalCost: result.totalCost,
    budgetRemaining: result.budgetRemaining,
    expectedDollarProfit: result.expectedDollarProfit,
    portfolioAnnualized: result.portfolioAnnualized,
    algorithm: result.algorithm,
    candidatesEvaluated: result.candidatesEvaluated,
    selected: result.selected.map(item => ({
      id: item.id,
      title: item.title,
      label: item.label,
      buyPriceUsd: item.buyPriceUsd,
      expectedNetDollar: item.expectedNetDollar,
      riskAdjustedReturn: item.riskAdjustedReturn,
      liquidity: item.risk,
      trustTier: item.trustTier,
      trustScore: item.trustScore,
    })),
    excluded: result.excluded.map(item => ({
      id: item.id,
      title: item.title,
      label: item.label,
      reason:
        item.label === "PASS" || item.label === "AVOID"
          ? "signal"
          : item.buyPriceUsd && item.buyPriceUsd > result.budget
          ? "over-budget"
          : (item.expectedNetDollar ?? 0) <= 0
          ? "non-positive-profit"
          : "missing-data",
    })),
    notes: result.notes,
  });
}
