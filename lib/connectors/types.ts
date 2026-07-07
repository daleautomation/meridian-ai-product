// Meridian Command — the Reality Layer: Connector contract + canonical Observation.
//
// A connector's ONLY job is to observe reality and emit Observation[]. It may not
// create opportunities, assign stages, or score anything — interpretation lives in
// the Belief Engine (lib/beliefs). This is the seam that lets any future sensor
// (Slack, GitHub, Drive, LinkedIn) plug in with no new architecture: translate its
// data into Observations and everything downstream already works.

export type ConnectorId =
  | "gmail"
  | "google-calendar"
  | "google-contacts"
  | (string & {}); // future connectors, no enum change required

/** Canonical, connector-agnostic observation types. Nothing connector-specific
 *  leaks past this list — a Gmail "email" and a Slack "message" are both messages. */
export const OBSERVATION_TYPES = [
  // communication
  "message_received",
  "message_sent",
  "no_response", // derived: outbound with no reply within a window
  // meetings
  "meeting_invited",
  "meeting_scheduled",
  "meeting_completed",
  "meeting_canceled",
  "meeting_rescheduled",
  "meeting_approaching",
  // opportunity lifecycle (observed facts, NOT assigned stages)
  "application_submitted",
  "application_ack",
  "interview_invited",
  "offer_received",
  "rejection_received",
  "proposal_sent",
  "proposal_viewed",
  "referral_offered",
  "referral_made",
  // contacts / people
  "contact_added",
  "contact_updated",
  "duplicate_identity",
  "job_change",
  "new_connection",
  "hiring_announcement",
  "profile_viewed",
  // linkedin (manual/read-only ingestion — no scraping)
  "linkedin_message_received",
  "linkedin_message_sent",
  "linkedin_connection_added",
  "linkedin_profile_viewed",
  "linkedin_job_signal",
  "linkedin_company_signal",
  "linkedin_manual_note",
  // memory (strategic context — a sensor, but never affects momentum/stage)
  "strategic_memory_active",
  "preference_active",
  "fact_active",
  "memory_updated",
  "memory_conflict_detected",
  "memory_stale",
  // work (future GitHub etc.)
  "commit",
  "pr_merged",
  "deployment",
  "issue_closed",
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export type ObservationDirection = "inbound" | "outbound" | null;

export interface ObservationEvidence {
  source: ConnectorId;
  nativeId: string; // the id in the source system (message id, event id, contact id)
  subject?: string;
  excerpt?: string;
  url?: string;
}

/** The one object every connector emits and everything downstream consumes. */
export interface Observation {
  /** Deterministic: `${connector}:${type}:${nativeId}`. */
  id: string;
  connector: ConnectorId;
  type: ObservationType;
  /** When the event happened in reality (ISO). */
  timestamp: string;
  /** When Meridian collected it (ISO). */
  observedAt: string;
  /** Native grouping key within the connector (thread id, event id, contact id). */
  entity: string;
  /** Identity handles involved (emails / stable ids). */
  people: string[];
  /** Inferred company (domain or name), or null. */
  company: string | null;
  direction: ObservationDirection;
  evidence: ObservationEvidence;
  /** 0–1 certainty that the FACT occurred. NOT a priority/score. */
  confidence: number;
  metadata: Record<string, unknown>;
}

// ── Connector contract ──────────────────────────────────────────────────────

export interface Capabilities {
  id: ConnectorId;
  /** Which observation types this connector can emit. */
  emits: ObservationType[];
  readOnly: boolean;
  /** How reality reaches the connector: an MCP-produced batch, a local file, or a live API. */
  inputMode: "batch" | "file" | "api";
  description: string;
}

export type HealthState = "ok" | "degraded" | "unauthenticated" | "unavailable";

export interface ConnectorHealth {
  id: ConnectorId;
  state: HealthState;
  detail: string;
  checkedAt: string;
}

export interface AuthStatus {
  id: ConnectorId;
  authenticated: boolean;
  method: "mcp-session" | "file" | "oauth" | "none";
  detail: string;
}

export interface SyncResult {
  connector: ConnectorId;
  ok: boolean;
  observations: Observation[];
  collected: number;
  syncedAt: string;
  health: ConnectorHealth;
  error?: string;
}

/**
 * Every connector implements this. `collectObservations` reads raw reality (from
 * its `input`) and returns already-normalized Observations — the Normalize() step
 * is folded in so nothing connector-specific escapes. `run` wraps health + auth +
 * collect for the registry.
 */
export interface Connector<Input = unknown> {
  capabilities(): Capabilities;
  health(input?: Input): Promise<ConnectorHealth>;
  authenticate(): Promise<AuthStatus>;
  lastSync(): Promise<string | null>;
  collectObservations(input: Input, nowMs: number): Promise<Observation[]>;
  run(input: Input, nowMs: number): Promise<SyncResult>;
}

export function observationId(connector: ConnectorId, type: ObservationType, nativeId: string): string {
  return `${connector}:${type}:${nativeId}`;
}

/** Deterministic dedup + ordering for a collected observation set. */
export function dedupeObservations(observations: Observation[]): Observation[] {
  const byId = new Map<string, Observation>();
  for (const o of observations) if (!byId.has(o.id)) byId.set(o.id, o);
  return [...byId.values()].sort((a, b) =>
    a.timestamp === b.timestamp ? a.id.localeCompare(b.id) : a.timestamp.localeCompare(b.timestamp),
  );
}
