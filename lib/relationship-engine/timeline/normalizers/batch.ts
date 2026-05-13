// Meridian Relationship Engine — batch timeline normalization entrypoint.
//
// This is the shadow-mode composition point for read-only projections. It
// normalizes each source independently, keeps warnings visible, and sorts the
// resulting events deterministically without writing them anywhere.

import type {
  SourceCrmActivity,
  SourceExecutionOutcome,
  SourceFollowUpTask,
  SourceUsageEvent,
  TimelineNormalizationContext,
  TimelineNormalizationWarning,
} from "../../adapters/sourceTypes";
import type { TimelineEvent } from "../events";
import { validateTimelineEventIntegrity } from "../validation";
import { normalizeCrmActivityToTimelineEvent } from "./crmActivity";
import { normalizeExecutionOutcomeToTimelineEvent } from "./executionOutcome";
import { normalizeFollowUpTaskToTimelineEvent } from "./followUpTask";
import { sortTimelineEvents, type TimelineNormalizationResult } from "./common";
import { normalizeUsageEventToTimelineEvent } from "./usageEvent";

export interface TimelineNormalizationBatchInput {
  context: TimelineNormalizationContext;
  crmActivities?: SourceCrmActivity[];
  followUpTasks?: SourceFollowUpTask[];
  usageEvents?: SourceUsageEvent[];
  executionOutcomes?: SourceExecutionOutcome[];
}

export interface TimelineNormalizationBatchResult {
  events: TimelineEvent[];
  warnings: TimelineNormalizationWarning[];
}

export interface TimelineDedupeResult {
  events: TimelineEvent[];
  warnings: TimelineNormalizationWarning[];
}

export function normalizeTimelineSources(
  input: TimelineNormalizationBatchInput,
): TimelineNormalizationBatchResult {
  const results: TimelineNormalizationResult[] = [
    ...(input.crmActivities ?? []).map((activity) =>
      normalizeCrmActivityToTimelineEvent(activity, input.context)),
    ...(input.followUpTasks ?? []).map((task) =>
      normalizeFollowUpTaskToTimelineEvent(task, input.context)),
    ...(input.usageEvents ?? []).map((event) =>
      normalizeUsageEventToTimelineEvent(event, input.context)),
    ...(input.executionOutcomes ?? []).map((outcome) =>
      normalizeExecutionOutcomeToTimelineEvent(outcome, input.context)),
  ];
  const validation = validateNormalizedEvents(
    results.flatMap((result) => result.event ? [result.event] : []),
  );
  const deduped = dedupeTimelineEvents(validation.events);
  return {
    events: deduped.events,
    warnings: [
      ...results.flatMap((result) => result.warnings),
      ...validation.warnings,
      ...deduped.warnings,
    ],
  };
}

export function validateNormalizedEvents(events: TimelineEvent[]): TimelineDedupeResult {
  const accepted: TimelineEvent[] = [];
  const warnings: TimelineNormalizationWarning[] = [];

  for (const event of events) {
    const validation = validateTimelineEventIntegrity(event);
    warnings.push(...validation.issues.map((issue) => ({
      source: "timeline_event" as const,
      sourceId: event.id,
      reason: `${issue.severity}:${issue.code}: ${issue.message}`,
    })));
    if (validation.ok) {
      accepted.push(event);
    }
  }

  return {
    events: sortTimelineEvents(accepted),
    warnings,
  };
}

export function dedupeTimelineEvents(events: TimelineEvent[]): TimelineDedupeResult {
  const warnings: TimelineNormalizationWarning[] = [];
  const byKey = new Map<string, TimelineEvent>();

  for (const event of sortTimelineEvents(events)) {
    const key = event.dedupeKey ?? event.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      continue;
    }

    warnings.push({
      source: "timeline_event",
      sourceId: event.id,
      reason: existing.id === event.id
        ? `duplicate_event: discarded duplicate import for dedupeKey ${key}.`
        : `dedupe_conflict: discarded ${event.id}; ${existing.id} already owns dedupeKey ${key}.`,
    });
  }

  return {
    events: sortTimelineEvents([...byKey.values()]),
    warnings,
  };
}
