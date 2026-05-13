// Meridian Relationship Engine — centralized read-only timeline retrieval.

import type { RelationshipId } from "../primitives";
import { assertReadOnlyCapabilities } from "../repositories/boundaries";
import type { TimelineQuery } from "../repositories/interfaces";
import {
  dedupeTimelineEvents,
  normalizeTimelineSources,
  validateNormalizedEvents,
} from "../timeline/normalizers";
import type { TimelineEvent } from "../timeline/events";
import type {
  RelationshipCollectionReadRequest,
  RelationshipEngineReadRepositories,
  RelationshipTimelineMemory,
} from "./types";
import {
  collectPages,
  serviceWarning,
  validationResult,
} from "./validation";

export class RelationshipTimelineRetrievalService {
  private readonly repositories: RelationshipEngineReadRepositories;

  constructor(repositories: RelationshipEngineReadRepositories) {
    if (repositories.timelineSources) {
      assertReadOnlyCapabilities(repositories.timelineSources.capabilities);
    }
    this.repositories = repositories;
  }

  async getRelationshipTimelineMemory(
    request: RelationshipCollectionReadRequest & { relationshipIds: RelationshipId[] },
  ): Promise<RelationshipTimelineMemory> {
    const relationshipIds = stableRelationshipIds(request.relationshipIds);
    const repositoryEvents = await this.readRepositoryTimelineEvents(request, relationshipIds);
    const sourceTimeline = await this.readSourceTimelineEvents(request);
    const allowed = new Set<RelationshipId>(relationshipIds);
    const validation = validateNormalizedEvents([...repositoryEvents, ...sourceTimeline.events]
      .filter((event) => allowed.has(event.relationshipId)));
    const deduped = dedupeTimelineEvents(validation.events);
    const normalizationWarnings = [
      ...sourceTimeline.warnings,
      ...validation.warnings,
      ...deduped.warnings,
    ];
    const issues = normalizationWarnings.map((warning) => serviceWarning(
      "timeline_normalization_warning",
      warning.reason,
      { source: warning.source, timelineEventId: warning.sourceId as never },
    ));

    return {
      relationshipIds,
      timelineEvents: deduped.events,
      normalizationWarnings,
      validation: validationResult(issues),
    };
  }

  private async readRepositoryTimelineEvents(
    request: RelationshipCollectionReadRequest,
    relationshipIds: RelationshipId[],
  ): Promise<TimelineEvent[]> {
    if (!this.repositories.timeline) return [];

    const pages = await Promise.all(relationshipIds.map((relationshipId) =>
      collectPages<TimelineQuery, TimelineEvent>(
        (query) => this.repositories.timeline?.list(query) ?? Promise.resolve({ items: [] }),
        { relationshipId },
        {
          pageSize: request.options?.pageSize,
          maxPages: request.options?.maxPages,
        },
      )));

    return pages.flat();
  }

  private async readSourceTimelineEvents(
    request: RelationshipCollectionReadRequest,
  ): Promise<ReturnType<typeof normalizeTimelineSources>> {
    const adapter = this.repositories.timelineSources;
    if (!adapter) {
      return { events: [], warnings: [] };
    }

    const [
      crmActivities,
      followUpTasks,
      usageEvents,
      executionOutcomes,
    ] = await Promise.all([
      adapter.listCrmActivities(request.context.workspaceId),
      adapter.listFollowUpTasks(request.context.workspaceId),
      adapter.listUsageEvents(request.context.workspaceId),
      adapter.listExecutionOutcomes(request.context.workspaceId),
    ]);

    return normalizeTimelineSources({
      context: {
        now: request.context.now,
        workspaceId: request.context.workspaceId,
      },
      crmActivities,
      followUpTasks,
      usageEvents,
      executionOutcomes,
    });
  }
}

function stableRelationshipIds(relationshipIds: RelationshipId[]): RelationshipId[] {
  return [...new Set(relationshipIds)].sort((a, b) => a.localeCompare(b));
}
