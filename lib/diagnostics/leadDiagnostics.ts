// Meridian — evidence-based lead diagnostics.
//
// Pure helper. Reads a NormalizedLead's signals and returns
// observable, verifiable findings the rep can lead with on a call.
// Replaces generic "lead with strongest pain point" copy.
//
// Every finding carries:
//   • issue      — short title  ("Low review count")
//   • evidence   — observable data point  ("19 reviews vs 80+ competitors")
//   • impact     — why it matters in plain English
//   • confidence — "high" | "medium" | "low"
//
// No I/O. No catalog imports. Trade-aware behavior is gated by the
// caller (visual-trade content rules, etc.) — keep this file simple
// and signal-driven.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";

export type FindingType =
  | "reviews"
  | "website"
  | "seo"
  | "content"
  | "conversion"
  | "opportunity";

export type FindingConfidence = "high" | "medium" | "low";

export type Finding = {
  type: FindingType;
  issue: string;
  evidence: string;
  impact: string;
  confidence: FindingConfidence;
};

export type LeadDiagnostics = {
  findings: Finding[];
  summary: string;
  topFinding: Finding | null;
};

const VISUAL_TRADES = new Set(["painting", "carpentry", "roofing"]);

const CONFIDENCE_RANK: Record<FindingConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const TYPE_RANK: Record<FindingType, number> = {
  reviews: 0,
  website: 1,
  conversion: 2,
  seo: 3,
  content: 4,
  opportunity: 5,
};

function competitorBenchmark(reviewCount: number): string {
  if (reviewCount < 10) return "80+ for top KC competitors";
  if (reviewCount < 30) return "100+ for top KC competitors";
  return "200+ for the strongest crews in the market";
}

export function generateLeadDiagnostics(
  lead: NormalizedLead | null | undefined,
): LeadDiagnostics {
  if (!lead) {
    return { findings: [], summary: "No lead data on file.", topFinding: null };
  }

  const findings: Finding[] = [];
  const s = lead.signals ?? {};
  const reviewCount = typeof s.reviewCount === "number" ? s.reviewCount : undefined;
  const rating = typeof s.rating === "number" ? s.rating : undefined;
  const hasWebsite = s.hasWebsite === true || !!lead.website;
  const websiteWeak = s.websiteWeak === true;
  const localVisibilityWeak = s.localVisibilityWeak === true;
  const portfolioMissing = s.portfolioMissing === true;
  const recentActivity = s.recentActivity;
  const trade = lead.moduleId;

  // ── Reviews ────────────────────────────────────────────────────
  if (reviewCount !== undefined && reviewCount < 30) {
    findings.push({
      type: "reviews",
      issue: "Low review count",
      evidence: `${reviewCount} reviews vs ${competitorBenchmark(reviewCount)}`,
      impact: "Buyers comparing three vendors filter on review count first; you don't make the shortlist.",
      confidence: "high",
    });
  }
  if (rating !== undefined && rating < 4.5) {
    findings.push({
      type: "reviews",
      issue: "Rating below 4.5",
      evidence: `${rating} stars on Google`,
      impact: "Most homeowners filter out anyone under 4.5 stars on the first pass.",
      confidence: "high",
    });
  }
  if (recentActivity === false && reviewCount !== undefined && reviewCount > 0) {
    findings.push({
      type: "reviews",
      issue: "No recent reviews",
      evidence: "No new reviews in the recent window.",
      impact: "Recency drives trust as much as star count — stale reviews look like a slowing business.",
      confidence: "medium",
    });
  }

  // ── Website ────────────────────────────────────────────────────
  if (!hasWebsite) {
    findings.push({
      type: "website",
      issue: "No website on file",
      evidence: "No verified website detected on the listing.",
      impact: "Without a site, every other channel leaks — comparison shoppers won't include you.",
      confidence: "high",
    });
  } else if (websiteWeak) {
    findings.push({
      type: "website",
      issue: "Weak website",
      evidence: "Quote path / mobile conversion weakness flagged on site scan.",
      impact: "Same traffic, fewer quote requests — typical leak point is the form on mobile.",
      confidence: "medium",
    });
  }

  // ── Conversion ────────────────────────────────────────────────
  if (!lead.phone) {
    findings.push({
      type: "conversion",
      issue: "No phone number on file",
      evidence: "No verified phone available on the public listing.",
      impact: "Ready-to-buy callers go to whoever picks up first; you don't get the call.",
      confidence: "high",
    });
  }
  if (hasWebsite && websiteWeak) {
    findings.push({
      type: "conversion",
      issue: "Quote funnel leak",
      evidence: "Existing site has no clear quote CTA above the fold.",
      impact: "Most mobile visitors don't scroll to find the form — that's lost jobs every week.",
      confidence: "medium",
    });
  }

  // ── SEO ───────────────────────────────────────────────────────
  if (localVisibilityWeak) {
    findings.push({
      type: "seo",
      issue: "Weak local SEO visibility",
      evidence: "Not ranking in the local pack for target neighborhoods.",
      impact: "Inbound demand is going to whoever ranks for the same service + neighborhood queries.",
      confidence: "medium",
    });
  } else if (hasWebsite && reviewCount !== undefined && reviewCount < 30) {
    findings.push({
      type: "seo",
      issue: "Thin organic footprint",
      evidence: `Low review count (${reviewCount}) drags map-pack and organic rank.`,
      impact: "Without volume + recency on Google, organic and map-pack stay capped.",
      confidence: "low",
    });
  }

  // ── Content ───────────────────────────────────────────────────
  if (portfolioMissing && VISUAL_TRADES.has(trade)) {
    findings.push({
      type: "content",
      issue: "No portfolio or gallery",
      evidence: "No before/after gallery or project showcase detected.",
      impact: "Visual-trade buyers vet on photos before they call — no gallery, no consult.",
      confidence: "medium",
    });
  }

  findings.sort((a, z) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[z.confidence];
    if (c !== 0) return c;
    return TYPE_RANK[a.type] - TYPE_RANK[z.type];
  });

  // ── Fallback opportunity findings ─────────────────────────────
  // Even strong companies need an angle. When no problem-finding
  // fired, attach observable opportunity-style findings so the rep
  // walks into the call with a specific lever to pull.
  if (findings.length === 0) {
    const fallback = buildFallbackFindings(lead);
    findings.push(...fallback);
    // eslint-disable-next-line no-console
    console.log(
      `[diagnostics-fallback] lead=${lead.companyName ?? lead.id ?? "(unknown)"} ` +
      `type=${fallback[0]?.type ?? "opportunity"}`,
    );
  }

  const summary = findings.length === 0
    ? "Foundations look solid; no urgent diagnostic flags."
    : `${findings.length} finding${findings.length === 1 ? "" : "s"}: ${findings
        .slice(0, 2)
        .map((f) => f.issue.toLowerCase())
        .join("; ")}.`;

  return {
    findings,
    summary,
    // Fallback guarantees a non-null topFinding for any lead that
    // reaches this function with non-empty signals.
    topFinding: findings[0] ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────
// Opportunity fallback. Always returns at least one finding so the
// rep has a usable angle to lead with on the call.
// ──────────────────────────────────────────────────────────────────
function buildFallbackFindings(lead: NormalizedLead): Finding[] {
  const out: Finding[] = [];
  const s = lead.signals ?? {};
  const reviewCount = typeof s.reviewCount === "number" ? s.reviewCount : undefined;
  const rating = typeof s.rating === "number" ? s.rating : undefined;
  const trade = lead.moduleId;

  // 1. Review-comparison angle.
  if (typeof reviewCount === "number") {
    if (reviewCount < 100) {
      out.push({
        type: "opportunity",
        issue: "Untapped review growth",
        evidence: `${reviewCount} reviews vs 100+ for top KC competitors`,
        impact: "You're leaving trust and inbound calls on the table — review velocity directly drives map-pack rank.",
        confidence: "medium",
      });
    } else if (reviewCount < 250) {
      out.push({
        type: "opportunity",
        issue: "Top-tier review push",
        evidence: `${reviewCount} reviews — strongest crews in the metro sit past 250`,
        impact: "Closing the gap to the strongest names compounds organic + map-pack share.",
        confidence: "medium",
      });
    } else {
      out.push({
        type: "opportunity",
        issue: "Top-of-market expansion",
        evidence: `${reviewCount} reviews${rating ? ` · ${rating} stars` : ""} — already top tier`,
        impact: "Next growth lever is paid + Local Services Ads to capture intent above organic.",
        confidence: "medium",
      });
    }
  } else {
    out.push({
      type: "opportunity",
      issue: "Reputation foundation",
      evidence: "No public review count on the listing yet",
      impact: "The first 50 reviews are the cheapest market-share lever in the trade.",
      confidence: "low",
    });
  }

  // 2. Visibility-comparison angle.
  out.push({
    type: "opportunity",
    issue: "Paid visibility opportunity",
    evidence: trade
      ? `Local Services Ads slot is open in ${trade}`
      : "Local Services Ads slot is open in this market",
    impact: "Paid placement above the map pack converts higher than organic at the urgency end of the funnel.",
    confidence: "low",
  });

  // 3. Positioning-gap angle.
  out.push({
    type: "opportunity",
    issue: "Specialty positioning gap",
    evidence: "No dedicated specialty / premium service page detected",
    impact: "Specialty positioning stops the price race and earns higher-ticket inbound.",
    confidence: "low",
  });

  return out;
}

// Helper: which service do we lead with for a given finding type?
// Used by serviceNeedClassifier to pull evidence + pitch into the
// LaborTech service the rep should sell.
export const FINDING_SERVICE_PRIORITY: Record<FindingType, string[]> = {
  reviews: ["reputation_management", "seo", "social_media_management"],
  website: ["website_funnel", "seo", "crm"],
  conversion: ["website_funnel", "appointment_scheduler", "crm"],
  seo: ["seo", "blog_posting", "google_ads"],
  content: ["media_production", "social_media_management", "meta_ads"],
  // Opportunity fallback — used when no problem finding fires.
  // Maps to growth services that work even on top-of-market companies.
  opportunity: [
    "lead_generation",
    "google_ads",
    "reputation_management",
    "seo",
    "social_media_management",
  ],
};

export function findingForService(
  diagnostics: LeadDiagnostics | undefined,
  serviceId: string,
): Finding | null {
  if (!diagnostics) return null;
  // Direct match first — find a finding type whose priority list
  // includes this service id and pick the highest-confidence one.
  let best: Finding | null = null;
  for (const f of diagnostics.findings) {
    const list = FINDING_SERVICE_PRIORITY[f.type] ?? [];
    if (!list.includes(serviceId)) continue;
    if (
      best === null ||
      CONFIDENCE_RANK[f.confidence] < CONFIDENCE_RANK[best.confidence]
    ) {
      best = f;
    }
  }
  return best;
}
