// Meridian AI — scraped/aggregator listing → NormalizedRealEstateRecord.
//
// Handles Zillow/Redfin/Realtor-style listings with structured data,
// price history, and DOM. These have better metadata than FSBO but the
// deals are more efficient — the edge comes from stale listings, price
// reductions, and back-on-market signals.

import type { DecisionLabelType } from "@/lib/types";
import type {
  NormalizedRealEstateRecord,
  RawScrapedRealEstateListing,
} from "@/lib/ingestion/types";
import {
  computeFreshnessScore,
  detectDistressSignals,
  detectPriceReductions,
  computeDescriptionQuality,
} from "./qualityFilters";

const MAO_PERCENTAGE = 0.70;

function formatUsd(n: number | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function deriveRisk(flags: string[], dom: number | undefined): string {
  const hasMajor = flags.some((f) =>
    /foundation|structural|fire|flood|sinkhole|asbestos|mold/i.test(f)
  );
  if (hasMajor) return "High";
  const hasMinor = flags.some((f) =>
    /roof|hvac|electrical|plumbing|kitchen|bathroom/i.test(f)
  );
  if (hasMinor) return "Medium";
  if (flags.length > 0) return "Low-Med";
  return "Low";
}

function deriveLabel(score: number): { label: string; labelType: DecisionLabelType } {
  if (score >= 8.5) return { label: "ACT NOW", labelType: "green" };
  if (score >= 7.0) return { label: "STRONG BUY", labelType: "green" };
  if (score >= 5.0) return { label: "MONITOR", labelType: "amber" };
  return { label: "PASS", labelType: "red" };
}

export function normalizeScrapedListing(
  raw: RawScrapedRealEstateListing
): NormalizedRealEstateRecord | null {
  const ask = raw.listPrice;
  const arv = raw.arvEstimate ?? 0;
  if (ask <= 0) return null;

  const rehab = raw.estimatedRehabCost ?? 0;
  const mao = arv > 0 ? Math.max(0, Math.round(arv * MAO_PERCENTAGE - rehab)) : 0;
  const equityRatio = arv > 0 ? (arv - ask) / arv : 0;

  const flags = raw.riskFlags ?? [];
  const risk = deriveRisk(flags, raw.daysOnMarket);
  const riskMult = risk === "High" ? 0.4 : risk === "Medium" ? 0.7 : risk === "Low-Med" ? 0.85 : 1.0;

  // DOM bonus: stale listings get a score nudge (motivated sellers)
  const domBonus = (raw.daysOnMarket ?? 0) > 60 ? 0.5 : (raw.daysOnMarket ?? 0) > 30 ? 0.2 : 0;

  const baseScore = arv > 0 ? Math.min(equityRatio * 22 + domBonus, 10) : 3;
  const score = Math.max(0, Math.round(baseScore * riskMult * 10) / 10);
  const { label, labelType } = deriveLabel(score);

  const tag = equityRatio >= 0.35 ? "Equity Play" : equityRatio >= 0.20 ? "Flip" : "BRRRR";
  const id = raw.listingId || `scraped-${raw.address.zip}-${raw.address.street.replace(/\s+/g, "-")}`;

  const distress = detectDistressSignals(
    raw.address.street,
    raw.description,
    flags
  );
  const freshness = computeFreshnessScore(raw.listedAt);
  const priceDrops = detectPriceReductions(raw.priceHistory, ask);
  const descQuality = computeDescriptionQuality(raw.description, raw.address.street);

  // Status-aware signals
  if (raw.status === "price-reduced" && !distress.detected) {
    distress.detected = true;
    distress.keywords.push("price reduced");
    distress.score = Math.min(100, distress.score + 15);
  }
  if (raw.status === "back-on-market" && !distress.keywords.includes("back on market")) {
    distress.detected = true;
    distress.keywords.push("back on market");
    distress.score = Math.min(100, distress.score + 12);
  }

  const domStr = raw.daysOnMarket != null ? `${raw.daysOnMarket}d on market` : "";
  const priceDropStr = priceDrops.count > 0
    ? `${priceDrops.count} price drop${priceDrops.count > 1 ? "s" : ""} (${priceDrops.totalDropPct.toFixed(0)}% total)`
    : "";

  const thesis = [
    equityRatio > 0.30 ? `${Math.round(equityRatio * 100)}% equity spread.` : null,
    domStr ? `${domStr}.` : null,
    priceDropStr ? `${priceDropStr}.` : null,
    distress.detected ? `Distress signals: ${distress.keywords.slice(0, 2).join(", ")}.` : null,
  ].filter(Boolean).join(" ") || "Standard listing — verify comps.";

  const nextAction = score >= 8.5
    ? `Submit offer at $${ask.toLocaleString("en-US")}. ${domStr ? `${domStr} — seller likely flexible.` : ""}`
    : score >= 7.0
    ? `Verify comps, then engage. ${priceDropStr || ""}`
    : score >= 5.0
    ? `Monitor for further price reductions.`
    : `No action at current price.`;

  return {
    id,
    zip: raw.address.zip,
    title: raw.address.street,
    sub: `${raw.address.city}, ${raw.address.state} ${raw.address.zip}`,
    score,
    label,
    labelType,
    tag,
    arv: formatUsd(arv) || "Unknown",
    mao: formatUsd(mao) || "Unknown",
    ask: formatUsd(ask),
    risk,
    thesis,
    nextAction,
    riskFactors: flags.length > 0 ? flags.slice(0, 4) : ["No risk flags — verify independently"],
    daysOnMarket: raw.daysOnMarket,
    listingTimestamp: raw.listedAt,
    sourcePlatform: "scraped",
    sellerType: raw.agent ? "agent" : "owner",
    freshnessScore: freshness,
    listingQualityScore: descQuality.listingQualityScore,
    priceReductionCount: priceDrops.count,
    originalAsk: formatUsd(priceDrops.originalPrice),
    distressSignals: distress,
    descriptionQualityDetail: descQuality.detail,
  };
}

export function normalizeScrapedListings(
  raws: RawScrapedRealEstateListing[]
): NormalizedRealEstateRecord[] {
  return raws
    .map(normalizeScrapedListing)
    .filter((r): r is NormalizedRealEstateRecord => r !== null);
}
