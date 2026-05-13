// Meridian Relationship Engine — API read-service construction.
//
// API routes must not know storage details. This module is the only app-layer
// place that binds authorized workspace context to the read-only service facade.

import type { WorkspaceConfig } from "@/config/workspaces";
import {
  createRelationshipEngineReadService,
  type RelationshipEngineRepositoryDiagnostics,
  type RelationshipEngineRepositoryModeLabel,
  type RelationshipEngineReadRepositories,
  type RelationshipEngineReadService,
} from "@/lib/relationship-engine";
import { createReadOnlyFileRelationshipAdapterBundle } from "@/lib/relationship-engine/repositories/readOnlyAdapters";
import { relationshipReadOnlyDataSourceState } from "@/lib/relationship-engine/repositories/readOnlyDataSources";

export type RelationshipEngineApiRepositoryMode = Extract<
  RelationshipEngineRepositoryModeLabel,
  "read_only_unwired" | "read_only_file" | "read_only_memory" | "read_only_snapshot"
>;

export interface RelationshipEngineReadServiceBinding {
  service: RelationshipEngineReadService;
  repositoryMode: RelationshipEngineApiRepositoryMode;
  diagnostics: RelationshipEngineRepositoryDiagnostics;
}

export function createRelationshipEngineReadServiceForWorkspace(
  workspace: WorkspaceConfig,
): RelationshipEngineReadServiceBinding {
  const sourceState = relationshipReadOnlyDataSourceState(workspace);
  if (sourceState.ready) {
    const bundle = createReadOnlyFileRelationshipAdapterBundle({
      workspaceId: workspace.id as never,
      workspaceSlug: workspace.slug,
    });
    return {
      service: createRelationshipEngineReadService(bundle.repositories),
      repositoryMode: sourceState.mode,
      diagnostics: readyDiagnostics(),
    };
  }

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

function readyDiagnostics(): RelationshipEngineRepositoryDiagnostics {
  return {
    relationshipStore: "ready",
    timelineStore: "ready",
    followUpStore: "ready",
    scoringStore: "ready",
    readOnly: true,
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
