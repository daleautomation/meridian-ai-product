// Meridian Relationship Engine — timeline normalization primitives.
//
// Normalizers are pure projection code: they read legacy facts, produce
// canonical TimelineEvent objects, and never call repositories or mutate
// source systems. Future fixture tests should live beside these modules and
// assert stable IDs, dedupe keys, evidence, timestamps, and category/type pairs.

import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  OperatorId,
  OutcomeId,
  RelationshipId,
  TimelineEventId,
  TouchpointId,
} from "../../primitives";
import type { TimelineEvent, TimelineEventSource } from "../events";
import type {
  SourceRelationshipRef,
  TimelineNormalizationContext,
  TimelineNormalizationWarning,
  TimelineSourceKind,
} from "../../adapters/sourceTypes";

export const UNKNOWN_OCCURRED_AT = "1970-01-01T00:00:00.000Z" as IsoDateString;

export interface TimelineNormalizationResult<T extends TimelineEvent = TimelineEvent> {
  event: T | null;
  warnings: TimelineNormalizationWarning[];
}

export interface BaseTimelineParts {
  source: TimelineSourceKind;
  sourceId: string;
  relationshipId: RelationshipId;
  occurredAt: IsoDateString;
  recordedAt: IsoDateString;
  timelineSource: TimelineEventSource;
  actorId?: OperatorId | "system";
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
  dedupeKey: string;
}

export function emptyNormalizationResult(
  source: TimelineSourceKind,
  sourceId: string,
  reason: string,
): TimelineNormalizationResult {
  return {
    event: null,
    warnings: [{ source, sourceId, reason }],
  };
}

export function asIsoDateString(value: string): IsoDateString {
  return value as IsoDateString;
}

export function asOperatorId(value: string): OperatorId {
  return value as OperatorId;
}

export function asRelationshipId(value: string): RelationshipId {
  return value as RelationshipId;
}

export function asTimelineEventId(value: string): TimelineEventId {
  return value as TimelineEventId;
}

export function asTouchpointId(value: string): TouchpointId {
  return value as TouchpointId;
}

export function asOutcomeId(value: string): OutcomeId {
  return value as OutcomeId;
}

export function normalizeIsoTimestamp(
  value: string | null | undefined,
  fallback: string,
): IsoDateString {
  const candidate = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return asIsoDateString(fallback);
  return asIsoDateString(date.toISOString());
}

export function normalizeOptionalIsoTimestamp(value: string | null | undefined): IsoDateString | undefined {
  if (!isValidTimestampInput(value)) return undefined;
  return asIsoDateString(new Date(value).toISOString());
}

export function isValidTimestampInput(value: string | null | undefined): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function relationshipIdFromSource(ref: SourceRelationshipRef): RelationshipId {
  if (ref.relationshipId && ref.relationshipId.trim().length > 0) {
    return asRelationshipId(ref.relationshipId.trim());
  }
  const workspace = clean(ref.workspace) ?? "default";
  const identity =
    clean(ref.crmKey)
    ?? clean(ref.companyKey)
    ?? clean(ref.leadId)
    ?? clean(ref.taskId)
    ?? clean(ref.companyName)
    ?? "unknown";
  return asRelationshipId(`relationship:${workspace}:${identity}`);
}

export function stableTimelineEventId(parts: Array<string | null | undefined>): TimelineEventId {
  return asTimelineEventId(`timeline:${stableHash(parts)}`);
}

export function stableDedupeKey(parts: Array<string | null | undefined>): string {
  return `relationship-engine:${stableHash(parts)}`;
}

export function makeEvidenceRef(input: {
  source: string;
  sourceId: string;
  label: string;
  observedAt: IsoDateString;
  confidence?: ConfidenceLevel;
  value?: string | number | boolean;
  notes?: string;
  url?: string;
}): EvidenceRef {
  return {
    id: `evidence:${stableHash([input.source, input.sourceId, input.label])}`,
    source: input.source,
    label: input.label,
    ...(input.value === undefined ? {} : { value: input.value }),
    observedAt: input.observedAt,
    confidence: input.confidence ?? "medium",
    ...(input.url ? { url: input.url } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

export function baseTimelineParts(input: {
  source: TimelineSourceKind;
  sourceId: string;
  sourceRef: SourceRelationshipRef;
  context: TimelineNormalizationContext;
  occurredAt?: string | null;
  recordedAt?: string | null;
  actorId?: string | null;
  confidence?: ConfidenceLevel;
  evidenceLabel: string;
  evidenceValue?: string | number | boolean;
  evidenceNotes?: string;
}): BaseTimelineParts {
  const fallbackRecordedAt = input.context.defaultRecordedAt ?? input.context.now;
  const occurredAtFallback = normalizeOptionalIsoTimestamp(input.recordedAt) ?? UNKNOWN_OCCURRED_AT;
  const occurredAt = normalizeIsoTimestamp(input.occurredAt, occurredAtFallback);
  const recordedAtFallback =
    normalizeOptionalIsoTimestamp(input.recordedAt)
    ?? normalizeOptionalIsoTimestamp(input.occurredAt)
    ?? fallbackRecordedAt;
  const recordedAt = normalizeIsoTimestamp(input.recordedAt, recordedAtFallback);
  const relationshipId = relationshipIdFromSource({
    ...input.sourceRef,
    workspace: input.sourceRef.workspace ?? input.context.workspaceId,
  });
  const confidence = input.confidence ?? defaultTimelineConfidence({
    sourceRef: input.sourceRef,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
  });
  const dedupeKey = stableDedupeKey([
    input.source,
    input.sourceId,
    relationshipId,
    occurredAt,
  ]);
  return {
    source: input.source,
    sourceId: input.sourceId,
    relationshipId,
    occurredAt,
    recordedAt,
    timelineSource: "integration",
    ...(input.actorId ? { actorId: asOperatorId(input.actorId) } : {}),
    evidence: [
      makeEvidenceRef({
        source: input.source,
        sourceId: input.sourceId,
        label: input.evidenceLabel,
        observedAt: occurredAt,
        confidence,
        value: input.evidenceValue,
        notes: input.evidenceNotes,
      }),
    ],
    confidence,
    dedupeKey,
  };
}

export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.slice().sort((a, b) => {
    const occurred = a.occurredAt.localeCompare(b.occurredAt);
    if (occurred !== 0) return occurred;
    return a.id.localeCompare(b.id);
  });
}

export function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function defaultTimelineConfidence(input: {
  sourceRef: SourceRelationshipRef;
  occurredAt?: string | null;
  recordedAt?: string | null;
}): ConfidenceLevel {
  const hasStableIdentity = Boolean(
    clean(input.sourceRef.relationshipId)
    ?? clean(input.sourceRef.crmKey)
    ?? clean(input.sourceRef.companyKey)
    ?? clean(input.sourceRef.leadId)
    ?? clean(input.sourceRef.taskId)
    ?? clean(input.sourceRef.companyName),
  );
  const hasUsableEventTime =
    isValidTimestampInput(input.occurredAt)
    || isValidTimestampInput(input.recordedAt);
  return hasStableIdentity && hasUsableEventTime ? "medium" : "low";
}

function stableHash(parts: Array<string | null | undefined>): string {
  const input = parts.map((part) => part ?? "").join("|");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
