// Meridian Relationship Engine — deterministic feed retrieval service.

import type {
  RelationshipCollectionReadRequest,
  RelationshipEngineReadRepositories,
} from "./types";
import { RelationshipProjectionOrchestrationService } from "./projections";

export class RelationshipFeedRetrievalService {
  private readonly orchestration: RelationshipProjectionOrchestrationService;

  constructor(
    repositories: RelationshipEngineReadRepositories,
    orchestration = new RelationshipProjectionOrchestrationService(repositories),
  ) {
    this.orchestration = orchestration;
  }

  getRelationshipFeeds(request: RelationshipCollectionReadRequest) {
    return this.orchestration.getRelationshipFeeds(request);
  }
}
