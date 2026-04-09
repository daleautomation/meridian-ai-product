// Meridian AI — real-estate data adapter.
//
// Tenant-aware: filters records by the caller's allowed ZIPs (user.geo).
// Internal records carry a `zip` tag for filtering; the adapter strips it
// before returning DecisionItem[] so the shell never sees adapter internals.
//
// Today the dataset is an inline mock. Replace REAL_ESTATE_DATASET with a
// DB / HTTP call when the live pipeline is ready — the adapter signature
// stays the same.

import path from "node:path";
import type { DecisionItem } from "@/lib/types";
import type { NormalizedRealEstateRecord } from "@/lib/ingestion/types";
import { loadRealEstateFromFile } from "@/lib/ingestion/realEstate/loader";
import {
  computeRealEstateAcquisition,
  evolveAcquisitionPlan,
} from "@/lib/scoring/acquisition";
import { computeRealEstateValuation } from "@/lib/scoring/valuation";
import { getAllNegotiations } from "@/lib/state/negotiationStore";
import {
  applyPortfolioContext,
  computeAllocatedFromStore,
} from "@/lib/scoring/portfolioContext";

const REAL_ESTATE_DEFAULT_BUDGET = 400000;
const DATA_PATH = path.join(process.cwd(), "data", "real-estate.json");

// Use the centralized normalized type from the ingestion layer.
// data/real-estate.json conforms to NormalizedRealEstateRecord exactly.
type RealEstateRecord = NormalizedRealEstateRecord;

// Parses display strings like "$485K" / "$1.2M" / "$285,000" into integer
// USD. Returns null on unparseable input.
function parseUsdShort(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\$([\d.,]+)\s*([KkMm])?/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const unit = m[2]?.toLowerCase();
  const mult = unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1;
  return Math.round(num * mult);
}

export async function loadRealEstateItems(geo: string[]): Promise<DecisionItem[]> {
  if (!geo || geo.length === 0) return [];
  const allowed = new Set(geo);
  const negStore = await getAllNegotiations();
  const allocated = computeAllocatedFromStore(negStore);

  // Load normalized records from data/real-estate.json via the shared loader.
  // The file shape conforms to NormalizedRealEstateRecord exactly.
  const dataset = await loadRealEstateFromFile(DATA_PATH, { source: "normalized" });

  // 1. Build base items + acquisition plans
  let items: DecisionItem[] = dataset
    .filter((r) => allowed.has(r.zip))
    .map(({ zip: _zip, ...item }) => {
      void _zip;
      const askUsd = parseUsdShort(item.ask);
      const maoUsd = parseUsdShort(item.mao);
      const arvUsd = parseUsdShort(item.arv);
      const out: DecisionItem = { ...item };
      if (askUsd != null) out.buyPriceUsd = askUsd;        // numeric cost for portfolio math

      // ── VALUATION (source-aware) ───────────────────────────────────
      // Honest about the fact that we don't have a live comp feed —
      // confidence will be MEDIUM/LOW unless the dataset later carries
      // listingTimestamp + compCount + DOM.
      let confidence: number | undefined;
      if (askUsd != null && arvUsd != null) {
        const valuation = computeRealEstateValuation({
          // The original normalized record (the loader strips zip, but the
          // valuation function only reads optional source-quality fields
          // that are still on `item`).
          rec: { zip: _zip, ...item },
          askUsd,
          arvUsd,
          maoUsd: maoUsd ?? undefined,
        });
        out.valuation = valuation;
        confidence = valuation.confidenceScore;
      }

      if (askUsd != null && maoUsd != null && arvUsd != null && maoUsd > 0) {
        const plan = computeRealEstateAcquisition({
          label: item.label ?? "",
          askUsd,
          maoUsd,
          arvUsd,
          risk: item.risk ?? "",
          tag: item.tag,
          riskFactors: item.riskFactors,
          score: item.score,
          confidenceScore: confidence,
          fragilityScore: out.valuation?.fragilityScore,
          fragilityFlags: out.valuation?.fragilityFlags,
        });
        if (plan) out.acquisitionPlan = plan;
      }
      return out;
    });

  // 2. Apply persisted negotiation state per item — auto-age the time field.
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

  // 3. Apply portfolio context.
  const result = applyPortfolioContext(items, REAL_ESTATE_DEFAULT_BUDGET, allocated);
  return result.items;
}
