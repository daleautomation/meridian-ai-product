// Meridian — Recovery Brief priority-read generator.
//
// Replaces dashboard-style "80/100 fit with 90/100 staleness" framing with
// 1–2 sentences of operator reasoning:
//   - why this lead is worth action this week (timing + signal)
//   - what to lead with (angle from the strongest available signal)
//
// Graceful degradation:
//   - HIGH quality (note or next-step): specific angle + variant phrasing
//   - MEDIUM quality (status + dates): reopen at the prior stage
//   - LOW quality (sparse): conservative single sentence, never invents
//                          an angle or an opportunity label

import type { LeadBucket } from "@/lib/scoring/decision";
import type { StaleCategory } from "@/lib/recovery/staleness";
import type { DataQuality } from "@/lib/recovery/normalize";

export type PriorityReadInput = {
  bucket: LeadBucket;
  staleCategory: StaleCategory;
  daysSinceTouch: number | null;
  lastNote?: string | null;
  nextStep?: string | null;
  activityLabel?: string | null;
  opportunityLabel?: string | null;
  priorityNote?: string | null;
  crmStatus?: string | null;
  dealStage?: string | null;
  lifecycleStage?: string | null;
  industry?: string | null;
  hasVerifiedContactPath?: boolean;
  companyName?: string | null;
  dataQuality?: DataQuality;
};

function variantIndex(seed: string, modulo: number): number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % modulo;
}

function trimFragment(value: string | null | undefined): string | null {
  const t = value?.trim();
  if (!t) return null;
  return t.replace(/[.!?,;:]+$/, "").trim() || null;
}

function lowerLead(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function actionPhrase(bucket: LeadBucket): string {
  switch (bucket) {
    case "Call now":       return "Worth calling this week";
    case "Call this week": return "Schedule the call for later this week";
    case "Watch":          return "Soft touch only — keep the thread warm without forcing a meeting";
    case "Skip":           return "Hold for now";
  }
}

function strongestAngle(input: PriorityReadInput): { label: string; source: "boost" | "note" | "next" | "stage" | "opp" | null } {
  const boost = trimFragment(input.activityLabel);
  if (boost) return { label: boost, source: "boost" };
  const opp = trimFragment(input.opportunityLabel);
  if (opp) return { label: opp, source: "opp" };
  const next = trimFragment(input.nextStep);
  if (next) return { label: next, source: "next" };
  const note = trimFragment(input.lastNote);
  if (note) return { label: note, source: "note" };
  const stage = trimFragment(input.dealStage ?? input.lifecycleStage ?? input.crmStatus);
  if (stage) return { label: stage, source: "stage" };
  return { label: "", source: null };
}

function whyWorthIt(input: PriorityReadInput, seed: string): string {
  const days = input.daysSinceTouch;
  const note = trimFragment(input.lastNote);
  const next = trimFragment(input.nextStep);
  const v = variantIndex(seed, 3);

  if (note && typeof days === "number" && days >= 30) {
    const variants = [
      "the prior note carried a concrete reason rather than a vague interest signal",
      "the last exchange ended with something specific enough to pick up again",
      "the prior thread had a real ask attached to it, not just curiosity",
    ];
    return variants[v];
  }
  if (next && typeof days === "number" && days >= 30) {
    const variants = [
      "the open next-step they outlined never closed out",
      "the action they committed to is still sitting unresolved",
      "their stated next move never got executed and the door is still open",
    ];
    return variants[v];
  }
  if (input.staleCategory === "Recovery candidate") {
    const variants = [
      "the account is in the window where threads either restart or quietly die",
      "this is the recovery zone — past polite, not yet cold",
      "the relationship is at the inflection point between dormant and lost",
    ];
    return variants[v];
  }
  if (input.staleCategory === "Dormant") {
    const variants = [
      "the relationship is dormant but the prior context is still usable",
      "the account has cooled, but the prior thread can still carry the call",
      "it is dormant, not dead — the original context still applies",
    ];
    return variants[v];
  }
  if (input.hasVerifiedContactPath) {
    return "the contact path is verified and there is no active obstacle to a direct re-entry";
  }
  return "the timing window is open and the recovery cost is small";
}

export function generatePriorityRead(input: PriorityReadInput): string {
  // Founder-authored priorityNote overrides everything when present.
  const note = trimFragment(input.priorityNote);
  if (note) {
    return note.endsWith(".") || note.endsWith("?") || note.endsWith("!") ? note : `${note}.`;
  }

  const quality: DataQuality = input.dataQuality ?? "medium";

  // LOW-QUALITY GUARD: never fabricate an angle. One conservative sentence.
  if (quality === "low") {
    const seed = `${input.companyName ?? ""}|${input.daysSinceTouch ?? 0}|low`;
    const v = variantIndex(seed, 3);
    const variants = [
      "Keep this exploratory. Without a clear prior thread, the safest move is a short, low-pressure touch rather than a strong angle.",
      "Limited signal on file. A brief check-in is appropriate; do not lead with a specific opportunity.",
      "Treat this as exploratory recovery. Confirm the door is still open before introducing a specific angle.",
    ];
    return variants[v];
  }

  const action = actionPhrase(input.bucket);
  const seed = `${input.companyName ?? ""}|${input.daysSinceTouch ?? 0}|${input.lastNote ?? ""}`;
  const reason = whyWorthIt(input, seed);
  const angle = strongestAngle(input);

  if (!angle.source || !angle.label) {
    return `${action} because ${reason}.`;
  }

  let leadClause: string;
  switch (angle.source) {
    case "boost":
      leadClause = ` Lead with the change you flagged — ${lowerLead(angle.label)} — and let that carry the reason for the call.`;
      break;
    case "opp":
      leadClause = ` Lead with the ${lowerLead(angle.label)} angle; that is the cleanest reason to revisit the relationship.`;
      break;
    case "next":
      leadClause = ` Lead with the action you'd outlined — to ${lowerLead(angle.label)} — and ask whether it should still happen.`;
      break;
    case "note":
      leadClause = ` Lead with the prior note ("${angle.label}") and treat this as a continuation, not a restart.`;
      break;
    case "stage":
      leadClause = ` Lead with the ${lowerLead(angle.label)} conversation as it stood, narrower this time.`;
      break;
  }

  return `${action} because ${reason}.${leadClause}`;
}
