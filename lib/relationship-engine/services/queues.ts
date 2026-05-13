// Meridian Relationship Engine — deterministic queue retrieval service.

import type {
  RelationshipCollectionReadRequest,
  RelationshipEngineReadRepositories,
} from "./types";
import { RelationshipProjectionOrchestrationService } from "./projections";

export class RelationshipQueueRetrievalService {
  private readonly orchestration: RelationshipProjectionOrchestrationService;

  constructor(
    repositories: RelationshipEngineReadRepositories,
    orchestration = new RelationshipProjectionOrchestrationService(repositories),
  ) {
    this.orchestration = orchestration;
  }

  getRelationshipQueues(request: RelationshipCollectionReadRequest) {
    return this.orchestration.getRelationshipQueues(request);
  }
}
