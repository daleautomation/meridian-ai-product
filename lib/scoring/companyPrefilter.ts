// Meridian AI — explainable prefilter for the wide-funnel raw company pool.
//
// Pure function. Given a RawCompany, returns a verdict (PASSED | FILTERED)
// plus the discrete list of reasons that fired. The batch pipeline calls
// this before paying for expensive inspections so the operator only spends
// Claude/API budget on viable candidates.
//
// No I/O. No external deps. Every rule is a one-liner so the reason line
// shown to the operator is literally the rule that fired.

import type { RawCompany } from "@/lib/state/rawCompaniesStore";
import { normalizeDomain } from "@/lib/state/rawCompaniesStore";

export type PrefilterResult = {
  verdict: "PASSED" | "FILTERED";
  reasons: string[];
};

// ── KC metro whitelist ──────────────────────────────────────────────────
// City names are case-insensitive exact matches. ZIPs use first-two digits
// to cover the MO/KS split (64*/66*). Narrow enough to exclude distant
// towns; wide enough to catch the actual metro.

const KC_METRO_CITIES = new Set<string>([
  "kansas city", "kansas city mo", "kansas city ks",
  "overland park", "olathe", "lee's summit", "lees summit",
  "independence", "shawnee", "lenexa", "leawood",
  "blue springs", "liberty", "raytown", "gladstone",
  "north kansas city", "prairie village", "mission", "merriam",
  "grandview", "belton", "raymore", "smithville",
  "parkville", "platte city", "kearney", "spring hill",
  "gardner", "de soto", "bonner springs", "basehor",
  "tonganoxie", "roeland park", "fairway", "mission hills",
  "riverside", "weatherby lake", "pleasant hill", "harrisonville",
  "greenwood", "lake winnebago", "peculiar", "oak grove",
  "buckner", "sugar creek", "pleasant valley", "excelsior springs",
  "gladstone", "claycomo", "edgerton", "stilwell",
]);

const KC_METRO_ZIP_PREFIXES = ["64", "66"]; // MO/KS metro

// ── National brand blacklist ────────────────────────────────────────────
// Not pilot targets for Labor Tech Solutions. Case-insensitive substring.

const NATIONAL_BRANDS = [
  "home depot",
  "lowe's",
  "lowes ",
  "gaf ",
  "gaf materials",
  "abc supply",
  "beacon building products",
  "beacon roofing supply",
  "srs distribution",
  "certainteed",
  "owens corning",
  "sears home",
  "leaffilter",
  "leaf filter",
  "angi ",
  "angie's list",
  "thumbtack",
  "networx",
  "roofclaim",
  "roof connect",
];

// ── Non-roofing category hints ──────────────────────────────────────────

const NON_ROOFING_CATEGORY_HINTS = [
  "solar only",
  "gutters only",
  "gutter only",
  "hvac",
  "pressure washing",
  "window washing",
  "lawn care",
  "pest control",
  "tree service",
];

// ── Rule implementations ────────────────────────────────────────────────

function isInKcMetro(c: RawCompany): boolean {
  const city = (c.city ?? "").trim().toLowerCase();
  if (city && KC_METRO_CITIES.has(city)) return true;
  const zip = (c.zip ?? "").trim();
  if (zip && KC_METRO_ZIP_PREFIXES.some((p) => zip.startsWith(p))) return true;
  return false;
}

function isNationalBrand(c: RawCompany): string | null {
  const name = (c.name ?? "").toLowerCase();
  for (const brand of NATIONAL_BRANDS) {
    if (name.includes(brand)) return brand.trim();
  }
  const domain = normalizeDomain(c.website) ?? "";
  if (domain.endsWith("homedepot.com") || domain.endsWith("lowes.com")) return domain;
  return null;
}

function isNonRoofingCategory(c: RawCompany): string | null {
  const cat = (c.category ?? "").toLowerCase();
  for (const hint of NON_ROOFING_CATEGORY_HINTS) {
    if (cat.includes(hint)) return hint;
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────

// Preferred target profile:
//   active operational status + Google Business Profile + 10-150 reviews + weak/outdated website.
// The rules below enforce the hard rejects. Soft signals (low reviews, no GBP)
// are surfaced as reasons so ranking can demote without filtering outright.

export function prefilter(c: RawCompany): PrefilterResult {
  const reasons: string[] = [];

  if (!c.website && !c.phone) {
    reasons.push("no_footprint (neither website nor phone)");
  }

  if (!isInKcMetro(c)) {
    reasons.push(`outside_kc_metro (city="${c.city ?? ""}" zip="${c.zip ?? ""}")`);
  }

  const brand = isNationalBrand(c);
  if (brand) reasons.push(`national_brand (${brand})`);

  const nonRoof = isNonRoofingCategory(c);
  if (nonRoof) reasons.push(`non_roofing_category (${nonRoof})`);

  // Hard rejects from enrichment (only fire when the field is populated).
  if (c.operationalStatus === "closed_permanently") {
    reasons.push("not_operational (closed permanently)");
  }
  if (c.reviewCount !== undefined && c.reviewCount === 0 && !c.website) {
    reasons.push("inactive_signal (no reviews, no website)");
  }

  // Soft signals — surfaced as reasons so ranking can demote without rejecting.
  // These are informational; the verdict below only filters when a reason is hard.
  const hardReasons = reasons.slice();
  const softReasons: string[] = [];
  if (c.gbpUrl === undefined || c.gbpUrl === null || c.gbpUrl === "") {
    softReasons.push("no_gbp");
  }
  if (c.reviewCount !== undefined) {
    if (c.reviewCount > 0 && c.reviewCount < 10) softReasons.push("low_review_count");
    if (c.reviewCount > 150) softReasons.push("over_reviewed_established");
  }

  return {
    verdict: hardReasons.length === 0 ? "PASSED" : "FILTERED",
    reasons: hardReasons.length === 0 ? softReasons : hardReasons,
  };
}

/**
 * Run prefilter over a batch. Duplicate handling is done at the store level
 * (dedupe on write), so this only reports content-based filters.
 */
export function prefilterBatch(records: RawCompany[]): Array<{
  key: string;
  verdict: "PASSED" | "FILTERED";
  reasons: string[];
}> {
  return records.map((r) => {
    const res = prefilter(r);
    return { key: r.key, verdict: res.verdict, reasons: res.reasons };
  });
}
