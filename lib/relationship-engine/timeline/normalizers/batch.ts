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
  return {
    events: sortTimelineEvents(results.flatMap((result) => result.event ? [result.event] : [])),
    warnings: results.flatMap((result) => result.warnings),
  };
}
