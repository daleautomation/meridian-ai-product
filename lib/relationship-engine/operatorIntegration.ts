// Meridian Relationship Engine — operator integration facade.
//
// This is the first safe bridge into operator surfaces. It consumes only the
// read-service facade and diagnostics consumer boundary; it never imports
// repositories, writes state, executes queues, or derives relationship rank.

import type { PublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import { isAdminOperator } from "@/lib/workspaceAccess";
import {
  createRelationshipEngineReadServiceForWorkspace,
} from "./api/readServiceFactory";
import {
  createRelationshipEngineFacadeDiagnosticsConsumer,
  RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES,
} from "./consumers/internalConsumers";
import {
  RelationshipEngineDiagnosticsService,
  RELATIONSHIP_ENGINE_READ_ONLY_GUARANTEES,
  type RelationshipEngineDiagnosticsResult,
  type RelationshipEngineHealthModel,
} from "./services/diagnostics";
import type {
  RelationshipFeedProjectionSet,
  RelationshipQueueProjectionSet,
  RelationshipServiceIssue,
} from "./services/types";
import type {
  RelationshipFeedProjection,
  RelationshipQueueProjection,
} from "./projections/operatorReadModels";
import {
  projectRelationshipWorkflowIntegration,
  type RelationshipWorkflowProjection,
} from "./workflowIntegration";
import {
  projectMultiOperatorWorkflowOrchestration,
  type MultiOperatorWorkflowOrchestrationProjection,
  type MultiOperatorWorkflowViewerContext,
} from "./multiOperatorWorkflowOrchestration";
import type { IsoDateString, WorkspaceId } from "./primitives";
import { asIsoDateString, asOperatorId } from "./timeline/normalizers/common";

const FEED_ORDER: Array<keyof RelationshipFeedProjectionSet> = [
  "relationship_activity",
  "operator_relationship",
  "relationship_momentum",
  "overdue_relationship",
  "relationship_change",
];

const QUEUE_ORDER: Array<keyof RelationshipQueueProjectionSet> = [
  "needs_attention",
  "overdue_follow_ups",
  "cooling_relationships",
  "retention_risk",
  "warm_opportunities",
  "reactivation_candidates",
];

export interface RelationshipEngineOperatorSurface {
  kind: "relationship_engine_operator_surface";
  status: "ready" | "degraded";
  generatedAt: string;
  workspace: {
    slug: string;
    id: string;
    dataMode: WorkspaceConfig["access"]["dataMode"];
    readOnlyByDefault: boolean;
  };
  access: {
    adminOperator: boolean;
    adminDiagnosticsVisible: boolean;
  };
  boundary: {
    integrationMode: "service_facade";
    apiOnlyAlternative: string[];
    repositoriesAllowed: false;
    writesAllowed: false;
    queueExecutionAllowed: false;
    workflowExecutionAllowed: false;
    automationAllowed: false;
    remindersAllowed: false;
    notificationsAllowed: false;
    rawInternalsAllowed: false;
  };
  health: RelationshipEngineHealthModel;
  feeds: RelationshipFeedProjection[];
  queues: RelationshipQueueProjection[];
  workflows: RelationshipWorkflowProjection;
  multiOperatorWorkflows: MultiOperatorWorkflowOrchestrationProjection;
  diagnostics: {
    relationshipEngine: RelationshipEngineDiagnosticsResult["diagnostics"]["relationshipEngine"];
    projectionIntegrity: RelationshipEngineDiagnosticsResult["diagnostics"]["projectionIntegrity"];
    timelineNormalization: RelationshipEngineDiagnosticsResult["diagnostics"]["timelineNormalization"];
    queueIntegrity: RelationshipEngineDiagnosticsResult["diagnostics"]["queueIntegrity"];
    repositoryReadiness: RelationshipEngineDiagnosticsResult["diagnostics"]["repositoryReadiness"];
  };
  adminDiagnostics: RelationshipEngineDiagnosticsResult | null;
  metadata: RelationshipEngineDiagnosticsResult["metadata"] & {
    serviceWarnings: RelationshipServiceIssue[];
    apiEndpoints: string[];
    timelineDisplay: {
      state: "relationship_selection_required";
      message: string;
      source: "relationship_engine_timeline_api";
    };
    summaryDisplay: {
      relationshipCount: number;
      queueItemCount: number;
      feedItemCount: number;
    };
  };
  safeError?: string;
}

export async function buildRelationshipEngineOperatorSurface(args: {
  workspace: WorkspaceConfig;
  user: PublicUser;
  now?: string;
}): Promise<RelationshipEngineOperatorSurface> {
  const generatedAt = asIsoDateString(args.now ?? new Date().toISOString());
  const adminOperator = isAdminOperator(args.user);
  const workspace = args.workspace;

  try {
    const binding = createRelationshipEngineReadServiceForWorkspace(workspace);
    const context = {
      workspaceId: workspace.id as WorkspaceId,
      now: generatedAt,
    };
    const [feedsResult, queuesResult] = await Promise.all([
      binding.service.getRelationshipFeeds({ context, page: { limit: 100 } }),
      binding.service.getRelationshipQueues({ context, page: { limit: 100 } }),
    ]);
    const diagnosticsConsumer = createRelationshipEngineFacadeDiagnosticsConsumer({
      kind: "operator_workspace",
      diagnosticsService: new RelationshipEngineDiagnosticsService(),
      request: {
        context,
        service: binding.service,
        repositoryMode: binding.repositoryMode,
        repositoryDiagnostics: binding.diagnostics,
        page: { limit: 100 },
        generatedAtSource: "server_clock",
      },
    });
    const diagnostics = await diagnosticsConsumer.getDiagnostics();
    const queues = orderedValues(queuesResult.data, QUEUE_ORDER);
    const feeds = orderedValues(feedsResult.data, FEED_ORDER);
    const workflows = projectRelationshipWorkflowIntegration({
      generatedAt,
      queues,
      feeds,
    });
    const multiOperatorWorkflows = projectMultiOperatorWorkflowOrchestration({
      generatedAt,
      workflow: workflows,
      viewer: operatorWorkflowViewer(args.user, adminOperator),
    });

    return {
      kind: "relationship_engine_operator_surface",
      status: "ready",
      generatedAt,
      workspace: workspaceEnvelope(workspace),
      access: {
        adminOperator,
        adminDiagnosticsVisible: adminOperator,
      },
      boundary: operatorBoundary(),
      health: diagnostics.health,
      feeds,
      queues,
      workflows,
      multiOperatorWorkflows,
      diagnostics: {
        relationshipEngine: diagnostics.diagnostics.relationshipEngine,
        projectionIntegrity: diagnostics.diagnostics.projectionIntegrity,
        timelineNormalization: diagnostics.diagnostics.timelineNormalization,
        queueIntegrity: diagnostics.diagnostics.queueIntegrity,
        repositoryReadiness: diagnostics.diagnostics.repositoryReadiness,
      },
      adminDiagnostics: adminOperator ? diagnostics : null,
      metadata: {
        ...diagnostics.metadata,
        serviceWarnings: [...feedsResult.warnings, ...queuesResult.warnings],
        apiEndpoints: relationshipEngineApiEndpoints(),
        timelineDisplay: {
          state: "relationship_selection_required",
          message: "Select a relationship from a queue item once read adapters provide relationship ids.",
          source: "relationship_engine_timeline_api",
        },
        summaryDisplay: {
          relationshipCount: relationshipCount(queues),
          queueItemCount: queues.reduce((sum, queue) => sum + queue.items.length, 0),
          feedItemCount: feeds.reduce((sum, feed) => sum + feed.items.length, 0),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relationship Engine operator surface failed to load.";
    return degradedSurface(workspace, adminOperator, generatedAt, message);
  }
}

function orderedValues<T extends string, TProjection>(
  set: Partial<Record<T, TProjection>>,
  order: readonly T[],
): TProjection[] {
  return order.map((kind) => set[kind]).filter((item): item is TProjection => Boolean(item));
}

function relationshipCount(queues: RelationshipQueueProjection[]): number {
  return new Set(queues.flatMap((queue) => queue.items.map((item) => item.relationshipId))).size;
}

function workspaceEnvelope(workspace: WorkspaceConfig): RelationshipEngineOperatorSurface["workspace"] {
  return {
    slug: workspace.slug,
    id: workspace.id,
    dataMode: workspace.access.dataMode,
    readOnlyByDefault: workspace.access.readOnlyByDefault,
  };
}

function operatorBoundary(): RelationshipEngineOperatorSurface["boundary"] {
  return {
    integrationMode: "service_facade",
    apiOnlyAlternative: relationshipEngineApiEndpoints(),
    repositoriesAllowed: false,
    writesAllowed: false,
    queueExecutionAllowed: false,
    workflowExecutionAllowed: false,
    automationAllowed: false,
    remindersAllowed: false,
    notificationsAllowed: false,
    rawInternalsAllowed: false,
  };
}

function relationshipEngineApiEndpoints(): string[] {
  return [
    "/api/relationship-engine/summary",
    "/api/relationship-engine/timeline",
    "/api/relationship-engine/feeds",
    "/api/relationship-engine/queues",
    "/api/relationship-engine/workflows",
    "/api/relationship-engine/projection",
    "/api/relationship-engine/health",
  ];
}

function degradedSurface(
  workspace: WorkspaceConfig,
  adminOperator: boolean,
  generatedAt: IsoDateString,
  safeError: string,
): RelationshipEngineOperatorSurface {
  const workflows = projectRelationshipWorkflowIntegration({
    generatedAt,
    queues: [],
    feeds: [],
  });
  return {
    kind: "relationship_engine_operator_surface",
    status: "degraded",
    generatedAt,
    workspace: workspaceEnvelope(workspace),
    access: {
      adminOperator,
      adminDiagnosticsVisible: adminOperator,
    },
    boundary: operatorBoundary(),
    health: {
      generatedAt,
      overallStatus: "error",
      normalizationStatus: "not_configured",
      projectionStatus: "not_configured",
      queueValidationStatus: "not_configured",
      timelineValidationStatus: "not_configured",
      repositoryMode: "unknown",
      deterministicReplayStatus: "not_configured",
      staleProjectionWarnings: [],
      missingDataWarnings: { count: 0, fields: [], reasons: [], effects: [] },
      readOnlyGuarantees: RELATIONSHIP_ENGINE_READ_ONLY_GUARANTEES,
    },
    feeds: [],
    queues: [],
    workflows,
    multiOperatorWorkflows: projectMultiOperatorWorkflowOrchestration({
      generatedAt,
      workflow: workflows,
      viewer: operatorWorkflowViewer({ id: "unknown", name: "Unknown operator", accessRole: "client_user", modules: [], geo: [], workspaces: [] }, adminOperator),
    }),
    diagnostics: {
      relationshipEngine: degradedDiagnostic("Relationship Engine operator surface failed to load."),
      projectionIntegrity: degradedDiagnostic("Projection diagnostics are unavailable."),
      timelineNormalization: degradedDiagnostic("Timeline normalization diagnostics are unavailable."),
      queueIntegrity: degradedDiagnostic("Queue diagnostics are unavailable."),
      repositoryReadiness: degradedDiagnostic("Repository readiness diagnostics are unavailable."),
    },
    adminDiagnostics: null,
    metadata: {
      deterministic: {
        replaySafeWithFixedAsOf: true,
        generatedAtSource: "server_clock",
        collectionOrder: { feeds: FEED_ORDER, queues: QUEUE_ORDER },
      },
      validationWarnings: [],
      confidence: { overall: "low", bySurface: { feeds: "low", queues: "low" } },
      missingData: { count: 0, fields: [], reasons: [], effects: [] },
      repositoryMode: "unknown",
      readOnly: RELATIONSHIP_ENGINE_READ_ONLY_GUARANTEES,
      serviceWarnings: [],
      apiEndpoints: relationshipEngineApiEndpoints(),
      timelineDisplay: {
        state: "relationship_selection_required",
        message: "Relationship timeline display remains read-only and unavailable until a relationship projection loads.",
        source: "relationship_engine_timeline_api",
      },
      summaryDisplay: {
        relationshipCount: 0,
        queueItemCount: 0,
        feedItemCount: 0,
      },
    },
    safeError,
  };
}

function operatorWorkflowViewer(
  user: PublicUser,
  adminOperator: boolean,
): MultiOperatorWorkflowViewerContext {
  return {
    operatorId: asOperatorId(user.id),
    label: user.name ?? user.id,
    role: adminOperator ? "account_manager" : "operator",
    sourceAccessRole: user.accessRole,
    visibilityScope: adminOperator ? "manager_review" : "assigned_and_shared_review",
  };
}

function degradedDiagnostic(summary: string) {
  return {
    status: "error" as const,
    summary,
    issueSummary: [],
    safeMetadata: {
      readOnly: true,
      consumerBoundaries: RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES.length,
    },
  };
}
