// Meridian Relationship Engine — API read-service construction.
//
// API routes must not know storage details. This module is the only app-layer
// place that binds authorized workspace context to the read-only service facade.

import type { WorkspaceConfig } from "@/config/workspaces";
import {
  createRelationshipEngineReadService,
  type RelationshipEngineReadRepositories,
  type RelationshipEngineReadService,
} from "@/lib/relationship-engine";

export type RelationshipEngineApiRepositoryMode = "read_only_unwired";

export interface RelationshipEngineReadServiceBinding {
  service: RelationshipEngineReadService;
  repositoryMode: RelationshipEngineApiRepositoryMode;
  diagnostics: {
    relationshipStore: "unwired";
    timelineStore: "unwired";
    followUpStore: "unwired";
    scoringStore: "unwired";
    readOnly: true;
  };
}

export function createRelationshipEngineReadServiceForWorkspace(
  workspace: WorkspaceConfig,
): RelationshipEngineReadServiceBinding {
  void workspace;
  return {
    service: createRelationshipEngineReadService(createUnwiredReadOnlyRepositories()),
    repositoryMode: "read_only_unwired",
    diagnostics: {
      relationshipStore: "unwired",
      timelineStore: "unwired",
      followUpStore: "unwired",
      scoringStore: "unwired",
      readOnly: true,
    },
  };
}

function createUnwiredReadOnlyRepositories(): RelationshipEngineReadRepositories {
  return {
    relationships: {
      async getById() {
        return null;
      },
      async find() {
        return { items: [] };
      },
      async summarize() {
        return null;
      },
    },
    timeline: {
      async list() {
        return { items: [] };
      },
    },
    followUps: {
      async listOpenPromises() {
        return [];
      },
      async listDueInstructions() {
        return [];
      },
    },
    scoring: {
      async getLatestHealthTrace() {
        return null;
      },
      async listHealthTraces() {
        return { items: [] };
      },
    },
  };
}
