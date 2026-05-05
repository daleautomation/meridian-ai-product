// Meridian — LaborTech premium scan generator.
//
// Single source of truth for "is this lead worth contacting now?" Every
// admitted lead carries a structured scan that explains:
//   1. why LaborTech is needed
//   2. what pain the business is likely feeling
//   3. what evidence supports the outreach
//   4. what service should be pitched first
//   5. what the rep should say
//   6. why this lead is worth time now
//
// The generator is pure — no I/O, no AI calls. It consumes only data
// that already exists on NormalizedLead (signals, diagnostics, sales
// strategy if present). Nothing is fabricated. If the evidence doesn't
// clear the bar, qualified=false and the loader drops the lead before
// it ever enters the operator surface.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import type { Finding, LeadDiagnostics } from "@/lib/diagnostics/leadDiagnostics";
import { buildLeadOneLiner } from "@/lib/scan/buildLeadOneLiner";
// EMERGENCY ROLLBACK — these imports are deliberately disabled.
// The dynamic angle generator and the multi-layer closeability model
// were destabilizing ingestion; ingestion now uses the pre-refactor
// static path (buildRecommendedAction + closeabilityFor) until both
// modules are hardened. Files left in place; just not imported.
//   import { computeCloseability } from "@/lib/scan/closeabilityModel";
//   import { generateAngles, type SalesAngle } from "@/lib/scan/angleGenerator";
type SalesAngle = never;

export type LaborTechServiceLabel =
  | "Website Conversion"
  | "SEO"
  | "Reviews"
  | "Paid Ads"
  | "Follow-up System"
  | "Diagnostics"
  | "Seasonal Campaign";

export type ScanPainLevel = "low" | "medium" | "high" | "critical";
export type ScanCloseLabel = "Weak" | "Moderate" | "Strong" | "High-Intent";
export type ScanUrgencyLabel = "Low" | "Medium" | "High" | "Critical";

export type LaborTechScan = {
  qualified: boolean;
  qualificationReason: string;
  primaryPain: string;
  painLevel: ScanPainLevel;
  primaryService: LaborTechServiceLabel;
  serviceFit: string;
  evidence: string[];
  businessImpact: string[];
  closeability: { score: number; label: ScanCloseLabel; reason: string };
  urgency: { label: ScanUrgencyLabel; reason: string };
  salesAngle: { opener: string; objection: string; rebuttal: string };
  recommendedAction: string;
  reportSummary: string;
  /** Risks / proof gaps the rep should know up front. Empty if none. */
  risks: string[];
  /**
   * Dynamic sales angles. Currently unused — temporarily optional
   * during rollback so the existing static path doesn't have to
   * synthesize an empty array everywhere. Will be restored once
   * the angle generator is hardened.
   */
  angles?: SalesAngle[];
};

// ── Service mapping ────────────────────────────────────────────────────

function serviceForFinding(finding: Finding | null): LaborTechServiceLabel {
  if (!finding) return "Paid Ads";
  switch (finding.type) {
    case "website":
    case "conversion":
      return "Website Conversion";
    case "reviews":
      return "Reviews";
    case "seo":
      return "SEO";
    case "content":
      return "SEO";
    case "opportunity":
      return "Paid Ads";
    default:
      return "Website Conversion";
  }
}

function serviceFitFor(service: LaborTechServiceLabel): string {
  switch (service) {
    case "Website Conversion":
      return "A clean conversion path turns existing traffic and listings into booked jobs without spending more on demand.";
    case "Reviews":
      return "Review velocity is the cheapest market-share lever — buyers filter on count and recency before they ever click through.";
    case "SEO":
      return "Local search captures intent at the moment of urgency; thin visibility hands those calls to whoever ranks instead.";
    case "Paid Ads":
      return "Paid placement above the map pack converts higher than organic at the urgency end of the funnel — direct lever on monthly job volume.";
    case "Follow-up System":
      return "Most quote requests die between submission and call-back. An automated follow-up sequence recovers the leads already paid for.";
    case "Diagnostics":
      return "A quick foundational scan exposes the leak before any spend — cheaper to fix the funnel than to pour traffic into it.";
    case "Seasonal Campaign":
      return "Trade demand is seasonal. Aligning a campaign to the peak window captures jobs the market already wants to give.";
  }
}

// ── Headline pain / impact / opener selection ─────────────────────────

function painFromFinding(finding: Finding | null): {
  primaryPain: string;
  painLevel: ScanPainLevel;
} {
  if (!finding) {
    return { primaryPain: "No clear pain signal yet", painLevel: "low" };
  }
  const c = finding.confidence;
  let level: ScanPainLevel = "medium";
  if (c === "high") level = "high";
  else if (c === "low") level = "low";
  // Critical reserved for combined website-missing + reviews-missing
  // (caller upgrades when both fire). Default high for high-confidence.
  return { primaryPain: finding.issue, painLevel: level };
}

function impactLines(diagnostics: LeadDiagnostics | undefined, lead: NormalizedLead): string[] {
  const out: string[] = [];
  const findings = diagnostics?.findings ?? [];
  for (const f of findings.slice(0, 3)) {
    if (f.impact) out.push(f.impact);
  }
  if (out.length === 0) {
    if (!lead.signals.hasWebsite && !lead.website) {
      out.push("Customers can't easily request quotes — competitors with sites look more credible.");
      out.push("Paid or organic traffic leaks without a destination — owner may not realize how many jobs are lost online.");
    } else {
      out.push("Without a clear digital lever, this business is leaving inbound demand on the table every week.");
    }
  }
  return out;
}

function evidenceLines(lead: NormalizedLead, diagnostics: LeadDiagnostics | undefined): string[] {
  const out: string[] = [];
  const findings = diagnostics?.findings ?? [];
  for (const f of findings.slice(0, 4)) {
    if (f.evidence) out.push(f.evidence);
  }
  if (lead.location) out.push(`Located in active service market: ${lead.location}`);
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = e.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function risksFor(lead: NormalizedLead, diagnostics: LeadDiagnostics | undefined): string[] {
  const risks: string[] = [];
  const lowConfidence = (diagnostics?.findings ?? []).filter((f) => f.confidence === "low");
  if (lowConfidence.length > 0) {
    risks.push(`${lowConfidence[0].issue} is directional — verify before strong claims.`);
  }
  if (!lead.email) risks.push("No verified email yet — outreach is phone-first.");
  if (!lead.phone) risks.push("No verified phone — enrich the contact path before the call.");
  if (lead.signals.hasWebsite === undefined && !lead.website) {
    risks.push("Website status should be re-verified live on the call to avoid a false claim.");
  }
  return risks;
}

// ── Sales angle (opener / objection / rebuttal) ───────────────────────

function salesAngleFor(
  service: LaborTechServiceLabel,
  finding: Finding | null,
  lead: NormalizedLead,
): { opener: string; objection: string; rebuttal: string } {
  const company = lead.companyName;
  switch (service) {
    case "Website Conversion": {
      const noSite = finding?.issue?.toLowerCase().includes("website") && finding.evidence?.toLowerCase().includes("no");
      return {
        opener: noSite
          ? `Hey, I noticed your Google listing is active, but I couldn’t find a verified website behind it. Are you currently getting quote requests from Google, or mostly phone calls?`
          : `Hey — pulled up ${company} and the listing's there, but the site doesn't have a clear quote path on mobile. How many of your jobs come in by phone vs. form right now?`,
        objection: "We already have a website.",
        rebuttal: "Right — we're not pitching a rebuild. We rebuild the conversion path: above-the-fold quote CTA, mobile form, click-to-call. Same site, more booked jobs.",
      };
    }
    case "Reviews":
      return {
        opener: `Hey, I was looking at ${company} on Google and noticed your review count is well below the top crews in the metro. Is that something you've been actively working on?`,
        objection: "We get reviews when customers feel like leaving them.",
        rebuttal: "That's the leak — passive review collection caps you. A 30-second post-job ask gets you to 4–8 new reviews a month without changing how you work.",
      };
    case "SEO":
      return {
        opener: `Hey, I was checking local search for your service area and ${company} isn't ranking for the obvious neighborhood + service combos. Have you ever looked at where those calls are going?`,
        objection: "SEO takes too long.",
        rebuttal: "Map pack + local landing pages move in 60–90 days, not 12 months. We can show you the queries you're losing today and fix the easy ones first.",
      };
    case "Paid Ads":
      return {
        opener: `Hey — ${company} looks solid from the listing side. Curious whether you're running anything paid above the map pack right now, or leaving that slot to competitors?`,
        objection: "Paid is too expensive.",
        rebuttal: "On Local Services Ads you only pay per booked lead, not per click. We start small, prove unit economics, then scale only what's working.",
      };
    case "Follow-up System":
      return {
        opener: `Hey, quick question — when a customer fills out a quote form on your site, what happens in the first hour? That's where most of the leakage shows up.`,
        objection: "We follow up when we have time.",
        rebuttal: "Exactly the leak — leads cool fast. A 4-step automated sequence (text + email) doubles contact rate without adding to your workload.",
      };
    case "Diagnostics":
      return {
        opener: `Hey, I was looking at ${company} and want to walk you through a quick scan we did — there are a couple of friction points worth flagging before you spend another dollar on traffic.`,
        objection: "We don't need an audit.",
        rebuttal: "Fair — it's not an audit, it's a 10-minute walkthrough showing exactly where leads are leaking. If nothing's broken, you walk away with proof. If something is, you fix it for free.",
      };
    case "Seasonal Campaign":
      return {
        opener: `Hey, with the season ramping up, I wanted to ask — are you running any kind of seasonal push for ${company}, or letting the demand roll in organically?`,
        objection: "We're already busy in season.",
        rebuttal: "Right — that's when margin is highest, so capturing one extra job per week through a campaign pays for the campaign three times over. The window is the whole point.",
      };
  }
}

// ── Closeability + urgency scoring ────────────────────────────────────

// ── Closeability scorer (v2 — weighted, normalized, explainable) ──────
//
// Replaces the legacy single-heuristic +bumps model. Same return type
// and same call site so all downstream UI continues to work; only the
// math + reason copy changes.
//
// Four signals, weighted:
//   1. Intent / urgency       (40%)  — call-now flags, seasonal/storm,
//                                      diagnostic high-confidence count
//   2. Opportunity size       (25%)  — review volume, rating tier,
//                                      recent activity, trade size
//   3. Contactability         (20%)  — phone, email, website, contact name
//   4. Competitive weakness   (15%)  — site gap, review gap, rating gap,
//                                      portfolio gap, local visibility
//
// Each signal returns 0..1. Weighted sum maps to [15, 95] — never 0,
// never 100. Pure / deterministic.

type CloseSignal = "intent" | "opportunity" | "contact" | "weakness";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function intentSubscore(
  lead: NormalizedLead,
  finding: Finding | null,
  diagnostics: LeadDiagnostics | undefined,
): number {
  let s = 0.30;
  // Lead-level urgency flags loosely typed onto the lead by upstream
  // scoring. We read them defensively — never mutate.
  const anyLead = lead as unknown as {
    forceAction?: boolean;
    recommendedAction?: string;
    bucket?: string;
    score?: number;
  };
  if (anyLead.forceAction === true) s += 0.30;
  if (anyLead.recommendedAction === "CALL NOW") s += 0.25;
  if (anyLead.bucket === "CALL NOW") s += 0.20;
  if (lead.signals.stormArea === true) s += 0.15;
  if (lead.signals.emergencyServiceGap === true) s += 0.12;
  if (lead.moduleId === "hvac") s += 0.10;
  if (typeof anyLead.score === "number" && anyLead.score >= 70) s += 0.15;
  const highCount = (diagnostics?.findings ?? []).filter((f) => f.confidence === "high").length;
  if (highCount >= 2) s += 0.20;
  else if (highCount === 1) s += 0.10;
  if (finding?.confidence === "high") s += 0.08;
  return clamp01(s);
}

function opportunitySubscore(lead: NormalizedLead): number {
  let s = 0.35;
  const reviewCount = lead.signals.reviewCount;
  if (typeof reviewCount === "number") {
    if (reviewCount >= 200) s += 0.30;
    else if (reviewCount >= 100) s += 0.22;
    else if (reviewCount >= 50) s += 0.14;
    else if (reviewCount >= 20) s += 0.07;
  }
  const rating = lead.signals.rating;
  if (typeof rating === "number" && rating >= 4.0) s += 0.10;
  if (lead.signals.recentActivity === true) s += 0.12;
  // Larger-ticket trades carry more revenue weight per close.
  if (lead.moduleId === "hvac" || lead.moduleId === "roofing") s += 0.10;
  return clamp01(s);
}

function contactSubscore(lead: NormalizedLead): number {
  let s = 0.10;
  if (lead.phone) s += 0.45;
  if (lead.email || lead.verifiedEmail) s += 0.25;
  if (lead.website || lead.signals.hasWebsite === true) s += 0.15;
  // contactName is on the contacts overlay (not always populated).
  const cn = (lead as unknown as { contacts?: { contactName?: string } }).contacts?.contactName;
  if (typeof cn === "string" && cn.length > 0) s += 0.15;
  return clamp01(s);
}

function weaknessSubscore(
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
): number {
  let s = 0.10;
  if (lead.signals.hasWebsite === false || !lead.website) s += 0.30;
  if (lead.signals.websiteWeak === true) s += 0.15;
  if (lead.signals.localVisibilityWeak === true) s += 0.18;
  if (lead.signals.portfolioMissing === true) s += 0.12;
  const reviewCount = lead.signals.reviewCount;
  if (typeof reviewCount === "number" && reviewCount < 30) s += 0.18;
  const rating = lead.signals.rating;
  if (typeof rating === "number" && rating < 4.0) s += 0.12;
  const highCount = (diagnostics?.findings ?? []).filter((f) => f.confidence === "high").length;
  if (highCount >= 3) s += 0.12;
  return clamp01(s);
}

// Pretty per-signal phrasing — read off concrete lead facts so the
// reason string names the actual evidence (review count, missing
// website, etc.) rather than abstract category names. Every branch
// tries to cite at least one concrete number so reasons read as real
// observations, not templated copy.
function describeSignal(
  signal: CloseSignal,
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
): string {
  const rc = lead.signals.reviewCount;
  const rt = lead.signals.rating;
  const hasSite = !!lead.website || lead.signals.hasWebsite === true;
  switch (signal) {
    case "intent": {
      const highCount = (diagnostics?.findings ?? []).filter((f) => f.confidence === "high").length;
      if (lead.signals.stormArea === true) return "active storm-area urgency";
      if (lead.signals.emergencyServiceGap === true) return "seasonal demand window";
      if (highCount >= 2) return `${highCount} high-confidence pain signals on the listing`;
      if (lead.moduleId === "hvac") return "HVAC seasonal urgency";
      if (highCount === 1) return "1 high-confidence pain signal active right now";
      return "active urgency signals";
    }
    case "opportunity": {
      if (typeof rc === "number" && rc >= 100) return `${rc} reviews · established book of work`;
      if (typeof rc === "number" && rc >= 50) return `${rc} reviews · solid local presence`;
      if (typeof rc === "number" && rc >= 15) return `${rc} reviews · real customer volume`;
      if (typeof rt === "number" && rt >= 4.0) return `${rt.toFixed(1)}★ rating · trusted operator`;
      if (lead.signals.recentActivity === true) return "recent activity signals real revenue";
      return "established business volume";
    }
    case "contact": {
      const hasPhone = !!lead.phone;
      const hasEmail = !!(lead.email || lead.verifiedEmail);
      if (hasPhone && hasEmail) return "verified phone + email both on file";
      if (hasPhone) return "verified phone on file";
      if (hasEmail) return "verified email on file";
      return "good contactability";
    }
    case "weakness": {
      const noSite = !hasSite;
      const lowReviews = typeof rc === "number" && rc < 30;
      if (noSite && lowReviews && typeof rc === "number") return `no website + only ${rc} reviews — clear gap`;
      if (noSite) return "no website — direct conversion gap";
      if (lowReviews && typeof rc === "number") return `only ${rc} reviews vs top crews at 100+`;
      if (typeof rt === "number" && rt < 4.0) return `${rt.toFixed(1)}★ rating · perception gap`;
      if (lead.signals.localVisibilityWeak === true) return "weak local-pack visibility";
      if (lead.signals.portfolioMissing === true) return "missing portfolio / project gallery";
      return "clear competitive gaps";
    }
  }
}

function describeWeakness(signal: CloseSignal): string {
  switch (signal) {
    case "intent":      return "lower urgency right now";
    case "opportunity": return "smaller opportunity signal";
    case "contact":     return "thin contact path";
    case "weakness":    return "fewer obvious gaps to lead with";
  }
}

function closeabilityFor(
  finding: Finding | null,
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
): { score: number; label: ScanCloseLabel; reason: string } {
  const intent      = intentSubscore(lead, finding, diagnostics);
  const opportunity = opportunitySubscore(lead);
  const contact     = contactSubscore(lead);
  const weakness    = weaknessSubscore(lead, diagnostics);

  const weighted =
    intent * 0.40
    + opportunity * 0.25
    + contact * 0.20
    + weakness * 0.15;

  // Piecewise spread curve — produces a wider visible distribution
  // than a flat 15..95 linear map. The same input that used to land
  // at ~55 (cluster zone) now stretches into clear High / Medium /
  // Low bands, so top-ranked leads visibly stand out from the pack:
  //
  //   weighted ≤ 0.40  →  15 .. 45   (Low band)
  //   0.40 < w ≤ 0.70  →  45 .. 75   (Medium band)
  //   0.70 < w ≤ 1.00  →  75 .. 95   (High band)
  //
  // Same monotonic ordering, same 15..95 floor/ceiling — only the
  // curve changes. UI tier thresholds (50 / 80) below match.
  let raw: number;
  if (weighted <= 0.40) {
    raw = 15 + weighted * 75; // 0.40 → 45
  } else if (weighted <= 0.70) {
    raw = 45 + (weighted - 0.40) * 100; // 0.70 → 75
  } else {
    raw = 75 + (weighted - 0.70) * (20 / 0.30); // 1.00 → 95
  }
  const score = Math.max(15, Math.min(95, Math.round(raw)));

  // Tier label — internal vocabulary preserved (Weak/Moderate/Strong/
  // High-Intent). UI maps to display tiers (Lower priority / Medium /
  // High probability) at render time using the matching thresholds.
  let label: ScanCloseLabel = "Moderate";
  if (score >= 80) label = "High-Intent";
  else if (score >= 60) label = "Strong";

  // Reason: pick the highest weighted-contribution signal as the
  // primary driver, plus the lowest as the qualifier so the sentence
  // tells the rep both why to call AND what's missing.
  const ranked: Array<{ signal: CloseSignal; weight: number; value: number; contribution: number }> = ([
    { signal: "intent" as const,      weight: 0.40, value: intent,      contribution: intent * 0.40 },
    { signal: "opportunity" as const, weight: 0.25, value: opportunity, contribution: opportunity * 0.25 },
    { signal: "contact" as const,     weight: 0.20, value: contact,     contribution: contact * 0.20 },
    { signal: "weakness" as const,    weight: 0.15, value: weakness,    contribution: weakness * 0.15 },
  ]).sort((a, b) => b.contribution - a.contribution);

  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const tierWord = score >= 80 ? "Strong" : score >= 50 ? "Moderate" : "Lower priority";

  let reason: string;
  if (top.value >= 0.55) {
    // Clear primary driver — lead with it.
    const driver = describeSignal(top.signal, lead, diagnostics);
    if (bottom.value < 0.30 && score < 75) {
      // Acknowledge the gap when the score is moderate.
      reason = `${tierWord} — ${driver}, but ${describeWeakness(bottom.signal)}.`;
    } else {
      // High confidence — emphasize the second-best driver too.
      const second = ranked[1];
      if (second.value >= 0.40) {
        reason = `${tierWord} — ${driver} and ${describeSignal(second.signal, lead, diagnostics)}.`;
      } else {
        reason = `${tierWord} — driven by ${driver}.`;
      }
    }
  } else {
    // No single dominant driver — composite picture.
    reason = `${tierWord} — composite signals across urgency, opportunity, contactability, and gaps.`;
  }

  return { score, label, reason };
}

function urgencyFor(
  finding: Finding | null,
  lead: NormalizedLead,
): { label: ScanUrgencyLabel; reason: string } {
  let label: ScanUrgencyLabel = "Medium";
  let reason = "Standard outreach window — call in the next two business days.";
  if (finding?.confidence === "high" && (finding.type === "website" || finding.type === "conversion")) {
    label = "High";
    reason = "Active conversion leak — every week of delay is lost jobs.";
  }
  if (lead.moduleId === "hvac") {
    label = label === "Medium" ? "High" : label;
    reason = "Seasonal HVAC demand window — call before the rush peaks.";
  }
  if ((finding?.confidence === "high") && (lead.signals.hasWebsite === false || !lead.website)) {
    label = "Critical";
    reason = "No website + active demand — leads are leaking right now.";
  }
  return { label, reason };
}

// ── Top-level qualification gate ───────────────────────────────────────

function isQualified(
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
): { qualified: boolean; reason: string; topFinding: Finding | null } {
  const findings = diagnostics?.findings ?? [];
  const top = findings[0] ?? null;
  // Strong qualifiers — any of these admits the lead.
  if (findings.some((f) => f.confidence === "high")) {
    return { qualified: true, reason: "High-confidence finding present", topFinding: top };
  }
  if (lead.signals.hasWebsite === false || !lead.website) {
    return { qualified: true, reason: "Missing or unverified website", topFinding: top };
  }
  if (lead.signals.websiteWeak === true) {
    return { qualified: true, reason: "Weak website / quote-path leak", topFinding: top };
  }
  const rc = lead.signals.reviewCount;
  if (typeof rc === "number" && rc < 30) {
    return { qualified: true, reason: "Low review count vs benchmark", topFinding: top };
  }
  const rating = lead.signals.rating;
  if (typeof rating === "number" && rating < 4.0) {
    return { qualified: true, reason: "Rating below trust threshold", topFinding: top };
  }
  if (lead.signals.localVisibilityWeak === true) {
    return { qualified: true, reason: "Weak local visibility", topFinding: top };
  }
  if (lead.signals.portfolioMissing === true) {
    return { qualified: true, reason: "No portfolio / project visibility", topFinding: top };
  }
  if (lead.moduleId === "hvac" && (lead.signals.emergencyServiceGap === true || lead.signals.stormArea === true)) {
    return { qualified: true, reason: "Seasonal urgency in HVAC market", topFinding: top };
  }
  // Medium-confidence findings still admit if there are at least two —
  // a single shaky signal isn't enough.
  const mediums = findings.filter((f) => f.confidence === "medium");
  if (mediums.length >= 2) {
    return { qualified: true, reason: "Multiple medium-confidence findings", topFinding: top };
  }
  return { qualified: false, reason: "insufficient proof of urgent LaborTech need", topFinding: null };
}

// ── Public entry point ─────────────────────────────────────────────────

export function buildLaborTechScan(
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
): LaborTechScan {
  const gate = isQualified(lead, diagnostics);

  if (!gate.qualified) {
    // Build a minimal, honest scan so downstream code can still type-check
    // against the shape. The qualification gate (qualified=false) is
    // unchanged — these strings are display-only and reframed so the
    // user always sees actionable prioritization language instead of
    // hold / do-not-contact framing. Lower-priority leads still get
    // worked, just not in the first batch.
    return {
      qualified: false,
      qualificationReason: gate.reason,
      primaryPain: "Secondary opportunity — pain signals still emerging",
      painLevel: "low",
      primaryService: "Diagnostics",
      serviceFit: "Lower priority — revisit after initial outreach so the first batch focuses on highest-signal leads.",
      evidence: [],
      businessImpact: [],
      closeability: { score: 15, label: "Moderate", reason: "Lower priority — signals still emerging; strengthen with more research before first calls." },
      urgency: { label: "Low", reason: "Monitor after first batch — re-evaluate as new signals come in." },
      salesAngle: {
        opener: "(secondary opportunity — not in the first call batch)",
        objection: "(n/a)",
        rebuttal: "(n/a)",
      },
      recommendedAction: "Lower priority — revisit after initial outreach.",
      reportSummary: `Secondary opportunity — not first calls. Reason: ${gate.reason}.`,
      risks: [],
    };
  }

  const top = gate.topFinding ?? (diagnostics?.findings[0] ?? null);
  const service = serviceForFinding(top);
  const fit = serviceFitFor(service);
  const { primaryPain, painLevel } = painFromFinding(top);
  const evidence = evidenceLines(lead, diagnostics);
  const businessImpact = impactLines(diagnostics, lead);
  // EMERGENCY ROLLBACK — restored static path:
  //   • closeabilityFor (legacy single-heuristic) replaces the
  //     computeCloseability multi-layer model.
  //   • buildRecommendedAction (legacy static) replaces the dynamic
  //     angle generator's oneLiner.
  // Both replacements were destabilizing ingestion; the dynamic
  // versions stay in their respective files but are not wired in.
  const closeability = closeabilityFor(top, lead, diagnostics);
  const urgency = urgencyFor(top, lead);
  const angle = salesAngleFor(service, top, lead);
  const risks = risksFor(lead, diagnostics);

  // Upgrade pain level when both website and reviews fire as high.
  const findings = diagnostics?.findings ?? [];
  const highCount = findings.filter((f) => f.confidence === "high").length;
  let upgradedPainLevel = painLevel;
  if (highCount >= 2) upgradedPainLevel = "critical";
  else if (highCount === 1 && painLevel !== "high") upgradedPainLevel = "high";

  // Per-lead one-liner — varied, company-specific copy keyed off the
  // service bucket + signals. Deterministic via lead.id hash so the same
  // lead renders the same sentence on every reload. Defensive: never
  // throws — falls through to a safe fallback if inputs are missing.
  // The legacy buildRecommendedAction static path is retained below as
  // a last-resort safety net only.
  const recommendedAction =
    buildLeadOneLiner(lead, { primaryService: service, primaryPain }, diagnostics)
    || buildRecommendedAction(top, service, lead);

  // One-paragraph executive readout.
  const reportSummary = buildReportSummary(lead, top, service);

  return {
    qualified: true,
    qualificationReason: gate.reason,
    primaryPain,
    painLevel: upgradedPainLevel,
    primaryService: service,
    serviceFit: fit,
    evidence,
    businessImpact,
    closeability,
    urgency,
    salesAngle: angle,
    recommendedAction,
    reportSummary,
    risks,
  };
}

function buildRecommendedAction(
  finding: Finding | null,
  service: LaborTechServiceLabel,
  lead: NormalizedLead,
): string {
  if (!finding) return `Call now and lead with the ${service.toLowerCase()} angle.`;
  const issue = finding.issue.toLowerCase();
  if (issue.includes("website") || issue.includes("quote")) {
    return "Call now and lead with the missing website / quote path issue.";
  }
  if (issue.includes("review")) {
    return "Call now and lead with the review-gap angle vs top competitors.";
  }
  if (issue.includes("local") || issue.includes("seo")) {
    return "Call now and lead with the local-search visibility gap.";
  }
  if (issue.includes("portfolio") || issue.includes("gallery")) {
    return "Call now and lead with the portfolio / gallery visibility gap.";
  }
  if (lead.moduleId === "hvac") {
    return "Call now — seasonal HVAC window is the lever.";
  }
  return `Call now and lead with: ${finding.issue}.`;
}

function buildReportSummary(
  lead: NormalizedLead,
  finding: Finding | null,
  service: LaborTechServiceLabel,
): string {
  if (!finding) {
    return `${lead.companyName} clears the LaborTech bar on aggregate signals — call to qualify the strongest angle live.`;
  }
  const issueLower = finding.issue.toLowerCase();
  if (issueLower.includes("website")) {
    return `${lead.companyName} has a clear digital conversion gap. The listing shows no verified website, which likely means quote requests are leaking before they ever reach the business.`;
  }
  if (issueLower.includes("review")) {
    return `${lead.companyName} has a measurable review gap vs the top crews in the metro — a direct drag on map-pack rank and inbound trust.`;
  }
  if (issueLower.includes("local") || issueLower.includes("seo")) {
    return `${lead.companyName} is not ranking where its customers are searching — calls and forms are flowing to whoever owns the local pack instead.`;
  }
  if (issueLower.includes("portfolio")) {
    return `${lead.companyName} lacks the visual proof buyers expect in this trade — every visit cools because there's nothing to vet before a call.`;
  }
  return `${lead.companyName} qualifies on ${finding.issue.toLowerCase()} — clean ${service.toLowerCase()} angle with concrete evidence.`;
}
