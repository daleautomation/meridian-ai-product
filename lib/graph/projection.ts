// Meridian Command — Opportunity Graph projection (Phase 1).
//
// PURE + DETERMINISTIC. No database, no network, no Date.now(). Given the same
// records and the same `asOf` fallback, it returns byte-identical output on every
// run and every machine. That property is what makes the graph replayable,
// explainable, and safe to rebuild.
//
// Phase 1 is STRUCTURE ONLY — nodes, edges, provenance, identity. No scoring, no
// ranking, no AI. Weights are structural constants, documented as such.

import type { CareerCalendarEvent } from "@/lib/ae-jobs/calendar";
import type { JobOpportunity } from "@/lib/ae-jobs/types";
import type { CrmContactRecord } from "@/lib/crm-import/types";
import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";
import {
  companyNodeId,
  companyNodeIdFromName,
  edgeId,
  meetingNodeId,
  norm,
  normalizeEmail,
  normalizePhone,
  opportunityNodeId,
  outcomeNodeId,
  personNodeId,
  provenance,
  sha256,
  SELF_NODE_ID,
  SELF_OWNER,
  sourceRecordId,
} from "./ids";
import type {
  EdgeType,
  ExecutionOutcome,
  GraphEdge,
  GraphNode,
  GraphProjection,
  IdentityLink,
  NodeType,
  ProvenanceRef,
  SourceRecord,
  SourceSystem,
} from "./types";

/** Structural default edge weights (0–1). NOT predictive scores. */
const EDGE_WEIGHTS: Record<EdgeType, number> = {
  KNOWS: 0.3,
  WORKS_AT: 0.5,
  PURSUING: 0.8,
  AT_COMPANY: 1.0,
  FOR_OPPORTUNITY: 1.0,
  ATTENDS: 0.6,
  GENERATED_VALUE: 1.0,
};

export interface ProjectionInputs {
  opportunities?: JobOpportunity[];
  companies?: CompanySnapshot[];
  contacts?: CrmContactRecord[];
  calendarEvents?: CareerCalendarEvent[];
  outcomes?: ExecutionOutcome[];
  /** Owner scope for the self-centered graph. Defaults to "dylan". */
  ownerId?: string;
  /** Deterministic fallback timestamp for records lacking one (ISO). */
  asOf: string;
}

/** Mutable accumulator that folds many records into one deduped projection. */
class GraphAccumulator {
  private sources = new Map<string, SourceRecord>();
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private identities = new Map<string, IdentityLink>();

  addSource(rec: Omit<SourceRecord, "contentHash">): ProvenanceRef {
    const contentHash = sha256(JSON.stringify(rec.payload));
    if (!this.sources.has(rec.sourceRecordId)) {
      this.sources.set(rec.sourceRecordId, { ...rec, contentHash });
    }
    return {
      sourceRecordId: rec.sourceRecordId,
      sourceSystem: rec.sourceSystem,
      sourceType: rec.sourceType,
      sourceId: rec.sourceId,
    };
  }

  upsertNode(input: {
    nodeId: string;
    nodeType: NodeType;
    label: string;
    ownerScope: string;
    canonicalKey: string;
    attributes: Record<string, unknown>;
    prov: ProvenanceRef;
    observedAt: string;
  }): void {
    const existing = this.nodes.get(input.nodeId);
    if (!existing) {
      this.nodes.set(input.nodeId, {
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        label: input.label,
        ownerScope: input.ownerScope,
        canonicalKey: input.canonicalKey,
        attributes: pruneEmpty(input.attributes),
        provenance: [input.prov],
        sourceCount: 1,
        firstSeenAt: input.observedAt,
        lastSeenAt: input.observedAt,
      });
      return;
    }
    // First non-empty value wins per key → order-independent given sorted input.
    for (const [k, v] of Object.entries(pruneEmpty(input.attributes))) {
      if (existing.attributes[k] === undefined || existing.attributes[k] === null) {
        existing.attributes[k] = v;
      }
    }
    if (!existing.provenance.some((p) => p.sourceRecordId === input.prov.sourceRecordId)) {
      existing.provenance.push(input.prov);
      existing.sourceCount = existing.provenance.length;
    }
    if (input.observedAt < existing.firstSeenAt) existing.firstSeenAt = input.observedAt;
    if (input.observedAt > existing.lastSeenAt) existing.lastSeenAt = input.observedAt;
    // Prefer a more specific label than a bare key echo.
    if (existing.label.length === 0) existing.label = input.label;
  }

  upsertEdge(input: {
    src: string;
    type: EdgeType;
    dst: string;
    directed?: boolean;
    weight?: number;
    attributes?: Record<string, unknown>;
    prov: ProvenanceRef;
    observedAt: string;
  }): void {
    const id = edgeId(input.src, input.type, input.dst);
    const existing = this.edges.get(id);
    if (!existing) {
      this.edges.set(id, {
        edgeId: id,
        srcNodeId: input.src,
        dstNodeId: input.dst,
        edgeType: input.type,
        directed: input.directed ?? true,
        weight: input.weight ?? EDGE_WEIGHTS[input.type],
        attributes: pruneEmpty(input.attributes ?? {}),
        evidence: [input.prov],
        firstObservedAt: input.observedAt,
        lastObservedAt: input.observedAt,
      });
      return;
    }
    if (!existing.evidence.some((p) => p.sourceRecordId === input.prov.sourceRecordId)) {
      existing.evidence.push(input.prov);
    }
    if (input.observedAt < existing.firstObservedAt) existing.firstObservedAt = input.observedAt;
    if (input.observedAt > existing.lastObservedAt) existing.lastObservedAt = input.observedAt;
  }

  link(input: IdentityLink): void {
    if (!this.identities.has(input.handle)) this.identities.set(input.handle, input);
  }

  build(): GraphProjection {
    // Stable ordering so output is deterministic and diffs are clean.
    return {
      sources: [...this.sources.values()].sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)),
      nodes: [...this.nodes.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
      edges: [...this.edges.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
      identities: [...this.identities.values()].sort((a, b) => a.handle.localeCompare(b.handle)),
    };
  }
}

function pruneEmpty(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

/** Ensure the single distinguished `self` node exists (the center of the OS). */
function ensureSelf(acc: GraphAccumulator, ownerId: string, asOf: string): void {
  acc.upsertNode({
    nodeId: SELF_NODE_ID,
    nodeType: "self",
    label: "Dylan",
    ownerScope: ownerId,
    canonicalKey: ownerId,
    attributes: { role: "owner" },
    prov: provenance("ae-jobs", "self", ownerId),
    observedAt: asOf,
  });
  // The self node's provenance references a synthetic source record so joins hold.
  acc.addSource({
    sourceRecordId: sourceRecordId("ae-jobs", "self", ownerId),
    sourceSystem: "ae-jobs",
    sourceType: "self",
    sourceId: ownerId,
    workspace: ownerId,
    payload: { ownerId },
    observedAt: asOf,
  });
}

// ── Per-entity projectors ────────────────────────────────────────────────────

export function projectOpportunity(
  acc: GraphAccumulator,
  opp: JobOpportunity,
  ownerId: string,
  asOf: string,
): void {
  const system: SourceSystem = "ae-jobs";
  const observedAt = opp.updatedAt || asOf;
  const prov = acc.addSource({
    sourceRecordId: sourceRecordId(system, "opportunity", opp.id),
    sourceSystem: system,
    sourceType: "opportunity",
    sourceId: opp.id,
    workspace: ownerId,
    payload: opp as unknown as Record<string, unknown>,
    observedAt,
  });

  const oppNode = opportunityNodeId(opp.id);
  acc.upsertNode({
    nodeId: oppNode,
    nodeType: "job_opportunity",
    label: `${opp.roleTitle} @ ${opp.company}`,
    ownerScope: ownerId,
    canonicalKey: norm(opp.id),
    attributes: {
      company: opp.company,
      roleTitle: opp.roleTitle,
      roleCategory: opp.roleCategory,
      stage: opp.stage,
      priority: opp.priority,
      nextAction: opp.nextAction,
      followUpDate: opp.followUpDate,
      source: opp.source ?? "manual",
    },
    prov,
    observedAt,
  });
  acc.link({
    handle: `opportunity_id:${norm(opp.id)}`,
    handleKind: "opportunity_id",
    nodeId: oppNode,
    confidence: 100,
    resolvedBy: "projectOpportunity",
  });

  // self —PURSUING→ opportunity
  acc.upsertEdge({ src: SELF_NODE_ID, type: "PURSUING", dst: oppNode, prov, observedAt });

  // opportunity —AT_COMPANY→ company  (the join that links the ae-jobs island
  // to the company island via the shared companyKey).
  const compNode = companyNodeIdFromName(opp.company);
  acc.upsertNode({
    nodeId: compNode,
    nodeType: "company",
    label: opp.company,
    ownerScope: ownerId,
    canonicalKey: compNode.slice("company:".length),
    attributes: { origin: "opportunity" },
    prov,
    observedAt,
  });
  acc.upsertEdge({ src: oppNode, type: "AT_COMPANY", dst: compNode, prov, observedAt });
}

export function projectCompanySnapshot(
  acc: GraphAccumulator,
  snap: CompanySnapshot,
  ownerId: string,
  asOf: string,
): void {
  const system: SourceSystem = "company-snapshots";
  const observedAt = snap.updatedAt || snap.lastCheckedAt || asOf;
  const prov = acc.addSource({
    sourceRecordId: sourceRecordId(system, "company", snap.key),
    sourceSystem: system,
    sourceType: "company",
    sourceId: snap.key,
    workspace: ownerId,
    payload: snap as unknown as Record<string, unknown>,
    observedAt,
  });

  const compNode = companyNodeId(snap.company);
  acc.upsertNode({
    nodeId: compNode,
    nodeType: "company",
    label: snap.company.name,
    ownerScope: ownerId,
    canonicalKey: snap.key,
    attributes: {
      domain: snap.company.domain ?? null,
      status: snap.status ?? null,
      trade: snap.trade ?? null,
      nextAction: snap.nextAction ?? null,
      origin: "company-snapshot",
    },
    prov,
    observedAt,
  });
  acc.link({
    handle: `company_key:${snap.key}`,
    handleKind: "company_key",
    nodeId: compNode,
    confidence: 100,
    resolvedBy: "projectCompanySnapshot",
  });
}

export function projectContact(
  acc: GraphAccumulator,
  contact: CrmContactRecord,
  ownerId: string,
  asOf: string,
): void {
  const system: SourceSystem = "crm-contacts";
  const observedAt = contact.updatedAt || contact.createdAt || asOf;
  const prov = acc.addSource({
    sourceRecordId: sourceRecordId(system, "contact", contact.id),
    sourceSystem: system,
    sourceType: "contact",
    sourceId: contact.id,
    workspace: contact.workspaceId,
    payload: contact as unknown as Record<string, unknown>,
    observedAt,
  });

  const person = personNodeId({
    email: contact.email,
    phone: contact.phone,
    name: contact.name,
    company: contact.company,
  });
  acc.upsertNode({
    nodeId: person,
    nodeType: "person",
    label: contact.name || contact.email || "Unknown contact",
    ownerScope: ownerId,
    canonicalKey: person.slice("person:".length),
    attributes: {
      company: contact.company || null,
      email: contact.email,
      phone: contact.phone,
      sourceCrm: contact.sourceCrm,
      relationshipScore: contact.relationshipScore,
      lastInteractionAt: contact.lastInteractionAt,
    },
    prov,
    observedAt,
  });

  const email = normalizeEmail(contact.email);
  if (email) acc.link({ handle: `email:${email}`, handleKind: "email", nodeId: person, confidence: 100, resolvedBy: "projectContact" });
  const phone = normalizePhone(contact.phone);
  if (phone) acc.link({ handle: `phone:${phone}`, handleKind: "phone", nodeId: person, confidence: 90, resolvedBy: "projectContact" });

  // self —KNOWS→ person (weighted by relationship score if present).
  const weight = typeof contact.relationshipScore === "number"
    ? Math.max(0, Math.min(1, contact.relationshipScore / 100))
    : undefined;
  acc.upsertEdge({ src: SELF_NODE_ID, type: "KNOWS", dst: person, weight, prov, observedAt, directed: false });

  // person —WORKS_AT→ company (links people to the company island).
  if (contact.company && contact.company.trim().length > 0) {
    const compNode = companyNodeIdFromName(contact.company);
    acc.upsertNode({
      nodeId: compNode,
      nodeType: "company",
      label: contact.company,
      ownerScope: ownerId,
      canonicalKey: compNode.slice("company:".length),
      attributes: { origin: "contact" },
      prov,
      observedAt,
    });
    acc.upsertEdge({ src: person, type: "WORKS_AT", dst: compNode, prov, observedAt });
  }
}

export function projectCalendarEvent(
  acc: GraphAccumulator,
  ev: CareerCalendarEvent,
  ownerId: string,
  asOf: string,
): void {
  const system: SourceSystem = "ae-jobs-calendar";
  const observedAt = ev.startDateTime || asOf;
  const prov = acc.addSource({
    sourceRecordId: sourceRecordId(system, "calendar_event", ev.eventId),
    sourceSystem: system,
    sourceType: "calendar_event",
    sourceId: ev.eventId,
    workspace: ownerId,
    payload: ev as unknown as Record<string, unknown>,
    observedAt,
  });

  const meeting = meetingNodeId(ev.eventId);
  acc.upsertNode({
    nodeId: meeting,
    nodeType: "meeting",
    label: `${ev.eventType}: ${ev.company}`,
    ownerScope: ownerId,
    canonicalKey: norm(ev.eventId),
    attributes: {
      company: ev.company,
      role: ev.role,
      eventType: ev.eventType,
      startDateTime: ev.startDateTime,
      endDateTime: ev.endDateTime,
      notes: ev.notes,
    },
    prov,
    observedAt,
  });
  acc.link({ handle: `calendar_event:${norm(ev.eventId)}`, handleKind: "calendar_event", nodeId: meeting, confidence: 100, resolvedBy: "projectCalendarEvent" });

  // self —ATTENDS→ meeting
  acc.upsertEdge({ src: SELF_NODE_ID, type: "ATTENDS", dst: meeting, prov, observedAt });

  // meeting —FOR_OPPORTUNITY→ opportunity (already-modeled link).
  if (ev.matchedOpportunityId) {
    acc.upsertEdge({
      src: meeting,
      type: "FOR_OPPORTUNITY",
      dst: opportunityNodeId(ev.matchedOpportunityId),
      prov,
      observedAt,
    });
  }
}

export function projectOutcome(
  acc: GraphAccumulator,
  outcome: ExecutionOutcome,
  ownerId: string,
  asOf: string,
): void {
  const system: SourceSystem = "execution-outcomes";
  const observedAt = outcome.occurredAt || outcome.recordedAt || asOf;
  const prov = acc.addSource({
    sourceRecordId: sourceRecordId(system, "outcome", outcome.eventId),
    sourceSystem: system,
    sourceType: "outcome",
    sourceId: outcome.eventId,
    workspace: outcome.workspace,
    payload: outcome as unknown as Record<string, unknown>,
    observedAt,
  });

  const node = outcomeNodeId(outcome.eventId);
  acc.upsertNode({
    nodeId: node,
    nodeType: "revenue_outcome",
    label: `${outcome.outcomeStatus} (${outcome.estimatedValue ?? 0})`,
    ownerScope: ownerId,
    canonicalKey: norm(outcome.eventId),
    attributes: {
      outcomeStatus: outcome.outcomeStatus,
      estimatedValue: outcome.estimatedValue,
      meridianInfluenced: outcome.meridianInfluenced,
      occurredAt: outcome.occurredAt,
    },
    prov,
    observedAt,
  });
  acc.link({ handle: `outcome:${norm(outcome.eventId)}`, handleKind: "outcome", nodeId: node, confidence: 100, resolvedBy: "projectOutcome" });

  // outcome —GENERATED_VALUE→ company (revenue attribution edge).
  if (outcome.companyKey) {
    const compNode = `company:${outcome.companyKey}`;
    acc.upsertNode({
      nodeId: compNode,
      nodeType: "company",
      label: outcome.companyKey,
      ownerScope: ownerId,
      canonicalKey: outcome.companyKey,
      attributes: { origin: "outcome" },
      prov,
      observedAt,
    });
    acc.upsertEdge({
      src: node,
      type: "GENERATED_VALUE",
      dst: compNode,
      attributes: { estimatedValue: outcome.estimatedValue ?? null },
      prov,
      observedAt,
    });
  }
}

/**
 * Project all supplied records into one deterministic graph. Inputs are sorted
 * by their natural id before processing so the result is independent of input
 * order (and therefore stable across runs).
 */
export function projectGraph(inputs: ProjectionInputs): GraphProjection {
  const ownerId = inputs.ownerId ?? SELF_OWNER;
  const asOf = inputs.asOf;
  const acc = new GraphAccumulator();

  ensureSelf(acc, ownerId, asOf);

  for (const c of [...(inputs.companies ?? [])].sort((a, b) => a.key.localeCompare(b.key))) {
    projectCompanySnapshot(acc, c, ownerId, asOf);
  }
  for (const o of [...(inputs.opportunities ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    projectOpportunity(acc, o, ownerId, asOf);
  }
  for (const p of [...(inputs.contacts ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    projectContact(acc, p, ownerId, asOf);
  }
  for (const e of [...(inputs.calendarEvents ?? [])].sort((a, b) => a.eventId.localeCompare(b.eventId))) {
    projectCalendarEvent(acc, e, ownerId, asOf);
  }
  for (const x of [...(inputs.outcomes ?? [])].sort((a, b) => a.eventId.localeCompare(b.eventId))) {
    projectOutcome(acc, x, ownerId, asOf);
  }

  return acc.build();
}
