// Meridian — Recovery Brief opener generator.
//
// Produces a short, founder-voiced opening line an operator could send by
// email or read aloud to start a call. Three-part shape:
//   1. Greeting (first name when available).
//   2. Anchor line referencing the prior thread (last_note / next_step /
//      activity / status) when available, OR a timing cue when not.
//   3. One narrow question with a concrete verb — never "checking in".
//
// Hard-banned phrases (we filter the output to ensure none reach the brief):
//   - "hope you're doing well"
//   - "checking in"
//   - "circle back" / "circling back"
//   - "touching base"
//   - "just wanted to"
//   - "as discussed previously" / "per our last conversation"

import { timingCueForIndustry } from "@/lib/recovery/normalize";

export type OpenerInput = {
  companyName?: string | null;
  contactName?: string | null;
  lastNote?: string | null;
  nextStep?: string | null;
  activityLabel?: string | null;
  recentActivity?: boolean | null;
  crmStatus?: string | null;
  dealStage?: string | null;
  lifecycleStage?: string | null;
  industry?: string | null;
  daysSinceTouch?: number | null;
};

const BANNED_FRAGMENTS = [
  /hope (?:you'?re|you are)/i,
  /\bchecking in\b/i,
  /\bcircle back\b/i,
  /\bcircling back\b/i,
  /\btouching base\b/i,
  /\bjust wanted to\b/i,
  /\bas discussed previously\b/i,
  /\bper our last conversation\b/i,
];

function firstName(full: string | null | undefined): string | null {
  if (!full) return null;
  const t = full.trim().split(/\s+/)[0];
  if (!t) return null;
  // Strip honorifics if the first token is one.
  if (/^(mr|mrs|ms|dr|prof)\.?$/i.test(t)) {
    const second = full.trim().split(/\s+/)[1];
    return second ?? null;
  }
  return t;
}

function trimFragment(value: string | null | undefined): string | null {
  const t = value?.trim();
  if (!t) return null;
  return t.replace(/[.!?,;:]+$/, "").trim() || null;
}

function lowerLead(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function variantIndex(seed: string, modulo: number): number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % modulo;
}

function bannedHit(text: string): boolean {
  return BANNED_FRAGMENTS.some((r) => r.test(text));
}

function isQualifiedStatus(value: string | null | undefined): boolean {
  const n = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["qualified", "open", "proposal", "proposal_sent", "demo", "interested", "warm", "in_negotiation", "follow_up"].includes(n);
}

// Compose the body of the opener (everything after "Hi NAME,").
function composeBody(input: OpenerInput, variantSeed: string): string {
  const note = trimFragment(input.lastNote);
  const next = trimFragment(input.nextStep);
  const boost = trimFragment(input.activityLabel);
  const stageHint = trimFragment(input.dealStage ?? input.lifecycleStage ?? input.crmStatus);
  const v = variantIndex(variantSeed, 3);

  // 1) Founder boost wins.
  if (boost) {
    const lead = lowerLead(boost);
    const variants = [
      `I had a note on ${lead}. If that thread is still active, I'd like to revisit the practical next step before it cools off.`,
      `${boost} is exactly the kind of movement I had flagged to come back to. If the door is open, I'd take the same angle we discussed — narrower this time.`,
      `I noticed ${lead}, and that was on my list to revisit with you. Worth a short conversation while it's still fresh?`,
    ];
    return variants[v];
  }

  // 2) Last note → reference the open thread. Templates here are written
  // so a lowercased note fragment lands grammatically.
  if (note) {
    const lead = lowerLead(note);
    const variants = [
      `I had a note from our last conversation — you ${lead}. If that's still live on your end, the cleanest next step is a short call to close the loop rather than restart.`,
      `Picking up where we left off: you ${lead}. If the door is still open on that, I'd come in narrow rather than start from the top.`,
      `Last we spoke, you ${lead}. If that thread is still active, I'd pick it back up exactly where we left it.`,
    ];
    return variants[variantIndex(`${note}|${variantSeed}`, variants.length)];
  }

  // 3) Next step → reopen around the outlined action.
  if (next) {
    const lead = lowerLead(next);
    const variants = [
      `The next step we'd outlined was to ${lead}. That's never been closed out, and I think it's still the right move if you can spare 15 minutes this week.`,
      `Looking back at our thread, the action we'd agreed on was to ${lead}. Want me to move on it, or has the priority shifted?`,
      `We'd lined up a next step — to ${lead} — and it's been sitting open. Worth closing the loop on that this week?`,
    ];
    return variants[v];
  }

  // 4) Recent activity on their side while we were quiet.
  if (input.recentActivity === true && stageHint) {
    return `I noticed activity continuing on your side at the ${stageHint.toLowerCase()} stage while I paused. If a narrow re-entry is useful, I'd rather meet you where you are than restart the full thread.`;
  }

  // 5) Qualified stage went cold.
  if (isQualifiedStatus(stageHint)) {
    const label = stageHint!.toLowerCase();
    return `Our last exchange had us at ${label} and then the thread went quiet on both sides. If the original yes is still directionally accurate, I'd come back in narrower this time.`;
  }

  // 6) Industry timing cue.
  const timing = timingCueForIndustry(input.industry);
  if (timing) {
    return `Reaching out ahead of ${timing}, which is usually when these threads either restart or get displaced for the season. Worth a 15-minute conversation before that window closes?`;
  }

  // 7) Days-only fallback.
  if (typeof input.daysSinceTouch === "number" && input.daysSinceTouch >= 30) {
    return `Quiet for a while on my end, which isn't a great look — and I'd rather reopen with a specific question than a soft touch. If there's a piece worth revisiting, I'd take 15 minutes this week.`;
  }

  // 8) Default — no context.
  return `Coming back to this account because the last touch is overdue. If now isn't right, a one-line "not this quarter" works and I'll step back without filling the inbox.`;
}

export function generateOpener(input: OpenerInput): string {
  const first = firstName(input.contactName);
  const greeting = first ? `Hi ${first},` : "Hi,";
  const seed = `${input.companyName ?? ""}|${input.lastNote ?? ""}|${input.daysSinceTouch ?? 0}`;
  let body = composeBody(input, seed);

  // Defense against an accidental boilerplate phrase slipping in via a
  // founder-authored boost or note text. If banned, drop a neutral fallback.
  if (bannedHit(body)) {
    body = composeBody({ ...input, lastNote: null, activityLabel: null, nextStep: null }, seed);
  }
  return `${greeting} ${body}`;
}
