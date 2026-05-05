// Meridian — Top-1% Closer sales strategy layer.
//
// Pure helper. Reads a NormalizedLead's diagnostics + decision +
// service-need classifications and emits a fully-formed sales plan:
// 3 ranked angles, 3 likely objections with rep-ready responses,
// a structured call plan, and a 0–100 close probability.
//
// No I/O. No external calls. Composable on top of the existing
// diagnostics + service-need stack — does not mutate scoring,
// scheduling, or service mappings.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import type { Finding } from "@/lib/diagnostics/leadDiagnostics";
import type { ServiceNeed } from "@/lib/services/serviceNeedClassifier";

export type CloseConfidence = "high" | "medium" | "low";
export type CloseLabel = "hot" | "strong" | "workable" | "nurture";

export type SalesAngle = {
  rank: 1 | 2 | 3;
  label: string;
  issue: string;
  evidence: string;
  impact: string;
  serviceId?: string;
  serviceLabel?: string;
  pitch: string;
  pivotLine: string;
};

export type SalesObjection = {
  objection: string;
  likelyReason: string;
  response: string;
  followUpQuestion: string;
};

export type SalesCallPlan = {
  opener: string;
  discoveryQuestions: string[];
  positioning: string;
  recommendedOffer: string;
  nextBestAction: string;
};

export type SalesStrategy = {
  closeProbability: number;
  confidence: CloseConfidence;
  closeLabel: CloseLabel;
  primaryAngle: SalesAngle;
  angles: SalesAngle[];
  objections: SalesObjection[];
  callPlan: SalesCallPlan;
};

const HIGH_CALL_VOLUME_TRADES = new Set(["plumbing", "hvac", "electrical", "roofing"]);
const VISUAL_TRADES = new Set(["painting", "carpentry", "roofing"]);

// Map a finding type to a clean angle "axis" so we don't ship three
// identical review-angle pitches. Two findings on the same axis
// collapse to one angle.
function axisOfFinding(f: Finding): string {
  return f.type;
}

function axisOfService(s: ServiceNeed | undefined): string {
  if (!s) return "service";
  if (s.serviceId === "reputation_management") return "reviews";
  if (s.serviceId === "website_funnel") return "website";
  if (s.serviceId === "seo" || s.serviceId === "blog_posting") return "seo";
  if (s.serviceId === "google_ads" || s.serviceId === "meta_ads") return "ads";
  if (s.serviceId === "appointment_scheduler" || s.serviceId === "crm") return "conversion";
  if (s.serviceId === "media_production" || s.serviceId === "social_media_management") return "content";
  if (s.serviceId === "lead_generation") return "lead_gen";
  if (s.serviceId === "voice_ai_agent" || s.serviceId === "chat_ai_agent") return "automation";
  return "service";
}

function buildAnglePitch(company: string, issue: string, evidence: string, impact: string): string {
  // Spoken English. Direct, evidence-led. No em dashes per house style.
  return `Hey ${company} — quick one, I noticed ${issue.toLowerCase()}: ${evidence}. ${impact}`;
}

function pivotForAngle(angle: { issue: string; serviceLabel?: string }): string {
  const focus = angle.serviceLabel ? angle.serviceLabel.toLowerCase() : "this gap";
  return `If they hesitate, pivot to: "Want me to show you the exact ${focus} fix in two minutes?"`;
}

function angleFromFinding(rank: 1 | 2 | 3, f: Finding, serviceMatch?: ServiceNeed, company = "there"): SalesAngle {
  const labelMap: Record<string, string> = {
    reviews: "Reputation gap",
    website: "Website / funnel leak",
    conversion: "Quote path leak",
    seo: "Local visibility gap",
    content: "Proof / portfolio gap",
    opportunity: "Growth opportunity",
  };
  const label = labelMap[f.type] ?? "Sales opportunity";
  const angle: SalesAngle = {
    rank,
    label,
    issue: f.issue,
    evidence: f.evidence,
    impact: f.impact,
    serviceId: serviceMatch?.serviceId,
    serviceLabel: serviceMatch?.label,
    pitch: buildAnglePitch(company, f.issue, f.evidence, f.impact),
    pivotLine: "",
  };
  angle.pivotLine = pivotForAngle(angle);
  return angle;
}

function angleFromService(rank: 1 | 2 | 3, s: ServiceNeed, company: string): SalesAngle {
  // Use the service-need pitch as the angle when no diagnostic finding
  // already covered it.
  const angle: SalesAngle = {
    rank,
    label: s.label,
    issue: s.label,
    evidence: s.evidence?.[0] ?? s.reason,
    impact: s.reason,
    serviceId: s.serviceId,
    serviceLabel: s.label,
    pitch: s.suggestedPitch || buildAnglePitch(company, s.label, s.reason, ""),
    pivotLine: "",
  };
  angle.pivotLine = pivotForAngle(angle);
  return angle;
}

function fallbackAngle(rank: 1 | 2 | 3, lead: NormalizedLead, company: string): SalesAngle {
  const trade = lead.moduleId || "this trade";
  const angle: SalesAngle = {
    rank,
    label: "Top-of-market expansion",
    issue: "Capture more inbound above the map pack",
    evidence: `Established ${trade} business with room to claim paid + specialty surface area`,
    impact: "Even strong companies leave inbound on the table when paid + specialty pages are unclaimed.",
    serviceId: "lead_generation",
    serviceLabel: "Lead Generation",
    pitch: `Hey ${company} — you already have credibility in ${trade}. The next lever is owning more demand above the map pack through paid visibility and sharper service pages.`,
    pivotLine: `If they push back, pivot to: "Want me to show the one paid lane that converts above organic for ${trade}?"`,
  };
  return angle;
}

function pickServiceForAxis(needs: ServiceNeed[], axis: string): ServiceNeed | undefined {
  for (const n of needs) {
    if (axisOfService(n) === axis) return n;
  }
  return undefined;
}

function buildAngles(lead: NormalizedLead, needs: ServiceNeed[]): SalesAngle[] {
  const company = lead.companyName || "there";
  const findings: Finding[] = lead.diagnostics?.findings ?? [];
  const out: SalesAngle[] = [];
  const usedAxes = new Set<string>();

  // Rank 1 — highest-confidence finding (real evidence wins).
  const top = findings[0];
  if (top) {
    const match = pickServiceForAxis(needs, axisOfFinding(top));
    out.push(angleFromFinding(1, top, match, company));
    usedAxes.add(axisOfFinding(top));
  }

  // Rank 2 — strongest revenue-impact angle from a different axis.
  // Prefer a service-need that's not on the rank-1 axis.
  for (const n of needs) {
    const axis = axisOfService(n);
    if (usedAxes.has(axis)) continue;
    out.push(angleFromService((out.length + 1) as 1 | 2 | 3, n, company));
    usedAxes.add(axis);
    break;
  }

  // Rank 3 — second-best finding (different axis) OR fallback opportunity.
  if (out.length < 3) {
    const second = findings.find((f) => !usedAxes.has(axisOfFinding(f)));
    if (second) {
      const match = pickServiceForAxis(needs, axisOfFinding(second));
      out.push(angleFromFinding((out.length + 1) as 1 | 2 | 3, second, match, company));
      usedAxes.add(axisOfFinding(second));
    } else {
      out.push(fallbackAngle((out.length + 1) as 1 | 2 | 3, lead, company));
    }
  }

  // Backfill if still short.
  while (out.length < 1) out.push(fallbackAngle(1, lead, company));
  return out.slice(0, 3) as SalesAngle[];
}

function evidenceSnippet(angles: SalesAngle[]): string {
  const a = angles[0];
  return a ? a.evidence : "no specific gap observed";
}

function buildObjections(lead: NormalizedLead, angles: SalesAngle[]): SalesObjection[] {
  const evidence = evidenceSnippet(angles);
  const angleSummary = angles[0]?.label ?? "the specific gap on your funnel";
  const recommendedOfferShort = angles[0]?.serviceLabel ?? "one focused fix";

  return [
    {
      objection: "We already have someone handling marketing",
      likelyReason: "They've been burned by generic agencies or are loyal to an existing vendor.",
      response:
        `That makes sense. I'm not calling to replace anything blindly. The reason I reached out is because there's a specific gap showing up in your public funnel: ${evidence}. LaborTech would focus on that one revenue leak first, not a generic marketing overhaul.`,
      followUpQuestion: "Would it be worth seeing the exact gap in two minutes?",
    },
    {
      objection: "We get enough work already",
      likelyReason: "They're at capacity but may be filling it with the wrong kind of work.",
      response:
        `That's usually a good sign. The question is whether the work coming in is the highest-margin work or just whatever the market gives you. The opportunity I'm seeing is ${angleSummary}.`,
      followUpQuestion: "Are you trying to grow volume, improve job quality, or both?",
    },
    {
      objection: "What would you actually do for us?",
      likelyReason: "They want to skip the pitch and see the deliverable.",
      response:
        `Based on what I'm seeing, the first move would be ${recommendedOfferShort.toLowerCase()}. Not a broad campaign. One focused fix tied to ${evidence}.`,
      followUpQuestion: "Do you want me to walk you through that specific fix?",
    },
  ];
}

function discoveryQuestionsForTrade(trade: string | undefined): string[] {
  if (trade === "roofing") {
    return [
      "Are most of your jobs coming from Google or referrals right now?",
      "Do you know how many storm or insurance jobs you closed last quarter?",
      "Are you trying to win more emergency / storm work, retail jobs, or both?",
    ];
  }
  if (trade === "hvac" || trade === "plumbing") {
    return [
      "How many emergency / after-hours calls are you getting per week?",
      "Do you have a clear booking flow online, or is everything by phone?",
      "Are you trying to grow service revenue, install revenue, or maintenance plans?",
    ];
  }
  if (trade === "electrical") {
    return [
      "What's the breakdown between residential service, panel upgrades, and commercial?",
      "Are EV charger installs growing for you yet?",
      "Where are most of your high-ticket leads coming from today?",
    ];
  }
  if (trade === "painting") {
    return [
      "What share of your work is exterior repaint vs interior vs cabinet?",
      "Do you have a dedicated cabinet repaint capture page?",
      "Are commercial repaints something you're chasing or filtering out?",
    ];
  }
  if (trade === "carpentry") {
    return [
      "What's the rough mix between custom builds, trim, and remodels?",
      "Where do most of your inbound consults come from today?",
      "How are you showcasing your portfolio when a buyer Googles you?",
    ];
  }
  return [
    "Where are most of your inbound leads coming from right now?",
    "Do you know roughly what percentage of quotes turn into booked work?",
    "Are you trying to grow volume, improve job quality, or both?",
  ];
}

function buildCallPlan(
  lead: NormalizedLead,
  angles: SalesAngle[],
  needs: ServiceNeed[],
): SalesCallPlan {
  const company = lead.companyName || "there";
  const top = angles[0];
  const opener = top?.pitch
    ?? `Hey ${company} — quick one, I'm calling about a couple of things on your funnel that may be costing you ${lead.moduleId || "trade"} jobs.`;

  // Pick the first call_now / build_next service need for the offer.
  const offerNeed =
    needs.find((n) => n.urgency === "call_now")
    ?? needs.find((n) => n.urgency === "build_next")
    ?? needs[0];

  const recommendedOffer = (() => {
    if (offerNeed) {
      const id = offerNeed.serviceId;
      if (id === "reputation_management") return "Review growth + reputation follow-up system";
      if (id === "website_funnel") return "Website quote-path rebuild + call tracking";
      if (id === "google_ads") return "Google Ads emergency / high-intent capture campaign";
      if (id === "meta_ads") return "Meta Ads portfolio + cabinet/exterior creative push";
      if (id === "seo") return "SEO service-page buildout";
      if (id === "crm") return "CRM follow-up automation";
      if (id === "appointment_scheduler") return "Online booking flow with confirmations";
      if (id === "email_sms") return "Email + SMS follow-up cadence";
      if (id === "media_production") return "Project photo + before/after refresh";
      if (id === "voice_ai_agent") return "AI voice receptionist for after-hours overflow";
      if (id === "chat_ai_agent") return "Website chat agent for after-hours qualification";
      if (id === "social_media_management") return "Organic social cadence + project showcase";
      if (id === "lead_generation") return "Targeted lead generation outside organic footprint";
      return offerNeed.label;
    }
    return top?.serviceLabel ?? "One focused funnel fix";
  })();

  const positioning = `LaborTech is relevant here because the gap is specific and verifiable: ${top?.evidence ?? "there's a measurable opportunity"}. We don't sell broad strokes; we sell the single fix that closes that loop.`;

  // Next best action — pick the most decisive call action.
  const phone = !!lead.phone;
  let nextBestAction: string;
  if (top?.serviceId === "reputation_management") {
    nextBestAction = "Offer to show their exact review gap on a 2-minute screen share.";
  } else if (top?.serviceId === "website_funnel") {
    nextBestAction = "Offer to send a 2-minute screen recording of the funnel leak.";
  } else if (top?.serviceId === "google_ads" || top?.serviceId === "seo") {
    nextBestAction = "Offer to pull the exact local-pack ranking gap and send it within the hour.";
  } else if (!phone) {
    nextBestAction = "Find a verified phone number, then re-attempt with the evidence opener.";
  } else {
    nextBestAction = "Book a 15-minute diagnostic walkthrough on their calendar today.";
  }

  return {
    opener,
    discoveryQuestions: discoveryQuestionsForTrade(lead.moduleId),
    positioning,
    recommendedOffer,
    nextBestAction,
  };
}

function computeCloseProbability(lead: NormalizedLead, needs: ServiceNeed[]): { closeProbability: number; confidence: CloseConfidence } {
  let p = 50;
  const s = lead.signals ?? {};
  const reviewCount = typeof s.reviewCount === "number" ? s.reviewCount : undefined;
  const rating = typeof s.rating === "number" ? s.rating : undefined;
  const hasWebsite = s.hasWebsite === true || !!lead.website;
  const hasPhone = !!lead.phone;
  const trade = lead.moduleId;

  // Positive signals
  if (hasPhone) p += 15;
  if (typeof reviewCount === "number" && reviewCount < 30) p += 10;
  if (!hasWebsite) p += 10;
  if (typeof rating === "number" && rating < 4.5) p += 5;
  if (needs.length >= 3) p += 5;
  if (trade && HIGH_CALL_VOLUME_TRADES.has(trade) && s.emergencyServiceGap === true) p += 5;
  const findings = lead.diagnostics?.findings ?? [];
  if (findings.some((f) => f.confidence === "high")) p += 5;

  // Negative signals
  if (!hasPhone) p -= 25;
  if (!hasWebsite && (reviewCount === undefined || reviewCount === 0) && !rating) p -= 10;
  if (findings.length === 0) p -= 5;

  // Visual-trade portfolio gap nudge
  if (trade && VISUAL_TRADES.has(trade) && s.portfolioMissing === true) p += 3;

  const closeProbability = Math.max(0, Math.min(100, Math.round(p)));
  const confidence: CloseConfidence =
    closeProbability >= 70 ? "high" :
    closeProbability >= 40 ? "medium" :
    "low";

  return { closeProbability, confidence };
}

function labelForCloseProbability(p: number): CloseLabel {
  if (p >= 80) return "hot";
  if (p >= 60) return "strong";
  if (p >= 40) return "workable";
  return "nurture";
}

export function generateSalesStrategy(
  lead: NormalizedLead,
  serviceNeeds?: ServiceNeed[],
): SalesStrategy {
  const needs = Array.isArray(serviceNeeds) ? serviceNeeds : [];
  const angles = buildAngles(lead, needs);
  const objections = buildObjections(lead, angles);
  const callPlan = buildCallPlan(lead, angles, needs);
  const { closeProbability, confidence } = computeCloseProbability(lead, needs);
  const closeLabel = labelForCloseProbability(closeProbability);

  return {
    closeProbability,
    confidence,
    closeLabel,
    primaryAngle: angles[0],
    angles,
    objections,
    callPlan,
  };
}
