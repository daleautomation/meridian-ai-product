// Meridian — Unified Lead Intelligence Layer.
//
// One canonical `LeadIntelligence` object every UI surface consumes.
// Replaces the scattered per-component normalization that used to live
// inside TaskCard, SelectedLeadPanel, IntelligencePanel,
// TodayExecutionPlan, and the assistant panels.
//
// CRITICAL: this layer never invents data. It only normalizes aliases,
// re-uses deterministic engines (computeLaborTechServiceFit,
// buildServiceFitBreakdown, renderServiceFitBreakdownAsChat), and
// surfaces safe fallbacks for anything missing:
//   - null
//   - []
//   - "Not enough evidence yet"
//   - "Needs deeper scan"
//
// Adopt-as-you-go: existing consumers can keep reading the old fields
// while new code reads `lead.intelligence.*`. A consumer migration is
// always a one-line swap, never a rewrite.

import {
  computeLaborTechServiceFit,
  buildServiceFitBreakdown,
  buildStructuredServiceStrategy,
  renderServiceFitBreakdownAsChat,
  type LaborTechServiceFit,
  type ServiceFitBreakdownEntry,
  type ServiceFitId,
  type ServiceStrategy,
} from "../scan/serviceFit";
import { buildLeadSignals, type LeadSignalsResult } from "./leadSignals";
import { buildLeadDecision, type LeadDecision } from "./leadDecision";
import { LABORTECH_INDUSTRY_PACK, type IndustryPack } from "./industryPack";

// ── Public types ────────────────────────────────────────────────────

export interface LeadIntelligenceIdentity {
  id: string | null;
  companyName: string | null;
  trade: string | null;        // canonical lowercase slug, e.g. "roofing"
  tradeLabel: string | null;   // human label, e.g. "Roofing"
  industry: string;            // industryPack.id
  serviceArea: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
}

export interface LeadIntelligenceScores {
  closeability: number | null;            // 0–100
  urgency: "Critical" | "High" | "Medium" | "Low" | null;
  serviceFit: number | null;              // 0–95 from the primary
  serviceFitConfidence: "High" | "Medium" | "Low" | null;
  opportunityScore: number | null;        // closeability * urgencyWeight
  confidence: "High" | "Medium" | "Low";  // overall, derived
}

export interface LeadIntelligenceServices {
  primary: { id: ServiceFitId | null; label: string | null; score: number | null };
  secondary: Array<{ id: ServiceFitId; label: string; score: number }>;
  supporting: Array<{ id: ServiceFitId; label: string; score: number }>;
  lowFit: Array<{ id: ServiceFitId; label: string; score: number }>;
  hierarchy: ServiceFitBreakdownEntry[];  // ranked list
  recommendedPackage: {
    primary: string | null;
    secondary: string[];
    optional: string[];
  };
}

export interface LeadIntelligenceEvidence {
  firedSignals: string[];                 // engine-detected signals
  missingSignals: string[];               // signals not yet fired (per primary)
  proofPoints: string[];                  // scan.evidence (normalized)
  risks: string[];                        // scan.risks (normalized)
  assumptions: string[];                  // scan.businessImpact (normalized)
  confidenceReasons: string[];            // why current confidence level
}

export interface LeadIntelligenceSalesStrategy {
  primaryAngle: string | null;
  nextBestAction: string | null;
  opener: string | null;
  pitchSequence: string[];
  objections: string[];                   // per primary + top secondary
  counters: string[];                     // matched 1:1 with objections
  discoveryQuestions: string[];           // 5
  warnings: string[];                     // services to avoid leading with
}

export interface LeadIntelligenceScheduling {
  recommendedDay: string | null;          // ISO date
  recommendedTime: string | null;         // HH:mm local
  priorityWindow: "Day-1" | "Day-2+" | "Overflow" | null;
  noWeekendEligible: boolean;
  overflowEligible: boolean;
}

export interface LeadIntelligenceAssistantContext {
  summary: string;
  servicesNeededPrompt: string;
  deepReportPrompt: string;
  callAssistPrompt: string;
  emailPrompt: string;
}

export interface LeadIntelligenceUi {
  cardTitle: string;
  cardSubtitle: string | null;
  badges: Array<{ label: string; tone: "blue" | "green" | "red" | "neutral" }>;
  tags: string[];
  tier: "CLOSE_NOW" | "STRONG" | "TEST" | "QUEUED";
  colorIntent: "blue" | "green" | "red" | "neutral";
  emptyStates: { hasScan: boolean; hasContact: boolean };
}

export interface LeadIntelligence {
  identity: LeadIntelligenceIdentity;
  scores: LeadIntelligenceScores;
  services: LeadIntelligenceServices;
  evidence: LeadIntelligenceEvidence;
  salesStrategy: LeadIntelligenceSalesStrategy;
  scheduling: LeadIntelligenceScheduling;
  assistantContext: LeadIntelligenceAssistantContext;
  ui: LeadIntelligenceUi;
  // Operational decision projection — composed from signals + strategy
  // + intelligence. Read this for execution priority, queue ranking,
  // next-best-action, routing, and the assistant prompt set.
  decision: LeadDecision;
  raw: { originalLead: any; scan: any; enrichment: any };
  industryPack: IndustryPack;
}

export interface BuildLeadIntelligenceOptions {
  industryPack?: IndustryPack;
  now?: Date;
}

// ── Helpers ─────────────────────────────────────────────────────────

const NOT_ENOUGH = "Not enough evidence yet";
const NEEDS_SCAN = "Needs deeper scan";

function pickString(...candidates: any[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

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

function bucketHierarchy(hierarchy: ServiceFitBreakdownEntry[]) {
  const primary = hierarchy[0] ?? null;
  const secondary: Array<{ id: ServiceFitId; label: string; score: number }> = [];
  const supporting: Array<{ id: ServiceFitId; label: string; score: number }> = [];
  const lowFit: Array<{ id: ServiceFitId; label: string; score: number }> = [];
  for (let i = 1; i < hierarchy.length; i++) {
    const e = hierarchy[i];
    const cell = { id: e.serviceId, label: e.label, score: e.score };
    if (e.score >= 60)      secondary.push(cell);
    else if (e.score >= 40) supporting.push(cell);
    else                    lowFit.push(cell);
  }
  return { primary, secondary, supporting, lowFit };
}

function deriveOverallConfidence(
  serviceFitConfidence: "High" | "Medium" | "Low" | null,
  closeability: number | null,
  hasScan: boolean,
): "High" | "Medium" | "Low" {
  if (!hasScan) return "Low";
  if (serviceFitConfidence === "High" && (closeability ?? 0) >= 75) return "High";
  if (serviceFitConfidence === "High" || (closeability ?? 0) >= 70) return "Medium";
  if (serviceFitConfidence === "Medium") return "Medium";
  return "Low";
}

function tierFromCloseability(c: number | null): LeadIntelligenceUi["tier"] {
  if (typeof c !== "number") return "QUEUED";
  if (c >= 80) return "CLOSE_NOW";
  if (c >= 60) return "STRONG";
  if (c >= 40) return "TEST";
  return "QUEUED";
}

function colorIntentFor(tier: LeadIntelligenceUi["tier"]): LeadIntelligenceUi["colorIntent"] {
  return tier === "CLOSE_NOW" ? "green"
       : tier === "STRONG"    ? "blue"
       : tier === "TEST"      ? "neutral"
       : "neutral";
}

function isWeekendIso(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

// ── Builder ─────────────────────────────────────────────────────────

export function buildLeadIntelligence(
  input: any,
  opts: BuildLeadIntelligenceOptions = {},
): LeadIntelligence {
  const lead = input ?? {};
  const industryPack = opts.industryPack ?? LABORTECH_INDUSTRY_PACK;

  // Alias-safe normalization. Read every shape we've seen in this
  // codebase so consumers can pass tasks, leads, or hybrid objects.
  const id          = pickString(lead.id, lead.taskId, lead.leadId);
  const companyName = pickString(lead.linkedCompany, lead.companyName, lead.name, lead.title);
  const trade       = pickString(lead.tradeId, lead.trade, lead.module, lead.moduleId);
  const tradeLabel  = pickString(lead.tradeLabel, lead.tradeName, lead.module);
  const serviceArea = pickString(lead.serviceArea, lead.linkedLocation, lead.location);
  const website     = pickString(lead.website, lead.url, lead.domain);
  const phone       = pickString(lead.phone, lead.phoneNumber, lead?.contacts?.primaryPhone);
  const email       = pickString(lead.verifiedEmail, lead.email, lead?.contacts?.primaryEmail);
  const source      = pickString(lead.source, lead.leadSource, lead.origin);

  // Scan: tolerate the three known aliases.
  const scan = lead.laborTechScan ?? lead.deepReport ?? lead.scan ?? null;

  // Service-fit engines do all the deterministic work — we just shape
  // the output. Pass a normalised view so the engine sees `tradeId`
  // and `laborTechScan` regardless of which alias the source used.
  const engineInput = {
    ...lead,
    tradeId: trade,
    tradeLabel,
    laborTechScan: scan,
    linkedCompany: companyName,
  };
  const fit: LaborTechServiceFit | null = scan ? computeLaborTechServiceFit(engineInput) : null;
  const hierarchy: ServiceFitBreakdownEntry[] = scan
    ? buildServiceFitBreakdown(engineInput, { minScore: 0 })
    : [];
  // Structured strategy — single source of truth for the layer's
  // services / salesStrategy sections. Read structured fields
  // directly instead of parsing chat markdown.
  const strategy: ServiceStrategy | null = scan
    ? buildStructuredServiceStrategy(engineInput)
    : null;
  // Unified Signal Engine — single source of truth for the layer's
  // evidence section + scoring inputs. Wraps the existing SIGNALS
  // table; never duplicates regexes.
  const signals: LeadSignalsResult = buildLeadSignals(engineInput, {
    industryId: industryPack.id,
  });

  // ── identity ─────────────────────────────────────────────────────
  const identity: LeadIntelligenceIdentity = {
    id,
    companyName,
    trade,
    tradeLabel,
    industry: industryPack.id,
    serviceArea,
    website,
    phone,
    email,
    source,
  };

  // ── scores ───────────────────────────────────────────────────────
  const closeability = typeof scan?.closeability?.score === "number"
    ? scan.closeability.score
    : (typeof lead.closeProbability100 === "number" ? Math.round(lead.closeProbability100) : null);
  const urgencyRaw = scan?.urgency?.label;
  const urgency = (["Critical", "High", "Medium", "Low"] as const).includes(urgencyRaw)
    ? urgencyRaw as LeadIntelligenceScores["urgency"]
    : null;
  const serviceFit = fit ? (fit.scores[fit.primaryService] ?? null) : null;
  const serviceFitConfidence = fit?.confidence ?? null;
  const urgencyWeight = urgency === "Critical" ? 1.15 : urgency === "High" ? 1.08 : 1.0;
  const opportunityScore =
    typeof closeability === "number"
      ? Math.min(100, Math.round(closeability * urgencyWeight))
      : null;
  const confidence = deriveOverallConfidence(serviceFitConfidence, closeability, !!scan);

  const scores: LeadIntelligenceScores = {
    closeability,
    urgency,
    serviceFit,
    serviceFitConfidence,
    opportunityScore,
    confidence,
  };

  // ── services ─────────────────────────────────────────────────────
  const buckets = bucketHierarchy(hierarchy);
  const services: LeadIntelligenceServices = {
    primary: {
      id: fit?.primaryService ?? null,
      label: fit?.primaryServiceLabel ?? null,
      score: serviceFit,
    },
    secondary: buckets.secondary,
    supporting: buckets.supporting,
    lowFit: buckets.lowFit,
    hierarchy,
    recommendedPackage: {
      primary: fit?.primaryServiceLabel ?? null,
      secondary: buckets.secondary.slice(0, 2).map((s) => s.label),
      optional: buckets.supporting.slice(0, 2).map((s) => s.label),
    },
  };

  // ── evidence ─────────────────────────────────────────────────────
  // Evidence is now sourced through the Unified Signal Engine. proof
  // / risks / assumptions still come from scan arrays (operator-
  // visible bullets). firedSignals and missingSignals are the
  // primary service's fired/missing labels, projected from
  // signals.byService. confidenceReasons come from the engine's
  // overall confidence summary.
  const proofPoints = signals.evidence.proofPoints;
  const assumptions = signals.evidence.assumptions;
  const risks = signals.evidence.risks;
  const primarySid = signals.scoringInputs.serviceFit.primary;
  const primaryByService = primarySid ? signals.signals.byService[primarySid] : null;
  const firedSignals = primaryByService
    ? primaryByService.fired.map((s) => s.label)
    : (fit?.evidenceByService[fit.primaryService] ?? []);
  const missingSignals = primaryByService
    ? primaryByService.missing.map((s) => s.label)
    : [];
  const confidenceReasons: string[] = signals.scoringInputs.confidence.reasons.slice();

  const evidence: LeadIntelligenceEvidence = {
    firedSignals,
    missingSignals,
    proofPoints,
    risks,
    assumptions,
    confidenceReasons,
  };

  // ── salesStrategy ────────────────────────────────────────────────
  const primaryAngle = pickString(scan?.recommendedAction, lead.nextAction, fit?.openingAngle);
  const opener = pickString(fit?.openingAngle, scan?.salesAngle?.opener, lead.suggestedOpeningLine);
  const nextBestAction = (() => {
    if (!scan) return NEEDS_SCAN;
    const isHot = urgency === "Critical" || urgency === "High";
    const hasPhone = typeof phone === "string" && phone.length > 0;
    const hasEmail = typeof email === "string" && email.length > 0;
    if (hasPhone && isHot) return "Call now — urgency is high. Lead with the opening angle.";
    if (hasPhone)          return "Call today and lead with the opening angle.";
    if (hasEmail)          return "Send the opening angle via email today.";
    return "Find a phone or verified email before reaching out.";
  })();
  // pitchSequence / objections / counters / discoveryQuestions /
  // warnings now come directly from the structured strategy. These
  // were either empty placeholders or duplicated lightweight versions
  // of the chat renderer's logic — the layer is the single boundary.
  const pitchSequence = strategy ? strategy.pitchSequence.slice() : [];
  const objections: string[] = strategy
    ? strategy.hierarchy.slice(0, 3).map((e) => `${e.label}: ${e.objection}`)
    : [];
  const counters: string[] = strategy
    ? strategy.hierarchy.slice(0, 3).map((e) => `${e.label}: ${e.counter}`)
    : [];
  // Discovery questions: 3 from primary + 1 from each top-2 secondary,
  // deduped, capped at 5. Mirrors the chat renderer's pickDiscovery
  // helper so the structured field matches the chat output.
  const discoveryQuestions: string[] = (() => {
    if (!strategy?.primaryService) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (q: string) => { if (!seen.has(q) && out.length < 5) { out.push(q); seen.add(q); } };
    for (const q of strategy.primaryService.discoveryQuestions.slice(0, 3)) add(q);
    for (const sec of strategy.secondaryServices.slice(0, 2)) {
      for (const q of sec.discoveryQuestions) { add(q); if (out.length >= 5) break; }
    }
    for (const q of strategy.primaryService.discoveryQuestions) {
      add(q); if (out.length >= 5) break;
    }
    return out;
  })();
  const warnings = strategy ? strategy.salesWarnings.slice() : [];

  const salesStrategy: LeadIntelligenceSalesStrategy = {
    primaryAngle,
    nextBestAction,
    opener,
    pitchSequence,
    objections,
    counters,
    discoveryQuestions,
    warnings,
  };

  // ── scheduling ───────────────────────────────────────────────────
  const dueIso = typeof lead.dueDate === "string" ? lead.dueDate : null;
  const recommendedDay = dueIso ? new Date(dueIso).toISOString().slice(0, 10) : null;
  const recommendedTime = dueIso
    ? (() => { const d = new Date(dueIso); return Number.isNaN(d.getTime()) ? null : `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; })()
    : null;
  const onWeekend = isWeekendIso(dueIso);
  const priorityWindow: LeadIntelligenceScheduling["priorityWindow"] = (() => {
    if (typeof closeability !== "number") return null;
    if (closeability >= 75) return "Day-1";
    if (closeability >= 50) return "Day-2+";
    return "Overflow";
  })();
  const scheduling: LeadIntelligenceScheduling = {
    recommendedDay,
    recommendedTime,
    priorityWindow,
    noWeekendEligible: !onWeekend,
    overflowEligible: priorityWindow === "Overflow",
  };

  // ── assistantContext ─────────────────────────────────────────────
  // The strategic chat renderer is the single source of truth for the
  // services-needed prompt; we precompute it here so consumers don't
  // call the renderer themselves.
  const servicesNeededPrompt = scan
    ? renderServiceFitBreakdownAsChat(engineInput)
    : NOT_ENOUGH;
  const summary = scan
    ? `${companyName ?? "This lead"} — ${fit?.primaryServiceLabel ?? "no clear primary service"}; closeability ${closeability ?? "—"}, urgency ${urgency ?? "—"}.`
    : `${companyName ?? "This lead"} — ${NEEDS_SCAN}.`;
  const deepReportPrompt = scan
    ? `Brief me on ${companyName ?? "this lead"}: pain, evidence, business impact, and the angle to lead with.`
    : NEEDS_SCAN;
  const callAssistPrompt = scan
    ? `I'm about to call ${companyName ?? "this lead"}. Give me the opening 30 seconds and the most likely objection.`
    : NEEDS_SCAN;
  const emailPrompt = scan
    ? `Draft a 4-sentence outbound email to ${companyName ?? "this lead"} that opens with the proven pain and asks one discovery question.`
    : NEEDS_SCAN;

  const assistantContext: LeadIntelligenceAssistantContext = {
    summary,
    servicesNeededPrompt,
    deepReportPrompt,
    callAssistPrompt,
    emailPrompt,
  };

  // ── ui ───────────────────────────────────────────────────────────
  const tier = tierFromCloseability(closeability);
  const colorIntent = colorIntentFor(tier);
  const badges: LeadIntelligenceUi["badges"] = [];
  if (typeof closeability === "number") {
    badges.push({
      label: `Close ${closeability}%`,
      tone: closeability >= 80 ? "green" : closeability >= 60 ? "blue" : "neutral",
    });
  }
  if (urgency) {
    badges.push({
      label: `${urgency} urgency`,
      tone: urgency === "Critical" || urgency === "High" ? "red" : "neutral",
    });
  }
  if (services.primary.label) {
    badges.push({ label: services.primary.label, tone: "blue" });
  }
  const ui: LeadIntelligenceUi = {
    cardTitle: companyName ?? "Unknown lead",
    cardSubtitle: serviceArea ?? tradeLabel ?? null,
    badges,
    tags: [tradeLabel, services.primary.label].filter(Boolean) as string[],
    tier,
    colorIntent,
    emptyStates: {
      hasScan: !!scan,
      hasContact: !!(phone || email),
    },
  };

  // ── raw ──────────────────────────────────────────────────────────
  const raw = {
    originalLead: input,
    scan,
    enrichment: lead.enrichment ?? null,
  };

  // ── decision ─────────────────────────────────────────────────────
  // Build the unified decision projection LAST so it sees every other
  // section if a future expansion needs to read them. Cached
  // internally on the same input identity, but the layer pays for the
  // first call per task per render pass.
  const decision: LeadDecision = buildLeadDecision(engineInput, {
    industryId: industryPack.id,
  });

  return {
    identity,
    scores,
    services,
    evidence,
    salesStrategy,
    scheduling,
    assistantContext,
    ui,
    decision,
    raw,
    industryPack,
  };
}

// ── Cached accessor ─────────────────────────────────────────────────
//
// Returns the intelligence for a given input. Caches per-input via a
// WeakMap so repeated calls within the same render pass don't re-run
// the engines. New inputs always rebuild — no stale data risk.

const INTEL_CACHE = new WeakMap<object, LeadIntelligence>();

export function getLeadIntelligence(
  input: any,
  opts?: BuildLeadIntelligenceOptions,
): LeadIntelligence {
  if (input && typeof input === "object") {
    const cached = INTEL_CACHE.get(input);
    if (cached && (!opts || opts.industryPack === cached.industryPack)) {
      return cached;
    }
    const built = buildLeadIntelligence(input, opts);
    INTEL_CACHE.set(input, built);
    return built;
  }
  return buildLeadIntelligence(input, opts);
}
