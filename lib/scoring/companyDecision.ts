// Meridian AI — company decision & ranking engine.
//
// Pure function. Given a persisted CompanySnapshot, produces a transparent,
// weighted decision: score (0–100), opportunity level, recommended action,
// close probability, ranked weaknesses, and a full contribution trace so
// every number can be defended line by line.
//
// Philosophy:
//   - Hard signals (website reachability, HTTPS, viewport, weakness count)
//     are deterministic and carry the most weight.
//   - The Claude-authored summary is treated as ONE signal, not ground
//     truth. It nudges level and contributes its own confidence, but cannot
//     outvote the deterministic evidence.
//   - Pipeline momentum (statusHistory) adjusts the action, not the score:
//     CLOSED_* and ARCHIVED short-circuit to LOW/MONITOR regardless of
//     website signals.
//
// No I/O. No external deps. Callers pass a snapshot in, get a decision out.

import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";
import type { ToolResult } from "@/lib/mcp/types";
import type { ContactResolution, ContactPath } from "@/lib/contacts/types";
import { computeNextAction, type NextAction } from "./nextAction";

// ── Types ───────────────────────────────────────────────────────────────

export type OpportunityLevel = "HIGH" | "MEDIUM" | "LOW";
export type RecommendedAction = "CALL NOW" | "TODAY" | "MONITOR";
// Bucket extends RecommendedAction with an explicit PASS tier. This is the
// operator-facing placement; RecommendedAction is kept for backward compat
// with older consumers.
export type Bucket = "CALL NOW" | "TODAY" | "MONITOR" | "PASS";
export type CloseProbability = "High" | "Medium" | "Low";
export type ConfidenceLabel = "HIGH" | "MEDIUM" | "LOW";

// Compact contact block exposed to the UI. Sourced from the snapshot's
// persisted contact fields plus the best path from the resolver. Keeps the
// operator UI's expected `lead.contacts.primaryPhone` shape working from
// first render without waiting for a client-triggered resolution.
export type DecisionContacts = {
  primaryPhone?: string;
  primaryEmail?: string;
  contactName?: string;
  contactRole?: string;
  businessName?: string;
  source?: string;
  confidence?: string;
  lastVerifiedAt?: string;
  // ── Phase 6: richer presentation fields (all optional) ──
  phoneConfidence?: string;
  emailConfidence?: string;
  nameConfidence?: string;
  fallbackConfidence?: string;
  corroborated?: boolean;
  corroborationReasons?: string[];
  primaryEmailType?: string;
  bestNextAction?: string;
  bestNextActionReason?: string;
  contactCompleteness?: string;
  contactCompletenessReason?: string;
  primaryContactReason?: string;
  isManualOverride?: boolean;
  manualNotes?: string;
  // ── Phase 7: at-a-glance quality + ask-for ──
  contactQualityScore?: number;
  contactQualityLabel?: string;
  askFor?: string[];
  // ── Phase 8: reachability + no-email explanation ──
  bestReachablePath?: string;
  bestReachablePathReason?: string;
  noEmailReason?: string;
  emailDomainMismatch?: boolean;
  // ── Phase 10: email provenance ──
  emailMethod?: string;
  alternateEmails?: string[];
  alternatePhones?: string[];
};

// LaborTech Fit — five observable signals that map directly to the five
// service lines LaborTech sells. Each axis is either Weak / Moderate /
// Strong (where applicable) or Low / Moderate / Strong for reviews, or
// None / Unknown / Active for ads + social. All values are derived from
// existing signals; "Unknown" is honest when we can't observe (ads and
// social are rarely detectable by a public crawl).
export type FitWebsite = "Weak" | "Moderate" | "Strong" | "Unknown";
export type FitSEO = "Weak" | "Moderate" | "Strong" | "Unknown";
export type FitReviews = "Low" | "Moderate" | "Strong" | "Unknown";
export type FitAds = "None" | "Unknown" | "Active";
export type FitSocial = "None" | "Weak" | "Active" | "Unknown";

export type LabortechFit = {
  website: FitWebsite;
  seo: FitSEO;
  reviews: FitReviews;
  ads: FitAds;
  social: FitSocial;
  // Overall fit summary — strong when offline business signals are
  // present but online presence is weak (classic LaborTech upside).
  overall: "STRONG FIT" | "GOOD FIT" | "WEAK FIT" | "UNKNOWN";
  reason: string;
};

// Evidence-gated opportunity estimate. Replaces generic hardcoded "lost
// leads" bands with a deterministic subscore-driven summary that exposes
// its own confidence. A numeric band is only emitted when confidence is
// HIGH (i.e. we actually have enough signals to stand behind a number).
// When confidence is weaker, the UI renders the qualitative level only.
export type OpportunityEstimate = {
  visibilityRisk: number;             // 0-100 — search/content reachability
  trustRisk: number;                  // 0-100 — trust/credibility signal loss
  conversionRisk: number;             // 0-100 — can inbound traffic convert?
  businessPresenceStrength: number;   // 0-100 — how well we actually know the business
  opportunityRiskLevel: "LOW" | "MODERATE" | "HIGH";
  opportunityEstimateBand: string | null;
  opportunityEstimateConfidence: "LOW" | "MEDIUM" | "HIGH";
  opportunityEstimateReason: string;
  signals: string[];                  // observed signals that drove the calc
  // ── Phase 9: sales-ready revenue narrative ──
  // All deterministic, mapped from the top 2-3 issue codes. Never invents
  // numbers or precision. Empty arrays / empty strings when there is not
  // enough evidence to say anything specific.
  revenueImpactSummary: string[];
  realWorldOutcome: string;
  salesAngle: string;
};

// Compact proof layer exposed to the UI. Sourced from inspect_website and
// never fabricated. Used for the trust strip under the company name.
//
// `issues` carries site-specific findings with severity + impact so the UI
// can render unique, defensible descriptions per lead. `site_classification`
// is the coarse-grained state (site_unreachable / site_blank / seo_missing
// / conversion_missing / partial_content / healthy_site).
export type SiteProofIssue = {
  code: string;
  description: string;
  impact: string;
  severity: "high" | "medium" | "low";
};

export type WebsiteProof = {
  homepage_fetch_ok: boolean;
  content_length: number;
  has_title: boolean;
  has_meta_description: boolean;
  has_contact_form: boolean;
  phone_from_site: string | null;
  email_from_site: string | null;
  page_speed_mobile: number | null;
  last_checked: string | null;
  // ── Extended signals (optional for bw compat with old snapshots) ──
  visible_text_length?: number;
  heading_count?: number;
  form_field_count?: number;
  issues?: SiteProofIssue[];
  site_classification?:
    | "site_unreachable"
    | "site_blank"
    | "seo_missing"
    | "conversion_missing"
    | "partial_content"
    | "healthy_site";
  // Convenience copies of raw signals the UI needs when reconstructing.
  title?: string | null;
  meta_description?: string | null;
  http_status?: number | null;
  response_ms?: number | null;
};

export type ScoreTrace = {
  factor: string;
  contribution: number;      // signed int
  note: string;              // human-readable "why this number"
};

// Phase 4 — explicit link from a decision back to the tool runs that
// produced its inputs. Every number in `trace[]` is rooted in one of these.
export type EvidenceRef = {
  tool: string;
  timestamp: string;         // ISO — when the tool ran
  confidence: number;        // that tool's reported confidence
  stub?: boolean;
};

export type ValueEstimate = {
  monthlyLeadLoss: string;
  annualUpside: string;
  estimatedContractValue: string;
  reasoning: string;
};

export type DealHeatLevel = "HOT" | "WARM" | "COLD";
export type CloseabilityTier = "EASY CLOSE" | "MEDIUM CLOSE" | "HARD CLOSE";
export type CloseReadiness = "READY TO CLOSE" | "NOT READY" | "AT RISK";

export type DealStrategy = {
  closeabilityTier: CloseabilityTier;
  bestApproach: string;
  biggestWeakness: string;     // the weakness to exploit
  mainRisk: string;
  nextTwoSteps: [string, string];
};

export type ClosePlan = {
  step1: string;               // current action
  step2: string;               // next move
  step3: string;               // closing move
};

export type CompanyDecision = {
  key: string;
  name: string;
  domain?: string;
  location?: string;
  score: number;             // 0–100, clamped
  opportunityScore: number;  // raw weakness-based opportunity (0-100)
  closabilityScore: number;  // how likely to close (0-100)
  contactabilityScore: number; // how reachable (0-100) — new
  proofScore: number;        // strength of live-check evidence (0-100) — new
  urgency: number;           // time-sensitivity (0-100)
  dealHeat: number;          // 0-100 engagement temperature
  dealHeatLevel: DealHeatLevel;
  callAttempts: number;
  consecutiveNoAnswers: number;
  escalationStage: number;   // 0-4
  opportunityLevel: OpportunityLevel;
  recommendedAction: RecommendedAction;
  bucket: Bucket;            // operator-facing placement — extends action with PASS
  verifiedIssue: boolean;    // live-check evidence supports at least one real issue
  verifiedContact: boolean;  // has a provider-verified contact path
  closeProbability: CloseProbability;
  topWeaknesses: string[];
  pitchAngle: string | null;
  whyPriority: string;      // one-line "why this company matters"
  reasons: string[];         // deterministic bullet reasons for the bucket
  valueEstimate: ValueEstimate;
  rationale: string;
  trace: ScoreTrace[];
  evidenceRefs: EvidenceRef[];
  confidenceFloor: number;
  confidenceLabel: ConfidenceLabel;
  staleDays: number | null;
  lastChecked: string | null; // latest scan/verification timestamp (ISO)
  opportunityEstimate: OpportunityEstimate;
  // ── LaborTech sales alignment (all deterministic, observable only) ──
  labortechFit: LabortechFit;
  serviceRecommendations: LabortechService[];
  whyThisCloses: string;
  // ── Trade + service bucket classification (from snapshot, optional) ──
  trade?: string;
  serviceBucket?: string;
  // ── Next Action engine output (deterministic, derived from above) ──
  nextAction: NextAction;
  websiteProof: WebsiteProof | null;
  contactPaths: ContactPath[];
  contacts: DecisionContacts;
  blocked?: string;
  rank?: number;
  forceAction?: string;
  scriptTone?: string;
  // ── Closing strategy layer ──
  dealStrategy: DealStrategy;
  closePlan: ClosePlan;
  conversionNarrative: string;
  whyOverNext?: string;
  // ── Decision compression layer ──
  closeReadiness: CloseReadiness;
  nextMoveCommand: string;     // "Next move: Call tomorrow and push for meeting"
  accountSnapshot: {
    status: string;
    touches: number;
    lastOutcome: string;
    recommendation: string;
    readiness: CloseReadiness;
    nextAction: string;
  };
};

// ── Shapes of tool results we consume (loose — no import cycle) ─────────

type WebsiteSignals = {
  reachable: boolean;
  https: boolean;
  hasViewport: boolean;
  responseMs: number | null;
  httpStatus?: number | null;
  title: string | null;
  metaDescription: string | null;
  contentBytes: number;
  weaknesses: string[];
  // Proof layer — all optional so older snapshots still decode.
  homepage_fetch_ok?: boolean;
  has_title?: boolean;
  has_meta_description?: boolean;
  has_contact_form?: boolean;
  phone_from_site?: string | null;
  email_from_site?: string | null;
  page_speed_mobile?: number | null;
  last_checked?: string;
  visible_text_length?: number;
  heading_count?: number;
  form_field_count?: number;
  issues?: SiteProofIssue[];
  site_classification?: string;
};

type SummaryData = {
  opportunityLevel?: OpportunityLevel;
  recommendedAction?: RecommendedAction;
  topWeakness?: string;
  weaknesses?: string[];
  pitchAngle?: string;
  closeProbability?: CloseProbability;
};

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

function getLatest<T>(snap: CompanySnapshot, tool: string): ToolResult<T> | null {
  const r = snap.latest?.[tool];
  return (r as ToolResult<T>) ?? null;
}

// Project the raw inspect_website output into the compact WebsiteProof the
// UI consumes. Single source of truth so old and new fields stay in sync.
// Handles older snapshots that predate the issues[] / classification /
// visible_text_length additions by falling back to derived defaults.
function buildWebsiteProof(
  data: WebsiteSignals,
  toolTimestamp: string | undefined,
): WebsiteProof {
  return {
    homepage_fetch_ok: data.homepage_fetch_ok ?? data.reachable,
    content_length: data.contentBytes ?? 0,
    has_title: data.has_title ?? !!data.title,
    has_meta_description: data.has_meta_description ?? !!data.metaDescription,
    has_contact_form: data.has_contact_form ?? false,
    phone_from_site: data.phone_from_site ?? null,
    email_from_site: data.email_from_site ?? null,
    page_speed_mobile: data.page_speed_mobile ?? null,
    last_checked: data.last_checked ?? toolTimestamp ?? null,
    visible_text_length: data.visible_text_length,
    heading_count: data.heading_count,
    form_field_count: data.form_field_count,
    issues: data.issues,
    site_classification: data.site_classification as WebsiteProof["site_classification"],
    title: data.title ?? null,
    meta_description: data.metaDescription ?? null,
    http_status: data.httpStatus ?? null,
    response_ms: data.responseMs ?? null,
  };
}

// Project the best contact into the UI-friendly shape the operator console
// consumes. Precedence, high → low:
//   1. snapshot.preferred* (manual operator override — Phase 6)
//   2. snapshot.contactPhone/Email/Name (legacy operator-curated)
//   3. best verified path / first path in resolver contactPaths
//   4. site-extracted phone/email from websiteProof
// Also surfaces the Phase-6 enrichment layer (confidences, corroboration,
// completeness, best next action, primary reason) when the resolver populated
// it.
function buildDecisionContacts(
  snap: CompanySnapshot,
  paths: ContactPath[],
  websiteProof: WebsiteProof | null,
  resolvedContact: ContactResolution | null,
): DecisionContacts {
  const out: DecisionContacts = {};
  const bestPhonePath = paths.find((p) => p.method === "phone");

  // ── Phase 6 manual overrides — highest priority ──
  const hasOverride = !!(
    snap.preferredPhone ?? snap.preferredEmail ?? snap.preferredContactName ?? snap.preferredContactRole
  );
  if (hasOverride) out.isManualOverride = true;
  if (snap.contactNotes) out.manualNotes = snap.contactNotes;

  // Phone precedence
  if (snap.preferredPhone) {
    out.primaryPhone = snap.preferredPhone;
    out.source = snap.preferredContactSource ?? "operator";
    out.confidence = "high";
    out.phoneConfidence = "high";
  } else if (snap.contactPhone) {
    out.primaryPhone = snap.contactPhone;
    out.source = "operator";
    out.confidence = "high";
    out.phoneConfidence = "high";
  } else if (bestPhonePath) {
    out.primaryPhone = bestPhonePath.value;
    out.source = bestPhonePath.source;
    out.confidence = bestPhonePath.confidence;
    out.phoneConfidence = resolvedContact?.phoneConfidence ?? bestPhonePath.confidence;
  } else if (websiteProof?.phone_from_site) {
    out.primaryPhone = websiteProof.phone_from_site;
    out.source = "website";
    out.confidence = "medium";
    out.phoneConfidence = "medium";
  }

  // Email precedence
  if (snap.preferredEmail) {
    out.primaryEmail = snap.preferredEmail;
    out.emailConfidence = "high";
  } else if (snap.contactEmail) {
    out.primaryEmail = snap.contactEmail;
    out.emailConfidence = "high";
  } else {
    const emailPath = paths.find((p) => p.method === "email");
    if (emailPath) {
      out.primaryEmail = emailPath.value;
      out.emailConfidence = resolvedContact?.emailConfidence ?? emailPath.confidence;
    } else if (websiteProof?.email_from_site) {
      out.primaryEmail = websiteProof.email_from_site;
      out.emailConfidence = "low";
    }
  }

  // Contact name precedence — always prefer real person over business entity.
  // Defensive guard: if a legacy snap.contactName equals the business
  // entity name (from older writes before the person-only backfill fix),
  // treat it as empty so the UI falls back to the default ask-for list.
  const businessEntity =
    resolvedContact?.businessName
    ?? resolvedContact?.matchedName
    ?? snap.profile?.name
    ?? snap.company.name;
  const businessEntityLc = (businessEntity ?? "").toLowerCase().trim();
  const legacyPersonName = snap.contactName
    && snap.contactName.toLowerCase().trim() !== businessEntityLc
    ? snap.contactName
    : undefined;

  if (snap.preferredContactName) out.contactName = snap.preferredContactName;
  else if (legacyPersonName) out.contactName = legacyPersonName;
  else if (resolvedContact?.contactName) out.contactName = resolvedContact.contactName;

  // Role/title
  if (snap.preferredContactRole) out.contactRole = snap.preferredContactRole;
  else if (resolvedContact?.contactRole) out.contactRole = resolvedContact.contactRole;

  // Business entity name (distinct from contactName).
  out.businessName =
    resolvedContact?.businessName
    ?? resolvedContact?.matchedName
    ?? snap.profile?.name
    ?? snap.company.name;

  // Phase-6 pass-throughs.
  out.nameConfidence = resolvedContact?.nameConfidence;
  out.fallbackConfidence = resolvedContact?.fallbackConfidence;
  out.corroborated = resolvedContact?.corroborated;
  out.corroborationReasons = resolvedContact?.corroborationReasons;
  out.primaryEmailType = resolvedContact?.primaryEmailType;
  out.bestNextAction = hasOverride
    ? (out.primaryPhone ? "READY TO CALL" : out.primaryEmail ? "READY TO EMAIL" : "MANUAL VERIFY")
    : resolvedContact?.bestNextAction;
  out.bestNextActionReason = hasOverride
    ? "Manual override in place — operator-curated contact."
    : resolvedContact?.bestNextActionReason;
  out.contactCompleteness = resolvedContact?.contactCompleteness;
  out.contactCompletenessReason = resolvedContact?.contactCompletenessReason;
  out.primaryContactReason = hasOverride
    ? "Operator-curated override on file."
    : resolvedContact?.primaryContactReason;
  out.contactQualityScore = resolvedContact?.contactQualityScore;
  out.contactQualityLabel = resolvedContact?.contactQualityLabel;
  // Keep askFor deterministic even when the resolver hasn't computed one —
  // default list falls through `buildAskFor` logic identical to resolver's.
  // Re-derive askFor from the *post-guard* contactName so a stripped
  // business entity doesn't surface as "Ask for: Acme Roofing LLC".
  // Three states, mirroring lib/contacts/resolver.ts::buildAskFor:
  //   person → ask for them (single line, role appended in parens)
  //   business match but no person → "No direct contact found — ask for owner"
  //   nothing matched → "Ask for: Owner or Office Manager"
  out.askFor = (() => {
    const name = out.contactName;
    const role = out.contactRole;
    if (name) {
      return [`Ask for: ${name}${role ? ` (${role})` : ""}`];
    }
    const hasBusinessMatch = !!out.businessName
      || (Array.isArray(paths) && paths.length > 0);
    if (hasBusinessMatch) {
      return ["No direct contact found — ask for Owner, Office Manager, or whoever handles the website."];
    }
    return ["Ask for: Owner or Office Manager"];
  })();

  // Reachability + no-email explanation pass-through.
  out.bestReachablePath = resolvedContact?.bestReachablePath;
  out.bestReachablePathReason = resolvedContact?.bestReachablePathReason;
  out.noEmailReason = out.primaryEmail ? undefined : resolvedContact?.noEmailReason;
  out.emailDomainMismatch = resolvedContact?.emailDomainMismatch;
  // Email provenance + alternates — surfaced for the UI's contact panel.
  // Operator-entered preferredEmail defaults to website_visible (we don't
  // know the method); otherwise pass through the resolver's emailMethod.
  out.emailMethod = snap.preferredEmail
    ? "website_visible"
    : resolvedContact?.emailMethod;
  out.alternateEmails = resolvedContact?.alternateEmails;
  out.alternatePhones = resolvedContact?.alternatePhones;

  out.lastVerifiedAt =
    snap.preferredUpdatedAt
    ?? resolvedContact?.lastCheckedAt
    ?? snap.contactResolutionCheckedAt
    ?? websiteProof?.last_checked
    ?? undefined;
  return out;
}

// ── Opportunity estimate (evidence-gated, deterministic) ──────────────
// Input: the subset of signals the engine has already captured. No
// external calls. No random ranges. A numeric band is only emitted when
// confidence is HIGH — otherwise the UI falls back to qualitative risk.

function isPlaceholderDomain(domain: string | undefined | null): boolean {
  if (!domain) return false;
  return /^(example|localhost|iana|w3)\.(org|com|net)$/i.test(domain.toLowerCase());
}

// ── LaborTech Fit + sales narrative ──────────────────────────────────
// Reads existing observable signals only. Ads + Social mostly return
// "Unknown" because we do not currently crawl for them; the operator
// still sees the Website/SEO/Reviews axes which are the strongest
// LaborTech upsell signals.

function computeLabortechFit(opts: {
  websiteProof: WebsiteProof | null;
  contactResolution: ContactResolution | null;
  placeholderDomain: boolean;
}): LabortechFit {
  const { websiteProof: wp, contactResolution: cr, placeholderDomain } = opts;

  // Website axis — fetch + content + title/meta present
  let website: FitWebsite = "Unknown";
  if (placeholderDomain) website = "Weak";
  else if (wp) {
    if (!wp.homepage_fetch_ok) website = "Weak";
    else if ((wp.content_length ?? 0) < 2000) website = "Weak";
    else if (wp.has_title && wp.has_meta_description && (wp.content_length ?? 0) >= 5000) website = "Strong";
    else website = "Moderate";
  }

  // SEO axis — title + meta + headings
  let seo: FitSEO = "Unknown";
  if (wp) {
    const hasTitle = !!wp.has_title;
    const hasMeta = !!wp.has_meta_description;
    const hasHeadings = (wp.heading_count ?? 0) > 0;
    const score = [hasTitle, hasMeta, hasHeadings].filter(Boolean).length;
    if (score === 3) seo = "Strong";
    else if (score === 0) seo = "Weak";
    else seo = "Moderate";
  }

  // Reviews axis — from resolver's matched business
  let reviews: FitReviews = "Unknown";
  const reviewCount = cr?.reviewCount;
  if (typeof reviewCount === "number") {
    if (reviewCount >= 20) reviews = "Strong";
    else if (reviewCount >= 5) reviews = "Moderate";
    else reviews = "Low";
  }

  // Ads axis — we don't crawl for Google Ads / Meta pixels; honest Unknown.
  const ads: FitAds = "Unknown";

  // Social axis — only signal today is whether the Facebook adapter
  // returned a matched page. Anything else = Unknown.
  let social: FitSocial = "Unknown";
  const checked = cr?.checkedSources ?? [];
  if (checked.includes("facebook")) {
    const hasFbPath = (cr?.paths ?? []).some((p) => p.source === "facebook");
    social = hasFbPath ? "Active" : "None";
  }

  // Overall fit — LaborTech wants real businesses with weak digital.
  // Strong presence signals (reviews + website) mean lower upside; weak
  // website/SEO + moderate/strong reviews = classic LaborTech lead.
  const websiteIsWeak = website === "Weak";
  const seoIsWeak = seo === "Weak";
  const reviewsSignalBusiness = reviews === "Moderate" || reviews === "Strong";
  let overall: LabortechFit["overall"];
  let reason: string;
  if ((websiteIsWeak || seoIsWeak) && reviewsSignalBusiness) {
    overall = "STRONG FIT";
    reason = "Real business with real reviews, but weak digital presence — direct LaborTech upside.";
  } else if (websiteIsWeak || seoIsWeak) {
    overall = "GOOD FIT";
    reason = "Digital presence is weak; offline strength not yet confirmed.";
  } else if (website === "Strong" && seo === "Strong" && reviews === "Strong") {
    overall = "WEAK FIT";
    reason = "Already strong online — limited LaborTech upside unless they want scale.";
  } else if (website === "Unknown" && seo === "Unknown" && reviews === "Unknown") {
    overall = "UNKNOWN";
    reason = "No live-check data on file yet.";
  } else {
    overall = "GOOD FIT";
    reason = "Some digital gaps detected; worth a qualification call.";
  }

  return { website, seo, reviews, ads, social, overall, reason };
}

// One sales-ready sentence the operator can deliver mid-call. Composed
// from the strongest observed gap paired with the LaborTech service
// that fixes it. Never fluff — either concrete or empty.
function buildWhyThisCloses(opts: {
  fit: LabortechFit;
  topService: LabortechService | null;
  reachable: boolean;
}): string {
  const { fit, topService, reachable } = opts;
  if (!reachable) {
    return "No website = fastest possible win. Every inbound search visitor is currently hitting a dead page.";
  }
  if (fit.overall === "STRONG FIT" && topService) {
    return `Established roofer with real reviews but ${topService.toLowerCase()} is the obvious gap — fast ROI, clear pitch.`;
  }
  if (fit.reviews === "Low" && fit.website === "Strong") {
    return "Site looks fine but review footprint is thin — reputation upgrade produces immediate trust lift.";
  }
  if (fit.website === "Weak" && fit.reviews === "Strong") {
    return "Already earning trust offline (reviews look solid), but losing inbound on a weak site — website rebuild is the win.";
  }
  if (fit.seo === "Weak") {
    return "Not showing up in local search right now — SEO work produces traffic they are currently missing.";
  }
  if (fit.website === "Weak") {
    return "Weak website is the bottleneck — digital upgrade produces immediate lead flow.";
  }
  if (topService) {
    return `${topService} is the clearest gap. Concrete fix, concrete pitch.`;
  }
  if (fit.overall === "WEAK FIT") {
    return "Already strong online — harder sell; qualify for scale or ops pain before pitching.";
  }
  return "Minor gaps. Call to qualify on reviews, ads, and ops.";
}

// Deterministic "what LaborTech can sell this lead" list. Derived from
// issue codes via LABORTECH_SERVICE_MAP, deduped, ranked by frequency
// of the underlying issues. Keeps the UI focused on the 2-4 services
// that actually apply.
type IssueLiteService = { code: string; severity: "high" | "medium" | "low" };

function buildServiceRecommendations(issues: IssueLiteService[]): LabortechService[] {
  if (!issues || issues.length === 0) return [];
  const counts = new Map<LabortechService, number>();
  for (const it of issues) {
    const svc = LABORTECH_SERVICE_MAP[it.code];
    if (!svc) continue;
    // Weight by severity so an "Immediate site fix" from a high-severity
    // issue bubbles above a "SEO" from a low-severity one.
    const weight = it.severity === "high" ? 3 : it.severity === "medium" ? 2 : 1;
    counts.set(svc, (counts.get(svc) ?? 0) + weight);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([svc]) => svc)
    .slice(0, 4);
}

// Issue-code → single-line business outcome. Keeps the product honest —
// no numbers, no fluff, just what the broken signal means in the real
// world. Add codes here as the inspector grows.
const REVENUE_IMPACT_MAP: Record<string, string> = {
  site_unreachable: "Search traffic hits a dead page and bounces before reaching your business.",
  http_5xx: "Inbound visitors see a server error instead of your homepage.",
  http_4xx: "Search links resolve to a missing-page error.",
  blank_body: "Visitors land on a blank page and leave within seconds.",
  thin_content: "Search engines can't tell customers what you offer.",
  title_missing: "Your business name doesn't show up clearly in Google results.",
  title_weak: "Search titles are too short to stand out against competitors.",
  meta_missing: "Search results show random snippets instead of your pitch.",
  no_headings: "Page structure is unclear to both customers and search crawlers.",
  no_contact_path: "Interested customers have no clear way to contact you.",
  no_contact_form: "Prospects can't request a quote without picking up the phone.",
  no_phone_on_site: "Callers have to search elsewhere to reach you.",
  no_email_on_site: "Email-first buyers have no direct way to reach out.",
  no_mobile_viewport: "Mobile visitors see a zoomed-out desktop layout.",
  no_https: "Browsers flag the site as insecure before the page even loads.",
  slow_response: "Slow load times drive mobile visitors away before content appears.",
  no_opengraph: "Social shares of your site look broken and don't drive clicks.",
};

// Issue-code → concrete LaborTech service. Every detected issue maps to
// something LaborTech can sell the roofer. Codes with no direct mapping
// are omitted (not every finding turns into a service pitch).
export type LabortechService =
  | "Website rebuild"
  | "SEO"
  | "Funnel optimization"
  | "Immediate site fix"
  | "Paid ads opportunity"
  | "Social management"
  | "Review generation";

const LABORTECH_SERVICE_MAP: Record<string, LabortechService> = {
  site_unreachable: "Immediate site fix",
  http_5xx: "Immediate site fix",
  http_4xx: "Immediate site fix",
  blank_body: "Website rebuild",
  thin_content: "Website rebuild",
  title_missing: "SEO",
  title_weak: "SEO",
  meta_missing: "SEO",
  no_headings: "SEO",
  no_opengraph: "SEO",
  no_contact_path: "Funnel optimization",
  no_contact_form: "Funnel optimization",
  no_phone_on_site: "Funnel optimization",
  no_email_on_site: "Funnel optimization",
  no_mobile_viewport: "Website rebuild",
  no_https: "Website rebuild",
  slow_response: "Website rebuild",
};

// Short service "pitch line" the operator can paraphrase mid-call — one
// sentence per service, always concrete (what's broken → what LaborTech
// fixes). Exported so the call-script fallback and future surfaces can
// pull a service-aligned pitch without re-deriving the copy.
export const LABORTECH_SERVICE_PITCH: Record<LabortechService, string> = {
  "Website rebuild": "LaborTech rebuilds the site with a real roofing page that converts search traffic into quote requests.",
  "SEO": "LaborTech restores the search metadata so the business actually shows up when locals search 'roofer near me'.",
  "Funnel optimization": "LaborTech adds a clear phone + quote path so interested visitors don't leak out of the site.",
  "Immediate site fix": "LaborTech gets the site loading again before more inbound search traffic is wasted.",
  "Paid ads opportunity": "LaborTech launches a local paid campaign so the business can capture search volume today.",
  "Social management": "LaborTech runs the social presence so referred customers see an active, trustworthy business.",
  "Review generation": "LaborTech runs a review capture flow to rebuild the star-rating signal on Google.",
};

type IssueLite = { code: string; severity: "high" | "medium" | "low" };

function rankIssuesLite(issues: IssueLite[]): IssueLite[] {
  const sevRank = { high: 0, medium: 1, low: 2 } as const;
  const codePriority: Record<string, number> = {
    site_unreachable: 0, http_5xx: 1, http_4xx: 2,
    blank_body: 3, thin_content: 4,
    no_contact_path: 5, no_contact_form: 6, no_phone_on_site: 7, no_email_on_site: 8,
    title_missing: 9, title_weak: 10, meta_missing: 11, no_headings: 12,
    slow_response: 13, no_mobile_viewport: 14, no_https: 15, no_opengraph: 16,
  };
  return [...issues].sort((a, b) => {
    const s = sevRank[a.severity] - sevRank[b.severity];
    if (s !== 0) return s;
    return (codePriority[a.code] ?? 99) - (codePriority[b.code] ?? 99);
  });
}

// Pick top issues + map to revenue-impact lines.
function buildRevenueImpactSummary(issues: IssueLite[]): string[] {
  if (!issues || issues.length === 0) return [];
  const top = rankIssuesLite(issues).slice(0, 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of top) {
    const line = REVENUE_IMPACT_MAP[it.code];
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

// One-line real-world outcome from the combination of issue codes. Walks
// the code set once and picks the strongest consequence; never reuses a
// generic fallback unless absolutely nothing is detected.
function buildRealWorldOutcome(codes: Set<string>, reachable: boolean): string {
  if (!reachable) return "Inbound search traffic is hitting a dead page and leaving without converting.";
  const blank = codes.has("blank_body");
  const thin = codes.has("thin_content");
  const seoBad = codes.has("title_missing") || codes.has("meta_missing") || codes.has("title_weak");
  const convBad = codes.has("no_contact_path") || codes.has("no_contact_form")
    || codes.has("no_phone_on_site");

  if (blank && convBad) {
    return "Visitors see nothing on the page and have no way to reach out — most are just moving on.";
  }
  if (blank) {
    return "Customers who find the site are bouncing on arrival before they ever see what you offer.";
  }
  if (seoBad && convBad) {
    return "Between weak search presence and no clear contact path, interested buyers are falling through.";
  }
  if (thin && convBad) {
    return "The site doesn't say enough about the business and doesn't give visitors a way to act.";
  }
  if (convBad) {
    return "Even interested visitors have no obvious way to convert into a call or quote request.";
  }
  if (seoBad) {
    return "Search is sending traffic to competitors who are indexed for what you actually do.";
  }
  if (thin) {
    return "Visitors are getting too little information to pick you over a competitor's fuller site.";
  }
  if (codes.has("slow_response") || codes.has("no_mobile_viewport") || codes.has("no_https")) {
    return "Mobile, trust, and speed gaps are quietly leaking inbound leads.";
  }
  return "Minor trust gaps — the site reads fine but loses edge on competitors with a stronger presence.";
}

// One-line sales angle — how the operator can frame the conversation.
// Deterministic from the same issue codes; never AI-generated fluff.
function buildSalesAngle(codes: Set<string>, reachable: boolean): string {
  if (!reachable) {
    return "Right now your site isn't loading for anyone searching for you — inbound leads are effectively going to competitors.";
  }
  const blank = codes.has("blank_body");
  const seoBad = codes.has("title_missing") || codes.has("meta_missing");
  const convBad = codes.has("no_contact_path") || codes.has("no_contact_form");
  if (blank && convBad) {
    return "Your homepage is basically blank and there's no clear way to get in touch — people are clicking away and picking another roofer.";
  }
  if (blank) {
    return "Customers are landing on a page with nothing on it and clicking away in seconds.";
  }
  if (seoBad && convBad) {
    return "Right now your site isn't showing customers what you do or how to contact you, so they're likely moving on to another roofer.";
  }
  if (convBad) {
    return "Even if people find you, there's nothing pushing them to actually call or request a quote.";
  }
  if (seoBad) {
    return "Even people actively searching for a roofer aren't finding you — the site doesn't tell Google what you actually do.";
  }
  if (codes.has("thin_content")) {
    return "The site doesn't give prospects enough to trust you over a competitor with a fuller page.";
  }
  if (codes.has("slow_response") || codes.has("no_mobile_viewport")) {
    return "The site works, but it's slow or hard to use on a phone — that's where most roofing searches happen.";
  }
  return "The site is in decent shape — small polish wins are where the leverage is.";
}

function computeOpportunityEstimate(opts: {
  websiteProof: WebsiteProof | null;
  contactResolution: ContactResolution | null;
  hasVerifiedContact: boolean;
  hasOperatorPhone: boolean;
  domain: string | undefined;
  weaknessCount: number;
}): OpportunityEstimate {
  const { websiteProof, contactResolution, hasVerifiedContact, hasOperatorPhone, domain, weaknessCount } = opts;
  const signals: string[] = [];

  const placeholderDomain = isPlaceholderDomain(domain);

  // ── visibilityRisk — can search traffic even see the business? ──
  let visibilityRisk = 0;
  if (placeholderDomain) {
    visibilityRisk += 50;
    signals.push("placeholder domain (example.org-class)");
  } else if (websiteProof) {
    if (!websiteProof.homepage_fetch_ok) {
      visibilityRisk += 40;
      signals.push("homepage fetch failed");
    } else if ((websiteProof.content_length ?? 0) < 2000) {
      visibilityRisk += 25;
      signals.push("thin homepage content");
    }
    if (!websiteProof.has_title) {
      visibilityRisk += 15;
      signals.push("no <title> on homepage");
    }
    if (!websiteProof.has_meta_description) {
      visibilityRisk += 10;
      signals.push("no meta description");
    }
  } else {
    // No scan on file is itself a gap; we just cannot be confident about it.
    visibilityRisk += 10;
  }
  visibilityRisk = Math.max(0, Math.min(100, visibilityRisk));

  // ── trustRisk — what is breaking the credibility chain? ──
  let trustRisk = 0;
  const reviewCount = contactResolution?.reviewCount ?? 0;
  const rating = contactResolution?.rating ?? 0;
  const hasGoogle = (contactResolution?.checkedSources ?? []).includes("google_places")
    && (contactResolution?.timestamps?.googleVerifiedAt !== undefined);
  if (!hasGoogle) {
    trustRisk += 20;
    signals.push("no Google Business Profile match");
  }
  if (reviewCount > 0 && reviewCount < 5) {
    trustRisk += 10;
    signals.push(`only ${reviewCount} reviews on record`);
  } else if (reviewCount === 0 && hasGoogle) {
    trustRisk += 15;
    signals.push("active Google profile with no reviews");
  }
  if (rating > 0 && rating < 3.5) {
    trustRisk += 15;
    signals.push(`low rating (${rating.toFixed(1)}★)`);
  }
  if (websiteProof && !websiteProof.homepage_fetch_ok) {
    trustRisk += 10;
    signals.push("unreachable homepage breaks trust");
  }
  if (contactResolution?.emailDomainMismatch) {
    trustRisk += 10;
    signals.push("email domain does not match website");
  }
  trustRisk = Math.max(0, Math.min(100, trustRisk));

  // ── conversionRisk — even if people find them, can they act? ──
  let conversionRisk = 0;
  const hasAnyPhone = !!contactResolution?.phone || hasOperatorPhone;
  const hasAnyEmail = !!contactResolution?.email;
  const hasForm = websiteProof?.has_contact_form === true;
  if (!hasAnyPhone && !hasAnyEmail && !hasForm) {
    conversionRisk += 50;
    signals.push("no phone, email, or form detected");
  } else {
    if (!hasAnyPhone) {
      conversionRisk += 25;
      signals.push("no phone on file");
    }
    if (!hasAnyEmail && !hasForm) {
      conversionRisk += 20;
      signals.push("no email or form detected");
    }
    if (!hasVerifiedContact && hasAnyPhone) {
      conversionRisk += 10;
      signals.push("phone not provider-verified");
    }
  }
  conversionRisk = Math.max(0, Math.min(100, conversionRisk));

  // ── businessPresenceStrength — how confidently do we know this business? ──
  let presence = 0;
  if (hasGoogle) presence += 40;
  if ((contactResolution?.checkedSources ?? []).includes("yelp")
    && contactResolution?.timestamps?.yelpCheckedAt) {
    presence += 20;
  }
  if (websiteProof?.homepage_fetch_ok && (websiteProof.content_length ?? 0) >= 2000) presence += 20;
  if (reviewCount >= 20) presence += 20;
  else if (reviewCount >= 5) presence += 10;
  if (hasOperatorPhone) presence += 20;
  if (placeholderDomain) presence = Math.min(presence, 15);
  presence = Math.max(0, Math.min(100, presence));

  // ── Roll-up: level + confidence + band + reason ──
  const avgRisk = Math.round((visibilityRisk + trustRisk + conversionRisk) / 3);
  const maxRisk = Math.max(visibilityRisk, trustRisk, conversionRisk);
  const level: OpportunityEstimate["opportunityRiskLevel"] =
    avgRisk >= 50 || maxRisk >= 70 ? "HIGH"
    : avgRisk >= 25 ? "MODERATE"
    : "LOW";

  // Confidence is strictly data-quality driven — never optimism.
  const strongRiskCount =
    (visibilityRisk >= 40 ? 1 : 0)
    + (trustRisk >= 40 ? 1 : 0)
    + (conversionRisk >= 40 ? 1 : 0);
  let confidence: OpportunityEstimate["opportunityEstimateConfidence"];
  if (presence >= 60 && strongRiskCount >= 2) confidence = "HIGH";
  else if (presence >= 30 || maxRisk >= 50) confidence = "MEDIUM";
  else confidence = "LOW";

  // Numeric band is emitted ONLY when confidence is HIGH. These bands are
  // risk-tiered — they reflect "inbound leads at risk when a typical KC
  // roofing site breaks at this level", not an exact per-business count.
  let band: string | null = null;
  if (confidence === "HIGH") {
    if (level === "HIGH") band = "15–30 inbound leads / month at risk";
    else if (level === "MODERATE") band = "5–15 inbound leads / month at risk";
    // LOW risk with HIGH confidence → no meaningful loss, no band.
  }

  // Reason is a compact, factual summary of the top drivers. Never vague.
  const drivers: string[] = [];
  if (visibilityRisk >= 40) drivers.push("visibility gap");
  if (trustRisk >= 40) drivers.push("trust gap");
  if (conversionRisk >= 40) drivers.push("conversion gap");
  let reason: string;
  if (confidence === "LOW") {
    reason = "Insufficient market-presence data for a defensible numeric estimate.";
  } else if (confidence === "MEDIUM" && !band) {
    reason = drivers.length > 0
      ? `Broad estimate only — ${drivers.join(" + ")} observed; presence data is incomplete.`
      : "Broad estimate only — limited risk signals; presence data is incomplete.";
  } else if (band) {
    const top = signals.slice(0, 3).join(" + ");
    reason = `${drivers.join(" + ") || "risk signals"} — ${top || "multiple observed signals"}.`;
  } else {
    reason = "Low risk — signals show the business is reachable and discoverable.";
  }
  // Capitalize the reason for display polish.
  reason = reason.charAt(0).toUpperCase() + reason.slice(1);
  // Guard against any empty weakness case (no scan, no presence).
  if (weaknessCount === 0 && !websiteProof && presence < 20) {
    confidence = "LOW";
    reason = "No live-check data on file yet — run a refresh for a real estimate.";
  }

  // ── Sales-ready revenue narrative (deterministic from issue codes) ──
  const issueList = (websiteProof?.issues ?? []) as IssueLite[];
  const codeSet = new Set(issueList.map((i) => i.code));
  const reachable = websiteProof?.homepage_fetch_ok !== false;
  const revenueImpactSummary = buildRevenueImpactSummary(issueList);
  // Only build outcome/angle when we actually have evidence to stand on —
  // placeholder-domain / no-scan leads get empty strings so the UI knows
  // not to pretend we have a story.
  const haveEvidence = !!websiteProof && (issueList.length > 0 || !reachable);
  const realWorldOutcome = haveEvidence ? buildRealWorldOutcome(codeSet, reachable) : "";
  const salesAngle = haveEvidence ? buildSalesAngle(codeSet, reachable) : "";

  return {
    visibilityRisk,
    trustRisk,
    conversionRisk,
    businessPresenceStrength: presence,
    opportunityRiskLevel: level,
    opportunityEstimateBand: band,
    opportunityEstimateConfidence: confidence,
    opportunityEstimateReason: reason,
    signals: signals.slice(0, 6),
    revenueImpactSummary,
    realWorldOutcome,
    salesAngle,
  };
}

// ── Core scoring ────────────────────────────────────────────────────────

const FINAL_STATUSES = new Set(["CLOSED_WON", "CLOSED_LOST", "ARCHIVED"]);
const MOMENTUM_STATUSES = new Set(["QUALIFIED", "PITCHED"]);
const INTERESTED_STATUSES = new Set(["INTERESTED", "QUALIFIED", "PITCHED"]);
const DEPRIORITIZE_STATUSES = new Set(["CLOSED_LOST", "ARCHIVED"]);

// ── Value estimation (heuristic, not ML) ───────────────────────────────
// Based on weakness signals, we estimate how much revenue a roofing company
// is losing monthly due to poor digital presence. These are conservative
// ranges based on local roofing industry data.

function estimateValue(weaknessCount: number, siteUnreachable: boolean, noViewport: boolean): ValueEstimate {
  // Base: a KC roofing company doing $2M–$10M generates ~$200K–$800K/yr
  // from digital leads. Poor marketing leaks 5-25% of that.
  let leakPctLow = 3;
  let leakPctHigh = 8;

  if (siteUnreachable) { leakPctLow = 15; leakPctHigh = 30; }
  else if (weaknessCount >= 4) { leakPctLow = 10; leakPctHigh = 22; }
  else if (weaknessCount >= 2) { leakPctLow = 5; leakPctHigh = 15; }
  if (noViewport && !siteUnreachable) { leakPctLow += 3; leakPctHigh += 5; }

  // Monthly digital lead value for a mid-market KC roofer: ~$30K–$80K/mo
  const baseLow = 30;   // $K/mo
  const baseHigh = 80;  // $K/mo
  const lossLow = Math.round(baseLow * leakPctLow / 100);
  const lossHigh = Math.round(baseHigh * leakPctHigh / 100);
  const annualLow = lossLow * 12;
  const annualHigh = lossHigh * 12;

  // LaborTech contract: typically 10-20% of the value they unlock
  const contractLow = Math.round(annualLow * 0.15);
  const contractHigh = Math.round(annualHigh * 0.18);

  let reasoning: string;
  if (siteUnreachable) {
    reasoning = "Website completely down — every searcher bounces. Maximum lead loss.";
  } else if (weaknessCount >= 4) {
    reasoning = "Multiple critical weaknesses (SEO, mobile, content) — significant lead leakage.";
  } else if (weaknessCount >= 2) {
    reasoning = "Moderate gaps in digital presence — steady lead loss to competitors.";
  } else {
    reasoning = "Minor optimization opportunities — still leaving money on the table.";
  }

  return {
    monthlyLeadLoss: `$${lossLow}K–$${lossHigh}K`,
    annualUpside: `$${annualLow}K–$${annualHigh}K`,
    estimatedContractValue: `$${contractLow}K–$${contractHigh}K/yr`,
    reasoning,
  };
}

// ── Closing strategy generator ─────────────────────────────────────────
// Pure function. All inputs are already computed scores + pipeline state.

function buildDealStrategy(opts: {
  closabilityScore: number;
  status: string;
  escalationStage: number;
  consecutiveNoAnswers: number;
  callAttempts: number;
  siteDown: boolean;
  topWeakness: string;
  wCount: number;
  dealHeat: number;
  interested: boolean;
}): DealStrategy {
  const { closabilityScore, status, escalationStage, consecutiveNoAnswers, callAttempts, siteDown, topWeakness, wCount, dealHeat, interested } = opts;

  // Closeability tier
  let closeabilityTier: CloseabilityTier;
  if (interested || (closabilityScore >= 70 && consecutiveNoAnswers === 0)) {
    closeabilityTier = "EASY CLOSE";
  } else if (closabilityScore >= 45 && escalationStage <= 2) {
    closeabilityTier = "MEDIUM CLOSE";
  } else {
    closeabilityTier = "HARD CLOSE";
  }

  // Best approach
  let bestApproach: string;
  if (interested) {
    bestApproach = "They're already warm. Confirm their pain, present the solution, and ask for the meeting. Don't re-pitch — close.";
  } else if (siteDown) {
    bestApproach = "Lead with the dead website — it's undeniable. Frame LaborTech as the fix, not a pitch. Urgency is built in.";
  } else if (escalationStage >= 3) {
    bestApproach = "Switch channel. Send a short email referencing the missed calls + one specific weakness. Make it easy to reply.";
  } else if (consecutiveNoAnswers >= 2) {
    bestApproach = "Try a different time of day. Open direct — 'I've called twice, here's why.' Be brief, ask one question.";
  } else if (wCount >= 3) {
    bestApproach = "Multiple weaknesses give you multiple angles. Pick the most painful one, lead with it, let them react.";
  } else {
    bestApproach = "Standard discovery call. Find their pain point, connect it to what you see on their site, propose next step.";
  }

  // Biggest weakness to exploit
  const biggestWeakness = topWeakness || (siteDown ? "Website completely unreachable" : "General digital presence gaps");

  // Main risk
  let mainRisk: string;
  if (escalationStage >= 4) mainRisk = "Prospect may be unreachable or unresponsive. Consider this a long shot.";
  else if (consecutiveNoAnswers >= 2) mainRisk = "Can't get them on the phone. Deal stalls if you don't switch channels.";
  else if (!interested && callAttempts === 0) mainRisk = "Cold outreach — they don't know who you are yet. First impression matters.";
  else if (interested) mainRisk = "Momentum loss — if you wait too long they'll go cold or find someone else.";
  else mainRisk = "They may not see the urgency. Tie your pitch to specific revenue they're losing today.";

  // Next two steps
  let nextTwoSteps: [string, string];
  if (interested) {
    nextTwoSteps = ["Schedule a 15-min demo/walkthrough call", "Send proposal with pricing within 24hrs of demo"];
  } else if (escalationStage >= 3) {
    nextTwoSteps = ["Send personalized email referencing their website issues", "If no reply in 2 days, try one final call at a different time"];
  } else if (consecutiveNoAnswers >= 1) {
    nextTwoSteps = ["Call again at a different time of day", "If no answer, leave a 30-second voicemail with one specific weakness"];
  } else if (callAttempts === 0) {
    nextTwoSteps = ["Make the initial call — use the generated script", "If connected, qualify and schedule a follow-up meeting"];
  } else {
    nextTwoSteps = ["Follow up on previous conversation", "Push for a scheduled meeting or proposal review"];
  }

  return { closeabilityTier, bestApproach, biggestWeakness, mainRisk, nextTwoSteps };
}

function buildClosePlan(opts: {
  interested: boolean;
  callAttempts: number;
  escalationStage: number;
  consecutiveNoAnswers: number;
  status: string;
}): ClosePlan {
  const { interested, callAttempts, escalationStage, consecutiveNoAnswers, status } = opts;

  if (interested || status === "QUALIFIED" || status === "PITCHED") {
    return {
      step1: "Confirm their interest and specific pain points",
      step2: "Present tailored proposal with pricing",
      step3: "Ask for the close — 'Can we start next week?'",
    };
  }
  if (escalationStage >= 3) {
    return {
      step1: "Send email with subject: 'Your website is costing you leads'",
      step2: "If reply → schedule call. If no reply → final voicemail.",
      step3: "If engaged → proposal. If silent → park for 30 days.",
    };
  }
  if (consecutiveNoAnswers >= 1) {
    return {
      step1: `Call #${callAttempts + 1} — try ${callAttempts <= 1 ? "morning" : "late afternoon"}`,
      step2: "If connected → qualify and schedule demo. If VM → leave 30s message.",
      step3: "Follow up within 2 days with email + meeting link",
    };
  }
  // Fresh lead
  return {
    step1: "Initial call — use the generated script to open",
    step2: "Qualify: company size, current marketing, pain level",
    step3: "Schedule follow-up meeting or send proposal",
  };
}

function buildConversionNarrative(opts: {
  interested: boolean;
  siteDown: boolean;
  wCount: number;
  callAttempts: number;
  escalationStage: number;
  contractValue: string;
}): string {
  const { interested, siteDown, wCount, callAttempts, escalationStage, contractValue } = opts;

  if (interested) {
    return `Already interested. Confirm pain → send proposal → close within 3–5 days. Expected value: ${contractValue}.`;
  }
  if (escalationStage >= 3) {
    return `Hard to reach after ${callAttempts} attempts. Switch to email. If they engage, close in 10–14 days. If silent, park and revisit.`;
  }
  if (siteDown) {
    return `Dead website = undeniable pain. Initial call → show them the problem → propose fix → close in 5–7 days. Contract: ${contractValue}.`;
  }
  if (wCount >= 3) {
    return `Multiple marketing gaps. Call → identify biggest pain → send targeted proposal → close in 7–10 days. Contract: ${contractValue}.`;
  }
  return `Standard outreach. Call → qualify → propose → close in 10–14 days if responsive. Contract: ${contractValue}.`;
}

export function decideCompany(snap: CompanySnapshot): CompanyDecision {
  const trace: ScoreTrace[] = [];
  let score = 50;

  // Neutral baseline so the trace starts explicit, not mysterious.
  trace.push({ factor: "baseline", contribution: 50, note: "neutral starting score" });

  // Status short-circuit — operator intent beats website signals.
  const status = (snap.status ?? "").toUpperCase();
  if (FINAL_STATUSES.has(status)) {
    return {
      key: snap.key,
      name: snap.company.name,
      domain: snap.company.domain,
      location: snap.company.location,
      score: status === "CLOSED_WON" ? 100 : 0,
      opportunityScore: 0, closabilityScore: 0, contactabilityScore: 0, proofScore: 0, urgency: 0,
      dealHeat: 0, dealHeatLevel: "COLD",
      callAttempts: snap.callAttempts ?? 0,
      consecutiveNoAnswers: snap.consecutiveNoAnswers ?? 0,
      escalationStage: snap.escalationStage ?? 0,
      opportunityLevel: "LOW",
      recommendedAction: "MONITOR",
      bucket: status === "CLOSED_WON" ? "MONITOR" : "PASS",
      verifiedIssue: false,
      verifiedContact: false,
      closeProbability: status === "CLOSED_WON" ? "High" : "Low",
      topWeaknesses: [],
      pitchAngle: null,
      whyPriority: status === "CLOSED_WON" ? "Deal closed — won" : "No longer active",
      reasons: [status === "CLOSED_WON" ? "Deal already won" : `Status = ${status}`],
      valueEstimate: { monthlyLeadLoss: "$0", annualUpside: "$0", estimatedContractValue: "$0", reasoning: "Closed" },
      rationale: `status=${status} — not an active opportunity`,
      trace: [...trace, { factor: "status_short_circuit", contribution: 0, note: `status=${status}` }],
      evidenceRefs: [],
      confidenceFloor: 100,
      confidenceLabel: "HIGH",
      staleDays: daysSince(snap.lastCheckedAt),
      lastChecked: snap.lastCheckedAt ?? null,
      opportunityEstimate: {
        visibilityRisk: 0, trustRisk: 0, conversionRisk: 0, businessPresenceStrength: 0,
        opportunityRiskLevel: "LOW",
        opportunityEstimateBand: null,
        opportunityEstimateConfidence: "LOW",
        opportunityEstimateReason: status === "CLOSED_WON"
          ? "Deal closed — opportunity already captured."
          : `Status=${status} — no longer an active opportunity.`,
        signals: [],
        revenueImpactSummary: [],
        realWorldOutcome: "",
        salesAngle: "",
      },
      labortechFit: {
        website: "Unknown", seo: "Unknown", reviews: "Unknown",
        ads: "Unknown", social: "Unknown",
        overall: "UNKNOWN",
        reason: status === "CLOSED_WON" ? "Deal already closed." : `Status=${status}.`,
      },
      serviceRecommendations: [],
      whyThisCloses: status === "CLOSED_WON" ? "Deal already won." : "No longer active.",
      trade: snap.trade,
      serviceBucket: snap.serviceBucket,
      nextAction: {
        action: "SKIP FOR NOW",
        confidence: "HIGH",
        reason: status === "CLOSED_WON" ? "Deal already won." : `Status = ${status.toLowerCase().replace(/_/g, " ")}.`,
      },
      websiteProof: null,
      contactPaths: [],
      contacts: {
        primaryPhone: snap.contactPhone ?? undefined,
        primaryEmail: snap.contactEmail ?? undefined,
        contactName: snap.contactName ?? undefined,
      },
      blocked: status,
      scriptTone: "neutral",
      dealStrategy: {
        closeabilityTier: "HARD CLOSE",
        bestApproach: "N/A — deal is closed",
        biggestWeakness: "N/A",
        mainRisk: "N/A",
        nextTwoSteps: ["N/A", "N/A"],
      },
      closePlan: { step1: "N/A", step2: "N/A", step3: "N/A" },
      conversionNarrative: status === "CLOSED_WON" ? "Deal won." : "Deal closed — no further action.",
      closeReadiness: status === "CLOSED_WON" ? "READY TO CLOSE" : "AT RISK",
      nextMoveCommand: status === "CLOSED_WON" ? "Closed." : "No action needed.",
      accountSnapshot: {
        status, touches: snap.callAttempts ?? 0, lastOutcome: status,
        recommendation: "N/A", readiness: status === "CLOSED_WON" ? "READY TO CLOSE" : "AT RISK",
        nextAction: "N/A",
      },
    };
  }

  const website = getLatest<WebsiteSignals>(snap, "inspect_website");
  const summary = getLatest<SummaryData>(snap, "generate_opportunity_summary");

  const confidenceFloor = Math.min(
    website?.confidence ?? 100,
    summary?.confidence ?? 100
  );

  // ── Summary signal (level + confidence) ────────────────────────────────
  if (summary) {
    const level = summary.data?.opportunityLevel;
    if (level === "HIGH") {
      score += 20;
      trace.push({ factor: "summary_level", contribution: 20, note: "summary says HIGH" });
    } else if (level === "MEDIUM") {
      score += 5;
      trace.push({ factor: "summary_level", contribution: 5, note: "summary says MEDIUM" });
    } else if (level === "LOW") {
      score -= 10;
      trace.push({ factor: "summary_level", contribution: -10, note: "summary says LOW" });
    }

    // Scale confidence (0–100) → 0–15 so confident summaries move the needle.
    const conf = Math.round((summary.confidence / 100) * 15);
    if (conf !== 0) {
      score += conf;
      trace.push({
        factor: "summary_confidence",
        contribution: conf,
        note: `summary confidence ${summary.confidence}/100`,
      });
    }
  } else {
    trace.push({
      factor: "summary_missing",
      contribution: -5,
      note: "no generate_opportunity_summary on file",
    });
    score -= 5;
  }

  // ── Website signals (the ground truth) ─────────────────────────────────
  if (website) {
    const w = website.data;
    if (!w.reachable) {
      score -= 20;
      trace.push({
        factor: "website_unreachable",
        contribution: -20,
        note: "site did not return a 2xx",
      });
    } else {
      score += 10;
      trace.push({ factor: "website_reachable", contribution: 10, note: "site returned 2xx" });
    }

    const wcount = w.weaknesses?.length ?? 0;
    if (wcount > 0) {
      // +6 per distinct weakness, capped at +18 so any single site can't
      // dominate pipeline ranking.
      const contrib = Math.min(wcount * 6, 18);
      score += contrib;
      trace.push({
        factor: "website_weaknesses",
        contribution: contrib,
        note: `${wcount} weakness signal${wcount === 1 ? "" : "s"}`,
      });
    }

    if (!w.https) {
      score += 6;
      trace.push({ factor: "no_https", contribution: 6, note: "no HTTPS — selling angle" });
    }
    if (!w.hasViewport) {
      score += 6;
      trace.push({
        factor: "no_viewport",
        contribution: 6,
        note: "no mobile viewport meta — selling angle",
      });
    }
    if (typeof w.responseMs === "number" && w.responseMs > 4000) {
      score += 5;
      trace.push({
        factor: "slow_response",
        contribution: 5,
        note: `slow first byte (${w.responseMs}ms)`,
      });
    }
  } else {
    trace.push({
      factor: "website_missing",
      contribution: -15,
      note: "no inspect_website on file — cannot verify leak signals",
    });
    score -= 15;
  }

  // ── Call attempt tracking ─────────────────────────────────────────────
  const callAttempts = snap.callAttempts ?? 0;
  const consecutiveNoAnswers = snap.consecutiveNoAnswers ?? 0;
  const escalationStage = snap.escalationStage ?? 0;
  const lastAction = snap.lastAction;
  const daysSinceLastAction = lastAction ? daysSince(lastAction.performedAt) : null;

  // ── Pipeline intelligence — status-aware scoring ─────────────────────
  let momentumBonus = 0;

  if (INTERESTED_STATUSES.has(status)) {
    momentumBonus = 20;
    score += momentumBonus;
    trace.push({ factor: "pipeline_interested", contribution: momentumBonus, note: `status=${status} — warm lead` });
  } else if (MOMENTUM_STATUSES.has(status)) {
    momentumBonus = 10;
    score += momentumBonus;
    trace.push({ factor: "pipeline_momentum", contribution: momentumBonus, note: `status=${status} — warm pipeline` });
  }

  // Follow-up due after no-answer
  if (lastAction?.outcome === "no_answer" && daysSinceLastAction !== null && daysSinceLastAction >= 1) {
    const fuBonus = consecutiveNoAnswers >= 2 ? 12 : 5;
    score += fuBonus;
    trace.push({ factor: "follow_up_due", contribution: fuBonus, note: `no answer ${daysSinceLastAction}d ago (attempt #${callAttempts})` });
  }

  // Multiple no-answers = urgency spike
  if (consecutiveNoAnswers >= 2) {
    score += 8;
    trace.push({ factor: "no_answer_escalation", contribution: 8, note: `${consecutiveNoAnswers} consecutive no-answers — escalate` });
  }

  // Deprioritize after 4+ no-answers (escalation stage 4)
  if (escalationStage >= 4) {
    score -= 15;
    trace.push({ factor: "escalation_deprioritize", contribution: -15, note: "4+ failed attempts — deprioritize" });
  }

  // Deprioritize not-interested
  if (lastAction?.outcome === "not_interested") {
    score -= 30;
    trace.push({ factor: "not_interested", contribution: -30, note: "prospect said not interested" });
  }

  // ── Sub-scores ──────────────────────────────────────────────────────────
  const wCount = website?.data?.weaknesses?.length ?? 0;
  const siteDown = website ? !website.data.reachable : true;
  const opportunityScore = clamp(
    30 + (wCount * 12) + (siteDown ? 25 : 0) + (!website?.data?.hasViewport ? 8 : 0)
  );

  const closabilityScore = clamp(Math.round(
    confidenceFloor * 0.4 +
    (INTERESTED_STATUSES.has(status) ? 40 : 0) +
    (momentumBonus > 0 ? 15 : 0) +
    (callAttempts > 0 && consecutiveNoAnswers === 0 ? 10 : 0) + // connected before = easier
    (lastAction?.outcome === "not_interested" ? -40 : 0) +
    (escalationStage >= 4 ? -20 : 0) +
    20
  ));

  const stale = daysSince(snap.lastCheckedAt);
  const staleFlag = stale === null || stale > 14;
  let urgencyScore = 50;
  if (!staleFlag) urgencyScore += 15;
  if (INTERESTED_STATUSES.has(status)) urgencyScore += 25;
  if (lastAction?.outcome === "no_answer" && daysSinceLastAction !== null && daysSinceLastAction >= 1) urgencyScore += 15;
  if (consecutiveNoAnswers >= 2) urgencyScore += 10;
  if (snap.nextActionDate) {
    const daysOverdue = daysSince(snap.nextActionDate);
    if (daysOverdue !== null && daysOverdue >= 0) urgencyScore += 20;
  }
  urgencyScore = clamp(urgencyScore);

  // ── Deal heat score ─────────────────────────────────────────────────────
  // Temperature of the deal: interest + recency + touches + next-action proximity
  let dealHeat = 20; // base
  if (INTERESTED_STATUSES.has(status)) dealHeat += 40;
  if (daysSinceLastAction !== null && daysSinceLastAction <= 1) dealHeat += 20;
  else if (daysSinceLastAction !== null && daysSinceLastAction <= 3) dealHeat += 10;
  else if (daysSinceLastAction !== null && daysSinceLastAction > 7) dealHeat -= 10;
  if (callAttempts >= 1 && consecutiveNoAnswers === 0) dealHeat += 15; // connected
  if (callAttempts >= 2) dealHeat += 5; // multiple touches
  if (snap.nextActionDate) {
    const daysOverdue = daysSince(snap.nextActionDate);
    if (daysOverdue !== null && daysOverdue >= 0) dealHeat += 15; // overdue = hot
  }
  if (lastAction?.outcome === "not_interested") dealHeat -= 30;
  if (escalationStage >= 4) dealHeat -= 20;
  dealHeat = clamp(dealHeat);
  const dealHeatLevel: DealHeatLevel = dealHeat >= 80 ? "HOT" : dealHeat >= 50 ? "WARM" : "COLD";

  // ── Force action detection ──────────────────────────────────────────────
  let forceAction: string | undefined;
  if (snap.nextActionDate) {
    const daysOverdue = daysSince(snap.nextActionDate);
    if (daysOverdue !== null && daysOverdue >= 0) {
      forceAction = daysOverdue === 0 ? "DO THIS NOW" : `OVERDUE ${daysOverdue}d`;
    }
  }

  // ── Script tone (psychology layer) ──────────────────────────────────────
  let scriptTone: string;
  if (INTERESTED_STATUSES.has(status)) scriptTone = "closing";
  else if (escalationStage >= 3) scriptTone = "urgent";
  else if (escalationStage >= 2 || consecutiveNoAnswers >= 2) scriptTone = "direct";
  else scriptTone = "neutral";

  // ── Clamp + classify ───────────────────────────────────────────────────
  const finalScore = clamp(Math.round(score));

  const level: OpportunityLevel =
    finalScore >= 75 ? "HIGH" : finalScore >= 55 ? "MEDIUM" : "LOW";

  const action: RecommendedAction =
    level === "HIGH" && !staleFlag
      ? "CALL NOW"
      : level === "HIGH"
      ? "TODAY"
      : level === "MEDIUM"
      ? "TODAY"
      : "MONITOR";

  // ── Contactability dimension ──────────────────────────────────────────
  // Reads the latest find_best_contact tool result if persisted; falls back
  // to the durable snap.contactResolution (written by upsertContactResolution
  // after batch hydration) when no tool-level result is on file.
  const contactResult = getLatest<ContactResolution>(snap, "find_best_contact");
  const persistedResolution = snap.contactResolution ?? null;
  const resolvedContact: ContactResolution | null =
    contactResult?.data ?? persistedResolution;
  const contactPaths: ContactPath[] = resolvedContact?.paths ?? [];
  const hasSnapshotPhone = !!snap.contactPhone;
  const bestPath = contactPaths[0];
  const hasVerifiedPath = contactPaths.some((p) => p.verified);
  const hasAnyPhone = contactPaths.some((p) => p.method === "phone") || hasSnapshotPhone;
  const sitePhone = website?.data?.phone_from_site ?? null;
  const siteEmail = website?.data?.email_from_site ?? null;
  const siteForm = website?.data?.has_contact_form ?? false;

  let contactabilityScore = 0;
  if (hasVerifiedPath) contactabilityScore += 55;
  else if (hasAnyPhone) contactabilityScore += 35;
  if (sitePhone) contactabilityScore += 15;
  if (siteEmail) contactabilityScore += 10;
  if (siteForm) contactabilityScore += 10;
  if (resolvedContact?.confidence === "high") contactabilityScore += 15;
  else if (resolvedContact?.confidence === "medium") contactabilityScore += 8;

  // ── Phase 6 modifiers — only when the resolver supplied them ──
  // Corroborated contacts (Google + site phone match, Hunter domain match,
  // etc.) add a small bump.
  if (resolvedContact?.corroborated) contactabilityScore += 6;
  // Person-level email beats generic inbox for reply rate.
  if (resolvedContact?.primaryEmailType === "person_email") contactabilityScore += 4;
  // Completeness floor — STRONG/COMPLETE leads should not score below ~55.
  if (resolvedContact?.contactCompleteness === "COMPLETE") contactabilityScore = Math.max(contactabilityScore, 75);
  else if (resolvedContact?.contactCompleteness === "STRONG") contactabilityScore = Math.max(contactabilityScore, 55);
  // WEAK leads should not float into the CALL NOW zone.
  if (resolvedContact?.contactCompleteness === "WEAK") contactabilityScore = Math.min(contactabilityScore, 25);

  if (!hasSnapshotPhone && !hasAnyPhone && !sitePhone && !siteEmail && !siteForm) {
    contactabilityScore = 5; // not zero — we can still try research
  }
  contactabilityScore = clamp(contactabilityScore);

  // ── Proof dimension ───────────────────────────────────────────────────
  // Strength of live-check evidence. Not a quality score of the site — a
  // score of how well-backed our claims about the site are.
  let proofScore = 0;
  if (website?.data) {
    const w = website.data;
    if (w.homepage_fetch_ok ?? w.reachable) proofScore += 25;
    if (w.has_title ?? !!w.title) proofScore += 10;
    if (w.has_meta_description ?? !!w.metaDescription) proofScore += 10;
    if (typeof w.contentBytes === "number" && w.contentBytes > 0) proofScore += 10;
    if (w.https) proofScore += 10;
    if (w.phone_from_site) proofScore += 15;
    if (w.email_from_site || w.has_contact_form) proofScore += 10;
    if (w.last_checked) proofScore += 10;
  }
  proofScore = clamp(proofScore);

  // ── Verified flags (gate for CALL NOW) ────────────────────────────────
  // verifiedIssue: live-check evidence exists that supports at least one
  // specific revenue-leak claim. Prevents calling "CALL NOW" on a lead when
  // all we have is a Claude summary without a backing scan.
  const verifiedIssue = !!website?.data && (
    website.data.reachable === false ||
    (website.data.weaknesses?.length ?? 0) >= 1
  );
  // verifiedContact: a provider-verified contact path exists (GBP / Yelp /
  // BBB), an operator-curated phone is on file, or an explicit manual
  // override has been set. Site-scraped or inferred paths do not satisfy.
  const verifiedContact = hasVerifiedPath
    || hasSnapshotPhone
    || !!snap.preferredPhone
    || !!snap.preferredEmail;

  // ── Bucket assignment (tightened placement rules) ────────────────────
  // CALL NOW requires verifiedIssue AND verifiedContact AND (not stale OR
  // overdue follow-up). TODAY is a solid issue with weaker contact or lower
  // urgency. MONITOR is partial value. PASS has no actionable angle.
  let bucket: Bucket;
  if (forceAction) {
    bucket = "CALL NOW";
  } else if (level === "HIGH" && verifiedIssue && verifiedContact && !staleFlag) {
    bucket = "CALL NOW";
  } else if (level === "HIGH" && verifiedIssue) {
    bucket = "TODAY";
  } else if (level === "MEDIUM" && verifiedIssue) {
    bucket = "TODAY";
  } else if (level === "MEDIUM" || (level === "LOW" && verifiedIssue && contactabilityScore >= 40)) {
    bucket = "MONITOR";
  } else if (!verifiedIssue && contactabilityScore < 25 && finalScore < 35) {
    bucket = "PASS";
  } else {
    bucket = "MONITOR";
  }

  // ── Deterministic reasons (UI bullets under the bucket) ───────────────
  const reasons: string[] = [];
  if (forceAction) reasons.push(`Follow-up ${forceAction.toLowerCase()}`);
  if (website?.data?.reachable === false) reasons.push("Live site check failed — page did not load content");
  else if ((website?.data?.weaknesses?.length ?? 0) >= 4) reasons.push(`${website!.data.weaknesses!.length} system checks failed on site`);
  else if ((website?.data?.weaknesses?.length ?? 0) >= 1) reasons.push("Live site check flagged visibility gaps");
  if (verifiedContact) reasons.push(`Verified contact path: ${bestPath?.label ?? "on file"}`);
  else if (hasAnyPhone) reasons.push("Contact path available (unverified)");
  else reasons.push("No verified contact path yet");
  if (bucket === "CALL NOW") reasons.push("Fast fix opportunity");
  if (bucket === "PASS") reasons.push("No actionable angle");

  // Close probability: blend confidence floor + momentum + pipeline warmth.
  let closeProbability: CloseProbability;
  if (INTERESTED_STATUSES.has(status)) closeProbability = "High";
  else if (confidenceFloor >= 70 && momentumBonus > 0) closeProbability = "High";
  else if (confidenceFloor >= 50 || momentumBonus > 0) closeProbability = "Medium";
  else closeProbability = "Low";

  // Merge + de-dupe weaknesses; summary-chosen topWeakness bubbles first.
  const weaknessSet: string[] = [];
  const push = (w?: string) => {
    if (!w) return;
    const trimmed = w.trim();
    if (!trimmed) return;
    if (!weaknessSet.includes(trimmed)) weaknessSet.push(trimmed);
  };
  push(summary?.data?.topWeakness);
  for (const w of summary?.data?.weaknesses ?? []) push(w);
  for (const w of website?.data?.weaknesses ?? []) push(w);

  // ── Value estimation ──────────────────────────────────────────────────
  const valueEstimate = estimateValue(wCount, siteDown, !website?.data?.hasViewport);

  // ── Evidence-gated opportunity estimate ───────────────────────────────
  // Computed here so we can include the preliminary websiteProof projection
  // below. Uses ONLY observable signals already on the snapshot.
  const opportunityEstimateProofView: WebsiteProof | null = website?.data
    ? buildWebsiteProof(website.data, website.timestamp)
    : null;
  const opportunityEstimate = computeOpportunityEstimate({
    websiteProof: opportunityEstimateProofView,
    contactResolution: resolvedContact,
    hasVerifiedContact: verifiedContact,
    hasOperatorPhone: hasSnapshotPhone || !!snap.preferredPhone,
    domain: snap.company.domain ?? snap.profile?.domain,
    weaknessCount: wCount,
  });

  // ── LaborTech Fit + Why-This-Closes + Services ──
  const placeholderDomain = isPlaceholderDomain(snap.company.domain ?? snap.profile?.domain);
  const labortechFit = computeLabortechFit({
    websiteProof: opportunityEstimateProofView,
    contactResolution: resolvedContact,
    placeholderDomain,
  });
  const siteIssues = (opportunityEstimateProofView?.issues ?? []) as IssueLiteService[];
  const serviceRecommendations = buildServiceRecommendations(siteIssues);
  const whyThisCloses = buildWhyThisCloses({
    fit: labortechFit,
    topService: serviceRecommendations[0] ?? null,
    reachable: opportunityEstimateProofView?.homepage_fetch_ok !== false,
  });

  // ── Why priority — one-liner for operator ─────────────────────────────
  let whyPriority: string;
  if (forceAction) {
    whyPriority = `${forceAction} — follow-up is due. Don't let this slip.`;
  } else if (INTERESTED_STATUSES.has(status)) {
    whyPriority = "Already interested — high close probability. Follow up NOW.";
  } else if (escalationStage >= 3) {
    whyPriority = `${consecutiveNoAnswers} missed calls — send voicemail + email combo. Last push.`;
  } else if (consecutiveNoAnswers >= 2) {
    whyPriority = `${consecutiveNoAnswers} no-answers — try different time or approach.`;
  } else if (siteDown) {
    whyPriority = `Website completely down — losing all digital leads. ${valueEstimate.monthlyLeadLoss}/mo.`;
  } else if (wCount >= 4) {
    whyPriority = `${wCount} critical gaps — major revenue leak. ${valueEstimate.monthlyLeadLoss}/mo.`;
  } else if (wCount >= 2) {
    whyPriority = `${wCount} fixable weaknesses — easy win for LaborTech.`;
  } else if (momentumBonus > 0) {
    whyPriority = "In conversation. Push to close.";
  } else {
    whyPriority = "Moderate opportunity — room for improvement.";
  }

  const topLine = trace
    .filter((t) => t.factor !== "baseline" && t.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map((t) => `${t.note} (${t.contribution > 0 ? "+" : ""}${t.contribution})`)
    .join("; ");

  // Evidence refs: exactly the tools that contributed.
  const evidenceRefs: EvidenceRef[] = [];
  if (website) {
    evidenceRefs.push({
      tool: "inspect_website",
      timestamp: website.timestamp,
      confidence: website.confidence,
      stub: website.stub,
    });
  }
  if (summary) {
    evidenceRefs.push({
      tool: "generate_opportunity_summary",
      timestamp: summary.timestamp,
      confidence: summary.confidence,
      stub: summary.stub,
    });
  }
  const reviews = getLatest(snap, "inspect_reviews");
  if (reviews) {
    evidenceRefs.push({
      tool: "inspect_reviews",
      timestamp: reviews.timestamp,
      confidence: reviews.confidence,
      stub: reviews.stub,
    });
  }

  // ── Closing strategy ──────────────────────────────────────────────────
  const isInterested = INTERESTED_STATUSES.has(status);
  const topWk = weaknessSet[0] ?? "";

  const dealStrategy = buildDealStrategy({
    closabilityScore, status, escalationStage, consecutiveNoAnswers,
    callAttempts, siteDown, topWeakness: topWk, wCount, dealHeat, interested: isInterested,
  });

  const closePlan = buildClosePlan({
    interested: isInterested, callAttempts, escalationStage, consecutiveNoAnswers, status,
  });

  const conversionNarrative = buildConversionNarrative({
    interested: isInterested, siteDown, wCount, callAttempts, escalationStage,
    contractValue: valueEstimate.estimatedContractValue,
  });

  // ── Close readiness ────────────────────────────────────────────────────
  let closeReadiness: CloseReadiness;
  if (isInterested && consecutiveNoAnswers === 0 && dealHeat >= 60) {
    closeReadiness = "READY TO CLOSE";
  } else if (escalationStage >= 3 || lastAction?.outcome === "not_interested" || dealHeat < 30) {
    closeReadiness = "AT RISK";
  } else {
    closeReadiness = "NOT READY";
  }

  // ── Next move command (one-line instruction) ───────────────────────────
  let nextMoveCommand: string;
  if (forceAction) {
    const na = snap.nextAction ?? "follow up";
    nextMoveCommand = `Next move: ${na} — ${forceAction.toLowerCase()}`;
  } else if (isInterested && closePlan.step1) {
    nextMoveCommand = `Next move: ${closePlan.step1}`;
  } else if (snap.nextAction && snap.nextActionDate) {
    nextMoveCommand = `Next move: ${snap.nextAction.replace(/_/g, " ")} on ${snap.nextActionDate}`;
  } else if (escalationStage >= 3) {
    nextMoveCommand = "Next move: Send email referencing their website issues";
  } else if (consecutiveNoAnswers >= 1) {
    nextMoveCommand = `Next move: Call again at a different time (attempt #${callAttempts + 1})`;
  } else if (callAttempts === 0) {
    nextMoveCommand = "Next move: Make the first call — use the generated script";
  } else {
    nextMoveCommand = `Next move: Follow up on previous ${lastAction?.type ?? "contact"}`;
  }

  // ── Account snapshot ───────────────────────────────────────────────────
  const lastOutcomeStr = lastAction?.outcome
    ? `${lastAction.type} → ${lastAction.outcome}`
    : (callAttempts > 0 ? `${callAttempts} attempts` : "No contact yet");
  const recStr = isInterested ? "Close" : escalationStage >= 3 ? "Email/VM combo"
    : consecutiveNoAnswers >= 2 ? "Try different approach" : callAttempts === 0 ? "Initial outreach" : "Follow up";

  const accountSnapshot = {
    status: status || "NEW",
    touches: callAttempts + (snap.dealActions?.filter((a) => a.type === "email").length ?? 0),
    lastOutcome: lastOutcomeStr,
    recommendation: recStr,
    readiness: closeReadiness,
    nextAction: snap.nextAction ? `${snap.nextAction.replace(/_/g, " ")}${snap.nextActionDate ? ` (${snap.nextActionDate})` : ""}` : nextMoveCommand.replace("Next move: ", ""),
  };

  const confidenceLabel: ConfidenceLabel =
    confidenceFloor >= 70 ? "HIGH" : confidenceFloor >= 40 ? "MEDIUM" : "LOW";

  const websiteProof: WebsiteProof | null = website?.data
    ? buildWebsiteProof(website.data, website.timestamp)
    : null;

  const lastChecked =
    websiteProof?.last_checked
    ?? contactResult?.timestamp
    ?? snap.contactResolutionCheckedAt
    ?? snap.lastCheckedAt
    ?? null;

  const decision: CompanyDecision = {
    key: snap.key,
    name: snap.company.name,
    domain: snap.company.domain,
    location: snap.company.location,
    score: finalScore,
    opportunityScore,
    closabilityScore,
    contactabilityScore,
    proofScore,
    urgency: urgencyScore,
    dealHeat,
    dealHeatLevel,
    callAttempts,
    consecutiveNoAnswers,
    escalationStage,
    opportunityLevel: level,
    recommendedAction: action,
    bucket,
    verifiedIssue,
    verifiedContact,
    closeProbability,
    topWeaknesses: weaknessSet.slice(0, 5),
    pitchAngle: summary?.data?.pitchAngle ?? null,
    whyPriority,
    reasons,
    valueEstimate,
    rationale: topLine || "insufficient evidence — defaulting to monitor",
    trace,
    evidenceRefs,
    confidenceFloor,
    confidenceLabel,
    staleDays: stale,
    lastChecked,
    opportunityEstimate,
    labortechFit,
    serviceRecommendations,
    whyThisCloses,
    trade: snap.trade,
    serviceBucket: snap.serviceBucket,
    // nextAction is a deterministic derivation from every field above; we
    // assemble the rest of the object first, then compute and attach it
    // in one pass below so the helper can read a complete CompanyDecision.
    nextAction: { action: "SKIP FOR NOW", confidence: "LOW", reason: "pending" },
    websiteProof,
    contactPaths,
    contacts: buildDecisionContacts(snap, contactPaths, websiteProof, resolvedContact),
    forceAction,
    scriptTone,
    dealStrategy,
    closePlan,
    conversionNarrative,
    closeReadiness,
    nextMoveCommand,
    accountSnapshot,
  };
  // Compute the Next Action from the fully-assembled decision and attach
  // it in place before returning. Keeps the engine as the single source
  // of truth for "what to do next".
  decision.nextAction = computeNextAction(decision);
  return decision;
}

// ── Ranking across the pipeline ─────────────────────────────────────────

export function rankCompanies(snaps: CompanySnapshot[]): CompanyDecision[] {
  const LEVEL_RANK: Record<OpportunityLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const ranked = snaps
    .map(decideCompany)
    .filter((d) => !d.blocked)
    .sort((a, b) => {
      // Force-action items get a boost but still sort by score within group
      const aForce = a.forceAction ? 0 : 1;
      const bForce = b.forceAction ? 0 : 1;
      if (aForce !== bForce) return aForce - bForce;

      // Within same force-action group, sort by score first
      if (aForce === bForce && aForce === 0) {
        return b.score - a.score;
      }

      // HOT deals next (only for high-scoring leads)
      const heatRank = { HOT: 0, WARM: 1, COLD: 2 } as Record<string, number>;
      const aHeat = heatRank[a.dealHeatLevel] ?? 2;
      const bHeat = heatRank[b.dealHeatLevel] ?? 2;
      if (aHeat !== bHeat && a.score >= 50 && b.score >= 50) return aHeat - bHeat;

      // Level
      const lv = LEVEL_RANK[a.opportunityLevel] - LEVEL_RANK[b.opportunityLevel];
      if (lv !== 0) return lv;

      // Score (primary determinant for most leads)
      if (b.score !== a.score) return b.score - a.score;

      // Composite tiebreaker — contactability + proof fold into the blend so
      // two equally-scored leads sort by how reachable and how well-verified
      // they are.
      const aComp = a.opportunityScore * 0.30 + a.closabilityScore * 0.20 + a.urgency * 0.15
                  + a.dealHeat * 0.10 + a.contactabilityScore * 0.15 + a.proofScore * 0.10;
      const bComp = b.opportunityScore * 0.30 + b.closabilityScore * 0.20 + b.urgency * 0.15
                  + b.dealHeat * 0.10 + b.contactabilityScore * 0.15 + b.proofScore * 0.10;
      if (Math.abs(bComp - aComp) > 2) return bComp - aComp;

      const as = a.staleDays ?? 9999;
      const bs = b.staleDays ?? 9999;
      return as - bs;
    });

  ranked.forEach((d, i) => {
    d.rank = i + 1;
    // Relative priority: explain why this one ranks above the next
    if (i < ranked.length - 1) {
      const next = ranked[i + 1];
      const reasons: string[] = [];
      if (d.forceAction && !next.forceAction) reasons.push("has overdue follow-up");
      if (d.dealHeatLevel === "HOT" && next.dealHeatLevel !== "HOT") reasons.push("hotter deal");
      if (d.dealStrategy.closeabilityTier === "EASY CLOSE" && next.dealStrategy.closeabilityTier !== "EASY CLOSE") reasons.push("easier to close");
      if (d.urgency > next.urgency + 10) reasons.push("more urgent");
      if (d.opportunityScore > next.opportunityScore + 10) reasons.push("bigger opportunity");
      if (d.closabilityScore > next.closabilityScore + 10) reasons.push("higher closability");
      d.whyOverNext = reasons.length > 0
        ? `Ranked above #${i + 2} (${next.name}): ${reasons.join(", ")}.`
        : undefined;
    }
  });
  return ranked;
}
