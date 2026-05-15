// Meridian — Recovery Brief opener generator.
//
// Founder-voiced opener with quality-tiered degradation. Banned-phrase
// filter prevents boilerplate from slipping through.

import {
  containsThirdPersonTail,
  leadsWithActionVerb,
  timingCueForIndustry,
  type DataQuality,
} from "@/lib/recovery/normalize";

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
  dataQuality?: DataQuality;
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
  const tokens = full.trim().split(/\s+/);
  const first = tokens[0];
  if (!first) return null;
  if (/^(mr|mrs|ms|dr|prof)\.?$/i.test(first)) return tokens[1] ?? null;
  return first;
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

function composeBody(input: OpenerInput, variantSeed: string): string {
  const quality: DataQuality = input.dataQuality ?? "medium";
  const note = trimFragment(input.lastNote);
  const next = trimFragment(input.nextStep);
  const boost = trimFragment(input.activityLabel);
  const stageHint = trimFragment(input.dealStage ?? input.lifecycleStage ?? input.crmStatus);
  const v = variantIndex(variantSeed, 3);

  if (quality === "low") {
    const variants = [
      "Coming back to this account because the last touch is overdue. If now isn't right, a one-line reply will help me step back without filling the inbox.",
      "Reaching out short — the prior thread is thin on my end, but the account is overdue for a touch. Worth a brief conversation, or should I park it?",
      "Quick note since this account has gone quiet. No agenda — just want to confirm whether there is still a thread worth picking up.",
    ];
    return variants[v];
  }

  if (boost) {
    const lead = lowerLead(boost);
    const variants = [
      `I had a note on ${lead}. If that thread is still active, I'd like to revisit the practical next step before it cools off.`,
      `${boost} is exactly the kind of movement I had flagged to come back to. If the door is open, I'd take the same angle we discussed — narrower this time.`,
      `I noticed ${lead}, and that was on my list to revisit with you. Worth a short conversation while it's still fresh?`,
    ];
    return variants[v];
  }

  if (note) {
    // The "you ___" template only reads well when the note (a) starts with
    // a past-tense action verb AND (b) doesn't shift to third person ("they
    // said…") later. Otherwise fall back to a safer "I had a note that…"
    // construction that doesn't put words in the contact's mouth.
    const safeForYouTemplate = leadsWithActionVerb(note) && !containsThirdPersonTail(note);
    const lead = lowerLead(note);
    if (safeForYouTemplate) {
      const variants = [
        `I had a note from our last conversation — you ${lead}. If that's still live on your end, the cleanest next step is a short call to close the loop rather than restart.`,
        `Picking up where we left off: you ${lead}. If the door is still open on that, I'd come in narrow rather than start from the top.`,
        `Last we spoke, you ${lead}. If that thread is still active, I'd pick it back up exactly where we left it.`,
      ];
      return variants[variantIndex(`${note}|${variantSeed}`, variants.length)];
    }
    // Safer fallback: reference the note as a note, not as direct speech.
    const variants = [
      `I had a note on file that ${lead}. If the door is still open on that thread, I'd come in narrow rather than start from the top.`,
      `Coming back to the thread my notes flagged: ${lead}. If that is still live on your end, worth a short conversation this week?`,
      `My notes from earlier reference that ${lead}. If it is still the right thread, I'd pick it up where we left it.`,
    ];
    return variants[variantIndex(`${note}|${variantSeed}|safe`, variants.length)];
  }

  if (next) {
    const lead = lowerLead(next);
    const variants = [
      `The next step we'd outlined was to ${lead}. That's never been closed out, and I think it's still the right move if you can spare 15 minutes this week.`,
      `Looking back at our thread, the action we'd agreed on was to ${lead}. Want me to move on it, or has the priority shifted?`,
      `We'd lined up a next step — to ${lead} — and it's been sitting open. Worth closing the loop on that this week?`,
    ];
    return variants[v];
  }

  if (input.recentActivity === true && stageHint) {
    return `I noticed activity continuing on your side at the ${stageHint.toLowerCase()} stage while I paused. If a narrow re-entry is useful, I'd rather meet you where you are than restart the full thread.`;
  }

  if (isQualifiedStatus(stageHint)) {
    const label = stageHint!.toLowerCase();
    return `Our last exchange had us at ${label} and then the thread went quiet on both sides. If the original yes is still directionally accurate, I'd come back in narrower this time.`;
  }

  const timing = timingCueForIndustry(input.industry);
  if (timing) {
    return `Reaching out ahead of ${timing}, which is usually when these threads either restart or get displaced for the season. Worth a 15-minute conversation before that window closes?`;
  }

  if (typeof input.daysSinceTouch === "number" && input.daysSinceTouch >= 30) {
    return `Quiet for a while on my end, which isn't a great look. I'd rather reopen with a specific question than a soft touch. If there's a piece worth revisiting, I'd take 15 minutes this week.`;
  }

  return "Coming back to this account because the last touch is overdue. If now isn't right, a one-line reply will help me step back without filling the inbox.";
}

export function generateOpener(input: OpenerInput): string {
  const first = firstName(input.contactName);
  const greeting = first ? `Hi ${first},` : "Hi,";
  const seed = `${input.companyName ?? ""}|${input.lastNote ?? ""}|${input.daysSinceTouch ?? 0}`;
  let body = composeBody(input, seed);

  if (bannedHit(body)) {
    body = composeBody({ ...input, lastNote: null, activityLabel: null, nextStep: null, dataQuality: "low" }, seed);
  }
  return `${greeting} ${body}`;
}
