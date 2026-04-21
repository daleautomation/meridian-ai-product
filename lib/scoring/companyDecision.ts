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

// ── Types ───────────────────────────────────────────────────────────────

export type OpportunityLevel = "HIGH" | "MEDIUM" | "LOW";
export type RecommendedAction = "CALL NOW" | "TODAY" | "MONITOR";
export type CloseProbability = "High" | "Medium" | "Low";

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
  urgency: number;           // time-sensitivity (0-100)
  dealHeat: number;          // 0-100 engagement temperature
  dealHeatLevel: DealHeatLevel;
  callAttempts: number;
  consecutiveNoAnswers: number;
  escalationStage: number;   // 0-4
  opportunityLevel: OpportunityLevel;
  recommendedAction: RecommendedAction;
  closeProbability: CloseProbability;
  topWeaknesses: string[];
  pitchAngle: string | null;
  whyPriority: string;      // one-line "why this company matters"
  valueEstimate: ValueEstimate;
  rationale: string;
  trace: ScoreTrace[];
  evidenceRefs: EvidenceRef[];
  confidenceFloor: number;
  staleDays: number | null;
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
  title: string | null;
  metaDescription: string | null;
  weaknesses: string[];
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
      opportunityScore: 0, closabilityScore: 0, urgency: 0,
      dealHeat: 0, dealHeatLevel: "COLD",
      callAttempts: snap.callAttempts ?? 0,
      consecutiveNoAnswers: snap.consecutiveNoAnswers ?? 0,
      escalationStage: snap.escalationStage ?? 0,
      opportunityLevel: "LOW",
      recommendedAction: "MONITOR",
      closeProbability: status === "CLOSED_WON" ? "High" : "Low",
      topWeaknesses: [],
      pitchAngle: null,
      whyPriority: status === "CLOSED_WON" ? "Deal closed — won" : "No longer active",
      valueEstimate: { monthlyLeadLoss: "$0", annualUpside: "$0", estimatedContractValue: "$0", reasoning: "Closed" },
      rationale: `status=${status} — not an active opportunity`,
      trace: [...trace, { factor: "status_short_circuit", contribution: 0, note: `status=${status}` }],
      evidenceRefs: [],
      confidenceFloor: 100,
      staleDays: daysSince(snap.lastCheckedAt),
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

  let closabilityScore = clamp(Math.round(
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

  return {
    key: snap.key,
    name: snap.company.name,
    domain: snap.company.domain,
    location: snap.company.location,
    score: finalScore,
    opportunityScore,
    closabilityScore,
    urgency: urgencyScore,
    dealHeat,
    dealHeatLevel,
    callAttempts,
    consecutiveNoAnswers,
    escalationStage,
    opportunityLevel: level,
    recommendedAction: action,
    closeProbability,
    topWeaknesses: weaknessSet.slice(0, 5),
    pitchAngle: summary?.data?.pitchAngle ?? null,
    whyPriority,
    valueEstimate,
    rationale: topLine || "insufficient evidence — defaulting to monitor",
    trace,
    evidenceRefs,
    confidenceFloor,
    staleDays: stale,
    forceAction,
    scriptTone,
    dealStrategy,
    closePlan,
    conversionNarrative,
    closeReadiness,
    nextMoveCommand,
    accountSnapshot,
  };
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

      // Composite tiebreaker
      const aComp = a.opportunityScore * 0.35 + a.closabilityScore * 0.3 + a.urgency * 0.2 + a.dealHeat * 0.15;
      const bComp = b.opportunityScore * 0.35 + b.closabilityScore * 0.3 + b.urgency * 0.2 + b.dealHeat * 0.15;
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
