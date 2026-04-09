// Meridian AI — capital allocation engine.
//
// Given a fixed budget and a current pipeline of DecisionItem records, picks
// the optimal subset of items to deploy capital into. Pure functions, no I/O,
// no external deps. Deterministic — same inputs always produce the same
// allocation.
//
// Optimization target: maximize liquidity-weighted expected dollar profit
// across the selected subset, subject to total cost ≤ budget. Liquidity
// weighting encodes the dealer reality that fast capital rotation beats
// slower trades at the same headline return.
//
// Algorithm:
//   - Filter: drop items missing buyPriceUsd / expectedNetDollar, with
//     non-positive expected return, or with PASS/AVOID buy signal.
//   - Brute force 0/1 knapsack for N ≤ 22 (exact optimum, ≤4M subsets).
//   - Greedy fallback by value-per-dollar for N > 22.
//
// Today this engine is general-purpose but is currently only meaningful for
// the watches module (which is the only adapter populating buyPriceUsd /
// expectedNetDollar / liquidity-as-risk). Future modules can opt in by
// populating the same fields.

import type { DecisionItem } from "@/lib/types";

const LIQUIDITY_WEIGHT: Record<string, number> = {
  High: 1.0,
  Med: 0.85,
  Low: 0.65,
};

const EXCLUDED_SIGNALS = new Set(["PASS", "AVOID"]);
const MAX_BRUTE_FORCE_N = 22;

type Candidate = {
  item: DecisionItem;
  cost: number;
  dollarProfit: number;
  annualized: number;
  weightedScore: number;
};

export type AllocationResult = {
  budget: number;
  selected: DecisionItem[];
  excluded: DecisionItem[];
  totalCost: number;
  budgetRemaining: number;
  expectedDollarProfit: number;
  portfolioAnnualized: number; // capital-weighted
  candidatesEvaluated: number;
  algorithm: "brute-force" | "greedy" | "none";
  notes: string[];
};

export function allocateCapital(
  budget: number,
  items: DecisionItem[]
): AllocationResult {
  const notes: string[] = [];

  if (!Number.isFinite(budget) || budget <= 0) {
    return emptyResult(budget, items, ["Invalid budget — must be a positive number."], "none");
  }
  if (!Array.isArray(items) || items.length === 0) {
    return emptyResult(budget, [], ["Empty pipeline — nothing to allocate."], "none");
  }

  const candidates: Candidate[] = [];
  const excluded: DecisionItem[] = [];

  for (const item of items) {
    const cost = item.buyPriceUsd;
    const dollarProfit = item.expectedNetDollar;
    const annualized = item.riskAdjustedReturn ?? 0;
    const signal = item.label;

    if (typeof cost !== "number" || cost <= 0) { excluded.push(item); continue; }
    if (typeof dollarProfit !== "number" || dollarProfit <= 0) { excluded.push(item); continue; }
    if (signal && EXCLUDED_SIGNALS.has(signal)) { excluded.push(item); continue; }
    if (cost > budget) { excluded.push(item); continue; }

    const liquidityMult = LIQUIDITY_WEIGHT[item.risk ?? ""] ?? 0.75;
    candidates.push({
      item,
      cost,
      dollarProfit,
      annualized,
      weightedScore: dollarProfit * liquidityMult,
    });
  }

  if (candidates.length === 0) {
    notes.push("No eligible candidates after filtering by signal, profitability, and budget.");
    return { ...emptyResult(budget, items, notes, "none"), excluded };
  }

  let chosen: Candidate[];
  let algorithm: "brute-force" | "greedy";
  if (candidates.length <= MAX_BRUTE_FORCE_N) {
    chosen = bruteForceKnapsack(candidates, budget);
    algorithm = "brute-force";
    notes.push(`Optimal subset across ${1 << candidates.length} possible combinations.`);
  } else {
    chosen = greedyKnapsack(candidates, budget);
    algorithm = "greedy";
    notes.push(`Greedy heuristic (${candidates.length} candidates exceeds brute-force cap of ${MAX_BRUTE_FORCE_N}).`);
  }

  const totalCost = chosen.reduce((s, c) => s + c.cost, 0);
  const expectedDollarProfit = chosen.reduce((s, c) => s + c.dollarProfit, 0);
  const portfolioAnnualized =
    totalCost > 0
      ? chosen.reduce((s, c) => s + c.cost * c.annualized, 0) / totalCost
      : 0;

  return {
    budget,
    selected: chosen.map(c => c.item),
    excluded,
    totalCost: Math.round(totalCost),
    budgetRemaining: Math.round(budget - totalCost),
    expectedDollarProfit: Math.round(expectedDollarProfit),
    portfolioAnnualized: Math.round(portfolioAnnualized * 10) / 10,
    candidatesEvaluated: candidates.length,
    algorithm,
    notes,
  };
}

function emptyResult(
  budget: number,
  excluded: DecisionItem[],
  notes: string[],
  algorithm: "brute-force" | "greedy" | "none"
): AllocationResult {
  return {
    budget,
    selected: [],
    excluded,
    totalCost: 0,
    budgetRemaining: budget,
    expectedDollarProfit: 0,
    portfolioAnnualized: 0,
    candidatesEvaluated: 0,
    algorithm,
    notes,
  };
}

function bruteForceKnapsack(candidates: Candidate[], budget: number): Candidate[] {
  const n = candidates.length;
  let bestMask = 0;
  let bestScore = -Infinity;

  for (let mask = 0; mask < (1 << n); mask++) {
    let cost = 0;
    let score = 0;
    let overBudget = false;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        cost += candidates[i].cost;
        if (cost > budget) { overBudget = true; break; }
        score += candidates[i].weightedScore;
      }
    }
    if (!overBudget && score > bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }

  const subset: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    if (bestMask & (1 << i)) subset.push(candidates[i]);
  }
  return subset;
}

function greedyKnapsack(candidates: Candidate[], budget: number): Candidate[] {
  const sorted = [...candidates].sort(
    (a, b) => b.weightedScore / b.cost - a.weightedScore / a.cost
  );
  const chosen: Candidate[] = [];
  let remaining = budget;
  for (const c of sorted) {
    if (c.cost <= remaining) {
      chosen.push(c);
      remaining -= c.cost;
    }
  }
  return chosen;
}
