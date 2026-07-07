// Meridian Command — strategic memory model.
//
// Memory is stable, long-term context (facts, preferences, strategic lessons) that
// makes recommendations smarter. It influences ranking transparently and never
// silently overrides reality. Every memory needs evidence or is marked low
// confidence. Nothing is invented or scraped.

export type MemoryType = "fact" | "preference" | "strategic_knowledge";
export type MemoryConfidence = "high" | "medium" | "low";
/** `pending` = proposed (e.g. by the nightly review) but NOT yet accepted; it does
 *  not influence ranking until promoted to `active`. */
export type MemoryStatus = "active" | "pending" | "stale" | "rejected";

export type ImpactArea =
  | "revenue" | "career" | "relationships" | "product"
  | "cashflow" | "learning" | "health" | "housing";

export interface Memory {
  id: string;
  type: MemoryType;
  subject: string; // "Clue Insights", "Blake Miller", "global", "self"...
  statement: string;
  confidence: MemoryConfidence;
  source: string; // manual | daily_review | weekly_review | feedback | operator_snapshot | user_note | claude_summary
  evidence: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
  status: MemoryStatus;
  tags: string[];
  impactAreas: ImpactArea[];
}

export interface MemoryStore {
  version: 1;
  ownerId: string;
  memories: Memory[];
}

const CONFIDENCE_SCORE: Record<MemoryConfidence, number> = { high: 1, medium: 0.7, low: 0.4 };
const TYPE_BASE: Record<MemoryType, number> = { strategic_knowledge: 8, preference: 4, fact: 0 };

export function confidenceScore(c: MemoryConfidence): number {
  return CONFIDENCE_SCORE[c];
}

/** Deterministic ranking weight a memory can contribute (0–8). Facts contribute 0
 *  (context only, never move ranking). */
export function strategicWeight(m: Memory): number {
  return TYPE_BASE[m.type] * CONFIDENCE_SCORE[m.confidence];
}

export function isActive(m: Memory, nowMs: number): boolean {
  if (m.status !== "active") return false;
  if (m.expiresAt && Date.parse(m.expiresAt) < nowMs) return false;
  return true;
}

export function isStale(m: Memory, nowMs: number): boolean {
  return m.status === "stale" || (!!m.expiresAt && Date.parse(m.expiresAt) < nowMs);
}
