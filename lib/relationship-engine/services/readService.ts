// Meridian Relationship Engine — read-only facade.

import {
  projectRelationshipTimeline,
} from "../projections";
import type {
  RelationshipByIdReadRequest,
  RelationshipCollectionReadRequest,
  RelationshipEngineReadRepositories,
} from "./types";
import { RelationshipProjectionOrchestrationService } from "./projections";
import { readModelValidationIssues, serviceResult } from "./validation";

export class RelationshipEngineReadService {
  private readonly orchestration: RelationshipProjectionOrchestrationService;

  constructor(
    repositories: RelationshipEngineReadRepositories,
    orchestration = new RelationshipProjectionOrchestrationService(repositories),
  ) {
    this.orchestration = orchestration;
  }

  getRelationshipSummary(request: RelationshipByIdReadRequest) {
    return this.orchestration.getRelationshipSummaryProjection(request);
  }

  async getRelationshipTimeline(request: RelationshipByIdReadRequest) {
    const set = await this.orchestration.getRelationshipReadModelSet({
      context: request.context,
      relationshipIds: [request.relationshipId],
      options: request.options,
    });
    const summary = set.summaries[0];
    if (!summary) {
      throw new Error(`Relationship ${request.relationshipId} was not found.`);
    }
    const timeline = projectRelationshipTimeline({
      context: request.context,
      summaries: set.summaries,
      timelineEvents: set.timelineEvents,
      promises: set.promises,
      followUpInstructions: set.followUpInstructions,
      healthTraces: set.healthTraces,
      relationshipId: request.relationshipId,
      staleTimelineAfterDays: request.options?.staleTimelineAfterDays,
      staleProjectionAfterHours: request.options?.staleProjectionAfterHours,
    });
    const issues = [
      ...set.validation.issues,
      ...readModelValidationIssues(timeline.validation),
    ];
    return serviceResult({
      data: timeline,
      generatedAt: request.context.now,
      issues,
      warnings: issues.filter((issue) => issue.severity === "warning"),
      confidence: summary.explanation.confidence,
      evidence: timeline.latestEvidence,
      missingDataEffects: timeline.missingDataEffects,
    });
  }

  getRelationshipFeeds(request: RelationshipCollectionReadRequest) {
    return this.orchestration.getRelationshipFeeds(request);
  }

  getRelationshipQueues(request: RelationshipCollectionReadRequest) {
    return this.orchestration.getRelationshipQueues(request);
  }

  getRelationshipProjection(request: RelationshipByIdReadRequest) {
    return this.orchestration.getRelationshipProjection(request);
  }
}

export function createRelationshipEngineReadService(
  repositories: RelationshipEngineReadRepositories,
): RelationshipEngineReadService {
  return new RelationshipEngineReadService(repositories);
}
