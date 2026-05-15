// Meridian — Recovery Brief "why now" generator.
//
// Produces a one- to two-sentence reason a recovery call is worth making
// this week. Designed to read like an operator wrote it from messy CRM
// data, not a templating engine.
//
// Signal hierarchy (strongest first):
//   1. last_note + stale window  → reference the open thread
//   2. next_step + stale         → the next-step they outlined is still open
//   3. activityLabel (boost)     → describe the activity directly
//   4. recent_activity + status  → account moved while we were quiet
//   5. status/stage drift        → proposal/qualified conversation went cold
//   6. industry timing cue       → seasonal/cycle window
//   7. days-only fallback        → narrow re-entry framing
//
// Tropes explicitly avoided:
//   - "so the follow-up has a real business reason"
//   - "reach out to reconnect"
//   - "circle back"
//   - "hope you're doing well"

import type { StaleCategory } from "@/lib/recovery/staleness";
import { timingCueForIndustry } from "@/lib/recovery/normalize";

export type WhyNowInput = {
  companyName?: string | null;
  daysSinceTouch?: number | null;
  staleCategory?: StaleCategory;
  recentActivity?: boolean | null;
  activityLabel?: string | null;        // optional founder-authored boost
  lastNote?: string | null;             // raw CRM "last note" text
  nextStep?: string | null;             // raw CRM "next step" text
  priorInterest?: boolean | null;
  relationshipFreshness?: string | null;
  crmStatus?: string | null;
  lifecycleStage?: string | null;
  dealStage?: string | null;
  industry?: string | null;
  hasVerifiedContactPath?: boolean;
};

// Stable variant picker so two cards with the same shape don't render the
// same sentence. Uses a tiny hash of the company name + day-count.
function variantIndex(seed: string, modulo: number): number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % modulo;
}

function trimFragment(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Drop trailing punctuation so we can compose freely.
  return trimmed.replace(/[.!?,;:]+$/, "").trim() || null;
}

function lowerLead(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function isQualifiedStatus(value: string | null | undefined): boolean {
  const n = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return [
    "qualified", "open", "proposal", "proposal_sent", "demo", "demo_booked",
    "interested", "warm", "in_discussion", "negotiation", "in_negotiation",
    "follow_up", "follow_up_needed",
  ].includes(n);
}

function isStaleByCategory(category: StaleCategory | undefined): boolean {
  return category === "Dormant" || category === "Recovery candidate";
}

// Compose a stale-window fragment that varies by week and avoids the same
// rhythm every line. Returns "" if days is null/short.
function staleClause(days: number | null | undefined, variant: number): string {
  if (typeof days !== "number" || days < 14) return "";
  if (days < 30) {
    return variant === 0
      ? " The window is still short enough to keep the conversation continuous."
      : " It's been a couple of weeks — close enough to pick up the thread.";
  }
  if (days < 60) {
    return variant === 0
      ? ` It has been ${days} days, so a narrow check-in is welcome, not intrusive.`
      : ` ${days} days have passed — long enough to be useful, not long enough to feel cold.`;
  }
  if (days < 120) {
    return variant === 0
      ? ` ${days} days of silence is exactly the window where these threads quietly die.`
      : ` After ${days} days, the relationship is past polite and into recovery range.`;
  }
  return variant === 0
    ? ` The relationship has been quiet for ${days} days; the prior thread is the most credible way back in.`
    : ` ${days} days is long enough that a direct, specific reopen reads better than a soft touch.`;
}

export function generateWhyNow(input: WhyNowInput): string {
  const days = input.daysSinceTouch ?? null;
  const stale = isStaleByCategory(input.staleCategory) || (typeof days === "number" && days >= 30);
  const note = trimFragment(input.lastNote);
  const next = trimFragment(input.nextStep);
  const boost = trimFragment(input.activityLabel);
  const variant = variantIndex(`${input.companyName ?? ""}|${days ?? 0}`, 2);

  // 1) Strongest signal: an explicit founder boost describing what changed.
  if (boost && stale) {
    const cue = staleClause(days, variant);
    const variants = [
      `${boost}, which is the kind of movement that earns a direct follow-up.${cue}`,
      `${boost} — concrete enough to anchor the recovery call on something specific.${cue}`,
    ];
    return variants[variant];
  }

  // 2) Last-note + stale: reference the open thread.
  if (note && stale) {
    const lead = lowerLead(note);
    const cue = staleClause(days, variant);
    const variants = [
      `The last note reads "${note}" — that thread is still the cleanest reason to come back.${cue}`,
      `Last contact closed on ${lead}; the conversation never resolved, and recovery starts there.${cue}`,
      `They left it at "${note}" and the account has been quiet since. The original line is the recovery line.${cue}`,
    ];
    return variants[variantIndex(`${note}|${days ?? 0}`, variants.length)];
  }

  // 3) Next-step + stale: the action they outlined is still open.
  if (next && stale) {
    const lead = lowerLead(next);
    const cue = staleClause(days, variant);
    const variants = [
      `The next step on file was to ${lead}, and that action has been sitting open through the quiet window.${cue}`,
      `Their stated next step — ${lead} — was never closed out, which gives the recovery call a defined purpose.${cue}`,
    ];
    return variants[variant];
  }

  // 4) Recent activity + status: account moved while we were silent.
  if (input.recentActivity === true && (input.crmStatus || input.lifecycleStage || input.dealStage)) {
    const stageLabel = trimFragment(input.dealStage ?? input.lifecycleStage ?? input.crmStatus) ?? "the account";
    const variants = [
      `${stageLabel} has shown movement on their side while we have been quiet, which makes a targeted reopen worthwhile.`,
      `Activity has continued on their end at the ${stageLabel.toLowerCase()} stage while we paused. Worth re-entering with a narrow ask.`,
    ];
    return variants[variant];
  }

  // 5) Status/stage went stale at a qualified point.
  const stageHint = input.dealStage ?? input.lifecycleStage ?? input.crmStatus;
  if (stale && isQualifiedStatus(stageHint)) {
    const label = (stageHint ?? "qualified").toLowerCase();
    const variants = [
      `The ${label} conversation went quiet without resolving. Reopen with the same angle that earned the qualification, narrower this time.`,
      `They were at ${label} and the thread stalled. The recovery move is to revisit the original yes without restarting from scratch.`,
    ];
    return variants[variantIndex(`${label}|${days ?? 0}`, variants.length)];
  }

  // 6) Industry timing cue.
  const timing = timingCueForIndustry(input.industry);
  if (timing && stale) {
    const variants = [
      `${timing.charAt(0).toUpperCase() + timing.slice(1)} is the window that gives this re-entry a concrete reason rather than a vague one.`,
      `The natural opening here is ${timing} — a specific cycle that lets the call sound timely instead of cold.`,
    ];
    return variants[variant];
  }

  // 7) Days-only fallback. Avoid the prior trope phrase entirely.
  if (typeof days === "number") {
    if (days >= 90) {
      return variant === 0
        ? `Nothing fresh on the record, but ${days} days of silence on a previously engaged account is itself the reason — recovery before this goes fully cold.`
        : `The account has been quiet for ${days} days without a closed-out reason. Worth a single, specific check-in before it slides further.`;
    }
    if (days >= 30) {
      return variant === 0
        ? `The relationship is in the soft-recovery window — quiet enough to need a deliberate touch, recent enough to feel continuous.`
        : `${days} days without contact on a warm account is the spot where most teams lose the thread. Worth a direct, narrow opening.`;
    }
  }

  // 8) Default — no signal at all.
  if (input.hasVerifiedContactPath) {
    return "Reachable contact on file with no recent outreach logged. Worth a single, specific check-in this week.";
  }
  return "Quiet account with limited context on file. Recovery here is exploratory — keep the ask narrow.";
}
