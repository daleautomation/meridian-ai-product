// Meridian Relationship Engine — read-only facade.

import {
  projectRelationshipTimeline,
} from "../projections";
import {
  projectRelationshipWorkflowIntegration,
  type RelationshipWorkflowIssue,
} from "../workflowIntegration";
import type {
  RelationshipByIdReadRequest,
  RelationshipCollectionReadRequest,
  RelationshipEngineReadRepositories,
  RelationshipServiceIssue,
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

  async getRelationshipWorkflowContext(request: RelationshipCollectionReadRequest) {
    const [queuesResult, feedsResult] = await Promise.all([
      this.getRelationshipQueues(request),
      this.getRelationshipFeeds(request),
    ]);
    const workflow = projectRelationshipWorkflowIntegration({
      generatedAt: request.context.now,
      queues: Object.values(queuesResult.data),
      feeds: Object.values(feedsResult.data),
    });
    const workflowIssues = workflow.validation.issues.map(workflowIssueToServiceIssue);
    const issues = [
      ...queuesResult.validation.issues,
      ...feedsResult.validation.issues,
      ...workflowIssues,
    ];
    return serviceResult({
      data: workflow,
      generatedAt: request.context.now,
      issues,
      warnings: issues.filter((issue) => issue.severity === "warning"),
      confidence: workflow.metadata.confidence,
      evidence: workflow.relationshipSummaries.flatMap((summary) => summary.whyNow.evidenceReferences),
      missingDataEffects: workflow.metadata.missingDataEffects,
    });
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

function workflowIssueToServiceIssue(issue: RelationshipWorkflowIssue): RelationshipServiceIssue {
  return {
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    ...(issue.relationshipId ? { relationshipId: issue.relationshipId } : {}),
    ...(issue.groupKind ? { source: `relationship_workflow:${issue.groupKind}` } : { source: "relationship_workflow" }),
  };
}
