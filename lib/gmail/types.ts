// Meridian Command — Gmail opportunity ingestion: domain types.
//
// The contract is deliberately shaped to match the Gmail MCP `search_threads` /
// `get_thread` output, so an external Claude session (the reader) can pipe threads
// straight into this deterministic pipeline (the classifier). No AI scoring lives
// here — every stage/momentum/confidence value is a pure function of observable
// email facts, and every opportunity carries evidence.

// ── Raw Gmail shapes (mirror the MCP output) ────────────────────────────────

export interface GmailMessage {
  id: string;
  threadId?: string;
  date: string; // ISO
  sender: string; // "name <email>" or "email"
  toRecipients?: string[];
  ccRecipients?: string[];
  subject?: string;
  snippet?: string;
  labelIds?: string[]; // INBOX | SENT | IMPORTANT | UNREAD | ...
}

export interface GmailThread {
  id: string;
  messages: GmailMessage[];
}

export interface GmailThreadBatch {
  fetchedAt: string; // ISO
  ownerEmails: string[];
  queries?: string[];
  threads: GmailThread[];
}

// ── Deterministic opportunity model ─────────────────────────────────────────

export const OPPORTUNITY_STAGES = [
  "discovered",
  "contacted",
  "replied",
  "meeting_scheduled",
  "meeting_completed",
  "waiting_on_them",
  "waiting_on_me",
  "follow_up_due",
  "active_pipeline",
  "stalled",
  "rejected",
  "closed_won",
  "closed_lost",
  "watch",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const MOMENTUM_STATES = ["accelerating", "warm", "cooling", "cold", "dead"] as const;
export type MomentumState = (typeof MOMENTUM_STATES)[number];

export const OPPORTUNITY_STATUSES = ["warm", "active", "waiting", "blocked", "stale", "dead"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export type Confidence = "high" | "medium" | "low" | "unknown";
export type WaitingOn = "me" | "them" | "none" | "unknown";
export type MessageDirection = "inbound" | "outbound";

/** Opportunity category — this is NOT only job search. */
export const OPPORTUNITY_KINDS = [
  "career", // recruiter / hiring / interview / application
  "sales", // prospect / customer / deal
  "consulting", // bidding / estimate / project work
  "partnership", // founder / collaboration
  "referral", // introduction / warm connection
  "unknown",
] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

/** One piece of evidence — the trust-model requirement. No opportunity without it. */
export interface EvidenceItem {
  threadId: string;
  messageId: string;
  direction: MessageDirection;
  sender: string;
  recipients: string[];
  subject: string;
  date: string; // ISO
  excerpt: string; // short, decoded
}

export interface DetectedOpportunity {
  /** Stable key: canonical company + primary counterparty. */
  key: string;
  name: string;
  kind: OpportunityKind;
  company: string;
  companyDomain: string | null;
  people: string[]; // counterparty emails
  stage: OpportunityStage;
  status: OpportunityStatus;
  momentum: MomentumState;
  confidence: Confidence;
  waitingOn: WaitingOn;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  nextAction: string;
  whyNow: string; // why this matters now (recency/decay)
  reason: string; // why THIS stage was assigned (deterministic trace)
  relevance: number; // 0–100
  evidence: EvidenceItem[];
  threadIds: string[];
  /** Trust-model Change Log — diff vs the previous scan. */
  whatChanged: string;
}

export interface OpportunityScanResult {
  scannedAt: string;
  ownerEmails: string[];
  threadsScanned: number;
  opportunities: DetectedOpportunity[];
  droppedAsNoise: number;
  unknown: number; // threads that could not be classified with confidence
}

/** Persisted staging file shape (data/gmail/opportunities.json). */
export interface GmailOpportunityStore {
  version: 1;
  ownerId: string;
  scannedAt: string | null;
  opportunities: DetectedOpportunity[];
}
