// Meridian Relationship Engine — read-only data source readiness.
//
// This module inspects only the presence of existing source files. It does not
// open write handles or verify mutable stores.

import { existsSync } from "node:fs";
import path from "node:path";
import type { WorkspaceConfig } from "@/config/workspaces";
import type { RelationshipEngineRepositoryModeLabel } from "../services/diagnostics";

export interface RelationshipReadOnlyDataSourceState {
  ready: boolean;
  mode: Extract<
    RelationshipEngineRepositoryModeLabel,
    "read_only_file" | "read_only_snapshot"
  >;
  sources: {
    companySnapshots: boolean;
    crmActivities: boolean;
    usageEvents: boolean;
    executionOutcomes: boolean;
    followUps: boolean;
    operatorSnapshot: boolean;
  };
}

export function relationshipReadOnlyDataSourceState(
  workspace: WorkspaceConfig,
  dataDir = path.join(process.cwd(), "data"),
): RelationshipReadOnlyDataSourceState {
  const operatorSnapshot = existsSync(path.join(dataDir, "snapshots", `${safeFilePart(workspace.slug)}-operator.json`));
  const sources = {
    companySnapshots: existsSync(path.join(dataDir, "companySnapshots.json")),
    crmActivities: existsSync(path.join(dataDir, "crmActivities.json")),
    usageEvents: existsSync(path.join(dataDir, "usage-events.jsonl")),
    executionOutcomes: existsSync(path.join(dataDir, "executionOutcomes.json")),
    followUps: existsSync(path.join(dataDir, "followUps.json")),
    operatorSnapshot,
  };
  return {
    ready: Object.values(sources).some(Boolean),
    mode: operatorSnapshot ? "read_only_snapshot" : "read_only_file",
    sources,
  };
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
