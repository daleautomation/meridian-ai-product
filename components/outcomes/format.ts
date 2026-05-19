// Meridian — Outcome Loop UI, deterministic formatters.
//
// Pure string helpers shared by ContinuityStrip and OutcomeHistory. No
// dependencies on continuity.ts internals beyond the OutcomeType union.
// Every string here is derived from the recorded history — there is no
// generated copy.

import type { OutcomeType } from "@/lib/recovery/outcomes/types";

const OUTCOME_LABELS: Record<OutcomeType, string> = {
  contacted: "Contacted",
  no_response: "No response",
  follow_up_later: "Follow up later",
  meeting_booked: "Meeting booked",
  opportunity_reopened: "Opportunity reopened",
  already_active: "Already active",
  wrong_contact: "Wrong contact",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
  not_worth_pursuing: "Not worth pursuing",
};

/** Title-case display label for an outcome value (e.g. "contacted" → "Contacted"). */
export function outcomeLabel(value: OutcomeType): string {
  return OUTCOME_LABELS[value];
}

/** Mar 14 / May 18 — calendar-only, no year unless the year differs from now. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * "14d ago", "2h ago", "just now". Returns null when iso is invalid.
 * Calm, quiet phrasing — no salesy adjectives, no urgency markers.
 */
export function relativeAgo(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return "in the future";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
