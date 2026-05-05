// Meridian AI — Bucket Classifier.
//
// Pure rule-based classifier that maps an existing lead onto one or
// more service buckets within a given trade. Reads only fields the lead
// already carries — no fabrication, no enrichment, no I/O. Returns
// multiple bucket matches when warranted, sorted by confidence.

import {
  type TradeId,
  type ServiceBucketId,
  TRADE_MODULES,
  isTradeId,
} from "./tradeConfigs";

export interface BucketClassification {
  tradeId: TradeId;
  bucketId: ServiceBucketId;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

// Permissive lead shape — we tolerate everything the upstream engine
// produces today plus older snapshot fields. Optional everywhere.
export interface ClassifierLeadLike {
  website?: string | null;
  websiteUrl?: string | null;
  websiteStatus?: string | null;
  websiteScore?: number | null;
  resolvedBusinessUrl?: string | null;
  domain?: string | null;
  scanFindings?: string[] | null;
  systemFindings?: string[] | null;
  aiSummary?: string | null;
  reviews?: number | null;
  reviewCount?: number | null;
  rating?: number | null;
  googlePresence?: string | null;
  seoScore?: number | null;
  services?: string[] | null;
  description?: string | null;
  notes?: string | null;
  opportunityLabel?: string | null;
  opportunity_label?: string | null;
  recommendedAction?: string | null;
  source?: string | null;
  score?: number | null;
  revenueImpact?: number | null;
  missingContact?: boolean | null;
  phone?: string | null;
  email?: string | null;
  contacts?: {
    primaryPhone?: string | null;
    primaryEmail?: string | null;
  } | null;
  websiteProof?: {
    homepage_fetch_ok?: boolean | null;
    issues?: string[] | null;
    site_classification?: string | null;
  } | null;
  // Ingestion-side context (Google Places, etc). Used by per-trade
  // classifiers to inspect the originating query, the Place types,
  // and any combined signal tokens the ingestion route produced.
  sourceQuery?: string | null;
  sourceTypes?: string[] | null;
  rawSignals?: string[] | null;
  name?: string | null;
  address?: string | null;
}

// ── Predicates over lead state ────────────────────────────────────────

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function joinedText(l: ClassifierLeadLike): string {
  return [
    l.aiSummary,
    l.description,
    l.notes,
    l.name ?? "",
    l.sourceQuery ?? "",
    Array.isArray(l.scanFindings) ? l.scanFindings.join(" ") : "",
    Array.isArray(l.systemFindings) ? l.systemFindings.join(" ") : "",
    Array.isArray(l.websiteProof?.issues) ? (l.websiteProof?.issues ?? []).join(" ") : "",
    Array.isArray(l.services) ? l.services.join(" ") : "",
    Array.isArray(l.sourceTypes) ? l.sourceTypes.join(" ") : "",
    Array.isArray(l.rawSignals) ? l.rawSignals.join(" ") : "",
    l.opportunityLabel ?? l.opportunity_label ?? "",
    l.recommendedAction ?? "",
  ].map(lower).join(" ");
}

function hasWebsite(l: ClassifierLeadLike): boolean {
  return !!(l.website || l.websiteUrl || l.resolvedBusinessUrl || l.domain);
}

function siteScanOk(l: ClassifierLeadLike): boolean {
  return !!l.websiteProof?.homepage_fetch_ok;
}

function websiteScoreLow(l: ClassifierLeadLike): boolean {
  return typeof l.websiteScore === "number" && l.websiteScore < 50;
}

function ratingLow(l: ClassifierLeadLike): boolean {
  return typeof l.rating === "number" && l.rating > 0 && l.rating < 4.0;
}

function reviewsThin(l: ClassifierLeadLike): boolean {
  const n = l.reviewCount ?? l.reviews ?? null;
  return typeof n === "number" && n >= 0 && n < 25;
}

function seoWeak(l: ClassifierLeadLike): boolean {
  if (typeof l.seoScore === "number" && l.seoScore < 50) return true;
  const gp = lower(l.googlePresence);
  return gp === "weak" || gp === "low" || gp === "poor";
}

function missingContact(l: ClassifierLeadLike): boolean {
  if (l.missingContact === true) return true;
  const phone = l.phone ?? l.contacts?.primaryPhone ?? null;
  const email = l.email ?? l.contacts?.primaryEmail ?? null;
  return !phone && !email;
}

function textHints(l: ClassifierLeadLike, needles: string[]): string[] {
  const hay = joinedText(l);
  return needles.filter((n) => hay.includes(n));
}

function hasAny(l: ClassifierLeadLike, needles: string[]): boolean {
  return textHints(l, needles).length > 0;
}

// ── Per-trade rules ───────────────────────────────────────────────────

function classifyRoofing(l: ClassifierLeadLike): BucketClassification[] {
  const out: BucketClassification[] = [];
  const websitePresent = hasWebsite(l);
  const rating = typeof l.rating === "number" ? l.rating : null;
  const reviews =
    (typeof l.reviewCount === "number" ? l.reviewCount : null) ??
    (typeof l.reviews === "number" ? l.reviews : null);

  // Website conversion — site exists but scan / CTA / mobile signal weak.
  {
    const reasons: string[] = [];
    if (websitePresent && !siteScanOk(l)) reasons.push("site scan failed");
    if (websiteScoreLow(l)) reasons.push("weak website score");
    if (hasAny(l, ["no quote form", "no cta", "weak cta", "broken", "mobile"])) {
      reasons.push("CTA / mobile gaps in scan");
    }
    if (reasons.length > 0) {
      out.push({
        tradeId: "roofing",
        bucketId: "website_conversion",
        confidence: reasons.length >= 2 ? "high" : "medium",
        reasons,
      });
    }
  }

  // No-website presence — explicit angle for "doesn't even have a site."
  // Emerges directly from Google Places — strongest signal we have.
  if (!websitePresent) {
    out.push({
      tradeId: "roofing",
      bucketId: "no_website_presence",
      confidence: "high",
      reasons: ["Google Places listing with no website"],
    });
  }

  // Local SEO visibility — no website OR low review volume signals
  // weak local-pack presence even before a scan runs.
  {
    const reasons: string[] = [];
    if (!websitePresent) reasons.push("no website on file");
    if (typeof reviews === "number" && reviews < 20) reasons.push(`only ${reviews} reviews`);
    if (seoWeak(l)) reasons.push("weak SEO / Google presence");
    if (hasAny(l, ["no city pages", "no service pages", "no neighborhood", "low ranking", "not ranking"])) {
      reasons.push("local-pack / city-page gaps in scan");
    }
    if (reasons.length > 0) {
      out.push({
        tradeId: "roofing",
        bucketId: "local_seo_visibility",
        confidence: reasons.length >= 2 ? "high" : "medium",
        reasons,
      });
    }
  }

  // Review reputation — pure Google Places numeric signals.
  {
    const reasons: string[] = [];
    if (typeof rating === "number" && rating > 0 && rating < 4.3) {
      reasons.push(`rating ${rating}`);
    }
    if (typeof reviews === "number" && reviews >= 0 && reviews < 25) {
      reasons.push(`only ${reviews} reviews`);
    }
    if (hasAny(l, ["bad reviews", "negative reviews", "reputation", "stale reviews"])) {
      reasons.push("reputation gap in scan");
    }
    if (reasons.length > 0) {
      out.push({
        tradeId: "roofing",
        bucketId: "review_reputation",
        confidence: reasons.length >= 2 ? "high" : "medium",
        reasons,
      });
    }
  }

  // Storm response — sourceQuery + name + free-text. Captures storm
  // chasers and storm-positioned roofers from the Google Places import.
  {
    const queryHits = textHints(l, ["storm", "hail", "wind damage", "insurance claim"]);
    const nameLower = lower(l.name);
    const nameHits = ["storm", "hail", "wind"].filter((t) => nameLower.includes(t));
    const reasons: string[] = [];
    if (queryHits.length > 0) reasons.push(...queryHits.map((h) => `mentions ${h}`));
    if (nameHits.length > 0) reasons.push(`name signals ${nameHits.join(", ")}`);
    if (reasons.length > 0) {
      out.push({
        tradeId: "roofing",
        bucketId: "storm_response",
        confidence: reasons.length >= 2 ? "high" : "medium",
        reasons,
      });
    }
  }

  // Estimate follow-up.
  if (hasAny(l, ["follow up", "estimate", "quote", "proposal"]) && !hasAny(l, ["nurture", "drip", "automation"])) {
    out.push({
      tradeId: "roofing",
      bucketId: "estimate_followup",
      confidence: "medium",
      reasons: ["estimates flow but no follow-up cadence detected"],
    });
  }

  return out;
}

function classifyHvac(l: ClassifierLeadLike): BucketClassification[] {
  const out: BucketClassification[] = [];
  const fromGooglePlaces = lower(l.source) === "google_places";

  // Emergency service visibility — prefer the Place name + originating
  // query + Place types so a Google Places import classifies cleanly
  // even without scan output.
  {
    const emergencyHits = textHints(l, [
      "emergency", "24/7", "24 7", "urgent", "after hours",
      "heating repair", "ac repair", "repair",
    ]);
    if (emergencyHits.length > 0 && (seoWeak(l) || websiteScoreLow(l) || !siteScanOk(l))) {
      out.push({
        tradeId: "hvac",
        bucketId: "emergency_service_visibility",
        confidence: "high",
        reasons: [`offers emergency (${emergencyHits.slice(0, 3).join(", ")}) but visibility is weak`],
      });
    } else if (emergencyHits.length > 0) {
      out.push({
        tradeId: "hvac",
        bucketId: "emergency_service_visibility",
        confidence: emergencyHits.length >= 2 ? "high" : "medium",
        reasons: [`offers emergency (${emergencyHits.slice(0, 3).join(", ")})`],
      });
    }
  }

  // Seasonal demand — heating/cooling/furnace/AC tokens point here even
  // without a literal "season" mention.
  {
    const seasonalHits = textHints(l, [
      "heating", "cooling", "furnace", "ac ", "air conditioning",
      "heat wave", "season", "summer", "winter", "spring",
    ]);
    if (seasonalHits.length > 0) {
      out.push({
        tradeId: "hvac",
        bucketId: "seasonal_demand",
        confidence: seasonalHits.length >= 2 ? "high" : "medium",
        reasons: [`HVAC seasonal context (${seasonalHits.slice(0, 3).join(", ")})`],
      });
    }
  }

  // Review reputation — explicit numeric signal from Google Places.
  {
    const reasons: string[] = [];
    if (typeof l.rating === "number" && l.rating > 0 && l.rating < 4.3) {
      reasons.push(`rating ${l.rating}`);
    }
    const reviews = (typeof l.reviewCount === "number" ? l.reviewCount : null) ?? l.reviews ?? null;
    if (typeof reviews === "number" && reviews >= 0 && reviews < 25) {
      reasons.push(`only ${reviews} reviews`);
    }
    if (reasons.length > 0) {
      out.push({
        tradeId: "hvac",
        bucketId: "review_reputation",
        confidence: reasons.length >= 2 ? "high" : "medium",
        reasons,
      });
    }
  }

  // Local SEO visibility — Google Places lead with no website is the
  // textbook "Needs local-pack tightening" candidate.
  {
    const reasons: string[] = [];
    if (fromGooglePlaces && !hasWebsite(l)) reasons.push("Google Places listing with no website");
    if (seoWeak(l)) reasons.push("weak SEO / Google presence");
    if (hasAny(l, ["no city pages", "no service pages", "no neighborhood", "low ranking", "not ranking"])) {
      reasons.push("local-pack / city-page gaps in scan");
    }
    if (reasons.length > 0) {
      out.push({
        tradeId: "hvac",
        bucketId: "local_seo_visibility",
        confidence: reasons.length >= 2 ? "high" : "medium",
        reasons,
      });
    }
  }

  // Maintenance memberships — only flag explicitly when the lead's text
  // already mentions it (i.e. strong evidence). Otherwise leave it for
  // the angle prioritizer to surface as Build Next.
  if (hasAny(l, ["membership", "maintenance plan", "tune up", "tune-up", "service agreement"])) {
    out.push({
      tradeId: "hvac",
      bucketId: "maintenance_memberships",
      confidence: "high",
      reasons: ["membership / maintenance plan mentioned"],
    });
  }

  // Financing visibility — only flag when explicitly mentioned.
  if (hasAny(l, ["financing", "$/mo", "monthly payment", "payment plan"])) {
    out.push({
      tradeId: "hvac",
      bucketId: "financing_visibility",
      confidence: "high",
      reasons: ["financing mention detected"],
    });
  }

  return out;
}

function classifyCarpentry(l: ClassifierLeadLike): BucketClassification[] {
  const out: BucketClassification[] = [];

  // Portfolio visibility.
  if (!hasAny(l, ["portfolio", "gallery", "before after", "before/after", "project photos"])) {
    out.push({
      tradeId: "carpentry",
      bucketId: "portfolio_visibility",
      confidence: "high",
      reasons: ["no portfolio / gallery references"],
    });
  }
  // Quote request funnel.
  out.push(...maybeQuoteFunnel(l, "carpentry"));
  // Project photography.
  if (hasAny(l, ["stock photo", "phone photo", "no photos", "amateur photos"])) {
    out.push({
      tradeId: "carpentry",
      bucketId: "project_photography",
      confidence: "medium",
      reasons: ["weak project photography signal"],
    });
  }
  out.push(...maybeLocalSeo(l, "carpentry"));
  // Niche specialty positioning.
  if (!hasAny(l, ["built-in", "millwork", "stair", "specialty", "custom"])) {
    out.push({
      tradeId: "carpentry",
      bucketId: "niche_specialty_positioning",
      confidence: "low",
      reasons: ["generic carpentry positioning"],
    });
  }
  return out;
}

function classifyPainting(l: ClassifierLeadLike): BucketClassification[] {
  const out: BucketClassification[] = [];
  // Exterior repaint visibility.
  if (!hasAny(l, ["exterior", "house paint", "repaint", "stucco paint", "siding paint"])) {
    out.push({
      tradeId: "painting",
      bucketId: "exterior_repaint_visibility",
      confidence: "medium",
      reasons: ["no exterior / repaint visibility"],
    });
  }
  // Cabinet painting demand.
  if (!hasAny(l, ["cabinet", "kitchen cabinet", "cabinet refinishing", "cabinet paint"])) {
    out.push({
      tradeId: "painting",
      bucketId: "cabinet_painting_demand",
      confidence: "medium",
      reasons: ["no cabinet repaint capture"],
    });
  }
  // Commercial painting visibility.
  if (!hasAny(l, ["commercial", "facility", "property manager", "rfp", "bid"])) {
    out.push({
      tradeId: "painting",
      bucketId: "commercial_painting_visibility",
      confidence: "low",
      reasons: ["no commercial painting positioning"],
    });
  }
  // Local SEO visibility.
  if (!hasAny(l, ["neighborhood", "city page", "service area", "schema"])) {
    out.push({
      tradeId: "painting",
      bucketId: "local_seo_visibility",
      confidence: "medium",
      reasons: ["weak local SEO signal"],
    });
  }
  // Reputation & proof.
  if (!hasAny(l, ["before", "after", "gallery", "project photo", "trust"])) {
    out.push({
      tradeId: "painting",
      bucketId: "reputation_proof",
      confidence: "medium",
      reasons: ["no before/after proof signal"],
    });
  }
  return out;
}

function classifyPlumbing(l: ClassifierLeadLike): BucketClassification[] {
  const out: BucketClassification[] = [];

  // Emergency service visibility.
  {
    const emergencyHits = textHints(l, ["emergency", "24/7", "24 7", "urgent", "after hours", "burst"]);
    if (emergencyHits.length > 0 && (seoWeak(l) || websiteScoreLow(l) || !siteScanOk(l))) {
      out.push({
        tradeId: "plumbing",
        bucketId: "emergency_service_visibility",
        confidence: "high",
        reasons: [`offers emergency (${emergencyHits.join(", ")}) but visibility is weak`],
      });
    } else if (emergencyHits.length > 0) {
      out.push({
        tradeId: "plumbing",
        bucketId: "emergency_service_visibility",
        confidence: "medium",
        reasons: [`offers emergency (${emergencyHits.join(", ")})`],
      });
    }
  }
  out.push(...maybeLocalSeo(l, "plumbing"));
  out.push(...maybeReviewReputation(l, "plumbing"));
  // Service page gaps.
  if (!hasAny(l, ["service page", "water heater", "drain cleaning", "sewer line"])) {
    out.push({
      tradeId: "plumbing",
      bucketId: "service_page_gaps",
      confidence: "medium",
      reasons: ["no per-service page references"],
    });
  }
  // Estimate follow-up.
  if (hasAny(l, ["estimate", "quote", "proposal"]) && !hasAny(l, ["nurture", "drip", "automation"])) {
    out.push({
      tradeId: "plumbing",
      bucketId: "estimate_followup",
      confidence: "medium",
      reasons: ["estimates flow but no follow-up cadence detected"],
    });
  }
  return out;
}

function classifyElectrical(l: ClassifierLeadLike): BucketClassification[] {
  const out: BucketClassification[] = [];

  // Emergency electrical visibility.
  {
    const emergencyHits = textHints(l, ["emergency", "24/7", "24 7", "after hours", "outage", "urgent"]);
    if (emergencyHits.length > 0 && (seoWeak(l) || websiteScoreLow(l) || !siteScanOk(l))) {
      out.push({
        tradeId: "electrical",
        bucketId: "emergency_electrical_visibility",
        confidence: "high",
        reasons: [`offers emergency (${emergencyHits.join(", ")}) but visibility is weak`],
      });
    } else if (emergencyHits.length > 0) {
      out.push({
        tradeId: "electrical",
        bucketId: "emergency_electrical_visibility",
        confidence: "medium",
        reasons: ["emergency electrical context detected"],
      });
    }
  }
  // Panel upgrade demand.
  if (!hasAny(l, ["panel", "breaker", "service upgrade", "rewire", "rewiring"])) {
    out.push({
      tradeId: "electrical",
      bucketId: "panel_upgrade_demand",
      confidence: "medium",
      reasons: ["no panel upgrade / rewiring positioning"],
    });
  }
  // EV charger install.
  if (!hasAny(l, ["ev charger", "electric vehicle", "tesla", "level 2 charger"])) {
    out.push({
      tradeId: "electrical",
      bucketId: "ev_charger_installation",
      confidence: "medium",
      reasons: ["no EV charger install capture"],
    });
  }
  // Commercial electrical.
  if (!hasAny(l, ["commercial", "facility", "property manager", "rfp", "maintenance"])) {
    out.push({
      tradeId: "electrical",
      bucketId: "commercial_electrical_visibility",
      confidence: "low",
      reasons: ["no commercial electrical positioning"],
    });
  }
  return out;
}

// ── Shared helpers ────────────────────────────────────────────────────

function maybeLocalSeo(l: ClassifierLeadLike, tradeId: TradeId): BucketClassification[] {
  const reasons: string[] = [];
  if (seoWeak(l)) reasons.push("weak SEO / Google presence");
  if (hasAny(l, ["no city pages", "no service pages", "no neighborhood", "low ranking", "not ranking"])) {
    reasons.push("local-pack / city-page gaps in scan");
  }
  if (reasons.length === 0) return [];
  return [{
    tradeId,
    bucketId: "local_seo_visibility",
    confidence: reasons.length >= 2 ? "high" : "medium",
    reasons,
  }];
}

function maybeReviewReputation(l: ClassifierLeadLike, tradeId: TradeId): BucketClassification[] {
  const reasons: string[] = [];
  if (ratingLow(l)) reasons.push(`rating ${l.rating}`);
  if (reviewsThin(l)) reasons.push(`only ${l.reviewCount ?? l.reviews} reviews`);
  if (hasAny(l, ["bad reviews", "negative reviews", "reputation", "stale reviews"])) {
    reasons.push("reputation gap in scan");
  }
  if (reasons.length === 0) return [];
  return [{
    tradeId,
    bucketId: "review_reputation",
    confidence: reasons.length >= 2 ? "high" : "medium",
    reasons,
  }];
}

function maybeQuoteFunnel(l: ClassifierLeadLike, tradeId: TradeId): BucketClassification[] {
  const reasons: string[] = [];
  if (missingContact(l)) reasons.push("no contact path on file");
  if (hasAny(l, ["no quote form", "no contact form", "weak cta", "no cta"])) reasons.push("CTA / form gap in scan");
  if (reasons.length === 0) return [];
  return [{
    tradeId,
    bucketId: "quote_request_funnel",
    confidence: reasons.length >= 2 ? "high" : "medium",
    reasons,
  }];
}

const CLASSIFIERS: Record<TradeId, (l: ClassifierLeadLike) => BucketClassification[]> = {
  roofing: classifyRoofing,
  hvac: classifyHvac,
  carpentry: classifyCarpentry,
  painting: classifyPainting,
  plumbing: classifyPlumbing,
  electrical: classifyElectrical,
};

const CONF_RANK: Record<BucketClassification["confidence"], number> = {
  high: 3, medium: 2, low: 1,
};

function defaultBucket(tradeId: TradeId): BucketClassification {
  // Pick the first declared bucket as the trade's neutral default so a
  // never-classified lead still surfaces a coherent angle.
  const bucket = TRADE_MODULES[tradeId].serviceBuckets[0];
  return {
    tradeId,
    bucketId: bucket.id,
    confidence: "low",
    reasons: ["no strong signal — defaulting to trade's primary bucket"],
  };
}

// ── Public API ────────────────────────────────────────────────────────

export function classifyLeadIntoBuckets(
  lead: ClassifierLeadLike | null | undefined,
  tradeId: string | null | undefined,
): BucketClassification[] {
  const trade = isTradeId(tradeId) ? (tradeId as TradeId) : "roofing";
  if (!lead) return [defaultBucket(trade)];
  const fn = CLASSIFIERS[trade];
  const matches = fn(lead);
  if (matches.length === 0) return [defaultBucket(trade)];

  // Dedupe by bucketId (keep highest-confidence, most reasons).
  const byBucket = new Map<string, BucketClassification>();
  for (const m of matches) {
    const existing = byBucket.get(m.bucketId);
    if (!existing) {
      byBucket.set(m.bucketId, m);
      continue;
    }
    const better =
      CONF_RANK[m.confidence] > CONF_RANK[existing.confidence] ||
      (CONF_RANK[m.confidence] === CONF_RANK[existing.confidence] &&
        m.reasons.length > existing.reasons.length);
    if (better) byBucket.set(m.bucketId, m);
  }

  return Array.from(byBucket.values()).sort((a, b) => {
    const c = CONF_RANK[b.confidence] - CONF_RANK[a.confidence];
    if (c !== 0) return c;
    return b.reasons.length - a.reasons.length;
  });
}

export function primaryBucketForLead(
  lead: ClassifierLeadLike | null | undefined,
  tradeId: string | null | undefined,
): BucketClassification | null {
  const all = classifyLeadIntoBuckets(lead, tradeId);
  return all[0] ?? null;
}
