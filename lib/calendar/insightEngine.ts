// Meridian AI — Insight Engine.
//
// Pure converter: outcome events + pattern adjustments + generated tasks
// → short, operator-grade insights. No I/O, no fakery, no fabricated
// numbers. Insights are gated on real evidence counts and capped to a
// small premium set so the rail never becomes a dashboard.

import type { OutcomeEvent } from "./outcomeLearning";
import type { PatternLearningAdjustment } from "./patternLearning";
import type { TaskItem } from "./tasks";
import type { MarketDifference } from "./marketIntelligence";

// ── Public types ───────────────────────────────────────────────────────

export type InsightSeverity = "positive" | "watch" | "opportunity";

export type InsightCategory =
  | "conversion"
  | "execution"
  | "data_quality"
  | "capital_allocation"
  | "followup";

export interface OperatorInsight {
  id: string;
  title: string;
  message: string;
  category: InsightCategory;
  severity: InsightSeverity;
  confidence: "high" | "medium" | "low";
  evidenceCount: number;
  relatedPatternKeys?: string[];
  relatedTaskIds?: string[];
  nextMove?: string;
}

export interface InsightEngineInput {
  events: OutcomeEvent[];
  patternAdjustments?: Record<string, PatternLearningAdjustment>;
  tasks?: TaskItem[];
  marketDifferences?: MarketDifference[];
  now?: Date;
}

// ── Constants ──────────────────────────────────────────────────────────

const MIN_EVIDENCE = 3;
const MAX_INSIGHTS = 5;

const POS_OUTCOME_TYPES = new Set<OutcomeEvent["type"]>([
  "contacted",
  "followup_scheduled",
  "meeting_booked",
  "proposal_sent",
  "deal_won",
]);

// Severity sort priority — higher wins on tie.
const SEVERITY_RANK: Record<InsightSeverity, number> = {
  opportunity: 3,
  positive: 2,
  watch: 1,
};

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

function confidenceFromSample(sample: number): OperatorInsight["confidence"] {
  if (sample >= 8) return "high";
  if (sample >= 5) return "medium";
  return "low";
}

// ── Pattern → insight copy ─────────────────────────────────────────────
// Cleaner business language than the raw pattern reason. Keys not listed
// fall back to a generic positive/watch shape so the engine still works
// when new pattern keys land later.

interface PatternCopy {
  positiveTitle: string;
  positiveMessage: string;
  positiveCategory: InsightCategory;
  positiveNextMove?: string;
  watchTitle: string;
  watchMessage: string;
  watchCategory: InsightCategory;
  watchNextMove?: string;
}

const PATTERN_COPY: Record<string, PatternCopy> = {
  has_contact: {
    positiveTitle: "Verified contacts are moving better",
    positiveMessage: "Leads with phone or email are showing stronger progression. Prioritize these during prime call windows.",
    positiveCategory: "conversion",
    positiveNextMove: "Work verified-contact leads before lower-evidence diagnostics.",
    watchTitle: "Verified contacts are stalling",
    watchMessage: "Even leads with verified contacts are not progressing. Re-check the call message before pushing more volume.",
    watchCategory: "conversion",
  },
  missing_contact: {
    positiveTitle: "Cleanup work is paying off",
    positiveMessage: "Leads that recently picked up verified contact info are starting to move.",
    positiveCategory: "data_quality",
    watchTitle: "Missing contact info is slowing execution",
    watchMessage: "Leads without verified contact details are reducing action confidence. Clean these before they reach the top of the queue.",
    watchCategory: "data_quality",
    watchNextMove: "Run contact-find on the top admin tasks before next call block.",
  },
  has_website_scan: {
    positiveTitle: "Verified scans improve confidence",
    positiveMessage: "Leads with completed diagnostics are producing cleaner action signals.",
    positiveCategory: "data_quality",
    positiveNextMove: "Complete scans before pushing low-confidence leads.",
    watchTitle: "Scanned leads need a fresh angle",
    watchMessage: "Leads that already have diagnostics are not converting at the rate the rest of the book is.",
    watchCategory: "execution",
  },
  missing_website_scan: {
    positiveTitle: "Lead quality is holding without full scans",
    positiveMessage: "Even partial-evidence leads are progressing — keep scoring outreach on what is already known.",
    positiveCategory: "execution",
    watchTitle: "Scan gaps are reducing confidence",
    watchMessage: "Leads without a verified site scan are producing weaker signals. Run scans before they reach the call queue.",
    watchCategory: "data_quality",
    watchNextMove: "Open the top scan cards — each carries its own next step (run, retry, or fix contact).",
  },
  high_score: {
    positiveTitle: "High-score leads are converting",
    positiveMessage: "Top-scored leads are progressing as expected. Keep them at the front of the call queue.",
    positiveCategory: "conversion",
    positiveNextMove: "Work the highest-score Execute Now item first.",
    watchTitle: "High-score leads are stalling",
    watchMessage: "Top-scored leads have not moved recently. Refresh the talk track before another round.",
    watchCategory: "conversion",
  },
  medium_score: {
    positiveTitle: "Mid-score leads are over-performing",
    positiveMessage: "Mid-band leads are converting better than usual. Worth a steady pass.",
    positiveCategory: "conversion",
    watchTitle: "Mid-score leads are sliding",
    watchMessage: "Mid-band leads are slipping through. Tighten qualification before adding more.",
    watchCategory: "conversion",
  },
  low_score: {
    positiveTitle: "Low-score leads are unexpectedly progressing",
    positiveMessage: "Low-band leads are converting more than expected. Worth a quick pass at the end of the day.",
    positiveCategory: "conversion",
    watchTitle: "Low-score leads are draining time",
    watchMessage: "Low-band leads are absorbing time without conversion. Move them to later weeks when prime windows are tight.",
    watchCategory: "execution",
  },
  call_now: {
    positiveTitle: "CALL NOW is converting",
    positiveMessage: "Engine-flagged CALL NOW leads are progressing. Trust the top-of-queue order today.",
    positiveCategory: "execution",
    positiveNextMove: "Work the top Execute Now item before diagnostics.",
    watchTitle: "CALL NOW recommendations are slipping",
    watchMessage: "Recent CALL NOW leads have not moved. Re-check timing of outreach windows.",
    watchCategory: "execution",
  },
  today_priority: {
    positiveTitle: "TODAY-priority leads are paying off",
    positiveMessage: "TODAY-flagged leads are converting at a steady rate. Keep the daily cadence.",
    positiveCategory: "execution",
    watchTitle: "TODAY-priority leads need a sharper open",
    watchMessage: "TODAY-flagged leads are getting through to fewer decision-makers than usual.",
    watchCategory: "execution",
  },
  has_revenue_estimate: {
    positiveTitle: "Revenue-tagged leads are progressing",
    positiveMessage: "Leads with a usable revenue estimate are converting. Use those numbers in the open.",
    positiveCategory: "capital_allocation",
    positiveNextMove: "Lead with the dollar figure on the next high-value call.",
    watchTitle: "Revenue-tagged leads are slipping",
    watchMessage: "Leads with revenue estimates are not closing as expected. The number alone is not carrying the call.",
    watchCategory: "capital_allocation",
  },
  missing_revenue_estimate: {
    positiveTitle: "Unestimated leads are still moving",
    positiveMessage: "Even without a revenue estimate, recent outreach is producing engagement.",
    positiveCategory: "execution",
    watchTitle: "Estimateless leads are stalling",
    watchMessage: "Without a revenue estimate, leads are not picking up momentum. Run the diagnostic first.",
    watchCategory: "data_quality",
    watchNextMove: "Run the scan before reaching out.",
  },
  high_confidence_estimate: {
    positiveTitle: "High-confidence estimates are converting",
    positiveMessage: "Leads with high-confidence revenue estimates are progressing reliably.",
    positiveCategory: "capital_allocation",
    watchTitle: "High-confidence estimates need a fresh angle",
    watchMessage: "Even strong-evidence leads are not closing. Re-check the talk track before another sweep.",
    watchCategory: "execution",
  },
  high_risk_estimate: {
    positiveTitle: "High-risk leads are converting anyway",
    positiveMessage: "High-risk-tagged leads are showing positive movement. Worth a careful pass.",
    positiveCategory: "conversion",
    watchTitle: "High-risk leads are confirming the warning",
    watchMessage: "High-risk-tagged leads are not progressing. Work the safer opportunities first.",
    watchCategory: "execution",
  },
  repeated_no_answer: {
    positiveTitle: "Persistence on no-answer is working",
    positiveMessage: "Leads with prior missed attempts are now picking up. Keep the structured cadence.",
    positiveCategory: "followup",
    watchTitle: "Repeated no-answer leads are cooling",
    watchMessage: "Leads with multiple missed attempts are showing weaker movement. Move them into structured follow-up instead of prime call time.",
    watchCategory: "followup",
    watchNextMove: "Shift no-answer leads into the scheduled follow-up rhythm.",
  },
  contacted_progress: {
    positiveTitle: "Contacted leads are progressing",
    positiveMessage: "Once a lead is past first contact, it is moving forward. Keep the 48-hour follow-up rhythm.",
    positiveCategory: "followup",
    positiveNextMove: "Honor the 48-hour follow-up window on contacted leads.",
    watchTitle: "Contacted leads are stalling",
    watchMessage: "Leads that have been contacted are not advancing. Tighten the next-move ask.",
    watchCategory: "followup",
  },
};

const FALLBACK_COPY: PatternCopy = {
  positiveTitle: "A lead profile is converting",
  positiveMessage: "A specific lead profile is progressing better than the rest of the book.",
  positiveCategory: "conversion",
  watchTitle: "A lead profile is cooling",
  watchMessage: "A specific lead profile is showing weaker movement than the rest of the book.",
  watchCategory: "execution",
};

// ── Builders ───────────────────────────────────────────────────────────

function makePatternInsights(
  patternAdjustments: Record<string, PatternLearningAdjustment> | undefined,
): OperatorInsight[] {
  if (!patternAdjustments) return [];
  const out: OperatorInsight[] = [];

  for (const key of Object.keys(patternAdjustments)) {
    const adj = patternAdjustments[key];
    if (!adj || adj.sampleSize < MIN_EVIDENCE) continue;
    const copy = PATTERN_COPY[key] ?? FALLBACK_COPY;

    if (adj.probabilityDelta > 0.03) {
      out.push({
        id: `insight-pattern-${key}-positive`,
        title: copy.positiveTitle,
        message: copy.positiveMessage,
        category: copy.positiveCategory,
        severity: "positive",
        confidence: confidenceFromSample(adj.sampleSize),
        evidenceCount: adj.sampleSize,
        relatedPatternKeys: [key],
        ...(copy.positiveNextMove ? { nextMove: copy.positiveNextMove } : {}),
      });
    } else if (adj.probabilityDelta < -0.03) {
      out.push({
        id: `insight-pattern-${key}-watch`,
        title: copy.watchTitle,
        message: copy.watchMessage,
        category: copy.watchCategory,
        severity: "watch",
        confidence: confidenceFromSample(adj.sampleSize),
        evidenceCount: adj.sampleSize,
        relatedPatternKeys: [key],
        ...(copy.watchNextMove ? { nextMove: copy.watchNextMove } : {}),
      });
    }
  }

  return out;
}

function makeTaskInsights(
  tasks: TaskItem[] | undefined,
  now: Date,
): OperatorInsight[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const out: OperatorInsight[] = [];

  const highValueTasks = tasks.filter(
    (t) =>
      typeof t.expectedValue === "number" &&
      t.expectedValue > 0 &&
      (t.priority === "critical" || t.priority === "high"),
  );
  if (highValueTasks.length >= MIN_EVIDENCE) {
    out.push({
      id: "insight-task-high-value-concentration",
      title: "High-value actions are concentrated today",
      message: "Several priority tasks have measurable expected value. Work the top Execute Now and Capital Allocation items before admin cleanup.",
      category: "capital_allocation",
      severity: "opportunity",
      confidence: confidenceFromSample(highValueTasks.length),
      evidenceCount: highValueTasks.length,
      relatedTaskIds: highValueTasks.slice(0, 5).map((t) => t.id),
      nextMove: "Open the top two high-value items first.",
    });
  }

  const adminTasks = tasks.filter(
    (t) => t.category === "admin" || t.category === "product",
  );
  if (adminTasks.length >= MIN_EVIDENCE) {
    out.push({
      id: "insight-task-admin-cleanup",
      title: "Contact cleanup is blocking execution",
      message: "Several leads need verified phone or email before they can become strong actions.",
      category: "data_quality",
      severity: "watch",
      confidence: confidenceFromSample(adminTasks.length),
      evidenceCount: adminTasks.length,
      relatedTaskIds: adminTasks.slice(0, 5).map((t) => t.id),
      nextMove: "Resolve the top admin items in a single batch.",
    });
  }

  const followupTasks = tasks.filter((t) => {
    if (t.category !== "followup" || t.status === "done") return false;
    const anchor = t.dueDate ?? t.startTime ?? null;
    if (!anchor) return false;
    return new Date(anchor).getTime() <= now.getTime() + 24 * 3_600_000;
  });
  if (followupTasks.length >= MIN_EVIDENCE) {
    out.push({
      id: "insight-task-followup-momentum",
      title: "Follow-up momentum is building",
      message: "Multiple follow-ups are due now. Use the scheduled rhythm to keep warm leads moving.",
      category: "followup",
      severity: "opportunity",
      confidence: confidenceFromSample(followupTasks.length),
      evidenceCount: followupTasks.length,
      relatedTaskIds: followupTasks.slice(0, 5).map((t) => t.id),
      nextMove: "Run the follow-up queue before starting new calls.",
    });
  }

  return out;
}

function makeOutcomeTrendInsights(events: OutcomeEvent[]): OperatorInsight[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const out: OperatorInsight[] = [];

  const positiveEvents = events.filter((e) => POS_OUTCOME_TYPES.has(e.type));
  if (positiveEvents.length >= MIN_EVIDENCE) {
    out.push({
      id: "insight-outcome-pipeline-movement",
      title: "Pipeline movement is improving",
      message: "Recent outcomes show active movement. Keep prioritizing tasks with clear next actions.",
      category: "execution",
      severity: "positive",
      confidence: confidenceFromSample(positiveEvents.length),
      evidenceCount: positiveEvents.length,
    });
  }

  const noAnswerEvents = events.filter((e) => e.type === "no_answer");
  if (noAnswerEvents.length >= MIN_EVIDENCE) {
    out.push({
      id: "insight-outcome-no-answer-rhythm",
      title: "No-answer attempts need structure",
      message: "Several leads are not responding on first attempts. Shift them into scheduled follow-up instead of repeated manual retries.",
      category: "followup",
      severity: "watch",
      confidence: confidenceFromSample(noAnswerEvents.length),
      evidenceCount: noAnswerEvents.length,
      nextMove: "Move repeated no-answer leads into the follow-up queue.",
    });
  }

  return out;
}

// ── Market difference insights (max 1) ─────────────────────────────────

function makeMarketInsights(
  diffs: MarketDifference[] | undefined,
): OperatorInsight[] {
  if (!Array.isArray(diffs) || diffs.length === 0) return [];
  // Pick the strongest single difference with enough evidence.
  const eligible = diffs.filter((d) => d.evidenceCount >= MIN_EVIDENCE);
  if (eligible.length === 0) return [];
  const top = eligible[0];
  const stronger = top.direction === "stronger_local";
  return [{
    id: `insight-market-${top.id}`,
    title: stronger ? "Local market is outperforming" : "Local market is lagging",
    message: top.message,
    category: stronger ? "conversion" : "execution",
    severity: stronger ? "opportunity" : "watch",
    confidence: confidenceFromSample(top.evidenceCount),
    evidenceCount: top.evidenceCount,
    ...(top.type === "pattern" ? { relatedPatternKeys: [top.key] } : {}),
  }];
}

// ── Public entry point ─────────────────────────────────────────────────

export function buildOperatorInsights(input: InsightEngineInput): OperatorInsight[] {
  const now = input.now ?? new Date();
  const events = Array.isArray(input.events) ? input.events : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];

  const merged: OperatorInsight[] = [
    ...makePatternInsights(input.patternAdjustments),
    ...makeTaskInsights(tasks, now),
    ...makeOutcomeTrendInsights(events),
    ...makeMarketInsights(input.marketDifferences),
  ];

  // Defensive: drop anything below the minimum evidence bar.
  const filtered = merged.filter((i) => i.evidenceCount >= MIN_EVIDENCE);

  // Dedupe by id (a pattern key should never produce both positive and
  // watch in one pass, but be safe).
  const seen = new Set<string>();
  const unique: OperatorInsight[] = [];
  for (const i of filtered) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    unique.push(i);
  }

  // Sort: confidence desc → evidenceCount desc → severity rank desc.
  unique.sort((a, b) => {
    const c = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (c !== 0) return c;
    if (b.evidenceCount !== a.evidenceCount) return b.evidenceCount - a.evidenceCount;
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });

  return unique.slice(0, MAX_INSIGHTS);
}
