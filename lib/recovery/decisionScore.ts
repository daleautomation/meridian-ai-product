// Meridian — Recovery Brief decision scorer.
//
// Replaces lib/scoring/decision.ts::decideNormalizedLead for the Recovery
// Brief generator only. That function is built for LaborTech roofing leads:
// it scores on reviewCount, rating, websiteWeak, and hasWebsite — signals
// that are either absent from recruiting/B2B CRM exports or commercially
// irrelevant to relationship recovery.
//
// This scorer is recovery-domain: it scores the three signals a real
// operator actually weighs when deciding whether to reopen a dormant
// account.
//
// Governing principles:
//   - docs/scoring-principles.md § Allowed scoring approaches
//   - docs/scoring-principles.md § Banned scoring approaches
//   - docs/meridian-philosophy.md § Revenue-aligned prioritization
//
// Deterministic. Bounded. No ML. No probabilistic outputs. Every
// component traces back to an observable signal in the customer's CSV.

import type { LeadBucket } from "@/lib/scoring/decision";

export type RecoveryDecisionInput = {
  // Real-thread signals (operator-rational #1: "is there a thread to pull?")
  lastNote?: string | null;
  nextStep?: string | null;
  activityLabel?: string | null;

  // Qualified-history signal (operator-rational #2: "was this account
  // previously moving commercially?")
  priorInterest?: boolean | null;
  crmStatus?: string | null;

  // Reachability signal (operator-rational #3: "can we actually reach them?")
  hasVerifiedContactPath?: boolean;
};

export type RecoveryDecision = {
  score: number;        // 0..99, in 33-point steps from 3 binary signals
  bucket: LeadBucket;   // derived per deriveRecoveryBucket()
  reason: string;       // one-line, operator-grade
  signals: {
    realThread: boolean;       // a usable note or next-step on file
    qualifiedHistory: boolean; // previously moving in the pipeline
    reachable: boolean;        // verified contact path on file
  };
};

// Vague notes carry no business signal — operators write "vm" or
// "followed up" when nothing actually happened. Mirrors the same
// pattern the brief-language pass uses; kept inline to avoid a
// cross-module dependency for one regex list.
const VAGUE_NOTE_PATTERNS = [
  /^followed up$/i,
  /^left voicemail$/i,
  /^left vm$/i,
  /^vm$/i,
  /^no response$/i,
  /^no reply$/i,
  /^reached out$/i,
  /^touched base$/i,
  /^pinged$/i,
  /^chasing$/i,
  /^\.+$/,
  /^see notes$/i,
  /^see crm$/i,
  /^na$/i,
  /^n\/a$/i,
  /^tbd$/i,
];

function isVagueNote(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return VAGUE_NOTE_PATTERNS.some((r) => r.test(trimmed));
}

function hasSubstantiveText(value: string | null | undefined, minLength = 6): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  if (isVagueNote(trimmed)) return false;
  return true;
}

// Qualified-stage taxonomy. Mirrors the staffing/B2B/contractor verticals
// in current Meridian fixtures. Conservative on purpose — only stages
// that clearly imply prior commercial movement count.
const QUALIFIED_STATUSES = new Set([
  "qualified",
  "open",
  "proposal",
  "proposal_sent",
  "demo",
  "demo_booked",
  "interested",
  "warm",
  "in_discussion",
  "negotiation",
  "in_negotiation",
  "follow_up",
  "follow_up_needed",
]);

function isQualifiedStatus(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return QUALIFIED_STATUSES.has(normalized);
}

// Bucket derivation. Tuned to operator intuition rather than mathematical
// elegance: a card is "Call now" only when both the relationship is stale
// enough to need attention AND there's enough commercial signal to anchor
// the call. "Call this week" handles the mixed cases. "Watch" handles
// thin signal. "Skip" handles fundamentally weak rows.
//
// Thresholds documented here so any future shift requires an explicit
// PR diff to this table, per docs/scoring-principles.md auditability.
export function deriveRecoveryBucket(staleScore: number, decisionScore: number): LeadBucket {
  if (staleScore >= 70 && decisionScore >= 66) return "Call now";
  if (staleScore >= 55 && decisionScore >= 33) return "Call this week";
  if (staleScore >= 30 || decisionScore >= 33) return "Watch";
  return "Skip";
}

function buildReason(signals: RecoveryDecision["signals"], bucket: LeadBucket): string {
  if (bucket === "Skip") {
    return "Limited prior context and no verified contact path — not a recovery candidate this week.";
  }
  const present: string[] = [];
  if (signals.realThread) present.push("a usable thread on file");
  if (signals.qualifiedHistory) present.push("a qualified prior stage");
  if (signals.reachable) present.push("a verified contact path");
  if (present.length === 0) {
    return "Surfacing on staleness signal alone — keep this exploratory.";
  }
  if (present.length === 1) {
    return `Surfacing on ${present[0]} — keep the ask narrow.`;
  }
  if (present.length === 2) {
    return `Two recovery signals on file (${present.join(" and ")}) — workable angle for re-entry.`;
  }
  return "Three signals align (real thread, qualified history, reachable contact) — anchor the call on the prior thread.";
}

export function computeRecoveryDecision(
  input: RecoveryDecisionInput,
  staleScore: number,
): RecoveryDecision {
  // Signal 1: real thread to pull.
  // Driven by lastNote or nextStep with substantive (non-vague) content,
  // OR an explicit activityLabel boost from the CSV.
  const realThread =
    hasSubstantiveText(input.lastNote, 10) ||
    hasSubstantiveText(input.nextStep, 6) ||
    hasSubstantiveText(input.activityLabel, 10);

  // Signal 2: qualified prior commercial history.
  // Either an explicit priorInterest flag or a qualifying CRM status.
  const qualifiedHistory =
    input.priorInterest === true || isQualifiedStatus(input.crmStatus);

  // Signal 3: reachability.
  // The contact resolver returns verified=true only when the path came
  // from a high-confidence provider (Google Business Profile, etc.).
  const reachable = input.hasVerifiedContactPath === true;

  // Sum: each signal worth 33 points; max 99.
  // Three equal weights because no signal is dispensable — an account
  // with two of three is meaningfully recoverable; an account with one
  // is exploratory; an account with zero shouldn't be in the brief.
  const score =
    (realThread ? 33 : 0) +
    (qualifiedHistory ? 33 : 0) +
    (reachable ? 33 : 0);

  const signals = { realThread, qualifiedHistory, reachable };
  const bucket = deriveRecoveryBucket(staleScore, score);
  const reason = buildReason(signals, bucket);

  return { score, bucket, reason, signals };
}
