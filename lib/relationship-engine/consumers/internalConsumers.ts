// Meridian Relationship Engine — internal consumer integration boundaries.
//
// These contracts describe how future internal surfaces may consume engine
// observability without importing repositories or enabling writes.

import type {
  RelationshipEngineDiagnosticsRequest,
  RelationshipEngineDiagnosticsResult,
  RelationshipEngineDiagnosticsService,
  RelationshipEngineHealthModel,
} from "../services/diagnostics";

export type RelationshipEngineInternalConsumerKind =
  | "operator_workspace"
  | "future_admin_dashboard"
  | "future_mcp_tooling"
  | "future_diagnostics_panel";

export type RelationshipEngineConsumerIntegrationMode = "api" | "service_facade";

export interface RelationshipEngineInternalConsumerBoundary {
  kind: RelationshipEngineInternalConsumerKind;
  integrationMode: RelationshipEngineConsumerIntegrationMode;
  allowedSurface: "internal_admin_api" | "relationship_engine_service_facade";
  repositoriesAllowed: false;
  writesAllowed: false;
  queueExecutionAllowed: false;
  automationAllowed: false;
  rawInternalsAllowed: false;
  notes: string[];
}

export interface RelationshipEngineInternalObservabilityConsumer {
  kind: RelationshipEngineInternalConsumerKind;
  getHealth(): Promise<RelationshipEngineHealthModel>;
  getDiagnostics(): Promise<RelationshipEngineDiagnosticsResult>;
  getValidation(): Promise<RelationshipEngineDiagnosticsResult["metadata"]>;
}

export const RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES: readonly RelationshipEngineInternalConsumerBoundary[] = [
  boundary("operator_workspace", "service_facade", "relationship_engine_service_facade", [
    "Operator workspace may render health metadata, but must not derive relationship state or import repositories.",
  ]),
  boundary("future_admin_dashboard", "api", "internal_admin_api", [
    "Admin dashboard should call internal admin endpoints and display metadata-only diagnostics.",
  ]),
  boundary("future_mcp_tooling", "api", "internal_admin_api", [
    "MCP tooling may inspect diagnostics metadata and must keep queue items review-only.",
  ]),
  boundary("future_diagnostics_panel", "service_facade", "relationship_engine_service_facade", [
    "Diagnostics panels may consume the facade-backed diagnostics service in server-only code.",
  ]),
];

export function assertRelationshipEngineConsumerBoundary(kind: RelationshipEngineInternalConsumerKind): void {
  const boundaryConfig = RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES.find((item) => item.kind === kind);
  if (!boundaryConfig) {
    throw new Error(`Unknown Relationship Engine internal consumer boundary: ${kind}`);
  }
  if (
    boundaryConfig.repositoriesAllowed
    || boundaryConfig.writesAllowed
    || boundaryConfig.queueExecutionAllowed
    || boundaryConfig.automationAllowed
    || boundaryConfig.rawInternalsAllowed
  ) {
    throw new Error(`Unsafe Relationship Engine consumer boundary: ${kind}`);
  }
}

export function createRelationshipEngineFacadeDiagnosticsConsumer(args: {
  kind: Extract<RelationshipEngineInternalConsumerKind, "operator_workspace" | "future_diagnostics_panel">;
  diagnosticsService: RelationshipEngineDiagnosticsService;
  request: RelationshipEngineDiagnosticsRequest;
}): RelationshipEngineInternalObservabilityConsumer {
  assertRelationshipEngineConsumerBoundary(args.kind);
  return {
    kind: args.kind,
    async getHealth() {
      return (await args.diagnosticsService.getDiagnostics(args.request)).health;
    },
    getDiagnostics() {
      return args.diagnosticsService.getDiagnostics(args.request);
    },
    async getValidation() {
      return (await args.diagnosticsService.getDiagnostics(args.request)).metadata;
    },
  };
}

export function createRelationshipEngineApiDiagnosticsConsumer(args: {
  kind: Extract<RelationshipEngineInternalConsumerKind, "future_admin_dashboard" | "future_mcp_tooling">;
  baseUrl: string;
  fetcher?: typeof fetch;
}): RelationshipEngineInternalObservabilityConsumer {
  assertRelationshipEngineConsumerBoundary(args.kind);
  const fetcher = args.fetcher ?? fetch;
  return {
    kind: args.kind,
    async getHealth() {
      return (await getJson<{ data: RelationshipEngineHealthModel }>(fetcher, args.baseUrl, "health")).data;
    },
    async getDiagnostics() {
      return (await getJson<{ data: RelationshipEngineDiagnosticsResult }>(fetcher, args.baseUrl, "diagnostics")).data;
    },
    async getValidation() {
      return (await getJson<{ data: RelationshipEngineDiagnosticsResult["metadata"] }>(
        fetcher,
        args.baseUrl,
        "validation",
      )).data;
    },
  };
}

function boundary(
  kind: RelationshipEngineInternalConsumerKind,
  integrationMode: RelationshipEngineConsumerIntegrationMode,
  allowedSurface: RelationshipEngineInternalConsumerBoundary["allowedSurface"],
  notes: string[],
): RelationshipEngineInternalConsumerBoundary {
  return {
    kind,
    integrationMode,
    allowedSurface,
    repositoriesAllowed: false,
    writesAllowed: false,
    queueExecutionAllowed: false,
    automationAllowed: false,
    rawInternalsAllowed: false,
    notes,
  };
}

async function getJson<T>(
  fetcher: typeof fetch,
  baseUrl: string,
  surface: "diagnostics" | "health" | "validation",
): Promise<T> {
  const response = await fetcher(`${baseUrl.replace(/\/$/, "")}/api/internal/relationship-engine/${surface}`, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Relationship Engine internal diagnostics request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
