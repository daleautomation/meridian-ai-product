// Meridian Command — deterministic Gmail opportunity classifier.
//
// Pure functions. Given ThreadSignals + a reference `nowMs`, assign a stage,
// momentum, status, confidence, who-owes-a-reply, a next action, and the reason
// for each — all traceable to observable email facts. No AI, no black box.

import { matchSeed } from "./seeds";
import type { ThreadSignals } from "./normalize";
import { decodeExcerpt, parseEmail } from "./normalize";
import type {
  Confidence,
  DetectedOpportunity,
  EvidenceItem,
  MomentumState,
  OpportunityKind,
  OpportunityStage,
  OpportunityStatus,
  WaitingOn,
} from "./types";

const DAY = 86_400_000;
const days = (ms: number) => Math.floor(ms / DAY);

// ── Stage ─────────────────────────────────────────────────────────────────

export function classifyStage(sig: ThreadSignals, nowMs: number): { stage: OpportunityStage; reason: string } {
  const gapDays = days(nowMs - sig.lastAt);
  const last = sig.messages[sig.messages.length - 1];
  const meetingFuture = sig.isCalendarInvite && sig.messages.some((m) => m.ts > nowMs);

  if (sig.flags.rejection) return { stage: "rejected", reason: "Thread contains explicit rejection/decline language." };
  if (sig.flags.offer) return { stage: "closed_won", reason: "Thread contains offer/acceptance language." };
  if (meetingFuture) return { stage: "meeting_scheduled", reason: "Calendar invite with a future meeting time." };

  // A completed meeting: an invite/meeting existed, its time has passed.
  const meetingPast = sig.isCalendarInvite && !meetingFuture;

  if (sig.lastDirection === "inbound") {
    // They wrote last → the ball is with me.
    if (gapDays >= 3) return { stage: "follow_up_due", reason: `They replied ${gapDays}d ago and I haven't responded.` };
    return { stage: "waiting_on_me", reason: "Latest message is inbound — awaiting my reply." };
  }

  if (sig.lastDirection === "outbound") {
    if (meetingPast) return { stage: "meeting_completed", reason: "Meeting occurred; I sent the latest follow-up — awaiting their reply." };
    if (sig.inboundCount > 0) {
      // Two-way thread, I wrote last.
      if (gapDays >= 10) return { stage: "stalled", reason: `Two-way thread but silent ${gapDays}d since my last message.` };
      return { stage: "waiting_on_them", reason: "Active two-way thread; I sent the latest message." };
    }
    // Only outbound — I reached out, no reply yet.
    if (gapDays >= 14) return { stage: "stalled", reason: `Outreach sent ${gapDays}d ago with no reply.` };
    if (sig.flags.applicationAck) return { stage: "contacted", reason: "Application submitted; only an automated acknowledgement received." };
    return { stage: "contacted", reason: "Outreach sent; awaiting first reply." };
  }

  if (sig.flags.applicationAck) return { stage: "contacted", reason: "Application acknowledgement only." };
  if (sig.inboundCount > 0) return { stage: "discovered", reason: "Inbound contact with no reply yet." };
  return { stage: "watch", reason: "Signals present but stage is ambiguous." };
}

// ── Momentum (perishable capital — decays with time) ────────────────────────

export function classifyMomentum(sig: ThreadSignals, nowMs: number): MomentumState {
  const gap = days(nowMs - sig.lastAt);
  const recentMsgs = sig.messages.filter((m) => days(nowMs - m.ts) <= 14).length;
  if (gap <= 3 && recentMsgs >= 3) return "accelerating";
  if (gap <= 7) return "warm";
  if (gap <= 21) return "cooling";
  if (gap <= 60) return "cold";
  return "dead";
}

// ── Status ──────────────────────────────────────────────────────────────────

export function classifyStatus(stage: OpportunityStage, momentum: MomentumState): OpportunityStatus {
  if (stage === "rejected" || stage === "closed_lost" || momentum === "dead") return "dead";
  if (stage === "stalled" || momentum === "cold") return "stale";
  if (stage === "waiting_on_them" && (momentum === "cooling")) return "blocked";
  if (stage === "waiting_on_me" || stage === "waiting_on_them" || stage === "follow_up_due") return "waiting";
  if (stage === "meeting_scheduled" || stage === "active_pipeline" || stage === "closed_won" || stage === "replied") return "active";
  return "warm";
}

// ── Who owes a reply ─────────────────────────────────────────────────────────

export function classifyWaitingOn(sig: ThreadSignals): WaitingOn {
  if (sig.lastDirection === "inbound") return "me";
  if (sig.lastDirection === "outbound") return "them";
  return "unknown";
}

// ── Relevance (deterministic 0–100) ──────────────────────────────────────────

export function relevanceScore(sig: ThreadSignals, nowMs: number): number {
  let s = 0;
  if (sig.seedCompany) s += 40;
  if (sig.inboundCount > 0 && sig.outboundCount > 0) s += 25; // real two-way conversation
  else if (sig.outboundCount > 0) s += 12; // I initiated
  if (sig.flags.career || sig.flags.proposal || sig.flags.referral) s += 15;
  if (sig.isCalendarInvite) s += 12;
  if (sig.companyDomain) s += 8;
  const gap = days(nowMs - sig.lastAt);
  if (gap <= 14) s += 10;
  else if (gap <= 45) s += 5;
  if (sig.messageCount >= 3) s += 5;
  return Math.max(0, Math.min(100, s));
}

// ── Confidence ────────────────────────────────────────────────────────────────

export function classifyConfidence(sig: ThreadSignals, relevance: number): Confidence {
  if (!sig.lastDirection || sig.messageCount === 0) return "unknown";
  const twoWayHuman = sig.inboundCount > 0 && sig.outboundCount > 0;
  if (relevance >= 65 && twoWayHuman) return "high";
  if (relevance >= 50) return "medium";
  if (relevance >= 35) return "low";
  return "unknown";
}

// ── Kind ──────────────────────────────────────────────────────────────────────

export function classifyKind(sig: ThreadSignals): OpportunityKind {
  const seed = matchSeed(`${sig.combinedText} ${sig.primaryCounterparty ?? ""} ${sig.companyDomain ?? ""}`);
  if (seed) return seed.kind;
  if (sig.flags.career) return "career";
  if (sig.flags.proposal) return "consulting";
  if (sig.flags.referral) return "referral";
  return "unknown";
}

// ── Next action + why now ────────────────────────────────────────────────────

function fmt(ms: number | null): string {
  return ms ? new Date(ms).toISOString().slice(0, 10) : "unknown";
}

export function nextAction(sig: ThreadSignals, stage: OpportunityStage, person: string): { action: string; whyNow: string } {
  const gap = days(Date.now() - sig.lastAt); // display-only; classification uses nowMs elsewhere
  switch (stage) {
    case "waiting_on_me":
    case "follow_up_due":
      return { action: `Reply to ${person} — they're waiting on you (since ${fmt(sig.lastInboundAt)}).`, whyNow: "You owe the response; every day of silence cools a warm thread." };
    case "meeting_scheduled":
      return { action: `Prepare for the scheduled meeting with ${person}.`, whyNow: "A confirmed meeting is imminent momentum — prep converts it." };
    case "meeting_completed":
      return { action: `Hold — you've followed up with ${person}. If silent by ${fmt(sig.lastOutboundAt ? sig.lastOutboundAt + 3 * DAY : null)}, nudge once.`, whyNow: "Meeting just happened and your follow-up is out; give a short window before re-touching." };
    case "waiting_on_them":
      return { action: `Give ${person} a short window; nudge if no reply in a few days.`, whyNow: "Ball is in their court on an active thread." };
    case "stalled":
      return { action: `Send a light re-engagement nudge to ${person}.`, whyNow: "Thread has gone quiet — a nudge recovers decaying momentum." };
    case "contacted":
      return { action: `Follow up with ${person} — no reply yet to your outreach.`, whyNow: "First outreach unanswered; a follow-up materially lifts reply odds." };
    case "discovered":
      return { action: `Reply to ${person} and qualify the opportunity.`, whyNow: "Fresh inbound interest — respond while it's warm." };
    case "rejected":
    case "closed_lost":
      return { action: `Log the outcome; keep ${person} warm for the future.`, whyNow: "Closed for now — preserve the relationship for later chains." };
    case "closed_won":
      return { action: `Confirm next steps / onboarding with ${person}.`, whyNow: "Won — protect and expand." };
    default:
      return { action: `Review the ${person} thread and decide next step.`, whyNow: "Ambiguous — needs a human read." };
  }
}

// ── Evidence (top messages, most recent first) ───────────────────────────────

export function buildEvidence(sig: ThreadSignals, max = 4): EvidenceItem[] {
  return [...sig.messages]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, max)
    .map((m) => ({
      threadId: m.threadId ?? sig.threadId,
      messageId: m.id,
      direction: m.direction,
      sender: parseEmail(m.sender).email,
      recipients: (m.toRecipients ?? []).map((r) => parseEmail(r).email),
      subject: m.subject ?? sig.subject,
      date: new Date(m.ts).toISOString(),
      excerpt: decodeExcerpt(m.snippet),
    }));
}

// ── Compose one opportunity from one thread ──────────────────────────────────

export function classifyThread(sig: ThreadSignals, nowMs: number): DetectedOpportunity | null {
  if (!sig.primaryCounterparty || sig.messageCount === 0) return null;

  const relevance = relevanceScore(sig, nowMs);
  const { stage, reason } = classifyStage(sig, nowMs);
  const momentum = classifyMomentum(sig, nowMs);
  const status = classifyStatus(stage, momentum);
  const confidence = classifyConfidence(sig, relevance);
  const waitingOn = classifyWaitingOn(sig);
  const kind = classifyKind(sig);

  const person = sig.primaryCounterparty;
  const personName = parseEmail(person).name || person;
  const company = sig.seedCompany
    ?? (sig.companyDomain ? sig.companyDomain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()) : personName);
  const { action, whyNow } = nextAction(sig, stage, personName);

  return {
    key: sig.seedCompany ? sig.seedCompany.toLowerCase() : `${company.toLowerCase()}::${person}`,
    name: `${company} — ${personName}`,
    kind,
    company,
    companyDomain: sig.companyDomain,
    people: sig.counterparties.slice(0, 5),
    stage,
    status,
    momentum,
    confidence,
    waitingOn,
    lastInboundAt: sig.lastInboundAt ? new Date(sig.lastInboundAt).toISOString() : null,
    lastOutboundAt: sig.lastOutboundAt ? new Date(sig.lastOutboundAt).toISOString() : null,
    nextAction: action,
    whyNow,
    reason,
    relevance,
    evidence: buildEvidence(sig),
    threadIds: [sig.threadId],
    whatChanged: "new (first scan)",
  };
}
