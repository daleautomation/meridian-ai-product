// Meridian — LaborTech Service-Fit Engine.
//
// Rule-based scoring that evaluates every lead against every LaborTech
// service. Pure / deterministic — reads only existing fields on the
// task + scan; no new data sources, no AI calls. The result is a
// `LaborTechServiceFit` object surfaced through Today, Operator, the
// Intelligence Panel, and the demo scheduler.
//
// Service IDs deliberately mirror lib/services/serviceCatalog.ts so
// the existing service-bucket filter (selectedLaborTechServiceId) can
// pick up fit-driven primaries without a parallel id space.

export type ServiceFitId =
  | "reputation_management"
  | "seo"
  | "website_funnel"
  | "google_ads"
  | "meta_ads"
  | "social_media_management"
  | "media_production"
  | "voice_ai_agent"
  | "chat_ai_agent"
  | "appointment_scheduler"
  | "crm"
  | "email_sms"
  | "lead_generation"
  | "blog_posting"
  | "mobile_app"
  | "influencer_marketing";

export interface ServiceFitEntry {
  serviceId: ServiceFitId;
  label: string;
  score: number;
  evidence: string[];
  confidence: "Low" | "Medium" | "High";
  signalsFired: number;
}

export interface LaborTechServiceFit {
  primaryService: ServiceFitId;
  primaryServiceLabel: string;
  secondaryServices: Array<{ id: ServiceFitId; label: string; score: number }>;
  scores: Partial<Record<ServiceFitId, number>>;
  evidenceByService: Partial<Record<ServiceFitId, string[]>>;
  recommendedOffer: string;
  openingAngle: string;
  whyNow: string;
  confidence: "Low" | "Medium" | "High";
  // Tactical pitch path — short bullet points the Assistant surfaces
  // so the rep knows the order of operations on a live call.
  pitchPath: string[];
}

const SERVICE_LABELS: Record<ServiceFitId, string> = {
  reputation_management:    "Reputation Management",
  seo:                      "SEO",
  website_funnel:           "Website & Funnel Development",
  google_ads:               "Google Advertising",
  meta_ads:                 "Meta Advertising",
  social_media_management:  "Social Media Management",
  media_production:         "Media Production",
  voice_ai_agent:           "Voice AI Agent",
  chat_ai_agent:            "Chat AI Agent",
  appointment_scheduler:    "Appointment Scheduler",
  crm:                      "CRM",
  email_sms:                "Email & SMS Marketing",
  lead_generation:          "Lead Generation",
  blog_posting:             "Blog Posting",
  mobile_app:               "Mobile App",
  influencer_marketing:     "Influencer Marketing",
};

// Visual-heavy trades unlock a media-production / meta-ads bonus.
const VISUAL_TRADES = new Set([
  "roofing", "remodeling", "painting", "landscaping",
  "construction", "hvac", "carpentry", "exteriors", "kitchen",
  "bath", "pools", "decks", "fencing", "concrete",
]);

// Phone-first / urgent-service trades unlock a Voice AI bonus.
const PHONE_FIRST_TRADES = new Set([
  "plumbing", "hvac", "electrical", "garage", "locksmith",
  "appliance", "septic", "pest", "restoration", "roofing",
]);

// Each signal: a regex over the combined text + the service it boosts
// + how many points it adds. Multiple matches stack but cap at 95 so
// no service ever reads as 100% certain.
// Public — the Unified Signal Engine in lib/intelligence/leadSignals.ts
// reads this directly so we never have two copies of the regex set.
export type Signal = {
  test: RegExp;
  service: ServiceFitId;
  weight: number;
  evidenceLabel: string;
};

export const SIGNALS: Signal[] = [
  // Reputation Management
  { test: /\b(low|few|missing|under)\s*(review|reviews|ratings?)/i,            service: "reputation_management", weight: 22, evidenceLabel: "Low review volume" },
  { test: /\brating\s*(below|under|poor|weak)/i,                                service: "reputation_management", weight: 18, evidenceLabel: "Rating below market" },
  { test: /\b(competitor|competitors)\s*(lead|ahead|stronger|more)\s*reviews/i, service: "reputation_management", weight: 18, evidenceLabel: "Competitor review gap" },
  { test: /\b(review velocity|stale reviews|no recent reviews)/i,               service: "reputation_management", weight: 14, evidenceLabel: "Weak review velocity" },
  { test: /\b(google business profile|gbp)\b/i,                                 service: "reputation_management", weight: 10, evidenceLabel: "Weak GBP trust signals" },
  { test: /\btrust|social proof|reputation\b/i,                                  service: "reputation_management", weight: 10, evidenceLabel: "Trust / social proof gap" },

  // SEO
  { test: /\b(map[\s-]?pack|3[\s-]?pack|local pack)\b/i,                        service: "seo",                   weight: 22, evidenceLabel: "Weak map-pack visibility" },
  { test: /\b(seo|search visibility|organic)\b/i,                                service: "seo",                   weight: 16, evidenceLabel: "Low organic visibility" },
  { test: /\b(keyword|ranking|rank|search rank)\b/i,                            service: "seo",                   weight: 14, evidenceLabel: "Poor service / location keyword presence" },
  { test: /\bgoogle business profile|gbp\b/i,                                    service: "seo",                   weight: 8,  evidenceLabel: "Missing GBP details" },

  // Website & Funnel Development
  { test: /\b(no website|missing website|website down|no site)\b/i,             service: "website_funnel",        weight: 28, evidenceLabel: "No website / site missing" },
  { test: /\b(outdated|old website|legacy site)\b/i,                            service: "website_funnel",        weight: 18, evidenceLabel: "Outdated website" },
  { test: /\b(mobile|responsive|slow site|broken)\b/i,                          service: "website_funnel",        weight: 16, evidenceLabel: "Poor mobile / performance" },
  { test: /\b(cta|call to action|quote form|lead form|conversion path)\b/i,     service: "website_funnel",        weight: 16, evidenceLabel: "Weak CTA / conversion path" },

  // Google Advertising
  { test: /\b(competitor|competitors)\s*ads?\b/i,                               service: "google_ads",            weight: 18, evidenceLabel: "Competitors running ads — lead is not" },
  { test: /\bgoogle ads?|search ads?\b/i,                                        service: "google_ads",            weight: 12, evidenceLabel: "Paid-search opportunity" },
  { test: /\b(high[- ]intent|service[- ]intent|emergency)\b/i,                  service: "google_ads",            weight: 12, evidenceLabel: "High-intent service category" },
  { test: /\b(seasonal|peak season|service urgency)\b/i,                        service: "google_ads",            weight: 10, evidenceLabel: "Seasonal demand window" },

  // Meta Advertising
  { test: /\b(meta ads?|facebook ads?|instagram ads?)\b/i,                      service: "meta_ads",              weight: 14, evidenceLabel: "Paid-social opportunity" },
  { test: /\b(retarget|retargeting|pixel)\b/i,                                  service: "meta_ads",              weight: 14, evidenceLabel: "No retargeting in place" },
  { test: /\b(before[- ]after|transformation|project gallery)\b/i,              service: "meta_ads",              weight: 12, evidenceLabel: "Before/after content opportunity" },

  // Social Media Management
  { test: /\b(social|inactive social|stale posts|no posts|outdated)\b/i,        service: "social_media_management", weight: 14, evidenceLabel: "Inactive / outdated social" },
  { test: /\b(facebook|instagram|tiktok|youtube|linkedin)\b/i,                  service: "social_media_management", weight: 8,  evidenceLabel: "Weak social presence" },
  { test: /\b(content|posts?|cadence)\b/i,                                       service: "social_media_management", weight: 8,  evidenceLabel: "Content cadence gap" },

  // Media Production
  { test: /\b(photo|photos|imagery|images|video|videos|portfolio|gallery)\b/i,  service: "media_production",      weight: 16, evidenceLabel: "Poor visual / portfolio assets" },
  { test: /\b(visual|brand assets|trust assets)\b/i,                            service: "media_production",      weight: 12, evidenceLabel: "Weak trust assets" },

  // Voice AI Agent
  { test: /\b(missed call|missed calls|after[- ]hours|after hours|voicemail)\b/i, service: "voice_ai_agent",      weight: 22, evidenceLabel: "Missed-call risk" },
  { test: /\b(phone[- ]first|emergency|service call|24\/7|24-7)\b/i,            service: "voice_ai_agent",        weight: 18, evidenceLabel: "Phone-first / urgent category" },
  { test: /\bbooking automation|answer\s*calls\b/i,                              service: "voice_ai_agent",        weight: 12, evidenceLabel: "No booking automation" },

  // Chat AI Agent
  { test: /\bchat\b|\bchatbot\b|\blive chat\b/i,                                 service: "chat_ai_agent",         weight: 16, evidenceLabel: "No chat / repetitive web questions" },
  { test: /\b(qualify|qualification|lead qualification)\b/i,                    service: "chat_ai_agent",         weight: 12, evidenceLabel: "Inbound qualification opportunity" },

  // Appointment Scheduler
  { test: /\b(appointment|booking|book now|schedule online|online booking)\b/i, service: "appointment_scheduler", weight: 20, evidenceLabel: "No visible online booking" },
  { test: /\b(consultation|estimate|quote workflow)\b/i,                        service: "appointment_scheduler", weight: 12, evidenceLabel: "Consultation / estimate workflow" },

  // CRM
  { test: /\b(follow[- ]up|cadence|nurture|drip)\b/i,                            service: "crm",                   weight: 14, evidenceLabel: "Weak follow-up / cadence" },
  { test: /\b(multi[- ]location|multiple locations|teams?)\b/i,                  service: "crm",                   weight: 12, evidenceLabel: "Multi-location follow-up complexity" },
  { test: /\b(pipeline|tracking)\b/i,                                            service: "crm",                   weight: 10, evidenceLabel: "Poor lead tracking signals" },

  // Email & SMS Marketing
  { test: /\b(reactivation|win[- ]back|seasonal reminder|recurring)\b/i,        service: "email_sms",             weight: 14, evidenceLabel: "Reactivation / recurring opportunity" },
  { test: /\b(email|sms|text marketing)\b/i,                                     service: "email_sms",             weight: 10, evidenceLabel: "Email / SMS channel gap" },

  // Lead Generation
  { test: /\b(inbound|demand|visibility|low traffic|few leads)\b/i,             service: "lead_generation",       weight: 14, evidenceLabel: "Weak inbound presence" },
  { test: /\b(prospecting|outbound)\b/i,                                         service: "lead_generation",       weight: 10, evidenceLabel: "Outbound opportunity" },

  // Blog Posting
  { test: /\b(blog|articles?|authority content|education(al)?)\b/i,             service: "blog_posting",          weight: 12, evidenceLabel: "Authority / content gap" },

  // Mobile App
  { test: /\b(mobile app|customer portal|membership|repeat customer|field service)\b/i, service: "mobile_app",   weight: 18, evidenceLabel: "Repeat / portal workflow" },

  // Influencer Marketing
  { test: /\b(dtc|direct[- ]to[- ]consumer|ecommerce|consumer brand|product line)\b/i,  service: "influencer_marketing", weight: 18, evidenceLabel: "DTC / consumer-brand surface" },
];

// Per-service templates for the opening angle + why-now lines.
const OPENING_ANGLES: Record<ServiceFitId, (company: string) => string> = {
  reputation_management:    () => "I noticed your review profile is much lighter than competitors showing above you.",
  seo:                      () => "When buyers search your service in your area you're not landing in the map pack.",
  website_funnel:           () => "Your site loads but the path from visitor to quote is hard to find — that's where buyers leak.",
  google_ads:               () => "Competitors are bidding on your service terms; right now you're invisible at the moment of intent.",
  meta_ads:                 () => "Your project work is the kind buyers love seeing on social — but no one is being shown it.",
  social_media_management:  () => "Your social channels look quiet, which makes you feel less active than the competition.",
  media_production:         () => "Your portfolio doesn't reflect the quality of your work — buyers judge before they call.",
  voice_ai_agent:           () => "Phone is your inbound channel, and missed calls right now equal lost jobs.",
  chat_ai_agent:            () => "Web visitors are arriving but leaving without an easy way to ask a question.",
  appointment_scheduler:    () => "Right now booking with you means a phone tag loop — that's an extra friction step.",
  crm:                      () => "Your pipeline doesn't show signs of structured follow-up — most quotes never get a second touch.",
  email_sms:                () => "You have a customer base sitting unactivated — there's recurring revenue you're not nudging.",
  lead_generation:          () => "Your closeability is strong but visibility is the limiter — the deal flow isn't matching your capacity.",
  blog_posting:             () => "Your site has zero content authority — search engines have no reason to rank you for your service terms.",
  mobile_app:               () => "Your repeat customers don't have a frictionless way to book or pay you — that's a churn risk.",
  influencer_marketing:     () => "You sell to consumers and have a brand worth amplifying — niche creators move that audience cheaply.",
};

const WHY_NOW: Record<ServiceFitId, string> = {
  reputation_management:    "Buyers comparing 3+ vendors filter by reviews before they call. Every week you delay, a competitor's review lead grows.",
  seo:                      "Map-pack ranking compounds. The longer you wait, the more local citations and reviews competitors stack against you.",
  website_funnel:           "You're paying to drive traffic somewhere — the conversion gap means every $ in is leaking out.",
  google_ads:               "Cost per click in your category is climbing seasonally. Late entry means paying for the spot competitors locked in cheaper.",
  meta_ads:                 "Meta retargeting requires pixel data history. The earlier the pixel runs, the cheaper the close-loop ads later.",
  social_media_management:  "Buyers cross-check social before calling. A dead profile is a quiet 'don't trust this vendor' signal.",
  media_production:         "Visual proof drives close rate on the call. Without it you're using words to describe work that should sell itself.",
  voice_ai_agent:           "Every missed call right now is a converted competitor lead. The ROI window starts the day it goes live.",
  chat_ai_agent:            "After-hours web traffic is already there — chat just turns it into qualified leads instead of bounces.",
  appointment_scheduler:    "Booking friction is the #1 reason quote-stage leads go silent. One-click booking compounds every quarter.",
  crm:                      "Without structured follow-up, your quote-to-close ratio caps. Adding cadence usually lifts close rate 10–20% inside 60 days.",
  email_sms:                "Your existing list is the cheapest revenue you'll ever produce — reactivation is faster than acquisition.",
  lead_generation:          "Your close rate proves the offer works. Volume is the only lever left, and that's a paid + organic problem.",
  blog_posting:             "Search authority compounds slowly. Starting now means owning the long-tail terms before competitors do.",
  mobile_app:               "Repeat customers want to book in seconds, not phone calls. The portal pays for itself in retention.",
  influencer_marketing:     "Your category has under-priced creator slots right now. Locking partnerships early beats bidding later.",
};

const PITCH_PATHS: Record<ServiceFitId, string[]> = {
  reputation_management:    ["Lead with reviews — that's the visible gap.", "Bridge to SEO once they agree review count matters.", "Park CRM and Email/SMS — those are secondary."],
  seo:                      ["Open with map-pack visibility.", "Anchor in their service + city keywords.", "Bridge to Reputation Management to defend the new traffic."],
  website_funnel:           ["Start with conversion path, not aesthetics.", "Pair with Google Ads only after the funnel converts.", "Park brand-style asks until the funnel is live."],
  google_ads:               ["Confirm the website can convert FIRST.", "Lead with intent-based search terms in their area.", "Park Meta until the search funnel is profitable."],
  meta_ads:                 ["Anchor in before/after and project visuals.", "Pair with Media Production if assets are weak.", "Hold on Google Ads if their site can't convert paid traffic."],
  social_media_management:  ["Frame as a trust signal, not a vanity metric.", "Pair with Media Production for content fuel.", "Park ad-spend asks until the channel reads as active."],
  media_production:         ["Lead with portfolio quality + buyer perception.", "Bridge to Meta Ads and Social once assets are upgraded.", "Hold on heavy ad spend until the assets exist."],
  voice_ai_agent:           ["This is phone-first — Voice AI is a stronger opener than chat.", "Quantify missed calls per week.", "Bridge to Appointment Scheduler after voice is live."],
  chat_ai_agent:            ["Anchor on after-hours web traffic.", "Pair with website funnel work for qualification flow.", "Don't lead with chat if they're phone-first — Voice AI fits better."],
  appointment_scheduler:    ["Anchor on quote-stage friction.", "Pair with CRM for the follow-up loop.", "Bridge to website conversion if booking flow is buried."],
  crm:                      ["Don't pitch CRM first.", "Open with the pain (lost follow-ups) and let CRM be the answer.", "Pair with Email/SMS for cadence content."],
  email_sms:                ["Anchor on reactivation revenue.", "Pair with CRM for the lifecycle.", "Park brand-style asks — keep it transactional."],
  lead_generation:          ["Confirm closeability strength FIRST.", "Bridge from there to traffic gap.", "Pair with website conversion before scaling spend."],
  blog_posting:             ["Frame as long-tail SEO compounding.", "Pair with SEO for the technical lift.", "Don't lead with blog posting — it's a follow-on."],
  mobile_app:               ["Only pitch if repeat / portal need is real.", "Anchor on retention, not acquisition.", "Park unless they confirm the workflow exists."],
  influencer_marketing:     ["Only relevant if they sell consumer-direct.", "Anchor on under-priced creator slots in their niche.", "Park if they're a local-services-only B2B trade."],
};

export function gatherText(task: any): string {
  const scan = task?.laborTechScan ?? {};
  const parts: string[] = [];
  if (typeof scan.primaryPain === "string") parts.push(scan.primaryPain);
  if (typeof scan.headline === "string") parts.push(scan.headline);
  if (typeof scan.qualificationReason === "string") parts.push(scan.qualificationReason);
  if (typeof scan.recommendedAction === "string") parts.push(scan.recommendedAction);
  if (Array.isArray(scan.evidence)) {
    for (const e of scan.evidence) {
      if (typeof e === "string") parts.push(e);
      else if (e && typeof e === "object") parts.push(e.statement ?? e.text ?? e.title ?? "");
    }
  }
  if (Array.isArray(scan.businessImpact)) {
    for (const e of scan.businessImpact) {
      if (typeof e === "string") parts.push(e);
      else if (e && typeof e === "object") parts.push(e.statement ?? e.text ?? "");
    }
  }
  if (Array.isArray(scan.risks)) {
    for (const e of scan.risks) {
      if (typeof e === "string") parts.push(e);
      else if (e && typeof e === "object") parts.push(e.statement ?? e.text ?? "");
    }
  }
  if (typeof task?.nextAction === "string") parts.push(task.nextAction);
  return parts.join("\n");
}

function classifyConfidence(score: number): "Low" | "Medium" | "High" {
  if (score >= 80) return "High";
  if (score >= 60) return "Medium";
  return "Low";
}

/**
 * Compute the LaborTech service fit for a single task. Pure: no
 * mutation, no network, deterministic over the same input. Returns
 * null when the task carries no scan to read from.
 */
export function computeLaborTechServiceFit(task: any): LaborTechServiceFit | null {
  if (!task || typeof task !== "object") return null;
  const scan = task.laborTechScan;
  if (!scan || typeof scan !== "object") return null;

  const text = gatherText(task);
  if (!text || text.trim().length === 0) return null;

  const tradeId = String(task.tradeId ?? task.tradeLabel ?? "").toLowerCase();
  const isVisualTrade = Array.from(VISUAL_TRADES).some((t) => tradeId.includes(t));
  const isPhoneFirstTrade = Array.from(PHONE_FIRST_TRADES).some((t) => tradeId.includes(t));

  const closeability = typeof scan.closeability?.score === "number" ? scan.closeability.score : 50;
  const urgencyLabel = typeof scan.urgency?.label === "string" ? scan.urgency.label : "Medium";
  const urgencyBonus = urgencyLabel === "Critical" ? 6 : urgencyLabel === "High" ? 3 : 0;
  const closeBonus = Math.max(0, Math.min(8, Math.round((closeability - 60) / 5)));

  const scores = new Map<ServiceFitId, number>();
  const fired = new Map<ServiceFitId, number>();
  const evidence = new Map<ServiceFitId, string[]>();

  const bump = (sid: ServiceFitId, n: number, label?: string) => {
    scores.set(sid, (scores.get(sid) ?? 0) + n);
    fired.set(sid, (fired.get(sid) ?? 0) + 1);
    if (label) {
      const arr = evidence.get(sid) ?? [];
      if (!arr.includes(label)) arr.push(label);
      evidence.set(sid, arr);
    }
  };

  for (const sig of SIGNALS) {
    if (sig.test.test(text)) bump(sig.service, sig.weight, sig.evidenceLabel);
  }

  // Trade-driven priors.
  if (isVisualTrade) {
    bump("media_production", 12, "Visual trade — buyers expect strong portfolio");
    bump("meta_ads", 8, "Visual trade — paid social converts on imagery");
  }
  if (isPhoneFirstTrade) {
    bump("voice_ai_agent", 14, "Phone-first trade — missed calls = lost jobs");
    bump("appointment_scheduler", 6, "Phone-first trade — booking friction is high");
  }

  // Closeability and urgency lift the highest-fit services so
  // hot leads bias toward decisive, action-oriented offers.
  for (const [sid, base] of scores) {
    let boosted = base + closeBonus + urgencyBonus;
    if (boosted > 95) boosted = 95;
    scores.set(sid, boosted);
  }

  if (scores.size === 0) return null;

  const ranked = Array.from(scores.entries())
    .map(([sid, score]) => ({
      serviceId: sid,
      label: SERVICE_LABELS[sid],
      score,
      evidence: evidence.get(sid) ?? [],
      confidence: classifyConfidence(score),
      signalsFired: fired.get(sid) ?? 0,
    }))
    .sort((a, b) => b.score - a.score || b.signalsFired - a.signalsFired);

  const primary = ranked[0];
  const secondaryServices = ranked.slice(1, 4).map((s) => ({ id: s.serviceId, label: s.label, score: s.score }));

  const scoresObj: Partial<Record<ServiceFitId, number>> = {};
  const evidenceObj: Partial<Record<ServiceFitId, string[]>> = {};
  for (const r of ranked) {
    scoresObj[r.serviceId] = r.score;
    if (r.evidence.length > 0) evidenceObj[r.serviceId] = r.evidence;
  }

  const company = String(task.linkedCompany ?? task.title ?? "");
  const opener = OPENING_ANGLES[primary.serviceId](company);
  const why = WHY_NOW[primary.serviceId];
  const path = PITCH_PATHS[primary.serviceId];

  return {
    primaryService: primary.serviceId,
    primaryServiceLabel: primary.label,
    secondaryServices,
    scores: scoresObj,
    evidenceByService: evidenceObj,
    recommendedOffer: primary.label,
    openingAngle: opener,
    whyNow: why,
    confidence: primary.confidence,
    pitchPath: path.slice(),
  };
}

/**
 * Convenience: pull (or lazily compute) the LaborTech service fit
 * from a task. If the task already carries a `serviceFit` payload
 * upstream (added later by a server-side enrichment step), that wins
 * so client and server stay aligned. Otherwise we compute on demand.
 */
export function getLaborTechServiceFit(task: any): LaborTechServiceFit | null {
  const cached = task?.laborTechScan?.serviceFit;
  if (cached && typeof cached === "object" && typeof cached.primaryService === "string") {
    return cached as LaborTechServiceFit;
  }
  return computeLaborTechServiceFit(task);
}

/**
 * Schedule weight: how confidently does this lead need *some*
 * LaborTech offer? Used as a tiebreaker in the demo scheduler so
 * Day 1 favours leads with a clear primary service over ones whose
 * fit is muddled across many low-score services. Returns 0 when no
 * fit is computable.
 */
export function serviceFitConfidenceScore(task: any): number {
  const fit = computeLaborTechServiceFit(task);
  if (!fit) return 0;
  const top = fit.scores[fit.primaryService] ?? 0;
  return Math.max(0, Math.min(95, top));
}

// ── Per-service breakdown ───────────────────────────────────────────
//
// Used by the Operator's "Break Down Services Needed" button and by
// the Assist Mode "Services Needed" section + AI chip. Pure synthesis
// from existing scan + fit data — never calls an external service.

export interface ServiceFitBreakdownEntry {
  serviceId: ServiceFitId;
  label: string;
  score: number;
  tier: "Strong" | "Medium" | "Light" | "Low";
  tierLabel: string;       // "HIGH FIT" | "MEDIUM FIT" | "LIGHT FIT" | "LOW FIT"
  whyBullets: string[];    // 2–3 short bullets (evidence-led + one buyer-psychology line)
  evidence: string[];
  pitch: string;
  objectionRisk: string;   // buyer-thought quote — "They may think reviews don't matter"
  counter: string;         // rebuttal quote — "Most buyers never call without seeing strong reviews"
  priority: string;        // "PITCH FIRST" / "PITCH SECOND" …
  priorityIcon: string;    // "🔥" for first, "▲" for second, "·" for third+
}

const PRIORITY_LABELS = ["PITCH FIRST", "PITCH SECOND", "PITCH THIRD", "PITCH FOURTH", "PITCH FIFTH"];
const PRIORITY_ICONS  = ["🔥",          "▲",            "·",          "·",            "·"];

// Per-service buyer-thought objection + rebuttal counter. Read as
// pair: what the prospect is likely to say internally, and the
// strongest one-line response that breaks the objection.
const OBJECTION_RISK: Record<ServiceFitId, { objection: string; counter: string }> = {
  reputation_management:    { objection: "They may think reviews don't matter",                  counter: "Most buyers never even call without seeing strong reviews" },
  seo:                      { objection: "They may say they already do SEO",                     counter: "Map-pack ranking is its own game — show their current rank vs the competitors above them" },
  website_funnel:           { objection: "They may be defensive about their site",               counter: "Frame around conversion: traffic without a clear path is wasted spend" },
  google_ads:               { objection: "They may push back on the budget",                     counter: "Competitors are already buying their search terms — every day they wait, the CPC climbs" },
  meta_ads:                 { objection: "They may say social doesn't drive jobs",               counter: "Visual proof + retargeting compounds — paid social is cheaper than paid search next quarter" },
  social_media_management:  { objection: "They may not see ROI from social",                     counter: "A dead profile costs jobs silently — buyers cross-check before calling" },
  media_production:         { objection: "They may say their photos are 'fine'",                 counter: "Side-by-side with competitors decides the call before it happens" },
  voice_ai_agent:           { objection: "They may worry it sounds robotic",                     counter: "Every missed call is a converted competitor — Voice AI can be staff-tuned" },
  chat_ai_agent:            { objection: "They may worry about brand voice on chat",             counter: "After-hours web traffic is already there — chat just qualifies it" },
  appointment_scheduler:    { objection: "They may say phone scheduling works fine",             counter: "Quote-stage friction is the #1 reason silent leads go cold" },
  crm:                      { objection: "They may say they already have a process",             counter: "Lead with the lost follow-ups — CRM is the answer, not the opening pitch" },
  email_sms:                { objection: "They may worry about opt-in compliance",               counter: "Reactivation revenue from the existing list is the cheapest revenue they'll ever produce" },
  lead_generation:          { objection: "They may already work with an agency",                 counter: "Anchor in attribution — show what their close rate could do at higher volume" },
  blog_posting:             { objection: "They may say blogs don't drive jobs",                  counter: "Long-tail SEO compounds — owning service + location terms means inbound for years" },
  mobile_app:               { objection: "They may say a mobile app is overkill",                counter: "Only pitch when repeat / portal need is real; otherwise this stays parked" },
  influencer_marketing:     { objection: "They may say it doesn't fit a local trade",            counter: "Skip unless DTC / consumer-direct is confirmed — most local trades shouldn't pitch this" },
};

// Per-service buyer-psychology line — used as the third "Why" bullet
// so each card has a buyer-side rationale even when the evidence is
// thin.
const WHY_PSYCHOLOGY: Record<ServiceFitId, string> = {
  reputation_management:    "Buyers filter by reviews before they call",
  seo:                      "Buyers don't scroll past the map-pack",
  website_funnel:           "Traffic without a clear path leaks revenue",
  google_ads:               "Search-intent traffic converts highest at the moment of need",
  meta_ads:                 "Visual social converts on imagery + retargeting compounding",
  social_media_management:  "Buyers cross-check social before reaching out",
  media_production:         "Visual proof drives close rate before price ever comes up",
  voice_ai_agent:           "Phone-first trades lose jobs to missed calls",
  chat_ai_agent:            "After-hours web visitors leave without a way to ask",
  appointment_scheduler:    "Booking friction kills quote-stage leads",
  crm:                      "Most quote-stage leads die without a follow-up cadence",
  email_sms:                "Existing customers are the cheapest revenue source",
  lead_generation:          "Visibility is the limiter when close rate is already solid",
  blog_posting:             "Long-tail SEO compounds over time",
  mobile_app:               "Repeat customers churn without frictionless re-booking",
  influencer_marketing:     "Niche creators move consumer audiences cheaply",
};

function tierFor(score: number): ServiceFitBreakdownEntry["tier"] {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Medium";
  if (score >= 40) return "Light";
  return "Low";
}

function tierLabelFor(tier: ServiceFitBreakdownEntry["tier"]): string {
  return tier === "Strong" ? "HIGH FIT"
       : tier === "Medium" ? "MEDIUM FIT"
       : tier === "Light"  ? "LIGHT FIT"
       : "LOW FIT";
}

function whyBulletsFor(serviceId: ServiceFitId, evidence: string[]): string[] {
  const out: string[] = [];
  for (const e of evidence.slice(0, 2)) {
    if (typeof e === "string" && e.trim()) out.push(e.trim());
  }
  out.push(WHY_PSYCHOLOGY[serviceId]);
  return out;
}

/**
 * Build a sorted list of per-service breakdowns for the given task.
 * Returns the union of (a) services that scored via the rule engine,
 * filtered to the relevant tiers (≥ 40 by default). The Operator
 * button and the Assist Mode "Services Needed" section both consume
 * this — same source, no duplication.
 */
export function buildServiceFitBreakdown(
  task: any,
  options: { minScore?: number; maxEntries?: number } = {},
): ServiceFitBreakdownEntry[] {
  const fit = computeLaborTechServiceFit(task);
  if (!fit) return [];
  const minScore = options.minScore ?? 40;
  const maxEntries = options.maxEntries ?? 16;

  const entries: ServiceFitBreakdownEntry[] = [];
  const ranked = Object.entries(fit.scores)
    .map(([sid, score]) => ({ sid: sid as ServiceFitId, score: score ?? 0 }))
    .sort((a, b) => b.score - a.score);

  for (let i = 0; i < ranked.length && entries.length < maxEntries; i++) {
    const { sid, score } = ranked[i];
    if (score < minScore) continue;
    const evidence = fit.evidenceByService[sid] ?? [];
    const isPrimary = sid === fit.primaryService;
    const pitch = isPrimary
      ? fit.openingAngle
      : OPENING_ANGLES[sid](String(task?.linkedCompany ?? ""));
    const tier = tierFor(score);
    const objection = OBJECTION_RISK[sid];
    const idx = entries.length;
    entries.push({
      serviceId: sid,
      label: SERVICE_LABELS[sid],
      score,
      tier,
      tierLabel: tierLabelFor(tier),
      whyBullets: whyBulletsFor(sid, evidence),
      evidence: evidence.slice(0, 4),
      pitch,
      objectionRisk: objection.objection,
      counter: objection.counter,
      priority: PRIORITY_LABELS[idx] ?? "PITCH LATER",
      priorityIcon: PRIORITY_ICONS[idx] ?? "·",
    });
  }
  return entries;
}

// ── Strategic chat renderer ─────────────────────────────────────────
//
// The Assist Mode "Services needed" chip and the Operator's
// "Break Down Services Needed →" button both consume this. It's
// pure synthesis from the existing scan + fit data — no /api/ai/chat
// round-trip, no AI cost. Output reads like a senior sales
// strategist briefing the rep on this specific lead.

export interface SignalReport {
  positives: Array<{ label: string; weight: number }>;
  bonuses:   Array<{ label: string; weight: number }>;
  missing:   string[];
  rawSubtotal: number;
  finalScore: number;
}

// Trade priors exposed for the Unified Signal Engine — same sets the
// engine has used internally; never re-define them in a second file.
export const VISUAL_TRADE_SET = VISUAL_TRADES;
export const PHONE_FIRST_TRADE_SET = PHONE_FIRST_TRADES;
export const SERVICE_LABEL_MAP = SERVICE_LABELS;

// ── Structured Service Strategy types ───────────────────────────────
//
// `buildStructuredServiceStrategy(task)` returns a fully structured
// view of every fact the chat renderer derives — same data, no
// stringification. Surfaces that need parts of the strategy (Operator
// Panel, Deep Report, calendar cards, AI Assistant, future industry
// packs) read fields directly instead of parsing markdown.

export interface ServiceStrategyEntry {
  id: ServiceFitId;
  label: string;
  score: number;
  tier: "Strong" | "Medium" | "Light" | "Low";
  tierLabel: string;                          // "HIGH FIT" | "MEDIUM FIT" | …
  priority: string;                           // "PITCH FIRST" | "PITCH SECOND" | …
  priorityIcon: string;                       // 🔥 / ▲ / ·
  group: "PITCH_FIRST" | "BRIDGE_AFTER" | "SUPPORTING" | "DO_NOT_LEAD";
  whyItFits: string[];
  whyNotHigher: string[];
  whatWouldRaiseConfidence: string[];
  firedSignals: Array<{ label: string; weight: number }>;
  missingSignals: string[];
  bonuses: Array<{ label: string; weight: number }>;
  rawSubtotal: number;
  cappedAt95: boolean;
  objection: string;
  counter: string;
  pitch: string;
  discoveryQuestions: string[];
}

export interface ServiceStrategy {
  executiveReadout: string;
  primaryService: ServiceStrategyEntry | null;
  secondaryServices: ServiceStrategyEntry[];
  supportingServices: ServiceStrategyEntry[];
  lowFitServices: ServiceStrategyEntry[];
  hierarchy: ServiceStrategyEntry[];
  pitchSequence: string[];
  salesWarnings: string[];
  recommendedPackage: {
    primary: string | null;
    secondary: string[];
    optional: string[];
  };
  confidence: {
    level: "Low" | "Medium" | "High";
    reasons: string[];
    missingEvidence: string[];
  };
}

export function buildSignalReport(task: any, fit: LaborTechServiceFit): Map<ServiceFitId, SignalReport> {
  const text = gatherText(task);
  const reports = new Map<ServiceFitId, SignalReport>();
  const tradeId = String(task?.tradeId ?? task?.tradeLabel ?? "").toLowerCase();
  const isVisualTrade = Array.from(VISUAL_TRADES).some((t) => tradeId.includes(t));
  const isPhoneFirstTrade = Array.from(PHONE_FIRST_TRADES).some((t) => tradeId.includes(t));
  const closeability = typeof task?.laborTechScan?.closeability?.score === "number"
    ? task.laborTechScan.closeability.score : 50;
  const urgencyLabel = typeof task?.laborTechScan?.urgency?.label === "string"
    ? task.laborTechScan.urgency.label : "Medium";
  const urgencyBonus = urgencyLabel === "Critical" ? 6 : urgencyLabel === "High" ? 3 : 0;
  const closeBonus = Math.max(0, Math.min(8, Math.round((closeability - 60) / 5)));

  // For each service that scored, walk SIGNALS again to record which
  // ones fired. List the unfired-but-relevant signals as "missing"
  // (these become "what would raise confidence" hints).
  for (const sid of Object.keys(fit.scores) as ServiceFitId[]) {
    const positives: Array<{ label: string; weight: number }> = [];
    const missing: string[] = [];
    let raw = 0;
    for (const sig of SIGNALS) {
      if (sig.service !== sid) continue;
      if (sig.test.test(text)) {
        positives.push({ label: sig.evidenceLabel, weight: sig.weight });
        raw += sig.weight;
      } else {
        missing.push(sig.evidenceLabel);
      }
    }
    const bonuses: Array<{ label: string; weight: number }> = [];
    if (isVisualTrade && sid === "media_production")    { bonuses.push({ label: "Visual-trade prior",    weight: 12 }); raw += 12; }
    if (isVisualTrade && sid === "meta_ads")            { bonuses.push({ label: "Visual-trade prior",    weight: 8  }); raw += 8;  }
    if (isPhoneFirstTrade && sid === "voice_ai_agent")  { bonuses.push({ label: "Phone-first prior",     weight: 14 }); raw += 14; }
    if (isPhoneFirstTrade && sid === "appointment_scheduler") { bonuses.push({ label: "Phone-first prior", weight: 6 }); raw += 6; }
    if (closeBonus > 0)                                 bonuses.push({ label: `Closeability boost (${closeability}%)`, weight: closeBonus });
    if (urgencyBonus > 0)                               bonuses.push({ label: `Urgency boost (${urgencyLabel})`,        weight: urgencyBonus });
    raw += closeBonus + urgencyBonus;
    reports.set(sid, {
      positives,
      bonuses,
      missing,
      rawSubtotal: raw,
      finalScore: fit.scores[sid] ?? 0,
    });
  }
  return reports;
}

type HierarchyGroup = "PITCH_FIRST" | "BRIDGE_AFTER" | "SUPPORTING" | "DO_NOT_LEAD";

const GROUP_LABEL: Record<HierarchyGroup, string> = {
  PITCH_FIRST:  "🔥 PITCH FIRST",
  BRIDGE_AFTER: "▲ BRIDGE AFTER",
  SUPPORTING:   "· SUPPORTING OFFER",
  DO_NOT_LEAD:  "✕ LOW FIT — DO NOT LEAD WITH",
};

function bucketHierarchy(fit: LaborTechServiceFit): Record<HierarchyGroup, ServiceFitId[]> {
  const buckets: Record<HierarchyGroup, ServiceFitId[]> = {
    PITCH_FIRST: [], BRIDGE_AFTER: [], SUPPORTING: [], DO_NOT_LEAD: [],
  };
  const ranked = (Object.entries(fit.scores) as Array<[ServiceFitId, number]>)
    .sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < ranked.length; i++) {
    const [sid, score] = ranked[i];
    if (i === 0)              buckets.PITCH_FIRST.push(sid);
    else if (score >= 60)     buckets.BRIDGE_AFTER.push(sid);
    else if (score >= 40)     buckets.SUPPORTING.push(sid);
    else                      buckets.DO_NOT_LEAD.push(sid);
  }
  return buckets;
}

const HIERARCHY_REASON: Record<HierarchyGroup, (label: string) => string> = {
  PITCH_FIRST:  (l) => `Top-scoring service. The strongest evidence on this lead points to ${l}, so this is what opens the call.`,
  BRIDGE_AFTER: (l) => `Strong secondary fit. Don't lead here — bridge into ${l} after the primary lands.`,
  SUPPORTING:   (l) => `Real fit but not the headline. Mention only if discovery confirms the underlying gap.`,
  DO_NOT_LEAD:  () => `Not enough evidence yet to lead with this. Pitching here would invite a budget objection without a buyer-side reason.`,
};

const DISCOVERY_QUESTIONS: Record<ServiceFitId, string[]> = {
  reputation_management: [
    "Where do most of your calls come from — Google, referrals, or repeat customers?",
    "Do you have a process for asking happy customers for reviews?",
    "Have you compared your review count to the top three competitors in your area?",
    "How do you handle a one-star review when it lands?",
    "What does your typical buyer look at before they call?",
  ],
  seo: [
    "Where do most of your calls come from right now?",
    "Do you know where you show up on Google vs the companies above you?",
    "How is your Google Business Profile maintained?",
    "Are most jobs coming from search, referrals, or repeat customers?",
    "Have you ever measured map-pack visibility for your service area?",
  ],
  website_funnel: [
    "When someone lands on your site, what do you want them to do first?",
    "Do you have a quote form, or is it phone-only?",
    "How are you tracking which leads came from the site?",
    "When was the site last meaningfully updated?",
    "How does the site look and behave on a phone vs desktop?",
  ],
  google_ads: [
    "Are you running paid search right now? What's the monthly spend?",
    "Do you know what competitors are paying per click in your area?",
    "How do you measure ad-driven conversions vs organic?",
    "What's your typical job size from a Google lead?",
    "If we doubled your inbound from search next month, could you handle it?",
  ],
  meta_ads: [
    "Do you have before/after photos or project galleries from recent jobs?",
    "Are you running anything on Meta or just organic?",
    "Is the Meta pixel installed on your site?",
    "Who's creating content for your social channels right now?",
    "What does your typical buyer look like — homeowners, property managers, both?",
  ],
  social_media_management: [
    "How often do you post to social right now?",
    "Are buyers cross-checking your social before they call?",
    "Who handles content production internally?",
    "What kinds of posts get the most engagement for you?",
    "Have you ever closed a job that came directly from social?",
  ],
  media_production: [
    "What's your current photo/video setup on jobs?",
    "How do buyers see proof of your work today?",
    "Do you have a project gallery you're proud of?",
    "Have you compared your visuals to the top competitor in your area?",
    "Would your team capture content if it was structured for them?",
  ],
  voice_ai_agent: [
    "Who handles missed calls after hours?",
    "Roughly how many calls do you miss in a week?",
    "Are you a 24/7 service or business hours only?",
    "What happens when a customer calls during a site visit?",
    "Do you currently qualify leads before booking?",
  ],
  chat_ai_agent: [
    "How much traffic does your site get monthly?",
    "Are visitors leaving without a way to ask a quick question?",
    "Who's answering inbound emails right now?",
    "Do you get repetitive 'do you service my area' questions?",
    "Would you trust an AI to qualify the easy ones and route the rest?",
  ],
  appointment_scheduler: [
    "How do customers book with you today — phone, email, or web?",
    "How many leads go quiet after the first quote?",
    "What's your booking-to-completion ratio?",
    "Would your team prefer customers self-schedule on the calendar?",
    "Do you offer different consultation types or just one?",
  ],
  crm: [
    "What does your follow-up cadence look like for unbooked quotes?",
    "How many touches before you call a quote 'dead'?",
    "Where do you track customer info today?",
    "Do you have any automation for past customers?",
    "What would change if your close rate jumped 15% on existing quotes?",
  ],
  email_sms: [
    "How big is your existing customer list?",
    "Have you ever run a reactivation campaign?",
    "Do you do any seasonal outreach to past customers?",
    "Are you opted in for SMS with your customer base?",
    "What's the average time between a customer's first job and their second?",
  ],
  lead_generation: [
    "What's your current monthly close rate?",
    "Where's the bottleneck — visibility, conversion, or capacity?",
    "Have you worked with a lead-gen agency before?",
    "What's the cost-per-job you'd be happy paying?",
    "Could you handle 30% more inbound next month?",
  ],
  blog_posting: [
    "What questions do customers ask most often before they book?",
    "Do you have any content on your site beyond service pages?",
    "Have you ever measured organic traffic from blog posts?",
    "Who at your company has the deepest service knowledge?",
    "Is there a service or location you'd love to own in search?",
  ],
  mobile_app: [
    "How often do customers come back to you for repeat work?",
    "Do you have a portal or membership program today?",
    "Would your customers actually use an app for booking?",
    "What's your retention rate over 12 months?",
    "Is there a workflow your team does in the field that an app would speed up?",
  ],
  influencer_marketing: [
    "Do you sell direct to consumers, or strictly local services?",
    "Have you ever had a creator post about your work?",
    "What audience would you most want to reach next?",
    "Is there a product line you sell beyond services?",
    "Are there local creators your buyers already follow?",
  ],
};

function pickDiscoveryQuestions(fit: LaborTechServiceFit): string[] {
  // Five questions: 3 from primary, 1 from each top-2 secondary, deduped.
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    if (!seen.has(q) && out.length < 5) {
      out.push(q);
      seen.add(q);
    }
  };
  const primary = DISCOVERY_QUESTIONS[fit.primaryService] ?? [];
  for (const q of primary.slice(0, 3)) add(q);
  for (const sec of fit.secondaryServices.slice(0, 2)) {
    const pool = DISCOVERY_QUESTIONS[sec.id] ?? [];
    for (const q of pool) {
      add(q);
      if (out.length >= 5) break;
    }
  }
  // Final fallback — pad from primary's remaining pool.
  for (const q of primary) {
    add(q);
    if (out.length >= 5) break;
  }
  return out;
}

function formatServiceDetail(
  sid: ServiceFitId,
  fit: LaborTechServiceFit,
  reports: Map<ServiceFitId, SignalReport>,
  group: HierarchyGroup,
): string[] {
  const label = SERVICE_LABELS[sid];
  const score = fit.scores[sid] ?? 0;
  const tier = score >= 80 ? "HIGH FIT" : score >= 60 ? "MEDIUM FIT" : score >= 40 ? "LIGHT FIT" : "LOW FIT";
  const lines: string[] = [];
  lines.push(`**${label.toUpperCase()} — ${Math.round(score)} (${tier})**`);

  const report = reports.get(sid);
  if (!report || (report.positives.length === 0 && report.bonuses.length === 0)) {
    lines.push("Score breakdown: Not enough evidence yet.");
  } else {
    lines.push("Score breakdown:");
    for (const p of report.positives) lines.push(`  +${p.weight}  ${p.label}`);
    for (const b of report.bonuses)   lines.push(`  +${b.weight}  ${b.label}`);
    if (report.rawSubtotal > 95) {
      lines.push(`  Capped at 95 (raw subtotal ${report.rawSubtotal})`);
    }
  }

  // Why it may fit — buyer-psychology + first concrete evidence.
  const psychology = WHY_PSYCHOLOGY[sid];
  const evidence = fit.evidenceByService[sid] ?? [];
  lines.push("");
  lines.push("Why it may fit:");
  if (evidence.length > 0) {
    lines.push(`- ${evidence[0]}.`);
    lines.push(`- ${psychology}.`);
  } else {
    lines.push(`- ${psychology}.`);
  }

  // Why it is not higher — based on missing signals.
  if (report) {
    lines.push("");
    lines.push("Why it is not higher:");
    if (report.missing.length === 0) {
      lines.push("- Already firing on every captured signal — score reflects current evidence.");
    } else {
      for (const m of report.missing.slice(0, 3)) {
        lines.push(`- No direct evidence of: ${m.toLowerCase()}.`);
      }
    }
  }

  // What would raise confidence — actionable discovery items.
  if (report && report.missing.length > 0) {
    lines.push("");
    lines.push("What would raise confidence:");
    for (const m of report.missing.slice(0, 3)) {
      lines.push(`- ${m}`);
    }
  }

  // Hierarchy reason — why this service sits in this bucket.
  lines.push("");
  lines.push(`Why ${GROUP_LABEL[group]}: ${HIERARCHY_REASON[group](label)}`);

  return lines;
}

function buildExecutiveReadout(fit: LaborTechServiceFit, buckets: Record<HierarchyGroup, ServiceFitId[]>): string[] {
  const lines: string[] = [];
  const primaryLabel = SERVICE_LABELS[fit.primaryService];
  const bridge = buckets.BRIDGE_AFTER[0];
  const bridgeLabel = bridge ? SERVICE_LABELS[bridge] : null;
  const avoid = buckets.DO_NOT_LEAD.slice(0, 2).map((s) => SERVICE_LABELS[s]);
  const primaryEvidence = fit.evidenceByService[fit.primaryService] ?? [];
  const evidenceFragment = primaryEvidence.length > 0
    ? primaryEvidence[0].toLowerCase().replace(/[.;]+$/g, "")
    : `${WHY_PSYCHOLOGY[fit.primaryService].toLowerCase()}`;

  lines.push("**Executive readout:**");
  const sentence: string[] = [];
  sentence.push(`Lead with **${primaryLabel}** — the strongest evidence on this lead is ${evidenceFragment}.`);
  if (bridgeLabel) {
    sentence.push(`Bridge into **${bridgeLabel}** only after ${primaryLabel} lands and the buyer agrees the gap is real.`);
  } else {
    sentence.push(`No clear secondary yet — keep the call tight on ${primaryLabel} and use discovery to surface the next move.`);
  }
  if (avoid.length > 0) {
    sentence.push(`Do not lead with ${avoid.join(" or ")} — there is not enough evidence on this lead to justify those services as the opener.`);
  }
  lines.push(sentence.join(" "));
  lines.push("");
  return lines;
}

function buildPitchSequence(fit: LaborTechServiceFit, buckets: Record<HierarchyGroup, ServiceFitId[]>): string[] {
  const lines: string[] = [];
  const primary = SERVICE_LABELS[fit.primaryService];
  const bridge = buckets.BRIDGE_AFTER[0] ? SERVICE_LABELS[buckets.BRIDGE_AFTER[0]] : null;
  const supporting = buckets.SUPPORTING[0] ? SERVICE_LABELS[buckets.SUPPORTING[0]] : null;
  lines.push("## Best pitch sequence");
  lines.push(`1. Open with the strongest pain on this lead — ${primary}.`);
  lines.push(`2. Tie ${primary} to revenue impact: ${WHY_NOW[fit.primaryService]}`);
  if (bridge) {
    lines.push(`3. Bridge to ${bridge} once the buyer agrees the ${primary.toLowerCase()} gap is real.`);
  } else {
    lines.push(`3. Use discovery to find the next service — there's no clear secondary on the evidence yet.`);
  }
  if (supporting) {
    lines.push(`4. Mention ${supporting} only if discovery confirms the underlying gap; never lead with it.`);
  } else {
    lines.push(`4. Avoid stacking offers — keep the call focused on ${primary}.`);
  }
  lines.push(`5. Close with a discovery question (see below) so the buyer reveals the next gap themselves.`);
  lines.push("");
  return lines;
}

function buildSalesWarnings(buckets: Record<HierarchyGroup, ServiceFitId[]>): string[] {
  const lines: string[] = [];
  if (buckets.DO_NOT_LEAD.length === 0) return lines;
  lines.push("## Sales warnings");
  for (const sid of buckets.DO_NOT_LEAD.slice(0, 4)) {
    const label = SERVICE_LABELS[sid];
    const objection = OBJECTION_RISK[sid];
    lines.push(`- **Do not lead with ${label}.** Why not: ${objection.objection.toLowerCase()}, and there isn't enough evidence yet to short-circuit that objection. Reposition only after discovery confirms the underlying gap.`);
  }
  lines.push("");
  return lines;
}

function buildDiscoveryQuestionsBlock(fit: LaborTechServiceFit): string[] {
  const lines: string[] = [];
  const qs = pickDiscoveryQuestions(fit);
  if (qs.length === 0) return lines;
  lines.push("## Discovery questions to confirm fit");
  for (const q of qs) lines.push(`- ${q}`);
  lines.push("");
  return lines;
}

function buildRecommendedPackage(fit: LaborTechServiceFit, buckets: Record<HierarchyGroup, ServiceFitId[]>): string[] {
  const lines: string[] = [];
  const primary = SERVICE_LABELS[fit.primaryService];
  const secondary = buckets.BRIDGE_AFTER.slice(0, 2).map((s) => SERVICE_LABELS[s]);
  const optional = buckets.SUPPORTING.slice(0, 2).map((s) => SERVICE_LABELS[s]);
  lines.push("## Recommended package");
  lines.push(`- **Primary:** ${primary}`);
  if (secondary.length > 0) {
    lines.push(`- **Secondary:** ${secondary.join(" + ")}`);
  } else {
    lines.push(`- **Secondary:** open — let discovery decide`);
  }
  if (optional.length > 0) {
    lines.push(`- **Optional (depending on discovery):** ${optional.join(", ")}`);
  }
  lines.push("");
  return lines;
}

/**
 * Render the breakdown as a chat-friendly markdown block. Used by the
 * Assist Mode "Services needed" quick-action chip and the Operator's
 * "Break Down Services Needed →" button. Pure synthesis — no AI call.
 *
 * Output sections:
 *   1. Executive readout
 *   2. Service hierarchy (PITCH_FIRST → BRIDGE_AFTER → SUPPORTING →
 *      DO_NOT_LEAD), each service with score breakdown, why-it-may-fit,
 *      why-it-isn't-higher, what-would-raise-confidence, group reason
 *   3. Best pitch sequence (5 steps)
 *   4. Sales warnings (services to avoid leading with + how to
 *      reposition)
 *   5. Discovery questions to confirm fit (5)
 *   6. Recommended LaborTech package
 */
// ── Structured Service Strategy builder ────────────────────────────
//
// Produces the same data the chat renderer derives, but as a fully
// structured object so Operator Panel, Deep Report, calendar cards,
// the AI Assistant, and future industry packs can read fields
// directly instead of parsing markdown. Reuses every existing
// primitive (computeLaborTechServiceFit, buildSignalReport,
// bucketHierarchy, OPENING_ANGLES, OBJECTION_RISK, WHY_PSYCHOLOGY,
// DISCOVERY_QUESTIONS, GROUP_LABEL, HIERARCHY_REASON, PRIORITY_LABELS,
// PRIORITY_ICONS, WHY_NOW). No scoring formula is reimplemented.

function entryFor(
  sid: ServiceFitId,
  group: HierarchyGroup,
  rankIndex: number,
  fit: LaborTechServiceFit,
  reports: Map<ServiceFitId, SignalReport>,
  task: any,
): ServiceStrategyEntry {
  const label = SERVICE_LABELS[sid];
  const score = fit.scores[sid] ?? 0;
  const tier = tierFor(score);
  const tierLabel = tierLabelFor(tier);
  const report = reports.get(sid);
  const evidence = fit.evidenceByService[sid] ?? [];
  const isPrimary = sid === fit.primaryService;
  const pitch = isPrimary
    ? fit.openingAngle
    : OPENING_ANGLES[sid](String(task?.linkedCompany ?? ""));
  const objectionPair = OBJECTION_RISK[sid];

  // Why it may fit — first concrete evidence + buyer-psychology line.
  const whyItFits: string[] = [];
  if (evidence.length > 0) whyItFits.push(`${evidence[0]}.`);
  whyItFits.push(`${WHY_PSYCHOLOGY[sid]}.`);

  // Why it is not higher — derived from missing signals (if scored).
  const whyNotHigher: string[] = report
    ? (report.missing.length === 0
        ? ["Already firing on every captured signal — score reflects current evidence."]
        : report.missing.slice(0, 3).map((m) => `No direct evidence of: ${m.toLowerCase()}.`))
    : ["Not enough evidence yet."];

  // What would raise confidence — the same missing signals, framed
  // as actionable discovery items.
  const whatWouldRaiseConfidence: string[] = report ? report.missing.slice(0, 3) : [];

  const positives = report ? report.positives.slice() : [];
  const bonuses = report ? report.bonuses.slice() : [];
  const missing = report ? report.missing.slice() : [];
  const rawSubtotal = report ? report.rawSubtotal : 0;
  const cappedAt95 = rawSubtotal > 95;

  return {
    id: sid,
    label,
    score,
    tier,
    tierLabel,
    priority: PRIORITY_LABELS[rankIndex] ?? "PITCH LATER",
    priorityIcon: PRIORITY_ICONS[rankIndex] ?? "·",
    group,
    whyItFits,
    whyNotHigher,
    whatWouldRaiseConfidence,
    firedSignals: positives,
    missingSignals: missing,
    bonuses,
    rawSubtotal,
    cappedAt95,
    objection: objectionPair.objection,
    counter: objectionPair.counter,
    pitch,
    discoveryQuestions: (DISCOVERY_QUESTIONS[sid] ?? []).slice(0, 5),
  };
}

/**
 * Build the full Structured Service Strategy for a task. Pure /
 * deterministic — calls only existing engine primitives. Returns
 * null when there is no scan to read from.
 */
export function buildStructuredServiceStrategy(task: any): ServiceStrategy | null {
  const fit = computeLaborTechServiceFit(task);
  if (!fit) return null;

  const reports = buildSignalReport(task, fit);
  const buckets = bucketHierarchy(fit);

  // Build entries in master rank order so `priority` ("PITCH FIRST",
  // "PITCH SECOND", …) matches what the chat renderer emits.
  const groupOrder: HierarchyGroup[] = ["PITCH_FIRST", "BRIDGE_AFTER", "SUPPORTING", "DO_NOT_LEAD"];
  const hierarchy: ServiceStrategyEntry[] = [];
  let rankIndex = 0;
  for (const g of groupOrder) {
    for (const sid of buckets[g]) {
      hierarchy.push(entryFor(sid, g, rankIndex, fit, reports, task));
      rankIndex++;
    }
  }
  const byGroup = (g: HierarchyGroup) => hierarchy.filter((e) => e.group === g);

  // Executive readout (single sentence) — same composition as the
  // chat helper so the rendered output is byte-identical when both
  // are joined.
  const primaryEntry = hierarchy.find((e) => e.group === "PITCH_FIRST") ?? null;
  const bridgeEntry = byGroup("BRIDGE_AFTER")[0] ?? null;
  const avoidEntries = byGroup("DO_NOT_LEAD").slice(0, 2);
  const primaryEvidence = primaryEntry ? (fit.evidenceByService[primaryEntry.id] ?? []) : [];
  const evidenceFragment = primaryEvidence.length > 0
    ? primaryEvidence[0].toLowerCase().replace(/[.;]+$/g, "")
    : (primaryEntry ? WHY_PSYCHOLOGY[primaryEntry.id].toLowerCase() : "");
  const execParts: string[] = [];
  if (primaryEntry) {
    execParts.push(`Lead with **${primaryEntry.label}** — the strongest evidence on this lead is ${evidenceFragment}.`);
  }
  if (bridgeEntry) {
    execParts.push(`Bridge into **${bridgeEntry.label}** only after ${primaryEntry?.label ?? "the primary"} lands and the buyer agrees the gap is real.`);
  } else if (primaryEntry) {
    execParts.push(`No clear secondary yet — keep the call tight on ${primaryEntry.label} and use discovery to surface the next move.`);
  }
  if (avoidEntries.length > 0) {
    execParts.push(`Do not lead with ${avoidEntries.map((e) => e.label).join(" or ")} — there is not enough evidence on this lead to justify those services as the opener.`);
  }
  const executiveReadout = execParts.join(" ");

  // Pitch sequence — five strategic steps; mirrors buildPitchSequence
  // helper output exactly.
  const pitchSequence: string[] = [];
  if (primaryEntry) {
    pitchSequence.push(`Open with the strongest pain on this lead — ${primaryEntry.label}.`);
    pitchSequence.push(`Tie ${primaryEntry.label} to revenue impact: ${WHY_NOW[primaryEntry.id]}`);
    pitchSequence.push(bridgeEntry
      ? `Bridge to ${bridgeEntry.label} once the buyer agrees the ${primaryEntry.label.toLowerCase()} gap is real.`
      : `Use discovery to find the next service — there's no clear secondary on the evidence yet.`);
    const supporting = byGroup("SUPPORTING")[0] ?? null;
    pitchSequence.push(supporting
      ? `Mention ${supporting.label} only if discovery confirms the underlying gap; never lead with it.`
      : `Avoid stacking offers — keep the call focused on ${primaryEntry.label}.`);
    pitchSequence.push("Close with a discovery question (see below) so the buyer reveals the next gap themselves.");
  }

  // Sales warnings — services flagged DO_NOT_LEAD with their objection
  // text (matches buildSalesWarnings output).
  const salesWarnings = byGroup("DO_NOT_LEAD").slice(0, 4).map((e) => {
    return `Do not lead with ${e.label}. Why not: ${e.objection.toLowerCase()}, and there isn't enough evidence yet to short-circuit that objection. Reposition only after discovery confirms the underlying gap.`;
  });

  // Recommended package — primary + top-2 bridge + top-2 supporting.
  const secondaryLabels = byGroup("BRIDGE_AFTER").slice(0, 2).map((e) => e.label);
  const optionalLabels  = byGroup("SUPPORTING").slice(0, 2).map((e) => e.label);
  const recommendedPackage = {
    primary: primaryEntry?.label ?? null,
    secondary: secondaryLabels,
    optional: optionalLabels,
  };

  // Confidence summary — overall level + missing-evidence list pulled
  // from the primary's missing signals.
  const confidenceLevel: "Low" | "Medium" | "High" = fit.confidence;
  const confidenceReasons: string[] = [];
  if (primaryEntry) {
    confidenceReasons.push(`${primaryEntry.firedSignals.length} signal(s) fired on ${primaryEntry.label}.`);
    if (primaryEntry.bonuses.length > 0) {
      confidenceReasons.push(`Bonuses applied: ${primaryEntry.bonuses.map((b) => b.label).join(", ")}.`);
    }
  } else {
    confidenceReasons.push("No primary service identified — confidence floors at Low.");
  }
  const missingEvidence = primaryEntry ? primaryEntry.missingSignals.slice(0, 5) : [];

  return {
    executiveReadout,
    primaryService: primaryEntry,
    secondaryServices: byGroup("BRIDGE_AFTER"),
    supportingServices: byGroup("SUPPORTING"),
    lowFitServices: byGroup("DO_NOT_LEAD"),
    hierarchy,
    pitchSequence,
    salesWarnings,
    recommendedPackage,
    confidence: {
      level: confidenceLevel,
      reasons: confidenceReasons,
      missingEvidence,
    },
  };
}

export function renderServiceFitBreakdownAsChat(task: any): string {
  const fit = computeLaborTechServiceFit(task);
  if (!fit) {
    return "Not enough scan evidence on this lead yet — pull a deeper scan first.";
  }
  const company = String(task?.linkedCompany ?? task?.title ?? "this lead");
  const reports = buildSignalReport(task, fit);
  const buckets = bucketHierarchy(fit);

  const lines: string[] = [];
  lines.push(`Here is the services-needed breakdown for **${company}**.`);
  lines.push("");
  lines.push(...buildExecutiveReadout(fit, buckets));

  lines.push("## Service hierarchy");
  lines.push("");
  const groupOrder: HierarchyGroup[] = ["PITCH_FIRST", "BRIDGE_AFTER", "SUPPORTING", "DO_NOT_LEAD"];
  for (const g of groupOrder) {
    const services = buckets[g];
    if (!services || services.length === 0) continue;
    lines.push(`### ${GROUP_LABEL[g]}`);
    lines.push("");
    for (const sid of services) {
      lines.push(...formatServiceDetail(sid, fit, reports, g));
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  lines.push(...buildPitchSequence(fit, buckets));
  lines.push(...buildSalesWarnings(buckets));
  lines.push(...buildDiscoveryQuestionsBlock(fit));
  lines.push(...buildRecommendedPackage(fit, buckets));

  return lines.join("\n").trim();
}
