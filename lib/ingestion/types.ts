// Meridian AI — central ingestion schema.
//
// Two layers:
//   1. RAW source records — verbatim from external data sources (eBay JSON
//      dumps, county assessor exports, MLS feeds, etc.). One type per source.
//   2. NORMALIZED engine records — the shape the existing engines consume.
//      One type per vertical. Stable schema; never changes when a new source
//      is added.
//
// Source-specific adapters in lib/ingestion/{vertical}/{source}Adapter.ts
// translate raw → normalized. The engines downstream don't know or care
// where the data came from.

import type { DecisionLabelType } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURED CONDITION TYPES
// ─────────────────────────────────────────────────────────────────────────
//
// Operator-grade sub-condition signals. Replaces vague free-form condition
// strings with deterministic enums that the valuation engine can score
// individually. The image-ready numeric fields (`*Score`, `*Likelihood`)
// are populated by a future image pipeline; the valuation engine merges
// them into the structured enums when the enums themselves are absent.
//
// Both halves coexist on the same object so there's a single source of
// truth — manual entry, scraped enrichment, and image inference all flow
// through the same struct.

export type WatchCondition = {
  // ── Structured enums (manual / textual ingest target) ──
  caseCondition?: "mint" | "light_wear" | "moderate_wear" | "heavy_wear";
  braceletCondition?: "tight" | "light_stretch" | "moderate_stretch" | "heavy_stretch";
  crystalCondition?: "clean" | "minor_marks" | "scratched" | "damaged";
  dialCondition?: "clean" | "minor_imperfection" | "damaged" | "refinished_risk";
  polishRisk?: "none" | "light" | "moderate" | "heavy";
  completeness?: "full_set" | "papers_only" | "box_only" | "neither";
  serviceStatus?: "recent_service" | "service_history" | "unknown" | "overdue";
  aftermarketRisk?: "none" | "possible" | "likely";
  // ── Image-ready numeric scores (0-100; higher = worse for wear/damage) ──
  // Populated by future image analysis. When the matching enum is unset,
  // the valuation engine derives it from these via deterministic thresholds.
  caseWearScore?: number;
  braceletStretchScore?: number;
  crystalDamageScore?: number;
  dialDamageScore?: number;
  polishLikelihood?: number;
};

export type RealEstateCondition = {
  // ── Structured enums ──
  exteriorCondition?: "turnkey" | "dated" | "worn" | "distressed";
  interiorCondition?: "turnkey" | "dated" | "worn" | "distressed";
  kitchenBathCondition?: "updated" | "dated" | "partial_rehab" | "full_rehab";
  systemsCondition?: "modern" | "aging" | "end_of_life" | "failed";
  structuralRisk?: "none" | "minor" | "moderate" | "major";
  rehabLevel?: "light_cosmetic" | "moderate_rehab" | "heavy_rehab";
  occupancyFriction?:
    | "vacant"
    | "owner_occupied"
    | "tenant_in_place"
    | "estate_sale"
    | "flipper_owned";
  // ── Image-ready numeric scores (0-100; higher = worse) ──
  exteriorWearScore?: number;
  interiorWearScore?: number;
  kitchenBathUpdateScore?: number;     // higher = MORE updated (inverted)
  systemsVisualRisk?: number;
  structuralVisualRisk?: number;
};

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURED COMPARABLE-SALES TYPES
// ─────────────────────────────────────────────────────────────────────────
//
// Comp similarity is the input to weighted-average valuation. Each comp
// carries the discrete fields the engine needs to weight it against the
// subject — the engine never treats comps as equal.

export type WatchComp = {
  price: number;
  exactReferenceMatch?: boolean;
  yearDelta?: number;             // |comp.year − subject.year|
  completenessMatch?: boolean;
  conditionMatch?: boolean;
  serviceMatch?: boolean;
  sourcePlatform?: string;        // resolves to platform-quality score
  ageHours?: number;              // recency of the comp itself
};

export type RealEstateComp = {
  price: number;
  sameZip?: boolean;
  conditionSimilar?: boolean;
  rehabSimilar?: boolean;
  saleType?: "sold" | "pending" | "active";
  daysOnMarket?: number;
  ageHours?: number;
  sqftDeltaPct?: number;          // |comp.sqft − subject.sqft| / subject.sqft
};

// ─────────────────────────────────────────────────────────────────────────
// NORMALIZED RECORD TYPES (canonical engine input shapes)
// ─────────────────────────────────────────────────────────────────────────

// Watches normalized record — exactly what data/watches.json holds today.
export type NormalizedWatchRecord = {
  id: string | number;
  ownerId: string;
  title: string;
  sub: string;
  tag?: string;

  // Economics
  buyPrice?: number;
  marketPrice?: number;
  liquidity?: string;             // "High" | "Med" | "Low"
  friction?: number;              // optional override (0..0.5); defaults to 0.08

  // Editorial
  thesis?: string;
  nextAction?: string;
  riskFactors?: string[];

  // Trust / scam-filter inputs
  sourcePlatform?: string;
  sellerName?: string;
  sellerFeedbackScore?: number;
  sellerFeedbackCount?: number;
  sellerAccountAgeMonths?: number;
  paymentMethod?: string;
  authenticityGuarantee?: boolean;
  escrowAvailable?: boolean;
  boxPapers?: string;
  serviceHistory?: string | null;
  serialProvided?: boolean;
  listingQualityScore?: number;
  priceTooGoodToBeTrue?: boolean;
  notes?: string;

  // ── Source-quality / valuation inputs (optional) ──
  // The engine downgrades confidence when these are absent.
  listingTimestamp?: string;      // ISO 8601 — when the listing/comp was observed
  condition?: WatchCondition;     // structured sub-condition signals
  compCount?: number;             // number of comps backing marketPrice (0 = single anchor)
  comps?: WatchComp[];            // optional structured comp set; weighted by similarity
};

// Real-estate normalized record — exactly what the inline dataset uses today.
export type NormalizedRealEstateRecord = {
  id: string | number;
  zip: string;
  title: string;
  sub: string;
  score: number;
  label: string;
  labelType: DecisionLabelType;
  tag?: string;
  arv?: string;          // formatted USD: "$485K"
  mao?: string;
  ask?: string;
  risk?: string;         // "Low" | "Low-Med" | "Medium" | "High"
  thesis?: string;
  nextAction?: string;
  riskFactors?: string[];

  // ── Source-quality / valuation inputs (optional) ──
  listingTimestamp?: string;      // ISO — when the listing was observed
  daysOnMarket?: number;
  condition?: RealEstateCondition; // structured sub-condition signals
  compCount?: number;             // number of nearby sold comps backing the ARV
  comps?: RealEstateComp[];       // optional structured comp set; weighted by similarity
};

// ─────────────────────────────────────────────────────────────────────────
// RAW SOURCE RECORD TYPES (one per external data source)
// ─────────────────────────────────────────────────────────────────────────

// eBay-style watch listing — fields you'd get from the eBay Browse API or
// a scraped JSON dump. Trust-relevant fields are first-class.
export type RawEbayWatchListing = {
  itemId: string;
  title: string;
  condition: string;                // "New" | "Pre-owned" | "For parts" | etc.
  priceUsd: number;
  shippingUsd?: number;
  estimatedMarketUsd?: number;      // optional enrichment from Watchcharts/comp data

  seller: {
    username: string;
    feedbackPercent?: number;       // 0–100
    feedbackCount?: number;
    accountAgeMonths?: number;
    topRated?: boolean;
  };

  itemLocation?: string;
  listingUrl?: string;
  description?: string;
  categoryId?: string;              // 31387 = Wristwatches

  // Trust-relevant signals from the listing itself
  authenticityGuarantee?: boolean;  // eBay's Authenticity Guarantee program
  buyerProtection?: boolean;
  hasBoxAndPapers?: boolean | "full_set" | "box_only" | "papers_only" | "neither";
  serviceHistory?: string;
  serialProvided?: boolean;
};

// Public-record / property-record style real-estate input. Maps roughly to
// what you'd get from a county assessor + MLS join, or a Zillow-equivalent
// API output.
export type RawPropertyRecord = {
  parcelId?: string;
  mlsId?: string;

  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };

  // Pricing
  listPrice?: number;
  priorSalePrice?: number;
  priorSaleDate?: string;           // ISO date
  estimatedValue?: number;          // Zestimate-equivalent
  arvEstimate?: number;             // After-Repair Value estimate from comps
  taxAssessedValue?: number;
  taxYear?: number;

  // Property facts
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  yearBuilt?: number;
  daysOnMarket?: number;
  propertyType?: string;            // single-family / condo / multi-family / townhouse

  // Investment-specific
  estimatedRehabCost?: number;
  riskFlags?: string[];             // human notes: "foundation crack", "roof age 18", etc.

  // Disclosures
  knownIssues?: string[];
  disclosures?: string[];
};
