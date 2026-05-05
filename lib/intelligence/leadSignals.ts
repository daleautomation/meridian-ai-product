// Meridian — Unified Signal Engine.
//
// Single source of truth for raw signal detection. Wraps the existing
// signal table from lib/scan/serviceFit.ts (no duplication) and emits
// a structured payload every consumer can read:
//   • Lead Intelligence Layer (evidence, scoring inputs, gaps)
//   • Structured Service Strategy (already reads the engine)
//   • Closeability / urgency derivations (downstream consumers can
//     project from `signals.byCategory.*`)
//   • Future industry packs (signal set is parameterizable)
//
// CRITICAL: this engine never invents data. It reads the existing
// regex table, the existing scan, and the existing trade priors.
// Output is deterministic over identical input.

import {
  computeLaborTechServiceFit,
  buildSignalReport,
  gatherText,
  SIGNALS,
  VISUAL_TRADE_SET,
  PHONE_FIRST_TRADE_SET,
  SERVICE_LABEL_MAP,
  type Signal,
  type ServiceFitId,
  type LaborTechServiceFit,
} from "../scan/serviceFit";

// ── Public types ────────────────────────────────────────────────────

export type SignalCategory =
  | "reputation"
  | "seo"
  | "website"
  | "paid_search"
  | "paid_social"
  | "social"
  | "media"
  | "voice"
  | "chat"
  | "booking"
  | "crm"
  | "lifecycle"
  | "leadgen"
  | "content"
  | "app"
  | "influencer"
  | "trade_prior"
  | "closeability"
  | "urgency";

export interface FiredSignal {
  id: string;                 // stable id derived from service + label
  label: string;              // human-readable evidence label
  category: SignalCategory;
  serviceId: ServiceFitId | null;
  weight: number;             // engine weight that fired
  source: "regex" | "trade_prior" | "scan_field";
  confidence: "High" | "Medium" | "Low";
  evidence: string;           // short text pulled from corpus
  matchedText: string | null; // first match, when available
}

export interface MissingSignal {
  id: string;
  label: string;
  category: SignalCategory;
  serviceId: ServiceFitId | null;
  weight: number;             // weight it WOULD have added
  reason: string;             // why we mark it missing
  discoveryQuestion: string;  // the question to ask to resolve
}

export interface LeadSignalsResult {
  identity: {
    leadId: string | null;
    companyName: string | null;
    trade: string | null;
    industry: string;
  };
  textCorpus: {
    sourceText: string;
    scanText: string;
    evidenceText: string;
    websiteText: string;
    notesText: string;
  };
  signals: {
    fired: FiredSignal[];
    missing: MissingSignal[];
    byService: Partial<Record<ServiceFitId, { fired: FiredSignal[]; missing: MissingSignal[] }>>;
    byCategory: Partial<Record<SignalCategory, FiredSignal[]>>;
  };
  scoringInputs: {
    serviceFit: {
      primary: ServiceFitId | null;
      score: number | null;
      confidence: "High" | "Medium" | "Low" | null;
    };
    closeability: {
      score: number | null;
      label: string | null;
    };
    urgency: {
      label: string | null;
    };
    opportunity: {
      score: number | null;
      tier: "CLOSE_NOW" | "STRONG" | "TEST" | "QUEUED";
    };
    confidence: {
      level: "High" | "Medium" | "Low";
      reasons: string[];
    };
  };
  evidence: {
    proofPoints: string[];
    risks: string[];
    assumptions: string[];
    gaps: string[];
  };
  recommendations: {
    primarySignal: string | null;
    strongestPain: string | null;
    weakestArea: string | null;
    nextDiscoveryQuestion: string | null;
    whyNow: string | null;
  };
  raw: {
    task: any;
    scan: any;
    serviceFitSignals: Signal[];
  };
}

export interface BuildLeadSignalsOptions {
  industryId?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

const NOT_ENOUGH = "Not enough evidence yet";

// Map each ServiceFitId to its broader signal category. Trade priors,
// closeability, and urgency get their own categories so consumers
// can project by category cleanly.
const SERVICE_TO_CATEGORY: Record<ServiceFitId, SignalCategory> = {
  reputation_management:    "reputation",
  seo:                      "seo",
  website_funnel:           "website",
  google_ads:               "paid_search",
  meta_ads:                 "paid_social",
  social_media_management:  "social",
  media_production:         "media",
  voice_ai_agent:           "voice",
  chat_ai_agent:            "chat",
  appointment_scheduler:    "booking",
  crm:                      "crm",
  email_sms:                "lifecycle",
  lead_generation:          "leadgen",
  blog_posting:             "content",
  mobile_app:               "app",
  influencer_marketing:     "influencer",
};

// Discovery question per evidence label. Used to fill MissingSignal's
// discoveryQuestion when the regex didn't fire. Pulled from the same
// pool the chat renderer uses (DISCOVERY_QUESTIONS), but keyed on
// evidenceLabel for the missing-signal path.
const LABEL_TO_DISCOVERY: Record<string, string> = {
  "Low review volume":                 "How does your review count compare to the top three competitors in your area?",
  "Rating below market":               "What's your current Google rating, and how do you handle low reviews?",
  "Competitor review gap":             "Do you know how many reviews the competitors above you have?",
  "Weak review velocity":              "How often are you asking happy customers for reviews?",
  "Weak GBP trust signals":            "When was your Google Business Profile last updated?",
  "Trust / social proof gap":          "What does your typical buyer look at before they call?",
  "Weak map-pack visibility":          "Do you know where you show up in Google's map pack vs the companies above you?",
  "Low organic visibility":            "Are most of your inbound jobs coming from search, referrals, or repeat customers?",
  "Poor service / location keyword presence": "Have you ever measured how you rank for your service + city terms?",
  "Missing GBP details":               "Is your Google Business Profile fully filled out — services, hours, photos?",
  "No website / site missing":         "Do you have a website right now, or is everything by phone?",
  "Outdated website":                  "When was your site last meaningfully updated?",
  "Poor mobile / performance":         "How does your site look on a phone vs desktop?",
  "Weak CTA / conversion path":        "When someone lands on your site, what do you want them to do first?",
  "Competitors running ads — lead is not": "Are you running paid search right now? What about your competitors?",
  "Paid-search opportunity":           "Have you tried Google Ads in your service area before?",
  "High-intent service category":      "What's your typical job size from a Google search lead?",
  "Seasonal demand window":            "Are there months when you're slammed and others when you're slow?",
  "Paid-social opportunity":           "Are you running anything on Meta or just organic posts?",
  "No retargeting in place":           "Is the Meta pixel installed on your site today?",
  "Before/after content opportunity":  "Do you have before/after photos or galleries from recent jobs?",
  "Inactive / outdated social":        "How often do you post to social right now?",
  "Weak social presence":              "Have buyers ever cross-checked your social before they called?",
  "Content cadence gap":               "Who's creating content for your social channels right now?",
  "Poor visual / portfolio assets":    "What's your current photo/video setup on jobs?",
  "Weak trust assets":                 "How do buyers see proof of your work today?",
  "Missed-call risk":                  "Roughly how many calls do you miss in a week?",
  "Phone-first / urgent category":     "Are you a 24/7 service or business hours only?",
  "No booking automation":             "What happens when a customer calls during a site visit?",
  "No chat / repetitive web questions": "Do you get repetitive 'do you service my area' questions?",
  "Inbound qualification opportunity": "Who's answering inbound emails right now?",
  "No visible online booking":         "How do customers book with you today — phone, email, or web?",
  "Consultation / estimate workflow":  "How many leads go quiet after the first quote?",
  "Weak follow-up / cadence":          "What does your follow-up cadence look like for unbooked quotes?",
  "Multi-location follow-up complexity": "Do you operate in multiple service areas or locations?",
  "Poor lead tracking signals":        "Where do you track customer info today?",
  "Reactivation / recurring opportunity": "Have you ever run a reactivation campaign on past customers?",
  "Email / SMS channel gap":           "How big is your existing customer list?",
  "Weak inbound presence":             "What's the bottleneck — visibility, conversion, or capacity?",
  "Outbound opportunity":              "Have you done any outbound prospecting?",
  "Authority / content gap":           "What questions do customers ask most often before they book?",
  "Repeat / portal workflow":          "How often do customers come back to you for repeat work?",
  "DTC / consumer-brand surface":      "Do you sell direct to consumers, or strictly local services?",
};

function fallbackDiscovery(label: string): string {
  return LABEL_TO_DISCOVERY[label] ?? `Have you confirmed signals around: ${label.toLowerCase()}?`;
}

function categoryFor(serviceId: ServiceFitId | null): SignalCategory {
  if (!serviceId) return "trade_prior";
  return SERVICE_TO_CATEGORY[serviceId] ?? "trade_prior";
}

function signalIdOf(serviceId: ServiceFitId | null, label: string): string {
  return `${serviceId ?? "any"}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function confidenceForWeight(weight: number): "High" | "Medium" | "Low" {
  if (weight >= 18) return "High";
  if (weight >= 10) return "Medium";
  return "Low";
}

function tierFromCloseability(c: number | null): "CLOSE_NOW" | "STRONG" | "TEST" | "QUEUED" {
  if (typeof c !== "number") return "QUEUED";
  if (c >= 80) return "CLOSE_NOW";
  if (c >= 60) return "STRONG";
  if (c >= 40) return "TEST";
  return "QUEUED";
}

function pickString(...vals: any[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

function asArray(v: any): any[] { return Array.isArray(v) ? v : []; }

function normalizeBullets(items: any[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (typeof i === "string" && i.trim()) out.push(i.trim());
    else if (i && typeof i === "object") {
      const t = i.statement ?? i.text ?? i.title ?? i.label ?? null;
      if (typeof t === "string" && t.trim()) out.push(t.trim());
    }
  }
  return out;
}

// ── Builder ─────────────────────────────────────────────────────────

export function buildLeadSignals(
  task: any,
  options: BuildLeadSignalsOptions = {},
): LeadSignalsResult {
  const lead = task ?? {};
  const scan = lead.laborTechScan ?? lead.deepReport ?? lead.scan ?? null;
  const industry = options.industryId ?? "labortech";

  // ── identity ─────────────────────────────────────────────────────
  const identity: LeadSignalsResult["identity"] = {
    leadId: pickString(lead.id, lead.linkedLeadId, lead.leadId, lead.taskId),
    companyName: pickString(lead.linkedCompany, lead.companyName, lead.name, lead.title),
    trade: pickString(lead.tradeId, lead.trade, lead.module),
    industry,
  };

  // ── text corpus ──────────────────────────────────────────────────
  const sourceText = gatherText(lead);
  const scanText = pickString(scan?.primaryPain, scan?.headline, scan?.qualificationReason, scan?.recommendedAction) ?? "";
  const evidenceText = normalizeBullets(asArray(scan?.evidence)).join("\n");
  const websiteText = pickString(lead.website, lead.url, lead.domain) ?? "";
  const notesText = pickString(lead.notes, lead.note) ?? "";
  const textCorpus = { sourceText, scanText, evidenceText, websiteText, notesText };

  // Compute fit so we can derive primary/score/confidence + reuse the
  // already-built per-service report (positives, bonuses, missing).
  const fit: LaborTechServiceFit | null = scan ? computeLaborTechServiceFit(lead) : null;
  const reports = fit ? buildSignalReport(lead, fit) : new Map();

  // Trade priors (visual / phone-first) — synthesize as fired/missing
  // signals so consumers see them in the same shape as regex hits.
  const tradeId = String(identity.trade ?? "").toLowerCase();
  const isVisualTrade = Array.from(VISUAL_TRADE_SET).some((t) => tradeId.includes(t));
  const isPhoneFirstTrade = Array.from(PHONE_FIRST_TRADE_SET).some((t) => tradeId.includes(t));

  // ── fired + missing assembly ────────────────────────────────────
  const fired: FiredSignal[] = [];
  const missing: MissingSignal[] = [];
  const byService: LeadSignalsResult["signals"]["byService"] = {};
  const byCategory: LeadSignalsResult["signals"]["byCategory"] = {};

  // Walk every service the engine scored.
  if (fit) {
    for (const sid of Object.keys(fit.scores) as ServiceFitId[]) {
      const r = reports.get(sid);
      if (!r) continue;
      const cat = categoryFor(sid);
      const firedForService: FiredSignal[] = [];
      const missingForService: MissingSignal[] = [];

      for (const p of r.positives) {
        const sig: FiredSignal = {
          id: signalIdOf(sid, p.label),
          label: p.label,
          category: cat,
          serviceId: sid,
          weight: p.weight,
          source: "regex",
          confidence: confidenceForWeight(p.weight),
          evidence: p.label,
          matchedText: null,
        };
        fired.push(sig);
        firedForService.push(sig);
      }
      for (const b of r.bonuses) {
        // Bonuses come from trade priors / closeability / urgency.
        const isTradePrior = b.label.includes("prior");
        const cat2: SignalCategory = isTradePrior ? "trade_prior"
          : b.label.startsWith("Closeability") ? "closeability"
          : b.label.startsWith("Urgency") ? "urgency"
          : cat;
        const sig: FiredSignal = {
          id: signalIdOf(sid, b.label),
          label: b.label,
          category: cat2,
          serviceId: sid,
          weight: b.weight,
          source: "trade_prior",
          confidence: confidenceForWeight(b.weight),
          evidence: b.label,
          matchedText: null,
        };
        fired.push(sig);
        firedForService.push(sig);
      }
      for (const mLabel of r.missing) {
        // Find the matching SIGNALS entry to get the weight it would
        // have added — pure lookup, no recomputation.
        const matchingSignal = SIGNALS.find((s) => s.service === sid && s.evidenceLabel === mLabel);
        const weight = matchingSignal ? matchingSignal.weight : 0;
        const ms: MissingSignal = {
          id: signalIdOf(sid, mLabel),
          label: mLabel,
          category: cat,
          serviceId: sid,
          weight,
          reason: `No direct evidence of ${mLabel.toLowerCase()} on this lead yet.`,
          discoveryQuestion: fallbackDiscovery(mLabel),
        };
        missing.push(ms);
        missingForService.push(ms);
      }
      byService[sid] = { fired: firedForService, missing: missingForService };
      const cell = byCategory[cat] ?? [];
      for (const f of firedForService) cell.push(f);
      byCategory[cat] = cell;
    }
  }

  // ── scoring inputs ──────────────────────────────────────────────
  const closeScore = typeof scan?.closeability?.score === "number" ? scan.closeability.score : null;
  const closeLabel = typeof scan?.closeability?.label === "string" ? scan.closeability.label : null;
  const urgencyLabel = typeof scan?.urgency?.label === "string" ? scan.urgency.label : null;
  const urgencyWeight = urgencyLabel === "Critical" ? 1.15 : urgencyLabel === "High" ? 1.08 : 1.0;
  const opportunityScore = typeof closeScore === "number"
    ? Math.min(100, Math.round(closeScore * urgencyWeight))
    : null;
  const tier = tierFromCloseability(closeScore);

  // Confidence — overall reasoning summary.
  const confidenceReasons: string[] = [];
  if (!scan) confidenceReasons.push("No scan attached — confidence floors at Low.");
  else if (fired.length === 0) confidenceReasons.push("Scan attached but no signals fired yet.");
  else confidenceReasons.push(`${fired.length} signal(s) fired across ${Object.keys(byCategory).length} categor${Object.keys(byCategory).length === 1 ? "y" : "ies"}.`);
  if (fit?.confidence) confidenceReasons.push(`Service-fit confidence: ${fit.confidence}.`);
  const overallConfidence: "High" | "Medium" | "Low" = !scan
    ? "Low"
    : (fit?.confidence === "High" && (closeScore ?? 0) >= 75 ? "High"
       : fit?.confidence === "High" || (closeScore ?? 0) >= 70 ? "Medium"
       : fit?.confidence === "Medium" ? "Medium" : "Low");

  const scoringInputs: LeadSignalsResult["scoringInputs"] = {
    serviceFit: {
      primary: fit?.primaryService ?? null,
      score: fit ? (fit.scores[fit.primaryService] ?? null) : null,
      confidence: fit?.confidence ?? null,
    },
    closeability: { score: closeScore, label: closeLabel },
    urgency: { label: urgencyLabel },
    opportunity: { score: opportunityScore, tier },
    confidence: { level: overallConfidence, reasons: confidenceReasons },
  };

  // ── evidence ────────────────────────────────────────────────────
  const proofPoints = normalizeBullets(asArray(scan?.evidence));
  const assumptions = normalizeBullets(asArray(scan?.businessImpact));
  const risks = normalizeBullets(asArray(scan?.risks));
  // gaps — top missing signals by would-have-added weight, capped at 5
  const gaps = missing
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((m) => m.label);

  const evidence = { proofPoints, risks, assumptions, gaps };

  // ── recommendations ─────────────────────────────────────────────
  const strongestFired = fired.slice().sort((a, b) => b.weight - a.weight)[0] ?? null;
  const topMissing = missing.slice().sort((a, b) => b.weight - a.weight)[0] ?? null;
  const recommendations: LeadSignalsResult["recommendations"] = {
    primarySignal: strongestFired?.label ?? null,
    strongestPain: pickString(scan?.primaryPain, scan?.headline) ?? strongestFired?.label ?? null,
    weakestArea: topMissing?.label ?? null,
    nextDiscoveryQuestion: topMissing?.discoveryQuestion ?? null,
    whyNow: scan ? null : NOT_ENOUGH,
  };

  // ── raw ─────────────────────────────────────────────────────────
  // Note: `isVisualTrade` and `isPhoneFirstTrade` are already baked
  // into fired bonuses by buildSignalReport — exposing them here as
  // raw flags is redundant and risks divergence. Consumers who want
  // to inspect priors should read fired signals where source ===
  // "trade_prior".
  void isVisualTrade;
  void isPhoneFirstTrade;

  return {
    identity,
    textCorpus,
    signals: { fired, missing, byService, byCategory },
    scoringInputs,
    evidence,
    recommendations,
    raw: {
      task: lead,
      scan,
      serviceFitSignals: SIGNALS,
    },
  };
}

// ── Dev helper ──────────────────────────────────────────────────────

export interface LeadSignalsSummary {
  firedCount: number;
  strongestCategory: SignalCategory | null;
  primaryServiceSignal: string | null;
  missingEvidenceCount: number;
  topMissingSignal: string | null;
  nextDiscoveryQuestion: string | null;
}

/**
 * Dev-only readable summary for debug panels and tests. Pure /
 * deterministic. Never opens a network call.
 */
export function summarizeLeadSignals(task: any): LeadSignalsSummary {
  const r = buildLeadSignals(task);
  // Strongest category by total weight fired.
  let strongestCategory: SignalCategory | null = null;
  let strongestWeight = -1;
  for (const cat of Object.keys(r.signals.byCategory) as SignalCategory[]) {
    const total = (r.signals.byCategory[cat] ?? []).reduce((sum, f) => sum + f.weight, 0);
    if (total > strongestWeight) { strongestWeight = total; strongestCategory = cat; }
  }
  const primarySid = r.scoringInputs.serviceFit.primary;
  const primaryServiceSignal = primarySid
    ? `${SERVICE_LABEL_MAP[primarySid]} (${r.scoringInputs.serviceFit.score ?? 0})`
    : null;
  return {
    firedCount: r.signals.fired.length,
    strongestCategory,
    primaryServiceSignal,
    missingEvidenceCount: r.signals.missing.length,
    topMissingSignal: r.recommendations.weakestArea,
    nextDiscoveryQuestion: r.recommendations.nextDiscoveryQuestion,
  };
}
