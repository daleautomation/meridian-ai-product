// Meridian Command — Belief model (the trust-model Belief made real).
//
// A Belief is a deterministic interpretation of Observations about one subject
// (a relationship / opportunity). It carries evidence, a change log (what moved
// since last time), and a falsifier (what would change our mind) — the three
// things MERIDIAN_TRUST_MODEL.md requires before anything may recommend an action.

import type {
  Confidence,
  MomentumState,
  OpportunityKind,
  OpportunityStage,
  OpportunityStatus,
  WaitingOn,
} from "@/lib/gmail/types";

export type { Confidence, MomentumState, OpportunityKind, OpportunityStage, OpportunityStatus, WaitingOn };

export type MomentumDelta = "rising" | "falling" | "flat" | "new";

/** Scannable heat label surfaced on every dashboard card. Derived from stage +
 *  momentum; the single at-a-glance signal for how alive a relationship is. */
export type HeatLabel = "HOT" | "WARM" | "COLD" | "STALLED" | "CLOSED" | "WATCH";

/** One entry in a belief's status history — how the stage moved over scans. */
export interface StatusHistoryEntry {
  stage: OpportunityStage;
  at: string; // ISO — when this stage was first observed
}

/** How real the relationship is — gates whether a belief may be RECOMMENDED.
 *  Cold one-way inbound (newsletters, apartment agents, cold blasts) is observed
 *  and believed, but never top-ranked as an action. */
export type Engagement = "two_way" | "owner_initiated" | "inbound_qualified" | "inbound_cold" | "none";

export interface BeliefEvidenceRef {
  connector: string;
  type: string;
  timestamp: string;
  direction: "inbound" | "outbound" | null;
  subject?: string;
  excerpt?: string;
  nativeId: string;
}

export interface Belief {
  subjectKey: string;
  subjectLabel: string;
  kind: OpportunityKind;
  company: string | null;
  people: string[];
  stage: OpportunityStage;
  status: OpportunityStatus;
  momentum: MomentumState;
  momentumDelta: MomentumDelta;
  waitingOn: WaitingOn;
  confidence: Confidence;
  engagement: Engagement;
  /** At-a-glance heat label (HOT/WARM/COLD/STALLED/CLOSED/WATCH). */
  heat: HeatLabel;
  /** Canonical company domain when known (e.g. "acme.com"), else null. */
  domain: string | null;
  firstActivityAt: string;
  lastActivityAt: string;
  /** Most recent inbound message (they contacted me), or null. */
  latestInboundAt: string | null;
  /** Most recent outbound message (I contacted them), or null. */
  latestOutboundAt: string | null;
  /** Most recent meeting observation (scheduled/completed), or null. */
  latestMeetingAt: string | null;
  /** The single recommended next move for this relationship (evidence-backed). */
  nextAction: string;
  /** When to act by / follow up (ISO date), or null when nothing is due. */
  followUpDate: string | null;
  observationCount: number;
  connectors: string[];
  /** One-sentence interpretation. */
  claim: string;
  /** What would change this belief (trust-model requirement). */
  falsifier: string;
  /** What moved since the previous scan (trust-model change log). */
  changeLog: string;
  /** How the stage has moved across scans (most recent last). */
  statusHistory: StatusHistoryEntry[];
  /** When this belief was last recomputed (ISO). */
  lastScanAt: string;
  evidence: BeliefEvidenceRef[];
}

export interface BeliefStore {
  version: 1;
  ownerId: string;
  updatedAt: string | null;
  beliefs: Belief[];
}
