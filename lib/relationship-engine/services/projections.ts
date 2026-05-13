// Meridian Relationship Engine — repository-backed projection orchestration.

import {
  projectAllRelationshipFeeds,
  projectAllRelationshipQueues,
  projectRelationshipSummary,
  projectRelationshipTimeline,
} from "../projections";
import {
  sortProjectionFollowUps,
  sortProjectionPromises,
  sortProjectionTimelineEvents,
} from "../projections/ordering";
import type { RelationshipQuery } from "../repositories/interfaces";
import type { RelationshipEntity } from "../relationship/entities";
import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import type {
  RelationshipByIdReadRequest,
  RelationshipCanonicalReadSet,
  RelationshipCollectionReadRequest,
  RelationshipEngineReadRepositories,
  RelationshipFeedProjectionSet,
  RelationshipProjectionBundle,
  RelationshipQueueProjectionSet,
  RelationshipReadModelCanonicalSet,
  RelationshipServiceIssue,
  RelationshipServiceReadResult,
} from "./types";
import { RelationshipTimelineRetrievalService } from "./timeline";
import {
  DEFAULT_FOLLOW_UP_LOOKAHEAD_DAYS,
  addDays,
  collectPages,
  combineServiceConfidence,
  readModelValidationIssues,
  serviceError,
  serviceResult,
  serviceWarning,
  summaryValidationIssues,
  validationResult,
} from "./validation";

export class RelationshipProjectionOrchestrationService {
  private readonly repositories: RelationshipEngineReadRepositories;
  private readonly timelineService: RelationshipTimelineRetrievalService;

  constructor(
    repositories: RelationshipEngineReadRepositories,
    timelineService = new RelationshipTimelineRetrievalService(repositories),
  ) {
    this.repositories = repositories;
    this.timelineService = timelineService;
  }

  async getRelationshipReadSet(request: RelationshipByIdReadRequest): Promise<RelationshipCanonicalReadSet> {
    const relationship = await this.repositories.relationships.getById(request.relationshipId);
    if (!relationship) {
      throw new Error(`Relationship ${request.relationshipId} was not found.`);
    }
    const set = await this.getRelationshipReadModelSet({
      context: request.context,
      relationshipIds: [request.relationshipId],
      options: request.options,
    });
    return {
      relationship,
      timelineEvents: set.timelineEvents,
      promises: set.promises,
      followUpInstructions: set.followUpInstructions,
      healthTrace: set.healthTraces.find((trace) => trace.relationshipId === request.relationshipId) ?? null,
      warnings: set.warnings,
    };
  }

  async getRelationshipReadModelSet(
    request: RelationshipCollectionReadRequest,
  ): Promise<RelationshipReadModelCanonicalSet> {
    const relationships = await this.readRelationships(request);
    const relationshipIds = relationships.map((relationship) => relationship.id);
    const timelineMemory = await this.timelineService.getRelationshipTimelineMemory({
      ...request,
      relationshipIds,
    });
    const [promises, followUpInstructions, healthTraces] = await Promise.all([
      this.readPromises(relationshipIds),
      this.readFollowUpInstructions(request, relationshipIds),
      this.readHealthTraces(relationshipIds),
    ]);
    const summaries = relationships.map((relationship) => projectRelationshipSummary({
      context: request.context,
      relationship,
      timelineEvents: timelineMemory.timelineEvents.filter((event) => event.relationshipId === relationship.id),
      promises: promises.filter((promise) => promise.relationshipId === relationship.id),
      followUpInstructions: followUpInstructions.filter((instruction) => instruction.relationshipId === relationship.id),
      healthTrace: healthTraces.find((trace) => trace.relationshipId === relationship.id) ?? null,
      staleTimelineAfterDays: request.options?.staleTimelineAfterDays,
    }));
    const summaryIssues = summaries.flatMap((summary) =>
      summaryValidationIssues(summary.validation).map((issue) => ({
        ...issue,
        relationshipId: summary.relationshipId,
      })));
    const issues = [
      ...timelineMemory.validation.issues,
      ...summaryIssues,
    ];

    return {
      relationships,
      summaries,
      timelineEvents: sortProjectionTimelineEvents(timelineMemory.timelineEvents),
      promises,
      followUpInstructions,
      healthTraces,
      warnings: issues.filter((issue) => issue.severity === "warning"),
      validation: validationResult(issues),
    };
  }

  async getRelationshipSummaryProjection(
    request: RelationshipByIdReadRequest,
  ): Promise<RelationshipServiceReadResult<RelationshipReadModelCanonicalSet["summaries"][number]>> {
    const set = await this.getRelationshipReadModelSet({
      context: request.context,
      relationshipIds: [request.relationshipId],
      options: request.options,
    });
    const summary = set.summaries[0];
    if (!summary) {
      throw new Error(`Relationship ${request.relationshipId} was not found.`);
    }
    return serviceResult({
      data: summary,
      generatedAt: request.context.now,
      issues: set.validation.issues,
      warnings: set.warnings,
      confidence: summary.explanation.confidence,
      evidence: summary.explanation.latestEvidence,
      missingDataEffects: summary.explanation.missingDataEffects,
    });
  }

  async getRelationshipFeeds(
    request: RelationshipCollectionReadRequest,
  ): Promise<RelationshipServiceReadResult<RelationshipFeedProjectionSet>> {
    const set = await this.getRelationshipReadModelSet(request);
    const feeds = projectAllRelationshipFeeds(this.readModelInput(request, set), request.query?.ownerId
      ? { operatorId: request.query.ownerId }
      : {});
    const issues = [
      ...set.validation.issues,
      ...Object.values(feeds).flatMap((feed) => readModelValidationIssues(feed.validation)),
    ];
    return serviceResult({
      data: feeds,
      generatedAt: request.context.now,
      issues,
      warnings: issues.filter((issue) => issue.severity === "warning"),
      confidence: combineServiceConfidence(set.summaries.map((summary) => summary.explanation.confidence)),
      evidence: set.summaries.flatMap((summary) => summary.explanation.latestEvidence),
      missingDataEffects: set.summaries.flatMap((summary) => summary.explanation.missingDataEffects),
    });
  }

  async getRelationshipQueues(
    request: RelationshipCollectionReadRequest,
  ): Promise<RelationshipServiceReadResult<RelationshipQueueProjectionSet>> {
    const set = await this.getRelationshipReadModelSet(request);
    const queues = projectAllRelationshipQueues(this.readModelInput(request, set));
    const issues = [
      ...set.validation.issues,
      ...Object.values(queues).flatMap((queue) => readModelValidationIssues(queue.validation)),
    ];
    return serviceResult({
      data: queues,
      generatedAt: request.context.now,
      issues,
      warnings: issues.filter((issue) => issue.severity === "warning"),
      confidence: combineServiceConfidence(set.summaries.map((summary) => summary.explanation.confidence)),
      evidence: set.summaries.flatMap((summary) => summary.explanation.latestEvidence),
      missingDataEffects: set.summaries.flatMap((summary) => summary.explanation.missingDataEffects),
    });
  }

  async getRelationshipProjection(
    request: RelationshipByIdReadRequest,
  ): Promise<RelationshipServiceReadResult<RelationshipProjectionBundle>> {
    const set = await this.getRelationshipReadModelSet({
      context: request.context,
      relationshipIds: [request.relationshipId],
      options: request.options,
    });
    const summary = set.summaries[0];
    if (!summary) {
      throw new Error(`Relationship ${request.relationshipId} was not found.`);
    }
    const input = this.readModelInput(request, set);
    const timeline = projectRelationshipTimeline({ ...input, relationshipId: request.relationshipId });
    const feeds = projectAllRelationshipFeeds(input);
    const queues = projectAllRelationshipQueues(input);
    const issues: RelationshipServiceIssue[] = [
      ...set.validation.issues,
      ...readModelValidationIssues(timeline.validation),
      ...Object.values(feeds).flatMap((feed) => readModelValidationIssues(feed.validation)),
      ...Object.values(queues).flatMap((queue) => readModelValidationIssues(queue.validation)),
    ];

    return serviceResult({
      data: { summary, timeline, feeds, queues },
      generatedAt: request.context.now,
      issues,
      warnings: issues.filter((issue) => issue.severity === "warning"),
      confidence: summary.explanation.confidence,
      evidence: summary.explanation.latestEvidence,
      missingDataEffects: summary.explanation.missingDataEffects,
    });
  }

  private async readRelationships(request: RelationshipCollectionReadRequest): Promise<RelationshipEntity[]> {
    if (request.relationshipIds && request.relationshipIds.length > 0) {
      const relationships = await Promise.all([...new Set(request.relationshipIds)]
        .sort((a, b) => a.localeCompare(b))
        .map(async (relationshipId) => {
          const relationship = await this.repositories.relationships.getById(relationshipId);
          if (!relationship) {
            throw new Error(`Relationship ${relationshipId} was not found.`);
          }
          return relationship;
        }));
      return relationships;
    }

    return collectPages<RelationshipQuery, RelationshipEntity>(
      (query) => this.repositories.relationships.find(query),
      {
        workspaceId: request.context.workspaceId,
        ...(request.query?.lifecycle ? { lifecycle: request.query.lifecycle } : {}),
        ...(request.query?.ownerId ? { ownerId: request.query.ownerId } : {}),
        ...(request.query?.updatedAfter ? { updatedAfter: request.query.updatedAfter } : {}),
      },
      {
        page: request.page,
        pageSize: request.options?.pageSize,
        maxPages: request.options?.maxPages,
      },
    ).then((relationships) => relationships.sort((a, b) => a.id.localeCompare(b.id)));
  }

  private async readPromises(relationshipIds: RelationshipEntity["id"][]): Promise<PromiseRecord[]> {
    if (!this.repositories.followUps) return [];
    const promises = await Promise.all(relationshipIds.map((relationshipId) =>
      this.repositories.followUps?.listOpenPromises(relationshipId) ?? Promise.resolve([])));
    return sortProjectionPromises(promises.flat());
  }

  private async readFollowUpInstructions(
    request: RelationshipCollectionReadRequest,
    relationshipIds: RelationshipEntity["id"][],
  ): Promise<FollowUpInstruction[]> {
    if (!this.repositories.followUps || relationshipIds.length === 0) return [];
    const relationshipIdSet = new Set(relationshipIds);
    const dueBefore = request.options?.followUpDueBefore
      ?? addDays(request.context.now, request.options?.followUpLookaheadDays ?? DEFAULT_FOLLOW_UP_LOOKAHEAD_DAYS);
    const instructions = await this.repositories.followUps.listDueInstructions({
      workspaceId: request.context.workspaceId,
      dueBefore,
      ...(request.query?.ownerId ? { ownerId: request.query.ownerId } : {}),
    });
    return sortProjectionFollowUps(instructions.filter((instruction) => relationshipIdSet.has(instruction.relationshipId)));
  }

  private async readHealthTraces(relationshipIds: RelationshipEntity["id"][]): Promise<HealthScoreTrace[]> {
    if (!this.repositories.scoring) return [];
    const traces = await Promise.all(relationshipIds.map((relationshipId) =>
      this.repositories.scoring?.getLatestHealthTrace(relationshipId) ?? Promise.resolve(null)));
    return traces
      .filter((trace): trace is HealthScoreTrace => Boolean(trace))
      .sort((a, b) => a.relationshipId.localeCompare(b.relationshipId) || a.computedAt.localeCompare(b.computedAt));
  }

  private readModelInput(
    request: RelationshipCollectionReadRequest | RelationshipByIdReadRequest,
    set: RelationshipReadModelCanonicalSet,
  ) {
    return {
      context: request.context,
      summaries: set.summaries,
      timelineEvents: set.timelineEvents,
      promises: set.promises,
      followUpInstructions: set.followUpInstructions,
      healthTraces: set.healthTraces,
      staleTimelineAfterDays: request.options?.staleTimelineAfterDays,
      staleProjectionAfterHours: request.options?.staleProjectionAfterHours,
    };
  }
}

export function relationshipServiceUnavailableWarning(source: string): RelationshipServiceIssue {
  return serviceWarning(
    "relationship_service_source_unavailable",
    `${source} repository was not provided; projections will expose related missing-data effects.`,
    { source },
  );
}

export function relationshipServiceInvariantError(message: string): RelationshipServiceIssue {
  return serviceError("relationship_service_invariant_failed", message);
}
