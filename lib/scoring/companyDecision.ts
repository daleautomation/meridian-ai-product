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

export type CompanyDecision = {
  key: string;
  name: string;
  domain?: string;
  score: number;             // 0–100, clamped
  opportunityLevel: OpportunityLevel;
  recommendedAction: RecommendedAction;
  closeProbability: CloseProbability;
  topWeaknesses: string[];
  pitchAngle: string | null;
  rationale: string;         // 1–2 lines — compressed trace summary
  trace: ScoreTrace[];
  evidenceRefs: EvidenceRef[];  // one entry per contributing tool run
  confidenceFloor: number;   // lowest confidence among contributing tools
  staleDays: number | null;  // age of lastCheckedAt in days
  blocked?: string;          // non-empty when status short-circuits the decision
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
      score: status === "CLOSED_WON" ? 100 : 0,
      opportunityLevel: "LOW",
      recommendedAction: "MONITOR",
      closeProbability: status === "CLOSED_WON" ? "High" : "Low",
      topWeaknesses: [],
      pitchAngle: null,
      rationale: `status=${status} — not an active opportunity`,
      trace: [
        ...trace,
        { factor: "status_short_circuit", contribution: 0, note: `status=${status}` },
      ],
      evidenceRefs: [],
      confidenceFloor: 100,
      staleDays: daysSince(snap.lastCheckedAt),
      blocked: status,
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

  // ── Pipeline momentum (affects action, not score) ──────────────────────
  let momentumBonus = 0;
  if (MOMENTUM_STATUSES.has(status)) {
    momentumBonus = 10;
    score += momentumBonus;
    trace.push({
      factor: "pipeline_momentum",
      contribution: momentumBonus,
      note: `status=${status} — warm pipeline`,
    });
  }

  // ── Clamp + classify ───────────────────────────────────────────────────
  const finalScore = clamp(Math.round(score));

  const level: OpportunityLevel =
    finalScore >= 75 ? "HIGH" : finalScore >= 55 ? "MEDIUM" : "LOW";

  const stale = daysSince(snap.lastCheckedAt);
  const staleFlag = stale === null || stale > 14;

  const action: RecommendedAction =
    level === "HIGH" && !staleFlag
      ? "CALL NOW"
      : level === "HIGH"
      ? "TODAY"
      : level === "MEDIUM"
      ? "TODAY"
      : "MONITOR";

  // Close probability: blend confidence floor + momentum.
  let closeProbability: CloseProbability;
  if (confidenceFloor >= 70 && momentumBonus > 0) closeProbability = "High";
  else if (confidenceFloor >= 50) closeProbability = "Medium";
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

  return {
    key: snap.key,
    name: snap.company.name,
    domain: snap.company.domain,
    score: finalScore,
    opportunityLevel: level,
    recommendedAction: action,
    closeProbability,
    topWeaknesses: weaknessSet.slice(0, 5),
    pitchAngle: summary?.data?.pitchAngle ?? null,
    rationale: topLine || "insufficient evidence — defaulting to monitor",
    trace,
    evidenceRefs,
    confidenceFloor,
    staleDays: stale,
  };
}

// ── Ranking across the pipeline ─────────────────────────────────────────

export function rankCompanies(snaps: CompanySnapshot[]): CompanyDecision[] {
  const LEVEL_RANK: Record<OpportunityLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return snaps
    .map(decideCompany)
    .sort((a, b) => {
      const lv = LEVEL_RANK[a.opportunityLevel] - LEVEL_RANK[b.opportunityLevel];
      if (lv !== 0) return lv;
      if (b.score !== a.score) return b.score - a.score;
      // Freshness tiebreaker: fresher wins.
      const as = a.staleDays ?? 9999;
      const bs = b.staleDays ?? 9999;
      return as - bs;
    });
}
