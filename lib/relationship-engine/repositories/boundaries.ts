// Meridian Relationship Engine — repository adapter boundaries.
//
// The first foundation pass prepares file/Neon/test adapters without choosing a
// write mode. Read-only adapters may list normalized projections; mutation
// methods remain behind repository interfaces and must be enabled deliberately
// in a future phase with migrations and fixture-backed tests.

import type { SourceCrmActivity, SourceExecutionOutcome, SourceFollowUpTask, SourceUsageEvent } from "../adapters/sourceTypes";
import type { WorkspaceId } from "../primitives";

export type RelationshipEngineStorageKind = "file" | "neon" | "memory" | "external";
export type RelationshipEngineRepositoryMode = "read_only" | "write_prepared";

export interface RepositoryAdapterCapabilities {
  storage: RelationshipEngineStorageKind;
  mode: RelationshipEngineRepositoryMode;
  canReadTimelineSources: boolean;
  canWriteRelationships: boolean;
  canAppendTimelineEvents: boolean;
  canWriteScores: boolean;
  canWriteQueueCandidates: boolean;
}

export interface ReadOnlyTimelineSourceAdapter {
  readonly capabilities: RepositoryAdapterCapabilities;
  listCrmActivities(workspaceId: WorkspaceId): Promise<SourceCrmActivity[]>;
  listFollowUpTasks(workspaceId: WorkspaceId): Promise<SourceFollowUpTask[]>;
  listUsageEvents(workspaceId: WorkspaceId): Promise<SourceUsageEvent[]>;
  listExecutionOutcomes(workspaceId: WorkspaceId): Promise<SourceExecutionOutcome[]>;
}

export const READ_ONLY_FILE_ADAPTER_CAPABILITIES: RepositoryAdapterCapabilities = {
  storage: "file",
  mode: "read_only",
  canReadTimelineSources: true,
  canWriteRelationships: false,
  canAppendTimelineEvents: false,
  canWriteScores: false,
  canWriteQueueCandidates: false,
};

export const READ_ONLY_NEON_ADAPTER_CAPABILITIES: RepositoryAdapterCapabilities = {
  storage: "neon",
  mode: "read_only",
  canReadTimelineSources: true,
  canWriteRelationships: false,
  canAppendTimelineEvents: false,
  canWriteScores: false,
  canWriteQueueCandidates: false,
};

export function assertReadOnlyCapabilities(capabilities: RepositoryAdapterCapabilities): void {
  const writesEnabled =
    capabilities.canWriteRelationships
    || capabilities.canAppendTimelineEvents
    || capabilities.canWriteScores
    || capabilities.canWriteQueueCandidates;
  if (capabilities.mode !== "read_only" || writesEnabled) {
    throw new Error("Relationship Engine foundation adapters must remain read-only.");
  }
}
