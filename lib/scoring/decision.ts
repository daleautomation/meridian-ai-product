// Meridian — unified decision engine.
//
// One call → one decision. Wraps the existing closeability axes
// (intent / leak / reach / timing) and the company decision payload
// to produce a single user-facing answer:
//
//   • bucket: "Call now" | "Call this week" | "Watch" | "Skip"
//   • score : 0–100, higher = more worth contacting now
//   • reason: one plain-English sentence
//   • suggestedOpening: one sentence the rep can read on the call
//
// No new data sources. No fabricated signals. Missing data lowers
// confidence (and pushes leads down the bucket ladder), it does not
// invent urgency.

import type { CompanyDecision } from "@/lib/scoring/companyDecision";
import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";
import { computeCloseability, type Closeability } from "@/lib/scoring/closeability";

export type LeadBucket = "Call now" | "Call this week" | "Watch" | "Skip";

export type DecisionService = { id: string; label: string };

export type PrimaryOpportunity = {
  id: string;                                        // bucket id (lib/services/opportunityServiceMapping)
  label: string;
  reason: string;                                    // one-line "why this matters"
  revenueImpact: "high" | "medium" | "low";
  services: DecisionService[];
};

export type LeadDecision = {
  bucket: LeadBucket;
  score: number;
  reason: string;
  suggestedOpening: string;
  primaryOpportunity?: PrimaryOpportunity;
};

export type DecideContext = {
  snapshot?: CompanySnapshot;
  workspaceLabel?: string;     // e.g. "LaborTech"
  moduleLabel?: string;        // e.g. "roofing"
  marketLabel?: string;        // e.g. "Kansas City"
};

// Map the legacy closeability bucket onto the user-facing label set.
function bucketFromCloseability(c: Closeability): LeadBucket {
  switch (c.bucket) {
    case "CALL NOW": return "Call now";
    case "TODAY":    return "Call this week";
    case "MONITOR":  return "Watch";
    case "PASS":     return "Skip";
  }
}

function pickTopIssue(d: CompanyDecision): string | null {
  const issues = d.websiteProof?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const r = first as { headline?: string; label?: string; description?: string; reason?: string };
      return r.headline ?? r.label ?? r.description ?? r.reason ?? null;
    }
  }
  return null;
}

function buildReason(d: CompanyDecision, c: Closeability): string {
  // Hard disqualifier first — if Skip due to status, say so plainly.
  if (c.bucket === "PASS" && c.disqualificationReason) {
    return c.disqualificationReason;
  }

  const parts: string[] = [];
  if (c.leak.level === "High" || c.leak.level === "Medium") {
    parts.push("a clear website issue we can fix");
  } else if (c.leak.level === "Low") {
    parts.push("a smaller website weakness");
  }
  if (c.reach.level === "Verified") {
    parts.push("a verified phone");
  } else if (c.reach.level === "Weak") {
    parts.push("partial contact info");
  } else {
    parts.push("no verified phone yet");
  }
  if (c.intent.level === "Strong") {
    parts.push("active-business signals");
  } else if (c.intent.level === "Weak") {
    parts.push("weak intent signals");
  }
  if (c.timing.level === "Now") {
    parts.push("a recent activity trigger");
  } else if (c.timing.level === "Soon") {
    parts.push("cooldown cleared");
  }

  const bucketLead = (() => {
    switch (c.bucket) {
      case "CALL NOW": return "They look ready to talk";
      case "TODAY":    return "Worth a call this week";
      case "MONITOR":  return "Watch for now";
      case "PASS":     return "Skip for now";
    }
  })();

  return `${bucketLead} — ${parts.join(", ")}.`;
}

function buildOpening(d: CompanyDecision, ctx: DecideContext, c: Closeability): string {
  const company = d.name ?? "there";
  const market = ctx.marketLabel ?? d.location ?? null;
  const moduleLabel = ctx.moduleLabel ?? "roofing";

  // If we have a concrete issue, lead with that.
  const issue = pickTopIssue(d);
  if (issue && c.bucket !== "PASS") {
    const where = market ? ` in ${market}` : "";
    return `Hey, I'm calling because I noticed ${issue.toLowerCase()} on ${company}'s site, and that may be costing you ${moduleLabel} leads${where}.`;
  }

  // No specific issue but reachable + active.
  if (c.bucket === "CALL NOW" || c.bucket === "TODAY") {
    const where = market ? ` in ${market}` : "";
    return `Hey, I ran a quick check on ${company} and saw a couple of things on your site that may be costing you ${moduleLabel} leads${where}. Got 60 seconds?`;
  }

  // Watch — generic, low-pressure.
  if (c.bucket === "MONITOR") {
    return `Worth a soft touch only — confirm contact info and the website status before any pitch.`;
  }

  // Skip.
  return `Not actionable today — leave it in the backlog.`;
}

export function decideLead(
  lead: CompanyDecision,
  context: DecideContext = {},
): LeadDecision {
  const closeability = computeCloseability(lead, context.snapshot);
  const bucket = bucketFromCloseability(closeability);
  const score = Math.max(0, Math.min(100, Math.round(closeability.score)));
  const reason = buildReason(lead, closeability);
  const suggestedOpening = buildOpening(lead, context, closeability);
  return { bucket, score, reason, suggestedOpening };
}

// ──────────────────────────────────────────────────────────────────────
// Primary opportunity picker.
//
// Per-trade priority cascade. Reads only NormalizedLead.signals + the
// bucket-→-services map. Deterministic: same inputs → same opportunity.
// Always returns the bucket the rep should LEAD with on the call.
// ──────────────────────────────────────────────────────────────────────
import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import { getOpportunityMapping } from "@/lib/services/opportunityServiceMapping";
import { listServices } from "@/lib/services/serviceCatalog";

const REVIEW_THRESHOLD = 25;

function pickBucketIdForLead(lead: NormalizedLead): string | null {
  const trade = lead.moduleId;
  const hasWebsite = lead.signals.hasWebsite === true || !!lead.website;
  const websiteWeak = lead.signals.websiteWeak === true;
  const reviewCount = typeof lead.signals.reviewCount === "number" ? lead.signals.reviewCount : undefined;
  const lowReviews = reviewCount !== undefined && reviewCount < REVIEW_THRESHOLD;

  if (trade === "roofing") {
    if (!hasWebsite) return "no_website_presence";
    if (websiteWeak) return "website_conversion";
    if (lowReviews) return "review_reputation";
    return "local_seo_visibility";
  }
  if (trade === "hvac") {
    if (lowReviews) return "review_reputation";
    if (!hasWebsite || websiteWeak) return "local_seo_visibility";
    return "emergency_service_visibility";
  }
  if (trade === "carpentry") {
    if (!hasWebsite) return "quote_request_funnel";
    if (lowReviews) return "portfolio_visibility";
    if (websiteWeak) return "quote_request_funnel";
    return "portfolio_visibility";
  }
  if (trade === "painting") {
    if (lowReviews) return "reputation_proof";
    if (!hasWebsite) return "cabinet_painting_demand";
    if (websiteWeak) return "exterior_repaint_visibility";
    return "exterior_repaint_visibility";
  }
  if (trade === "plumbing") {
    if (!hasWebsite) return "service_page_gaps";
    if (lowReviews) return "review_reputation";
    return "emergency_service_visibility";
  }
  if (trade === "electrical") {
    if (!hasWebsite) return "panel_upgrade_demand";
    if (lowReviews) return "review_reputation";
    return "emergency_electrical_visibility";
  }
  return null;
}

export function buildPrimaryOpportunity(lead: NormalizedLead): PrimaryOpportunity | undefined {
  const bucketId = pickBucketIdForLead(lead);
  if (!bucketId) return undefined;
  const mapping = getOpportunityMapping(bucketId);
  if (!mapping) return undefined;
  const services: DecisionService[] = listServices(mapping.services).map((s) => ({
    id: s.id,
    label: s.label,
  }));
  return {
    id: mapping.id,
    label: mapping.label,
    reason: mapping.why,
    revenueImpact: mapping.revenueImpact,
    services,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Decision over a NormalizedLead (ingestion-side).
//
// Tuned for real deal-closing: surface more callable leads while
// staying honest about which gap to lead with. Score bands:
//   Call now        80–95
//   Call this week  60–80
//   Watch           30–60
//   Skip            < 30
//
// Bucket logic (when phone is present):
//   • No website                                → Call now
//   • reviewCount < 20                          → Call now
//   • reviewCount 20–75                         → Call this week
//   • reviewCount 75–100                        → Call this week  (Rule 1)
//   • reviewCount 100–150                       → Call this week  (soft edge)
//   • reviewCount ≥ 150 + rating < 4.7          → Call this week  (soft edge)
//   • reviewCount ≥ 150 + rating ≥ 4.7          → Watch
//   • Then: rating < 4.5 bumps priority up one level
//
// No phone → Watch (never callable). Closed-CRM → Skip.
// ──────────────────────────────────────────────────────────────────────

// Pull a short market label out of a Google formatted_address.
// "102 E Main St, Lebanon, TN 37087, USA" → "Lebanon, TN"
function shortMarket(location: string | undefined): string {
  if (!location) return "your area";
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "your area";
  if (parts.length <= 2) return parts.join(", ");
  // Drop "USA" tail if present.
  const trimmed = parts[parts.length - 1].toUpperCase() === "USA"
    ? parts.slice(0, -1)
    : parts;
  if (trimmed.length === 1) return trimmed[0];
  // Take the city + state slot. State block looks like "TN 37087" → keep just "TN".
  const city = trimmed[trimmed.length - 2];
  const stateBlock = trimmed[trimmed.length - 1];
  const stateAbbr = stateBlock.split(/\s+/)[0];
  return `${city}, ${stateAbbr}`;
}

function buildSalesOpening(
  lead: NormalizedLead,
  bucket: LeadBucket,
  reviewCount: number | undefined,
  rating: number | undefined,
): string {
  const company = lead.companyName || "there";
  const market = shortMarket(lead.location);

  if (bucket === "Call now") {
    if (lead.signals.hasWebsite === false) {
      return `Hey, quick one — I noticed ${company} doesn't have a site up. Mind if I show you what your competitors in ${market} are running?`;
    }
    if (typeof reviewCount === "number" && reviewCount < 20) {
      return `Hey, this is a quick one — ${company} is at ${reviewCount} Google reviews and most of your ${market} competition is past 100. Got 30 seconds?`;
    }
    if (typeof rating === "number" && rating < 4.5) {
      return `Hey, I'm calling about your Google rating — ${company} is at ${rating}, and most of the top crews in ${market} sit above 4.7. Worth a real conversation?`;
    }
    return `Hey, I ran a quick check on ${company} — there are a couple of things on your end that are likely costing you ${market} leads. Got 30 seconds?`;
  }

  if (bucket === "Call this week") {
    if (typeof reviewCount === "number" && reviewCount < 75) {
      return `Hey, I'm calling about ${company}'s Google reviews — you're at ${reviewCount}, and the top ${market} crews are well past that. Worth a quick conversation this week?`;
    }
    if (typeof reviewCount === "number" && reviewCount < 150) {
      return `Hey, I'm taking a look at ${company} — solid base at ${reviewCount} reviews, but a few easy things are costing you ${market} leads. Got a minute this week?`;
    }
    if (typeof rating === "number" && rating < 4.7) {
      return `Hey, I checked ${company} — ${reviewCount ?? "your"} reviews, but the rating's at ${rating}. There's a clean angle to lead with this week. Got a minute?`;
    }
    return `Hey, I'm calling about ${company} — a couple of small things are likely leaving ${market} leads on the table. Worth a quick call this week?`;
  }

  if (bucket === "Watch") {
    if (!lead.phone) {
      return `Worth a soft touch only — confirm a phone number before any pitch.`;
    }
    return `No clean angle to lead with right now — keep an eye on it for a slip in rating or a new gap.`;
  }

  return `Not actionable today — leave it in the backlog.`;
}

function decideNormalizedBucket(lead: NormalizedLead): {
  bucket: LeadBucket;
  score: number;
  reason: string;
} {
  const hasPhone = !!lead.phone;
  const reviewCount = typeof lead.signals.reviewCount === "number" ? lead.signals.reviewCount : undefined;
  const rating = typeof lead.signals.rating === "number" ? lead.signals.rating : undefined;
  const recentActivity = lead.signals.recentActivity === true;
  const websiteWeak = lead.signals.websiteWeak === true;

  // Hard skip: CRM "do not contact" / closed states.
  const status = (lead.crm.status ?? "").toUpperCase();
  if (["CLOSED_WON", "CLOSED_LOST", "NOT_QUALIFIED", "ARCHIVED", "DO_NOT_CONTACT"].includes(status)) {
    return { bucket: "Skip", score: 10, reason: `Closed in CRM (${status}) — out of play.` };
  }

  // No phone → Watch. (Never Call when there's no way to reach them.)
  if (!hasPhone) {
    return {
      bucket: "Watch",
      score: 35,
      reason: "Possible angle on file, but no verified phone yet — not callable today.",
    };
  }

  // Rule: no website + phone → Call now.
  if (lead.signals.hasWebsite === false) {
    let score = 90;
    if (recentActivity) score += 3;
    return {
      bucket: "Call now",
      score,
      reason: "No website on file and they pick up the phone — clean entry to pitch a fast site build.",
    };
  }

  // Review-count tiering (with phone present).
  let bucket: LeadBucket = "Watch";
  let score = 35;
  let reason = "Strong online presence — no obvious angle right now.";

  if (reviewCount !== undefined) {
    if (reviewCount < 20) {
      bucket = "Call now";
      score = 82;
      reason = `Only ${reviewCount} Google reviews and a verified phone — clean reputation pitch with a real way to reach them.`;
    } else if (reviewCount < 75) {
      bucket = "Call this week";
      score = 70;
      reason = `${reviewCount} Google reviews — solid, but top ${shortMarket(lead.location)} crews are well past that. Worth a call this week.`;
    } else if (reviewCount < 100) {
      // Rule 1: phone + <100 reviews → never Watch.
      bucket = "Call this week";
      score = 65;
      reason = `${reviewCount} Google reviews — close to the top tier, but still room to push past competitors. Worth a call this week.`;
    } else if (reviewCount < 150) {
      // Soft-edge: under 150 reviews is still callable.
      bucket = "Call this week";
      score = 62;
      reason = `${reviewCount} reviews — strong, but a clean angle still exists below the top ${shortMarket(lead.location)} crews.`;
    } else if (typeof rating === "number" && rating < 4.7) {
      // Soft-edge: high volume but rating gives an opening.
      bucket = "Call this week";
      score = 60;
      reason = `${reviewCount} reviews at ${rating} — strong volume, but rating leaves an opening to lead with.`;
    } else {
      // ≥150 reviews AND rating ≥ 4.7 → genuinely tough — Watch.
      bucket = "Watch";
      score = 40;
      reason = `${reviewCount} reviews at ${rating} stars — they're tough to beat. Keep watching for a slip.`;
    }
  } else {
    // No reviewCount data at all but a phone exists → soft Call this week.
    bucket = "Call this week";
    score = 60;
    reason = "Phone on file, but reputation signal is unknown — call to size them up.";
  }

  // Rule: rating < 4.5 → bump priority up one level.
  if (typeof rating === "number" && rating < 4.5) {
    if (bucket === "Watch") {
      bucket = "Call this week";
      score = Math.max(score, 65);
      reason = `Rating is ${rating}${reviewCount !== undefined ? ` across ${reviewCount} reviews` : ""} — clean reputation angle to lead with.`;
    } else if (bucket === "Call this week") {
      bucket = "Call now";
      score = Math.max(score, 82);
      reason = `Rating is ${rating}${reviewCount !== undefined ? ` across ${reviewCount} reviews` : ""} — both reputation and visibility are in play.`;
    }
  }

  // Weak-website signal nudges Call this week up to Call now (when phone exists).
  if (websiteWeak && bucket === "Call this week") {
    bucket = "Call now";
    score = Math.max(score, 80);
    reason = `${reason} Weak website on top of it — easy to lead with.`;
  }

  return { bucket, score, reason };
}

export function decideNormalizedLead(lead: NormalizedLead): LeadDecision {
  // Source-error leads cannot be decided honestly — surface as Watch.
  if (lead.sourceStatus === "error") {
    return {
      bucket: "Watch",
      score: 30,
      reason: "Source returned an error — re-check before any outreach.",
      suggestedOpening: "Wait for a clean source check before calling.",
    };
  }

  const { bucket, score, reason } = decideNormalizedBucket(lead);
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const suggestedOpening = buildSalesOpening(
    lead,
    bucket,
    typeof lead.signals.reviewCount === "number" ? lead.signals.reviewCount : undefined,
    typeof lead.signals.rating === "number" ? lead.signals.rating : undefined,
  );
  // Skip leads carry no opportunity — there's nothing to sell into.
  const primaryOpportunity = bucket === "Skip" ? undefined : buildPrimaryOpportunity(lead);
  return { bucket, score: clamped, reason, suggestedOpening, primaryOpportunity };
}

// Batch helper that mirrors the rerankByCloseability shape but emits the
// unified decision. Existing closeability rerank stays in place for the
// legacy props OperatorConsole still consumes — this layer is additive.
export type DecidedLead = CompanyDecision & {
  decision: LeadDecision;
  closeability: Closeability;
};

export type DecideAllResult = {
  all: DecidedLead[];
  callNow: DecidedLead[];
  callThisWeek: DecidedLead[];
  watch: DecidedLead[];
  skip: DecidedLead[];
};

export function decideAll(
  ranked: CompanyDecision[],
  snapshotsByKey: Map<string, CompanySnapshot>,
  baseContext: Omit<DecideContext, "snapshot"> = {},
): DecideAllResult {
  const all: DecidedLead[] = ranked.map((d) => {
    const snapshot = snapshotsByKey.get(d.key);
    const closeability = computeCloseability(d, snapshot);
    const decision = decideLead(d, { ...baseContext, snapshot });
    return Object.assign({}, d, { decision, closeability });
  });

  const groups = groupByDecision(all);
  return {
    all,
    callNow: groups.callNow,
    callThisWeek: groups.callThisWeek,
    watch: groups.watch,
    skip: groups.skip,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Decision-native grouping. Use this everywhere user-facing — replaces
// any closeability-keyed grouping. Sorts each group by score descending.
// ──────────────────────────────────────────────────────────────────────
export function groupByDecision<T extends { decision?: LeadDecision }>(leads: T[]): {
  callNow: T[];
  callThisWeek: T[];
  watch: T[];
  skip: T[];
} {
  const empty = { callNow: [] as T[], callThisWeek: [] as T[], watch: [] as T[], skip: [] as T[] };
  if (!Array.isArray(leads)) return empty;
  const out = empty;
  for (const l of leads) {
    const b = l.decision?.bucket;
    if (b === "Call now") out.callNow.push(l);
    else if (b === "Call this week") out.callThisWeek.push(l);
    else if (b === "Watch") out.watch.push(l);
    else if (b === "Skip") out.skip.push(l);
    // No bucket → drop from all four groups (decision missing = not surfaced).
  }
  const byScore = (a: T, z: T) => (z.decision?.score ?? 0) - (a.decision?.score ?? 0);
  out.callNow.sort(byScore);
  out.callThisWeek.sort(byScore);
  out.watch.sort(byScore);
  out.skip.sort(byScore);
  return out;
}
