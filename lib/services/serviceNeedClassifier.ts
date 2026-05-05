// Meridian — service-need classifier.
//
// Reads a NormalizedLead's signals and returns the LaborTech services
// the lead most clearly needs today, with urgency, reason, and a
// rep-ready pitch line. Pure function — no I/O, no API calls.
//
// The classifier ONLY emits services this trade actually offers
// (lib/services/tradeServiceConfig.ts). High-call-volume rules and
// visual-trade rules use the trade id, not text hints, so the output
// is deterministic.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import { tradeOffersService, tierForService } from "./tradeServiceConfig";
import { getService } from "./serviceCatalog";
import {
  findingForService,
  type Finding,
} from "@/lib/diagnostics/leadDiagnostics";

export type ServiceNeedUrgency = "call_now" | "build_next" | "monitor";

export type ServiceNeed = {
  serviceId: string;
  label: string;
  tier: "primary" | "secondary" | "advanced" | null;
  needScore: number;            // 0–100; higher = more urgent
  urgency: ServiceNeedUrgency;
  reason: string;               // one-line, plain English
  evidence: string[];           // observable signals that fired this need
  suggestedPitch: string;       // a rep-ready opener
};

const HIGH_CALL_VOLUME_TRADES = new Set(["plumbing", "hvac", "electrical", "roofing"]);
const VISUAL_TRADES = new Set(["painting", "carpentry", "roofing"]);

const REVIEW_THRESHOLD = 25;
const RATING_FLOOR = 4.5;
const HIGH_REVIEW_BAR = 100;

function urgencyFromScore(score: number): ServiceNeedUrgency {
  if (score >= 75) return "call_now";
  if (score >= 50) return "build_next";
  return "monitor";
}

function pitch(company: string, line: string): string {
  return `Hey ${company} — ${line}`;
}

export function classifyLeadServiceNeeds(
  lead: NormalizedLead,
  tradeId: string,
): ServiceNeed[] {
  const company = lead.companyName || "there";
  const hasWebsite = lead.signals.hasWebsite === true || !!lead.website;
  const websiteWeak = lead.signals.websiteWeak === true;
  const reviewCount = typeof lead.signals.reviewCount === "number" ? lead.signals.reviewCount : undefined;
  const rating = typeof lead.signals.rating === "number" ? lead.signals.rating : undefined;
  const lowReviews = reviewCount !== undefined && reviewCount < REVIEW_THRESHOLD;
  const subTopReviews = reviewCount !== undefined && reviewCount < HIGH_REVIEW_BAR;
  const lowRating = rating !== undefined && rating < RATING_FLOOR;
  const hasPhone = !!lead.phone;
  const recentActivity = lead.signals.recentActivity === true;
  const stormArea = lead.signals.stormArea === true;
  const emergencyServiceGap = lead.signals.emergencyServiceGap === true;
  const portfolioMissing = lead.signals.portfolioMissing === true;
  const localVisibilityWeak = lead.signals.localVisibilityWeak === true;

  const out: ServiceNeed[] = [];
  const offered = (id: string) => tradeOffersService(tradeId, id);

  // Confidence boost: a high-confidence diagnostic finding bumps the
  // need score by 8, medium by 4, low by 0. Caps at 100.
  function findingBoost(f: Finding | null): number {
    if (!f) return 0;
    if (f.confidence === "high") return 8;
    if (f.confidence === "medium") return 4;
    return 0;
  }

  function push(
    serviceId: string,
    score: number,
    reason: string,
    evidence: string[],
    pitchLine: string,
  ) {
    if (!offered(serviceId)) return;
    const cfg = getService(serviceId);
    if (!cfg) return;
    // Pull a matching diagnostic finding and let it override the
    // generic reason / pitch / evidence with verifiable data.
    const finding = findingForService(lead.diagnostics, serviceId);
    const finalScore = Math.max(0, Math.min(100, Math.round(score + findingBoost(finding))));
    const finalReason = finding
      ? `${finding.issue} — ${finding.evidence}.`
      : reason;
    const finalEvidence = finding
      ? [finding.evidence, ...evidence]
      : evidence;
    const finalPitch = finding
      ? pitch(
          company,
          `I noticed ${finding.issue.toLowerCase()} — ${finding.evidence}. ${finding.impact}`,
        )
      : pitch(company, pitchLine);
    out.push({
      serviceId,
      label: cfg.label,
      tier: tierForService(tradeId, serviceId),
      needScore: finalScore,
      urgency: urgencyFromScore(finalScore),
      reason: finalReason,
      evidence: finalEvidence,
      suggestedPitch: finalPitch,
    });
  }

  // ── Website & Funnel ────────────────────────────────────────────
  if (!hasWebsite) {
    push(
      "website_funnel",
      90,
      "No website on file — every other channel leaks without one.",
      ["signals.hasWebsite is false"],
      "I noticed you don't have a site up. The whole funnel leaks without one. Got 60 seconds?",
    );
  } else if (websiteWeak) {
    push(
      "website_funnel",
      75,
      "Quote path / mobile conversion weakness on the existing site.",
      ["signals.websiteWeak"],
      "I ran through your site and the quote path is leaking before submit. Want a 2-minute walkthrough?",
    );
  }

  // ── SEO ─────────────────────────────────────────────────────────
  if (localVisibilityWeak || lowReviews || !hasWebsite) {
    const score = !hasWebsite ? 70 : localVisibilityWeak ? 70 : 60;
    const reason = !hasWebsite
      ? "No website + no organic surface to rank — SEO needs a target first."
      : localVisibilityWeak
      ? "Local visibility is weak in the map pack."
      : "Low review count is dragging organic + local rank.";
    push(
      "seo",
      score,
      reason,
      [
        ...(localVisibilityWeak ? ["signals.localVisibilityWeak"] : []),
        ...(lowReviews ? [`reviewCount=${reviewCount}`] : []),
        ...(hasWebsite ? [] : ["no website"]),
      ],
      "Your name didn't crack the top six on the searches your buyers run. Want to see the gap?",
    );
  }

  // ── Google Ads ──────────────────────────────────────────────────
  if (hasPhone && (emergencyServiceGap || stormArea || (HIGH_CALL_VOLUME_TRADES.has(tradeId) && hasWebsite))) {
    const score = emergencyServiceGap || stormArea ? 80 : 60;
    push(
      "google_ads",
      score,
      "Urgent / high-intent searches exist and the business has a phone to convert them.",
      [
        ...(emergencyServiceGap ? ["signals.emergencyServiceGap"] : []),
        ...(stormArea ? ["signals.stormArea"] : []),
        ...(hasPhone ? ["phone present"] : []),
      ],
      "Pulled the high-intent searches in your zip codes — your name's not in the top six. Worth a quick fix?",
    );
  }

  // ── Meta Ads ────────────────────────────────────────────────────
  if (VISUAL_TRADES.has(tradeId) && (portfolioMissing || subTopReviews)) {
    push(
      "meta_ads",
      55,
      "Visual trade with thin portfolio / proof — Meta creative converts on photos.",
      [
        ...(portfolioMissing ? ["signals.portfolioMissing"] : []),
        ...(subTopReviews ? [`reviewCount=${reviewCount}`] : []),
      ],
      "Your competitors are running before/after Meta ads in your market. Want me to send the breakdown?",
    );
  }

  // ── Social Media Management ─────────────────────────────────────
  if (VISUAL_TRADES.has(tradeId) && (portfolioMissing || lowReviews)) {
    push(
      "social_media_management",
      50,
      "Visual proof trade with thin organic presence.",
      [
        ...(portfolioMissing ? ["signals.portfolioMissing"] : []),
        ...(lowReviews ? [`reviewCount=${reviewCount}`] : []),
      ],
      "Your project work isn't showing up on social — that's the asset that closes referrals. Worth a quick fix?",
    );
  }

  // ── Email & SMS ─────────────────────────────────────────────────
  if (recentActivity || lowReviews) {
    push(
      "email_sms",
      55,
      "Follow-up / retention cadence is doing real work for this trade — recover cold quotes automatically.",
      [
        ...(recentActivity ? ["signals.recentActivity"] : []),
        ...(lowReviews ? [`reviewCount=${reviewCount}`] : []),
      ],
      "Most of your cold quotes recover with a 3-day / 7-day cadence. Want me to set that up?",
    );
  }

  // ── CRM ─────────────────────────────────────────────────────────
  if (hasPhone && (lowReviews || !hasWebsite || websiteWeak)) {
    push(
      "crm",
      60,
      "Lead handling is fragmented — quotes and follow-ups need a system.",
      [
        ...(lowReviews ? [`reviewCount=${reviewCount}`] : []),
        ...(!hasWebsite ? ["no website"] : []),
        ...(websiteWeak ? ["signals.websiteWeak"] : []),
      ],
      "Where do your leads live today? If the answer is text threads, there's a leak.",
    );
  }

  // ── Appointment Scheduler ───────────────────────────────────────
  if (hasPhone && (HIGH_CALL_VOLUME_TRADES.has(tradeId) || emergencyServiceGap)) {
    push(
      "appointment_scheduler",
      60,
      "Phone is on file but no booking flow — back-and-forth phone tag is killing conversion.",
      [
        ...(emergencyServiceGap ? ["signals.emergencyServiceGap"] : []),
        ...(HIGH_CALL_VOLUME_TRADES.has(tradeId) ? [`high-call trade=${tradeId}`] : []),
      ],
      "Your customers should be able to book a slot at midnight. Right now they can't. Worth a 5-minute fix?",
    );
  }

  // ── Reputation Management ───────────────────────────────────────
  if (lowReviews || lowRating) {
    push(
      "reputation_management",
      lowReviews ? 80 : 65,
      lowReviews
        ? `Only ${reviewCount} reviews — buyers compare star count and recency before calling.`
        : `Rating is ${rating} — leaves an opening for a competitor.`,
      [
        ...(lowReviews ? [`reviewCount=${reviewCount}`] : []),
        ...(lowRating ? [`rating=${rating}`] : []),
      ],
      "Reputation is the cheapest conversion lever you have. Want to see the 3-step playbook?",
    );
  }

  // ── Lead Generation ────────────────────────────────────────────
  if (hasPhone && hasWebsite && !lowReviews && !websiteWeak) {
    push(
      "lead_generation",
      40,
      "Foundations are in place — net-new pipeline could compound on top.",
      [
        "phone present",
        "website present",
        "reviews above threshold",
      ],
      "Your basics are tight. The next win is net-new pipeline that doesn't compete with your organic. Got a minute?",
    );
  }

  // ── Blog Posting ────────────────────────────────────────────────
  if (hasWebsite && (localVisibilityWeak || subTopReviews)) {
    push(
      "blog_posting",
      35,
      "Compounding organic content lifts long-tail and education searches.",
      [
        ...(localVisibilityWeak ? ["signals.localVisibilityWeak"] : []),
        ...(subTopReviews ? [`reviewCount=${reviewCount}`] : []),
      ],
      "Your service pages are thin on the education searches buyers run before they call. Want the gap analysis?",
    );
  }

  // ── Chat AI Agent ──────────────────────────────────────────────
  if (hasWebsite) {
    push(
      "chat_ai_agent",
      40,
      "Website is up — a chat agent captures after-hours leads and qualifies in real time.",
      ["website present"],
      "Your site goes quiet after 6pm. That's where after-hours leads live. Want to see the chat playbook?",
    );
  }

  // ── Voice AI Agent ─────────────────────────────────────────────
  if (HIGH_CALL_VOLUME_TRADES.has(tradeId) && hasPhone) {
    push(
      "voice_ai_agent",
      55,
      "High-call-volume trade — overflow + after-hours calls drop without an AI receptionist.",
      [`high-call trade=${tradeId}`, "phone present"],
      "Every missed call is a lost job in your trade. Want the AI voice setup that catches them?",
    );
  }

  // ── Media Production ───────────────────────────────────────────
  if (VISUAL_TRADES.has(tradeId) && (portfolioMissing || subTopReviews)) {
    push(
      "media_production",
      50,
      "Visual trade — real project photos beat stock or phone photos every time.",
      [
        ...(portfolioMissing ? ["signals.portfolioMissing"] : []),
        ...(subTopReviews ? [`reviewCount=${reviewCount}`] : []),
      ],
      "Your gallery is the leak. Buyers vet on photos before they call. Worth a quick photo refresh?",
    );
  }

  // Sort by needScore desc — highest urgency first.
  out.sort((a, z) => z.needScore - a.needScore);
  return out;
}

// Aggregate helper: for a list of leads in one trade, count how many
// needs each service. Used to populate per-service-bucket counts in the
// trade panel without re-running the classifier per render.
export type ServiceBucketCount = {
  serviceId: string;
  count: number;
  topNeedScore: number;
  topReason: string;
};

export function aggregateServiceBuckets(
  needsByLead: ServiceNeed[][],
): Map<string, ServiceBucketCount> {
  const map = new Map<string, ServiceBucketCount>();
  for (const list of needsByLead) {
    for (const need of list) {
      const cur = map.get(need.serviceId);
      if (!cur) {
        map.set(need.serviceId, {
          serviceId: need.serviceId,
          count: 1,
          topNeedScore: need.needScore,
          topReason: need.reason,
        });
      } else {
        cur.count++;
        if (need.needScore > cur.topNeedScore) {
          cur.topNeedScore = need.needScore;
          cur.topReason = need.reason;
        }
      }
    }
  }
  return map;
}
