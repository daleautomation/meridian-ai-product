// Meridian — Temporal Intelligence Engine: deadline inference.
//
// Infers an EXPECTED RESPONSE window from natural language a counterparty used —
// "I'll get back to you early next week", "by Friday", "in a few days". Meridian
// then knows when that window closes and can move the relationship to "waiting on
// them" → "follow-up recommended" with no manual entry. Deterministic phrase
// matching only; vague promises get low confidence, never false precision.

const DAY = 86_400_000;

const WEEKDAY: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function dow(ms: number): number {
  return new Date(ms).getUTCDay();
}
function addDays(ms: number, n: number): number {
  return ms + n * DAY;
}
/** Days to the next strict future occurrence of a weekday (same day → +7). */
function daysToNext(fromMs: number, targetDow: number): number {
  const d = (targetDow - dow(fromMs) + 7) % 7;
  return d === 0 ? 7 : d;
}
/** The Monday that opens the following calendar week. */
function nextWeekMonday(fromMs: number): number {
  return addDays(fromMs, daysToNext(fromMs, WEEKDAY.monday));
}
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type DeadlineConfidence = "high" | "medium" | "low";

export interface InferredDeadline {
  at: string; // ISO date the window closes
  atMs: number;
  horizonDays: number; // whole days from the message to the deadline
  phrase: string; // the matched language
  confidence: DeadlineConfidence;
}

interface Rule {
  test: RegExp;
  resolve: (fromMs: number) => number; // → deadline ms
  confidence: DeadlineConfidence;
}

// Ordered most-specific first so "end of next week" wins over "next week", etc.
const RULES: Rule[] = [
  { test: /end of next week/i, resolve: (f) => addDays(nextWeekMonday(f), 4), confidence: "medium" },
  { test: /early next week/i, resolve: (f) => addDays(nextWeekMonday(f), 1), confidence: "medium" },
  { test: /(later|end of) next week/i, resolve: (f) => addDays(nextWeekMonday(f), 4), confidence: "medium" },
  { test: /next week/i, resolve: (f) => addDays(nextWeekMonday(f), 2), confidence: "medium" },
  { test: /(by|before) (the )?end of (the )?week|end of the week|eow\b/i, resolve: (f) => addDays(f, daysToNext(f, WEEKDAY.friday)), confidence: "medium" },
  { test: /(tomorrow|by tomorrow)/i, resolve: (f) => addDays(f, 1), confidence: "high" },
  { test: /(in|within) a couple( of)? days|couple days/i, resolve: (f) => addDays(f, 2), confidence: "medium" },
  { test: /(in|within) (a )?few days|few days|in a couple days/i, resolve: (f) => addDays(f, 3), confidence: "medium" },
  { test: /(by|within) (the )?next few days/i, resolve: (f) => addDays(f, 3), confidence: "medium" },
  { test: /(get|circle) back to you|follow up with you|be in touch|reach out|update you|let you know/i, resolve: (f) => addDays(f, 5), confidence: "low" },
  { test: /shortly|soon|asap|right away/i, resolve: (f) => addDays(f, 3), confidence: "low" },
];

/**
 * Infer an expected-response deadline from a message's text and its send time.
 * Returns null when no timeframe language is present.
 */
export function inferExpectedResponse(text: string, fromMs: number): InferredDeadline | null {
  if (!text) return null;
  const t = text.toLowerCase();

  // Specific weekday ("by Friday") first — highest confidence.
  const wd = /\b(by|before|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(t);
  if (wd) {
    const atMs = addDays(fromMs, daysToNext(fromMs, WEEKDAY[wd[2].toLowerCase()]));
    return { at: isoDate(atMs), atMs, horizonDays: Math.round((atMs - fromMs) / DAY), phrase: wd[0], confidence: "high" };
  }

  for (const rule of RULES) {
    const m = rule.test.exec(t);
    if (!m) continue;
    const atMs = rule.resolve(fromMs);
    if (!atMs) continue;
    return { at: isoDate(atMs), atMs, horizonDays: Math.round((atMs - fromMs) / DAY), phrase: m[0], confidence: rule.confidence };
  }
  return null;
}
