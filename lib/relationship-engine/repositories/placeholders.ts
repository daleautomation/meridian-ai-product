// Meridian Relationship Engine — safe repository placeholders.
//
// These placeholders make unsupported write paths fail loudly during
// integration. They are not production repositories and should be replaced by
// explicit file/Neon adapters only after migrations and read/write tests exist.

import type { ReadOnlyTimelineSourceAdapter, RepositoryAdapterCapabilities } from "./boundaries";
import { assertReadOnlyCapabilities } from "./boundaries";

export class RelationshipEngineMutationNotImplementedError extends Error {
  constructor(operation: string) {
    super(`${operation} is not implemented in the Relationship Engine foundation pass.`);
    this.name = "RelationshipEngineMutationNotImplementedError";
  }
}

export function createEmptyReadOnlyTimelineSourceAdapter(
  capabilities: RepositoryAdapterCapabilities,
): ReadOnlyTimelineSourceAdapter {
  assertReadOnlyCapabilities(capabilities);
  return {
    capabilities,
    async listCrmActivities() {
      return [];
    },
    async listFollowUpTasks() {
      return [];
    },
    async listUsageEvents() {
      return [];
    },
    async listExecutionOutcomes() {
      return [];
    },
  };
}

export function throwMutationNotImplemented(operation: string): never {
  throw new RelationshipEngineMutationNotImplementedError(operation);
}
