// Meridian Command — the Belief Engine. The ONLY interpreter of observations.
//
// Pure + deterministic + connector-agnostic. Groups Observations from every
// connector into subjects, then derives a Belief per subject. An observation
// ("Blake replied") never becomes an action here — it updates a belief
// ("relationship momentum increased; you owe a reply"). Recommendations come later.

import { classifyStatus } from "@/lib/gmail/classify";
import { matchSeed } from "@/lib/gmail/seeds";
import { parseEmail } from "@/lib/gmail/normalize";
import type { Observation } from "@/lib/connectors/types";
import { computeTemporalProfile } from "@/lib/temporal/engine";
import type { MeetingInput } from "@/lib/temporal/meetings";
import type {
  Belief,
  BeliefEvidenceRef,
  HeatLabel,
  MomentumDelta,
  MomentumState,
  OpportunityKind,
  OpportunityStage,
  StatusHistoryEntry,
  WaitingOn,
} from "./types";

const DAY = 86_400_000;
const days = (ms: number) => Math.floor(ms / DAY);

const COMM_TYPES = new Set(["message_sent", "message_received", "linkedin_message_sent", "linkedin_message_received"]);
const CONTACT_ONLY = new Set(["contact_added", "contact_updated", "duplicate_identity"]);
// Memory is strategic CONTEXT, never activity: it must never move momentum/stage.
const MEMORY_TYPES = new Set(["strategic_memory_active", "preference_active", "fact_active", "memory_updated", "memory_conflict_detected", "memory_stale"]);
const NON_ACTIVITY = new Set([...CONTACT_ONLY, ...MEMORY_TYPES]);
const LINKEDIN_SIGNAL = new Set(["linkedin_connection_added", "linkedin_profile_viewed",
  "linkedin_job_signal", "linkedin_company_signal", "linkedin_manual_note",
  "linkedin_message_received", "linkedin_message_sent"]);

function subjectKeyFor(o: Observation): string | null {
  const text = `${o.company ?? ""} ${o.people.join(" ")} ${o.evidence.subject ?? ""}`;
  const seed = matchSeed(text);
  if (seed) return seed.company.toLowerCase();
  if (o.company) return o.company.toLowerCase();
  const p = o.people.find((x) => x.includes("@"));
  return p ?? o.people[0] ?? null;
}

function momentumOf(sortedTs: number[], nowMs: number): MomentumState {
  if (sortedTs.length === 0) return "dead";
  const gap = days(nowMs - sortedTs[sortedTs.length - 1]);
  const recent = sortedTs.filter((t) => days(nowMs - t) <= 14).length;
  if (gap <= 3 && recent >= 3) return "accelerating";
  if (gap <= 7) return "warm";
  if (gap <= 21) return "cooling";
  if (gap <= 60) return "cold";
  return "dead";
}

const MOMENTUM_RANK: Record<MomentumState, number> = { accelerating: 5, warm: 4, cooling: 3, cold: 2, dead: 1 };

function kindOf(seedKind: OpportunityKind | null, types: Set<string>): OpportunityKind {
  if (seedKind) return seedKind;
  if (types.has("interview_invited") || types.has("application_ack") || types.has("offer_received")) return "career";
  if (types.has("proposal_sent") || types.has("proposal_viewed")) return "consulting";
  if (types.has("referral_offered") || types.has("referral_made")) return "referral";
  if (types.has("meeting_completed") || types.has("meeting_scheduled")) return "partnership";
  return "unknown";
}

function stageOf(args: {
  types: Set<string>;
  lastCommDir: "inbound" | "outbound" | null;
  hasInbound: boolean;
  hasFutureMeeting: boolean;
  hasPastMeeting: boolean;
  gapDays: number;
}): { stage: OpportunityStage; reason: string } {
  const { types, lastCommDir, hasInbound, hasFutureMeeting, hasPastMeeting, gapDays } = args;
  if (types.has("rejection_received")) return { stage: "rejected", reason: "A rejection observation is present." };
  if (types.has("offer_received")) return { stage: "closed_won", reason: "An offer observation is present." };
  if (hasFutureMeeting) return { stage: "meeting_scheduled", reason: "A meeting is scheduled ahead." };
  if (hasPastMeeting && lastCommDir === "outbound") return { stage: "meeting_completed", reason: "Meeting occurred; I sent the latest message." };

  if (lastCommDir === "inbound") {
    return gapDays >= 3
      ? { stage: "follow_up_due", reason: `They contacted me ${gapDays}d ago and I haven't replied.` }
      : { stage: "waiting_on_me", reason: "Latest communication is inbound — awaiting my reply." };
  }
  if (lastCommDir === "outbound") {
    if (hasInbound) {
      return gapDays >= 10
        ? { stage: "stalled", reason: `Two-way thread silent ${gapDays}d since my last message.` }
        : { stage: "waiting_on_them", reason: "Active two-way thread; I sent the latest message." };
    }
    if (gapDays >= 14) return { stage: "stalled", reason: `Outreach ${gapDays}d old with no reply.` };
    return { stage: "contacted", reason: "Outreach sent; awaiting first reply." };
  }
  if (hasPastMeeting) return { stage: "meeting_completed", reason: "A past meeting with no follow-up communication." };
  if (types.has("application_ack")) return { stage: "contacted", reason: "Application acknowledged; no human reply yet." };
  if (hasInbound) return { stage: "discovered", reason: "Inbound signal with no reply." };
  return { stage: "watch", reason: "Signals present but ambiguous." };
}

function waitingOnOf(lastCommDir: "inbound" | "outbound" | null): WaitingOn {
  if (lastCommDir === "inbound") return "me";
  if (lastCommDir === "outbound") return "them";
  return "none";
}

const CLOSED_STAGES = new Set<OpportunityStage>(["closed_won", "closed_lost", "rejected"]);

/** The single scannable heat label. Stage takes precedence over momentum so a
 *  closed/stalled/watch relationship is never mislabelled "HOT" by recency. */
function heatOf(stage: OpportunityStage, momentum: MomentumState): HeatLabel {
  if (CLOSED_STAGES.has(stage)) return "CLOSED";
  if (stage === "stalled") return "STALLED";
  if (stage === "watch") return "WATCH";
  if (momentum === "accelerating") return "HOT";
  if (momentum === "warm") return "WARM";
  return "COLD"; // cooling / cold / dead
}

/** Canonical domain: prefer a company value that already looks like a domain,
 *  else derive from the first business email's host. Generic hosts → null. */
function domainOf(company: string | null, people: string[]): string | null {
  if (company && company.includes(".") && !company.includes(" ")) return company.toLowerCase();
  const generic = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"]);
  for (const p of people) {
    const host = p.split("@")[1]?.toLowerCase();
    if (host && !generic.has(host)) return host;
  }
  return null;
}

/** The evidence-backed next move for a relationship. Never tells the owner to
 *  chase too early: a healthy waiting_on_them thread gets "hold", not "follow up". */
export function nextActionFor(stage: OpportunityStage, label: string, lastActivityAt: string): string {
  const since = lastActivityAt.slice(0, 10);
  switch (stage) {
    case "waiting_on_me":
    case "follow_up_due":
      return `Reply to ${label} — you owe the next move (since ${since}).`;
    case "meeting_scheduled":
      return `Prepare for the scheduled meeting with ${label}.`;
    case "meeting_completed":
      return `Follow-up to ${label} is out — hold; nudge once if silent ~3 days.`;
    case "waiting_on_them":
      return `Ball is in ${label}'s court — give it a short window before nudging.`;
    case "stalled":
      return `Send ${label} a light re-engagement nudge.`;
    case "contacted":
      return `Follow up with ${label} — no reply yet.`;
    case "discovered":
      return `Reply to ${label} and qualify the opportunity.`;
    case "closed_won":
      return `Closed won with ${label} — keep the relationship warm for future chains.`;
    case "closed_lost":
    case "rejected":
      return `Closed with ${label} — archive; revisit only on a new signal.`;
    default:
      return `Review the ${label} thread and decide the next step.`;
  }
}

/** Build the deduped meeting inputs the temporal engine reasons over, from every
 *  meeting_* observation (Gmail-parsed invites + calendar events). Dedup by start
 *  time (within an hour) so the same meeting from two sources counts once. */
function toMeetingInputs(meetingObs: Observation[]): MeetingInput[] {
  const byHour = new Map<number, MeetingInput>();
  for (const o of meetingObs) {
    const startMs = Date.parse(o.timestamp);
    if (!Number.isFinite(startMs)) continue;
    const endRaw = o.metadata.end;
    const endMs = typeof endRaw === "string" ? Date.parse(endRaw) : null;
    const status = o.type === "meeting_canceled"
      ? "cancelled"
      : (typeof o.metadata.status === "string" ? o.metadata.status : "confirmed");
    const bucket = Math.round(startMs / 3_600_000);
    const existing = byHour.get(bucket);
    // Prefer the calendar source (authoritative) when two sources collide.
    if (!existing || (existing.source !== "google-calendar" && o.connector === "google-calendar")) {
      byHour.set(bucket, { id: o.evidence.nativeId || o.id, startMs, endMs: Number.isFinite(endMs as number) ? (endMs as number) : null, status, source: o.connector });
    }
  }
  return [...byHour.values()];
}

/** Append the current stage to the prior status history when it changed. */
function buildStatusHistory(
  prev: Belief | undefined,
  stage: OpportunityStage,
  lastActivityAt: string,
  nowIso: string,
): StatusHistoryEntry[] {
  const prior = prev?.statusHistory ?? (prev ? [{ stage: prev.stage, at: prev.lastActivityAt }] : []);
  const last = prior[prior.length - 1];
  const history = last?.stage === stage ? prior : [...prior, { stage, at: prev ? nowIso : lastActivityAt }];
  return history.slice(-6);
}

export interface DeriveOptions {
  nowMs: number;
  previous?: Belief[];
}

/** Observations (from all connectors) → Beliefs. Deterministic. */
export function deriveBeliefs(observations: Observation[], opts: DeriveOptions): Belief[] {
  const nowMs = opts.nowMs;
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    const key = subjectKeyFor(o);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }

  const prevByKey = new Map((opts.previous ?? []).map((b) => [b.subjectKey, b]));
  const beliefs: Belief[] = [];

  for (const [key, obs] of groups) {
    const types = new Set(obs.map((o) => o.type));
    // Subjects with no real activity (memory-only or contact-only) are context, not
    // relationships-in-motion — no belief is formed. Memory never creates a belief.
    const activity = obs.filter((o) => !NON_ACTIVITY.has(o.type));
    if (activity.length === 0) continue;

    const sorted = [...obs].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const sortedActivity = [...activity].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const comms = sorted.filter((o) => COMM_TYPES.has(o.type));
    const lastComm = comms[comms.length - 1] ?? null;
    const lastCommDir = (lastComm?.direction ?? null) as "inbound" | "outbound" | null;
    const hasInbound = comms.some((o) => o.direction === "inbound");
    const hasFutureMeeting = sorted.some(
      (o) => (o.type === "meeting_scheduled" || o.type === "meeting_approaching") && Date.parse(o.timestamp) >= nowMs,
    ) || sorted.some((o) => o.type === "meeting_invited" && Date.parse(o.timestamp) >= nowMs);
    const hasPastMeeting = sorted.some(
      (o) => o.type === "meeting_completed" || (o.type === "meeting_invited" && Date.parse(o.timestamp) < nowMs),
    );

    // Momentum + recency come from ACTIVITY only — memory context never ages a thread.
    const lastActivityMs = Date.parse(sortedActivity[sortedActivity.length - 1].timestamp);
    const firstActivityMs = Date.parse(sortedActivity[0].timestamp);
    const gapDays = days(nowMs - lastActivityMs);
    const momentum = momentumOf(sortedActivity.map((o) => Date.parse(o.timestamp)), nowMs);
    const { stage, reason } = stageOf({ types, lastCommDir, hasInbound, hasFutureMeeting, hasPastMeeting, gapDays });
    const status = classifyStatus(stage, momentum);
    const waitingOn = waitingOnOf(lastCommDir);

    const seed = matchSeed(`${key} ${obs.map((o) => o.evidence.subject ?? "").join(" ")}`);
    const kind = kindOf(seed?.kind ?? null, types);
    const company = obs.find((o) => o.company)?.company ?? null;
    const peopleSet = new Set(obs.flatMap((o) => o.people).filter((p) => p.includes("@")));
    const people = [...peopleSet].slice(0, 5);
    const label = seed?.company ?? company ?? (parseEmail(people[0] ?? key).name || key);
    const connectors = [...new Set(obs.map((o) => o.connector))];

    const hasOutbound = comms.some((o) => o.direction === "outbound");
    const twoWay = hasInbound && hasOutbound;
    const confidence = comms.length === 0
      ? "low"
      : twoWay && comms.length >= 3 ? "high" : comms.length >= 1 ? "medium" : "low";

    // Engagement quality — gates recommendability. A cold one-way inbound with no
    // seed and no lifecycle signal is observed but never top-ranked as an action.
    const typeSet: Set<string> = types;
    const hasLinkedInSignal = [...typeSet].some((t) => LINKEDIN_SIGNAL.has(t));
    const hasSignal = ["application_ack", "interview_invited", "offer_received", "rejection_received",
      "referral_offered", "proposal_sent", "proposal_viewed"].some((t) => typeSet.has(t))
      || hasFutureMeeting || hasPastMeeting || hasLinkedInSignal;
    // LinkedIn/manual signals about a known (seed) entity qualify even one-way.
    const engagement = twoWay ? "two_way"
      : hasOutbound ? "owner_initiated"
      : (hasInbound || hasLinkedInSignal) && (!!seed || hasSignal) ? "inbound_qualified"
      : hasInbound ? "inbound_cold"
      : hasFutureMeeting || hasPastMeeting ? "inbound_qualified"
      : "none";

    const evidence: BeliefEvidenceRef[] = [...sorted].reverse().slice(0, 4).map((o) => ({
      connector: o.connector, type: o.type, timestamp: o.timestamp, direction: o.direction,
      subject: o.evidence.subject, excerpt: o.evidence.excerpt, nativeId: o.evidence.nativeId,
    }));

    // Change log + momentum delta vs previous belief.
    const prev = prevByKey.get(key);
    let momentumDelta: MomentumDelta = "new";
    let changeLog = "NEW — first belief formed";
    if (prev) {
      const d = MOMENTUM_RANK[momentum] - MOMENTUM_RANK[prev.momentum];
      momentumDelta = d > 0 ? "rising" : d < 0 ? "falling" : "flat";
      if (prev.stage !== stage) changeLog = `stage: ${prev.stage} → ${stage}`;
      else if (prev.momentum !== momentum) changeLog = `momentum: ${prev.momentum} → ${momentum}`;
      else if (prev.waitingOn !== waitingOn) changeLog = `waiting-on: ${prev.waitingOn} → ${waitingOn}`;
      else if (prev.lastActivityAt !== new Date(lastActivityMs).toISOString()) changeLog = `new activity ${new Date(lastActivityMs).toISOString().slice(0, 10)}`;
      else changeLog = "no change since last scan";
    }

    const claim = buildClaim(label, stage, momentum, waitingOn);
    const falsifier = buildFalsifier(label, stage, lastActivityMs);

    // Directional touch timestamps + latest meeting — the raw "who owes whom"
    // signal the dashboard cards surface. Derived from ACTIVITY only.
    const inboundComms = comms.filter((o) => o.direction === "inbound");
    const outboundComms = comms.filter((o) => o.direction === "outbound");
    const meetingObs = sorted.filter((o) => o.type.startsWith("meeting_"));
    const latestOf = (list: Observation[]): string | null =>
      list.length ? list[list.length - 1].timestamp : null;
    const lastActivityAt = new Date(lastActivityMs).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    // ── Temporal profile — the single source of truth for time ──
    const statusChangedAtMs = prev
      ? (prev.stage !== stage ? nowMs : (prev.temporal?.statusChangedAt ? Date.parse(prev.temporal.statusChangedAt) : lastActivityMs))
      : firstActivityMs;
    const temporal = computeTemporalProfile({
      createdAtMs: firstActivityMs,
      lastInboundMs: inboundComms.length ? Date.parse(inboundComms[inboundComms.length - 1].timestamp) : null,
      lastOutboundMs: outboundComms.length ? Date.parse(outboundComms[outboundComms.length - 1].timestamp) : null,
      comms: comms.map((o) => ({
        ts: Date.parse(o.timestamp),
        direction: o.direction as "inbound" | "outbound" | null,
        text: `${o.evidence.subject ?? ""} ${o.evidence.excerpt ?? ""}`.trim(),
      })),
      meetings: toMeetingInputs(meetingObs),
      stage, momentum, kind, confidence, waitingOn, engagement,
      statusChangedAtMs,
      lastReminderSentMs: prev?.temporal?.lastReminderSent ? Date.parse(prev.temporal.lastReminderSent) : null,
    }, nowMs);

    // A missed meeting rewrites the next move: an honest recovery reach-out
    // outranks any stage-derived suggestion.
    const nextAction = temporal.missedMeeting
      ? `Reach out to ${label} with an honest explanation — the ${temporal.missedMeeting.scheduledFor.slice(0, 10)} meeting was missed (${temporal.daysOverdue}d ago).`
      : nextActionFor(stage, label, lastActivityAt);

    beliefs.push({
      subjectKey: key, subjectLabel: label, kind, company, people,
      stage, status, momentum, momentumDelta, waitingOn, confidence, engagement,
      heat: heatOf(stage, momentum),
      domain: domainOf(company, people),
      firstActivityAt: new Date(firstActivityMs).toISOString(),
      lastActivityAt,
      latestInboundAt: latestOf(inboundComms),
      latestOutboundAt: latestOf(outboundComms),
      latestMeetingAt: latestOf(meetingObs),
      nextAction,
      followUpDate: temporal.followUpDue ? temporal.followUpDue.slice(0, 10) : null,
      observationCount: obs.length, connectors,
      claim, falsifier, changeLog,
      statusHistory: buildStatusHistory(prev, stage, lastActivityAt, nowIso),
      lastScanAt: nowIso,
      temporal,
      evidence,
    });
  }

  return beliefs.sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
}

function buildClaim(label: string, stage: OpportunityStage, momentum: MomentumState, waitingOn: WaitingOn): string {
  const heat = momentum === "accelerating" ? "gaining momentum fast"
    : momentum === "warm" ? "warm and active"
    : momentum === "cooling" ? "cooling off"
    : momentum === "cold" ? "gone cold"
    : "dormant";
  const owe = waitingOn === "me" ? "you owe the next move" : waitingOn === "them" ? "the ball is in their court" : "no reply pending";
  return `${label} is ${heat} (${stage.replace(/_/g, " ")}); ${owe}.`;
}

function buildFalsifier(label: string, stage: OpportunityStage, lastActivityMs: number): string {
  const by = new Date(lastActivityMs + 4 * DAY).toISOString().slice(0, 10);
  switch (stage) {
    case "waiting_on_them":
    case "meeting_completed":
      return `If ${label} doesn't reply by ${by}, this belief downgrades to stalling.`;
    case "waiting_on_me":
    case "follow_up_due":
      return `If you don't respond, momentum with ${label} decays and the belief weakens.`;
    case "stalled":
      return `A reply from ${label} would revive this from stalled to active.`;
    default:
      return `New inbound or a scheduled meeting with ${label} would change this belief.`;
  }
}
