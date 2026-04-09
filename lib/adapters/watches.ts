// Meridian AI — watches data adapter.
//
// Tenant-aware: filters records by ownerId. Each watch belongs to a single
// user's portfolio.
//
// Data source: data/watches.json (read on every request — fine for personal
// scale; add caching if you scale beyond a single user). The file shape is
// fact-only: you enter buyPrice, marketPrice, liquidity, and optionally a
// per-watch friction override. The adapter derives net margin, annualized
// return, capital tier, max-buy ceiling, score, and buy signal via
// lib/scoring/watches.
//
// Phase 2 swap target: when you wire eBay Browse API, replace readDataset()
// with the API call. Adapter signature stays the same — DecisionItem[] out.

import path from "node:path";
import type { DecisionItem } from "@/lib/types";
import type { NormalizedWatchRecord } from "@/lib/ingestion/types";
import { loadWatchesFromFile } from "@/lib/ingestion/watches/loader";
import {
  type Liquidity,
  type CapitalTier,
  type BuySignal,
  isLiquidity,
  netSpread as computeNetSpread,
  netMarginPct as computeNetMarginPct,
  annualizedReturn as computeAnnualized,
  capitalTier as computeCapitalTier,
  maxBuyPrice as computeMaxBuy,
  buySignal as computeBuySignal,
  score as computeScore,
  capitalNote as computeCapitalNote,
  labelType as computeLabelType,
  DEFAULT_FRICTION_RATE,
  TARGET_NET_MARGIN,
  HOLD_DAYS_BY_LIQUIDITY,
} from "@/lib/scoring/watches";
import {
  computeTrust,
  applyTrustDowngrade,
  formatTrustLine,
} from "@/lib/scoring/trust";
import {
  computeWatchesAcquisition,
  evolveAcquisitionPlan,
} from "@/lib/scoring/acquisition";
import { computeWatchValuation } from "@/lib/scoring/valuation";
import { getAllNegotiations } from "@/lib/state/negotiationStore";
import {
  applyPortfolioContext,
  computeAllocatedFromStore,
} from "@/lib/scoring/portfolioContext";

const WATCHES_DEFAULT_BUDGET = 30000;

// Deterministic friction inference. The "friction" rate is the slice of market
// price you actually surrender to fees + payment costs + shipping when you
// resell. It varies by exit channel (which is roughly inferred from where you
// SOURCED the piece, since dealers buying from peers usually re-list on the
// same tier of platform) and by liquidity (slow movers eat more storage,
// insurance, and price-cut friction over their longer hold).
//
// Anchored against real flip cycles. Anything not in the table falls back to
// the engine default.
const PLATFORM_FRICTION: Record<string, number> = {
  chrono24: 0.075,
  watchbox: 0.06,
  crown_and_caliber: 0.07,
  hodinkee_shop: 0.08,
  bobs_watches: 0.07,
  watchfinder: 0.075,
  ebay: 0.13,
  watchuseek: 0.05,
  watchcharts: 0.06,
  facebook_marketplace: 0.04,
  craigslist: 0.04,
  instagram_dm: 0.04,
  telegram: 0.04,
};

function inferFriction(
  sourcePlatform: string | undefined,
  liquidity: Liquidity
): number {
  const base =
    sourcePlatform && PLATFORM_FRICTION[sourcePlatform] !== undefined
      ? PLATFORM_FRICTION[sourcePlatform]
      : DEFAULT_FRICTION_RATE;
  // Slow movers carry extra holding friction (storage, insurance, price cuts).
  const liquidityAdj = liquidity === "Low" ? 0.015 : liquidity === "High" ? -0.005 : 0;
  return Math.max(0, Math.min(0.2, base + liquidityAdj));
}

// Use the centralized normalized type from the ingestion layer.
// data/watches.json conforms to NormalizedWatchRecord exactly.
type WatchRecord = NormalizedWatchRecord;

const DATA_PATH = path.join(process.cwd(), "data", "watches.json");

async function readDataset(): Promise<WatchRecord[]> {
  return loadWatchesFromFile(DATA_PATH, { source: "normalized" });
}

function formatUSD(n: number | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatNetMargin(spread: number, pct: number): string | undefined {
  if (!Number.isFinite(spread) || !Number.isFinite(pct)) return undefined;
  const sign = spread >= 0 ? "+" : "-";
  const absDelta = Math.abs(Math.round(spread)).toLocaleString("en-US");
  return `${sign}$${absDelta} net (${pct.toFixed(1)}%)`;
}

function formatPlatformMetrics(args: {
  annualized: number;
  holdDays: number;
  capital: CapitalTier;
  maxBuy: number;
  signal: BuySignal;
}): string {
  const { annualized, holdDays, capital, maxBuy, signal } = args;
  const annStr =
    annualized > 0
      ? `${Math.round(annualized)}% annualized`
      : `${annualized.toFixed(0)}% annualized`;
  const line1 = `${annStr}  ·  ${holdDays}d hold  ·  max @ 10% net $${maxBuy.toLocaleString("en-US")}`;
  const line2 = `Position: ${capital}  ·  ${computeCapitalNote(signal, capital)}`;
  return `${line1}\n${line2}`;
}

function toDecisionItem(r: WatchRecord): DecisionItem {
  const liquidity: Liquidity = isLiquidity(r.liquidity) ? r.liquidity : "Med";
  // Friction precedence: explicit per-record override → deterministic
  // platform+liquidity inference → engine default.
  const friction =
    typeof r.friction === "number" && r.friction >= 0 && r.friction < 0.5
      ? r.friction
      : inferFriction(r.sourcePlatform, liquidity);

  const haveBoth =
    typeof r.buyPrice === "number" &&
    typeof r.marketPrice === "number" &&
    r.buyPrice > 0;

  const buy = r.buyPrice ?? 0;
  const rawMarket = r.marketPrice ?? 0;

  // ── VALUATION (source-aware) ────────────────────────────────────────
  // Replace the raw market anchor with a confidence-adjusted fair value
  // before any margin math runs. Stale / weakly comped data lowers the
  // working anchor and feeds the confidence gate downstream.
  const valuation = haveBoth ? computeWatchValuation(r) : null;
  const market = valuation ? valuation.estimatedFairValue : rawMarket;

  const spread = haveBoth ? computeNetSpread(buy, market, friction) : 0;
  const netPct = haveBoth ? computeNetMarginPct(buy, market, friction) : 0;
  const holdDays = HOLD_DAYS_BY_LIQUIDITY[liquidity];
  const annualized = haveBoth ? computeAnnualized(netPct, holdDays) : 0;
  const capital: CapitalTier = haveBoth ? computeCapitalTier(buy) : "Small";
  const maxBuy = haveBoth ? computeMaxBuy(market, friction, TARGET_NET_MARGIN) : 0;

  const economicSignal: BuySignal = haveBoth
    ? computeBuySignal(netPct, spread, annualized, capital, liquidity)
    : "MONITOR";

  // ── TRUST / SCAM-FILTER LAYER ─────────────────────────────────────────
  const trust = computeTrust({
    title: r.title,
    buyPrice: r.buyPrice,
    marketPrice: r.marketPrice,
    sourcePlatform: r.sourcePlatform,
    sellerName: r.sellerName,
    sellerFeedbackScore: r.sellerFeedbackScore,
    sellerFeedbackCount: r.sellerFeedbackCount,
    sellerAccountAgeMonths: r.sellerAccountAgeMonths,
    paymentMethod: r.paymentMethod,
    authenticityGuarantee: r.authenticityGuarantee,
    escrowAvailable: r.escrowAvailable,
    boxPapers: r.boxPapers,
    serviceHistory: r.serviceHistory,
    serialProvided: r.serialProvided,
    listingQualityScore: r.listingQualityScore,
    priceTooGoodToBeTrue: r.priceTooGoodToBeTrue,
    notes: r.notes,
  });
  const signal = applyTrustDowngrade(economicSignal, trust);
  const trustNote = formatTrustLine(trust);
  // Score reflects economic conviction. Hard rejects collapse it to 0 so the
  // scam doesn't visually rank above legitimate deals.
  const itemScore = trust.hardReject
    ? 0
    : haveBoth
    ? computeScore(annualized)
    : 0;
  const labelClr = computeLabelType(signal);

  // platformMetrics holds the economic summary only. Trust info now lives in
  // its own first-class section in the detail panel via trustScore/trustTier/
  // trustReasons fields, so embedding it here would duplicate it in the UI.
  const platformMetrics = haveBoth
    ? formatPlatformMetrics({ annualized, holdDays, capital, maxBuy, signal: economicSignal })
    : undefined;

  return {
    id: r.id,
    title: r.title,
    sub: r.sub,
    score: itemScore,
    label: signal,                                    // ← serves as the buy signal field
    labelType: labelClr,
    tag: r.tag,
    arv: formatUSD(r.buyPrice),                       // → "Price"
    mao: formatUSD(r.marketPrice),                    // → "Market"
    ask: haveBoth ? formatNetMargin(spread, netPct) : undefined,  // → "Margin" (NET)
    risk: liquidity,                                  // → "Liquidity"
    nextAction: r.nextAction,
    riskFactors: r.riskFactors,
    thesis: r.thesis,
    platformMetrics,
    maxBuyPrice: haveBoth ? maxBuy : undefined,
    riskAdjustedReturn: haveBoth ? Math.round(annualized * 10) / 10 : undefined,
    buyPriceUsd: haveBoth ? buy : undefined,
    expectedNetDollar: haveBoth ? Math.round(spread) : undefined,
    trustScore: trust.score,
    trustTier: trust.tier,
    trustNote,
    trustReasons: trust.reasons,
    valuation: valuation ?? undefined,
    ...(haveBoth
      ? (() => {
          const plan = computeWatchesAcquisition({
            signal,
            buyPrice: buy,
            maxBuy,
            liquidity,
            trustScore: trust.score,
            capital,
            score: itemScore,
            netMarginPct: netPct,
            annualized,
            confidenceScore: valuation?.confidenceScore,
            fragilityScore: valuation?.fragilityScore,
            fragilityFlags: valuation?.fragilityFlags,
            tag: r.tag,
            boxPapers: r.boxPapers,
            serviceHistory: r.serviceHistory ?? undefined,
            sellerFeedbackCount: r.sellerFeedbackCount,
          });
          return plan ? { acquisitionPlan: plan } : {};
        })()
      : {}),
  };
}

export async function loadWatchesItems(userId: string): Promise<DecisionItem[]> {
  if (!userId) return [];
  const dataset = await readDataset();
  const negStore = await getAllNegotiations();
  const allocated = computeAllocatedFromStore(negStore);

  // 1. Build base items from the economic + trust + acquisition engines.
  let items = dataset
    .filter((r) => r && r.ownerId === userId)
    .map(toDecisionItem)
    .sort((a, b) => b.score - a.score);

  // 2. Apply persisted negotiation state per item — auto-age the time field
  //    from lastUpdated, then evolve the plan.
  items = items.map((item) => {
    const stored = negStore[String(item.id)];
    if (!stored || !item.acquisitionPlan) return item;

    const lastUpdatedMs = new Date(stored.lastUpdated).getTime();
    const elapsedHours = Number.isFinite(lastUpdatedMs)
      ? Math.max(0, (Date.now() - lastUpdatedMs) / (1000 * 60 * 60))
      : 0;
    const adjustedState = {
      ...stored.negotiationState,
      timeSinceLastActionHours:
        (stored.negotiationState.timeSinceLastActionHours ?? 0) + elapsedHours,
    };

    const evolved = evolveAcquisitionPlan(
      item.acquisitionPlan as Parameters<typeof evolveAcquisitionPlan>[0],
      adjustedState
    );

    return {
      ...item,
      acquisitionPlan: evolved,
      negotiationState: {
        currentPhase: stored.negotiationState.currentPhase,
        lastActionTaken: stored.negotiationState.lastActionTaken,
        sellerResponse: stored.negotiationState.sellerResponse,
        timeSinceLastActionHours: Math.round(adjustedState.timeSinceLastActionHours * 10) / 10,
        sellerCounterPrice: stored.negotiationState.sellerCounterPrice,
        lastOfferSent: stored.lastOfferSent,
        lastUpdated: stored.lastUpdated,
      },
    };
  });

  // 3. Apply portfolio context — reshape capitalContext / urgency based on
  //    total budget and what's already in active negotiations.
  const result = applyPortfolioContext(items, WATCHES_DEFAULT_BUDGET, allocated);
  return result.items;
}
