// Meridian AI — Call Queue helper.
//
// Produces a priority-ordered list of leads for a rep to work through
// top-to-bottom. Uses *only* fields the engine already computed
// (nextAction, labortechFit, verifiedIssue, topWeaknesses count, bucket).
// No new scoring.
//
// Queue priority (first group → last):
//   1. CALL NOW + HIGH confidence
//   2. CALL NOW + MEDIUM confidence
//   3. FOLLOW UP
//   4. EMAIL FIRST
//   5. REVIEW SITE FIRST
//   6. SKIP FOR NOW (only included when explicitly asked for)
//
// Within each group, ordered by:
//   - stronger LaborTech Fit (STRONG > GOOD > WEAK > UNKNOWN)
//   - higher severity (more issues; "high" severity weighted more)
//   - higher overall score as a tiebreaker
// Excludes closed / not-qualified leads by default.

import type { CompanyDecision } from "./companyDecision";

export type QueueFilter = "call_now" | "follow_up" | "email_first" | "all";

const ACTION_BUCKET_ORDER: Record<string, number> = {
  "CALL NOW":          0,
  "FOLLOW UP":         1,
  "EMAIL FIRST":       2,
  "REVIEW SITE FIRST": 3,
  "SKIP FOR NOW":      4,
};

const CONFIDENCE_ORDER: Record<string, number> = {
  "HIGH":   0,
  "MEDIUM": 1,
  "LOW":    2,
};

const FIT_ORDER: Record<string, number> = {
  "STRONG FIT": 0,
  "GOOD FIT":   1,
  "WEAK FIT":   2,
  "UNKNOWN":    3,
};

// Excluded statuses — a rep never wants to see these in the live queue.
const EXCLUDED_STATUSES = new Set([
  "CLOSED_WON",
  "CLOSED_LOST",
  "ARCHIVED",
  "NOT_QUALIFIED",
]);

function severity(d: CompanyDecision): number {
  // Count of high-severity site issues (from websiteProof). Higher = more
  // urgent pitch material for the rep.
  const issues = d.websiteProof?.issues ?? [];
  let score = 0;
  for (const it of issues) {
    if (it.severity === "high") score += 3;
    else if (it.severity === "medium") score += 2;
    else score += 1;
  }
  return score;
}

export type CallQueueEntry = CompanyDecision;

export function buildCallQueue(
  decisions: CompanyDecision[],
  filter: QueueFilter = "all",
): CallQueueEntry[] {
  // Pre-filter: drop blocked/excluded + apply the requested filter.
  const candidates = decisions.filter((d) => {
    const status = (d.accountSnapshot?.status ?? "").toUpperCase();
    if (EXCLUDED_STATUSES.has(status)) return false;
    if (d.blocked) return false;
    const action = d.nextAction?.action;
    if (!action) return false;
    if (filter === "call_now" && action !== "CALL NOW") return false;
    if (filter === "follow_up" && action !== "FOLLOW UP") return false;
    if (filter === "email_first" && action !== "EMAIL FIRST") return false;
    // "all" excludes SKIP FOR NOW unless nothing else is available.
    if (filter === "all" && action === "SKIP FOR NOW") return false;
    return true;
  });

  // Rank within filter.
  candidates.sort((a, b) => {
    const aAction = a.nextAction?.action ?? "SKIP FOR NOW";
    const bAction = b.nextAction?.action ?? "SKIP FOR NOW";
    const ac = ACTION_BUCKET_ORDER[aAction] ?? 99;
    const bc = ACTION_BUCKET_ORDER[bAction] ?? 99;
    if (ac !== bc) return ac - bc;

    // Within same action, confidence (HIGH > MEDIUM > LOW).
    const aConf = CONFIDENCE_ORDER[a.nextAction?.confidence ?? "LOW"] ?? 9;
    const bConf = CONFIDENCE_ORDER[b.nextAction?.confidence ?? "LOW"] ?? 9;
    if (aConf !== bConf) return aConf - bConf;

    // Then LaborTech Fit strength.
    const aFit = FIT_ORDER[a.labortechFit?.overall ?? "UNKNOWN"] ?? 9;
    const bFit = FIT_ORDER[b.labortechFit?.overall ?? "UNKNOWN"] ?? 9;
    if (aFit !== bFit) return aFit - bFit;

    // Then site-issue severity.
    const sev = severity(b) - severity(a);
    if (sev !== 0) return sev;

    // Final tiebreaker — overall score.
    return (b.score ?? 0) - (a.score ?? 0);
  });

  return candidates;
}

// Small summary used by the daily dashboard. Counts per action bucket.
export function summarizeQueue(decisions: CompanyDecision[]): {
  callNow: number;
  followUp: number;
  emailFirst: number;
  reviewSite: number;
  skip: number;
  total: number;
} {
  const out = { callNow: 0, followUp: 0, emailFirst: 0, reviewSite: 0, skip: 0, total: 0 };
  for (const d of decisions) {
    if (d.blocked) continue;
    const status = (d.accountSnapshot?.status ?? "").toUpperCase();
    if (EXCLUDED_STATUSES.has(status)) continue;
    const action = d.nextAction?.action ?? "SKIP FOR NOW";
    out.total++;
    if (action === "CALL NOW") out.callNow++;
    else if (action === "FOLLOW UP") out.followUp++;
    else if (action === "EMAIL FIRST") out.emailFirst++;
    else if (action === "REVIEW SITE FIRST") out.reviewSite++;
    else out.skip++;
  }
  return out;
}
