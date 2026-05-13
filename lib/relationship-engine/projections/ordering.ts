// Meridian Relationship Engine — deterministic projection ordering helpers.

import type { EvidenceRef, IsoDateString, OperatorId } from "../primitives";
import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import type { OperatorAssignment } from "../relationship/entities";
import type { TimelineEvent } from "../timeline/events";

export function sortProjectionTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.slice().sort(compareTimelineEvents);
}

export function compareTimelineEvents(a: TimelineEvent, b: TimelineEvent): number {
  return compareStrings(a.occurredAt, b.occurredAt)
    || compareStrings(a.recordedAt, b.recordedAt)
    || compareStrings(a.id, b.id);
}

export function sortProjectionPromises(promises: PromiseRecord[]): PromiseRecord[] {
  return promises.slice().sort((a, b) => {
    const due = compareOptionalIso(a.dueAt, b.dueAt);
    if (due !== 0) return due;
    return compareStrings(a.createdAt, b.createdAt)
      || compareStrings(a.id, b.id);
  });
}

export function sortProjectionFollowUps(instructions: FollowUpInstruction[]): FollowUpInstruction[] {
  return instructions.slice().sort((a, b) => {
    return compareStrings(a.dueAt, b.dueAt)
      || compareOptionalStrings(a.ownerId, b.ownerId)
      || compareStrings(a.reason, b.reason)
      || compareStrings(a.source, b.source);
  });
}

export function sortProjectionAssignments(assignments: OperatorAssignment[]): OperatorAssignment[] {
  return assignments.slice().sort((a, b) => {
    const visibility = visibilityRank(a.visibility) - visibilityRank(b.visibility);
    if (visibility !== 0) return visibility;
    return compareStrings(b.assignedAt, a.assignedAt)
      || compareStrings(a.ownerId, b.ownerId);
  });
}

export function sortProjectionEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  return evidence.slice().sort((a, b) => {
    return compareStrings(a.observedAt, b.observedAt)
      || compareStrings(a.source, b.source)
      || compareStrings(a.id, b.id);
  });
}

export function uniqueOperators(ids: OperatorId[]): OperatorId[] {
  return [...new Set(ids)].sort(compareStrings);
}

export function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort(compareStrings);
}

export function latestByProjectionOrder<T>(items: T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}

export function isBeforeIso(value: IsoDateString | undefined, now: IsoDateString): boolean {
  return Boolean(value && value < now);
}

function compareOptionalIso(a: IsoDateString | undefined, b: IsoDateString | undefined): number {
  if (a && b) return compareStrings(a, b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function compareOptionalStrings(a: string | undefined, b: string | undefined): number {
  if (a && b) return compareStrings(a, b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function visibilityRank(value: OperatorAssignment["visibility"]): number {
  switch (value) {
    case "primary_owner":
      return 0;
    case "collaborator":
      return 1;
    case "observer":
      return 2;
  }
}
