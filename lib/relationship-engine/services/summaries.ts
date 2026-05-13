// Meridian Relationship Engine — relationship summary read service.

import type {
  RelationshipByIdReadRequest,
  RelationshipCollectionReadRequest,
  RelationshipEngineReadRepositories,
} from "./types";
import { RelationshipProjectionOrchestrationService } from "./projections";

export class RelationshipSummaryReadService {
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

  async getRelationshipSummaries(request: RelationshipCollectionReadRequest) {
    const set = await this.orchestration.getRelationshipReadModelSet(request);
    return set.summaries;
  }
}
