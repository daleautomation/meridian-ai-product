// Meridian Command — Opportunity Graph domain types (Phase 0/1).
//
// The graph is a deterministic projection over durable records. These types are
// the contract shared by the pure projector (lib/graph/projection.ts), the Neon
// repository (lib/graph/repository.ts), and the backfill/validation scripts.
//
// No scoring lives here. Phase 1 is structure only — nodes, edges, provenance.

/** Node kinds. Thin nodes; the value is in the edges between them. */
export const NODE_TYPES = [
  "self",
  "person",
  "company",
  "job_opportunity",
  "meeting",
  "revenue_outcome",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Relationship kinds, all rooted in observable records. */
export const EDGE_TYPES = [
  "KNOWS", // self — person
  "WORKS_AT", // person — company
  "PURSUING", // self — job_opportunity
  "AT_COMPANY", // job_opportunity/outcome — company (the cross-island join)
  "FOR_OPPORTUNITY", // meeting — job_opportunity
  "ATTENDS", // self — meeting
  "GENERATED_VALUE", // revenue_outcome — company
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const SOURCE_SYSTEMS = [
  "ae-jobs",
  "company-snapshots",
  "crm-contacts",
  "ae-jobs-calendar",
  "execution-outcomes",
  "gmail",
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

/** A pointer from a node/edge back to the raw record that produced it. */
export interface ProvenanceRef {
  sourceRecordId: string; // "<system>:<type>:<id>"
  sourceSystem: SourceSystem;
  sourceType: string;
  sourceId: string;
}

/** The raw ingested record, stored once, keyed deterministically. */
export interface SourceRecord {
  sourceRecordId: string;
  sourceSystem: SourceSystem;
  sourceType: string;
  sourceId: string;
  workspace: string | null;
  payload: Record<string, unknown>;
  contentHash: string;
  observedAt: string; // ISO
}

/** A canonical object in the graph. */
export interface GraphNode {
  nodeId: string; // "company:domain:x", "person:email:x", "self:dylan"
  nodeType: NodeType;
  label: string;
  ownerScope: string; // whose graph — self-centered OS ("dylan")
  canonicalKey: string; // normalized natural key (identity target)
  attributes: Record<string, unknown>;
  provenance: ProvenanceRef[];
  sourceCount: number;
  firstSeenAt: string; // ISO
  lastSeenAt: string; // ISO
}

/** A relationship between two nodes. edgeId is the natural key "src|type|dst". */
export interface GraphEdge {
  edgeId: string;
  srcNodeId: string;
  dstNodeId: string;
  edgeType: EdgeType;
  directed: boolean;
  /** Structural default weight (0–1). NOT a predictive score in Phase 1. */
  weight: number;
  attributes: Record<string, unknown>;
  evidence: ProvenanceRef[];
  firstObservedAt: string;
  lastObservedAt: string;
}

/** A deterministic handle → node mapping (the cross-keyspace join). */
export interface IdentityLink {
  handle: string; // "email:foo@bar.com", "companyKey:domain:bar.com"
  handleKind:
    | "email"
    | "phone"
    | "company_key"
    | "opportunity_id"
    | "person_name"
    | "calendar_event"
    | "outcome";
  nodeId: string;
  confidence: number; // 0–100
  resolvedBy: string; // projector rule name
}

/** The full output of a projection pass — everything needed to persist. */
export interface GraphProjection {
  sources: SourceRecord[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  identities: IdentityLink[];
}

/**
 * Unified attention item — the durable read-model seam the Command Brief will
 * consume later WITHOUT rewriting the graph. Backed by the `attention_items`
 * SQL view. Included here so Phase 2 scoring codes against a stable interface.
 */
export interface AttentionItem {
  itemId: string;
  kind: "job_opportunity" | "meeting";
  title: string;
  company: string | null;
  nextAction: string | null;
  dueAt: string | null;
  priority: string | null;
  ownerScope: string;
  lastSeenAt: string;
}

/** Typed lens over job-opportunity nodes (backed by the `opportunities` view). */
export interface Opportunity {
  opportunityId: string;
  title: string;
  company: string | null;
  roleTitle: string | null;
  stage: string | null;
  priority: string | null;
  nextAction: string | null;
  followUpDate: string | null;
  source: string | null;
  ownerScope: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Durable execution outcome (revenue attribution ledger). Mirrors the existing
 * `DurableExecutionOutcome` (lib/execution/serverOutcomeStore.ts) and the
 * `execution_outcomes` table — re-declared here so the graph module has no
 * runtime import cycle into the execution layer. Field-compatible on purpose.
 */
export interface ExecutionOutcome {
  eventId: string;
  workspace: string;
  companyKey: string | null;
  crmKey: string | null;
  leadId: string | null;
  taskId: string | null;
  operatorId: string;
  sourceSurface: string;
  outcomeStatus: string;
  previousStatus: string | null;
  nextStatus: string;
  occurredAt: string;
  recordedAt: string;
  nextAction: string | null;
  nextActionDate: string | null;
  estimatedValue: number | null;
  meridianInfluenced: boolean;
  influenceReason: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}
