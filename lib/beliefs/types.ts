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
  firstActivityAt: string;
  lastActivityAt: string;
  observationCount: number;
  connectors: string[];
  /** One-sentence interpretation. */
  claim: string;
  /** What would change this belief (trust-model requirement). */
  falsifier: string;
  /** What moved since the previous scan (trust-model change log). */
  changeLog: string;
  evidence: BeliefEvidenceRef[];
}

export interface BeliefStore {
  version: 1;
  ownerId: string;
  updatedAt: string | null;
  beliefs: Belief[];
}
