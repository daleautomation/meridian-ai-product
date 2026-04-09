// Meridian AI — watches scoring engine.
//
// Real-world dealer math, not headline-margin theatre. Every metric the
// engine produces is what hits Dylan's bank account, not what's quoted on a
// listing page.
//
// Pure functions, no I/O. Inputs: buyPrice, marketPrice, liquidity, optional
// friction override. Outputs: net margin, annualized return, capital tier,
// max buy ceiling, buy signal, score.
//
// Calibrated against real flip cycles:
//   - 8% blended transaction friction (eBay 13%, Chrono24 6.5%, dealer 3%, cash 0%)
//   - High liquidity = 14-day flip (Sub, GMT, Daytona, RO Sport)
//   - Med liquidity  = 45-day flip (Speedy, Cartier, most steel sport)
//   - Low liquidity  = 120-day flip (dress, vintage, no-papers, oddities)
//   - Net spread <$200 → PASS regardless (transaction friction wins)
//   - Net <0% → AVOID
//   - Capital >Mid penalizes the buy signal (concentrated positions need more conviction)

import type { DecisionLabelType } from "@/lib/types";

export type Liquidity = "High" | "Med" | "Low";
export type MarginGrade = "Elite" | "Strong" | "Acceptable" | "Thin" | "Underwater";
export type BuySignal = "STRONG BUY" | "BUY" | "MONITOR" | "PASS" | "AVOID";
export type CapitalTier = "Micro" | "Small" | "Mid" | "Large";

export const DEFAULT_FRICTION_RATE = 0.08;
export const TARGET_NET_MARGIN = 0.10;
export const MIN_NET_SPREAD_USD = 200;

export const HOLD_DAYS_BY_LIQUIDITY: Record<Liquidity, number> = {
  High: 14,
  Med: 45,
  Low: 120,
};

const CAPITAL_TIER_BREAKS: Record<CapitalTier, number> = {
  Micro: 5000,
  Small: 15000,
  Mid: 30000,
  Large: Infinity,
};

// Larger positions need more conviction. The buy signal divides annualized
// return by this multiplier before thresholding — so a Large position needs
// 1.4× the annualized return of a Small one to earn the same signal tier.
const CAPITAL_CONVICTION_MULT: Record<CapitalTier, number> = {
  Micro: 1.0,
  Small: 1.0,
  Mid: 1.15,
  Large: 1.4,
};

export function isLiquidity(v: unknown): v is Liquidity {
  return v === "High" || v === "Med" || v === "Low";
}

// ── Margin math ───────────────────────────────────────────────────────────

export function netSpread(buy: number, market: number, friction: number): number {
  if (!Number.isFinite(buy) || !Number.isFinite(market)) return 0;
  return market * (1 - friction) - buy;
}

export function netMarginPct(buy: number, market: number, friction: number): number {
  if (!Number.isFinite(buy) || buy <= 0) return 0;
  return (netSpread(buy, market, friction) / buy) * 100;
}

export function marginGrade(netPct: number): MarginGrade {
  if (netPct < 0) return "Underwater";
  if (netPct < 4) return "Thin";
  if (netPct < 9) return "Acceptable";
  if (netPct < 16) return "Strong";
  return "Elite";
}

// ── Time-adjusted return ──────────────────────────────────────────────────

export function annualizedReturn(netMarginPctValue: number, holdDays: number): number {
  if (holdDays <= 0) return 0;
  return netMarginPctValue * (365 / holdDays);
}

// ── Capital ───────────────────────────────────────────────────────────────

export function capitalTier(buy: number): CapitalTier {
  if (!Number.isFinite(buy) || buy <= 0) return "Small";
  if (buy < CAPITAL_TIER_BREAKS.Micro) return "Micro";
  if (buy < CAPITAL_TIER_BREAKS.Small) return "Small";
  if (buy < CAPITAL_TIER_BREAKS.Mid) return "Mid";
  return "Large";
}

// ── Negotiation ceiling ───────────────────────────────────────────────────

// Max price you can pay to still hit the target net margin after friction.
// Use this as your hard counter-ceiling when negotiating.
export function maxBuyPrice(
  market: number,
  friction: number,
  targetNetMargin: number
): number {
  if (!Number.isFinite(market) || market <= 0) return 0;
  return Math.floor((market * (1 - friction)) / (1 + targetNetMargin));
}

// ── Buy signal ────────────────────────────────────────────────────────────

// Liquidity-sensitive MONITOR thresholds. Slow-moving pieces have a longer
// hold so the same gross margin produces a lower annualized return — they
// deserve a slightly lower MONITOR bar. Fast pieces clear the engine too
// easily on thin margin so they get a slightly higher bar.
//
// STRONG BUY (200) and BUY (100) thresholds are uniform — those tiers
// require absolute conviction regardless of liquidity.
const MONITOR_THRESHOLD_BY_LIQUIDITY: Record<Liquidity, number> = {
  High: 35,
  Med: 25,
  Low: 18,
};

export function buySignal(
  netMarginPctValue: number,
  netDollarSpread: number,
  annualizedPct: number,
  capital: CapitalTier,
  liquidity: Liquidity = "Med"
): BuySignal {
  if (netMarginPctValue < 0) return "AVOID";
  if (netDollarSpread < MIN_NET_SPREAD_USD) return "PASS";
  const adjusted = annualizedPct / CAPITAL_CONVICTION_MULT[capital];
  if (adjusted >= 200) return "STRONG BUY";
  if (adjusted >= 100) return "BUY";
  if (adjusted >= MONITOR_THRESHOLD_BY_LIQUIDITY[liquidity]) return "MONITOR";
  return "PASS";
}

// ── Score (visual ring 0–10) ─────────────────────────────────────────────

// Sqrt curve gives a more visually balanced 0–10 distribution than linear.
// 30% annualized → 3.2, 100% → 5.9, 200% → 8.3, 300% → 10.0
export function score(annualizedPct: number): number {
  if (annualizedPct <= 0) return 0;
  const raw = Math.sqrt(annualizedPct) / 1.7;
  return Math.round(Math.min(raw, 10) * 10) / 10;
}

// ── Capital allocation framing ────────────────────────────────────────────

export function capitalNote(signal: BuySignal, tier: CapitalTier): string {
  if (signal === "STRONG BUY") {
    if (tier === "Large") return "Anchor — only if book has dry powder";
    if (tier === "Mid") return "Anchor — clear runway first";
    return "Anchor — deploy in full";
  }
  if (signal === "BUY") {
    if (tier === "Large") return "Position trade — size for concentration risk";
    if (tier === "Mid") return "Position trade — sized allocation";
    return "Position trade — full allocation if book has room";
  }
  if (signal === "MONITOR") {
    return "Watch — re-engage on price drop or condition update";
  }
  if (signal === "PASS") {
    return "Skip — capital better elsewhere";
  }
  return "Walk away — net negative or below friction floor";
}

// ── Color mapping ─────────────────────────────────────────────────────────

export function labelType(signal: BuySignal): DecisionLabelType {
  if (signal === "STRONG BUY" || signal === "BUY") return "green";
  if (signal === "MONITOR") return "amber";
  return "red"; // PASS, AVOID
}

// Execution and negotiation logic now lives in lib/scoring/acquisition.ts as
// a single unified `computeWatchesAcquisition` function. This file retains
// only the pure economic scoring (signal, score, margin grade, capital tier).
