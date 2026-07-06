// Meridian Command — nightly review types. Evening is for learning.
//
// Reuses the morning snapshots + feedback. Produces an immutable Daily Review and,
// on Sundays, a Weekly Review. No fabricated numbers; "unknown" is a valid verdict.

export interface FeedbackEntry {
  ownerId: string;
  subjectKey: string;
  subjectLabel: string;
  feedback: "did_this" | "ignored" | "better_than_expected" | "worse_than_expected";
  rank: number | null;
  recordedAt: string; // ISO
}

export type Verdict = "correct" | "partially_correct" | "incorrect" | "unknown";

export interface RecommendationScore {
  subjectKey: string;
  subjectLabel: string;
  rank: number;
  verdict: Verdict;
  evidence: string; // never fabricated — cites the feedback (or its absence)
}

export interface BeliefUpdate {
  subjectKey: string;
  subjectLabel: string;
  oldBelief: string;
  newBelief: string;
  evidence: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface OperatorMetrics {
  morningRanOk: boolean | null;
  notificationSent: boolean | null;
  connectorFailures: string[];
  freshnessHours: number | null;
  feedbackRate: number; // feedback items / recommendations (0 when no recs)
  recommendationAccuracy: number | null; // correct / scored(non-unknown); null if none scored
}

export interface DailyReview {
  date: string; // YYYY-MM-DD
  ownerId: string;
  generatedAt: string;
  summary: { observations: number; beliefs: number; recommendations: number; feedbackCount: number };
  narrative: {
    whatHappened: string;
    producedValue: string[];
    failed: string[];
    opportunitiesChanged: string[];
    strengthened: string[];
    weakened: string[];
    surprises: string[];
    believeDifferently: string[];
  };
  scores: RecommendationScore[];
  beliefUpdates: BeliefUpdate[];
  accuracy: { correct: number; partial: number; incorrect: number; unknown: number; scored: number; accuracyPct: number | null };
  operatorMetrics: OperatorMetrics;
}

export interface WeeklyReview {
  weekEnding: string; // YYYY-MM-DD (Sunday)
  ownerId: string;
  generatedAt: string;
  daysReviewed: number;
  biggestWins: string[];
  biggestMisses: string[];
  mostValuableRelationship: string | null;
  mostImprovedOpportunity: string | null;
  revenueGenerated: string; // honest — no fabricated dollars
  lessonsLearned: string[];
  optimizeNextWeek: string[];
}
