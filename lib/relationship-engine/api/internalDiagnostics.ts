// Meridian Relationship Engine — internal admin observability boundary.
//
// Internal diagnostics are admin-only, read-only, and metadata-only. They call
// service facades and diagnostics services rather than repositories.

import { NextResponse } from "next/server";
import type { PublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import { getSession } from "@/lib/auth";
import { getWorkspaceAccess, isAdminOperator } from "@/lib/workspaceAccess";
import {
  LIFECYCLE_STATES,
  RelationshipEngineDiagnosticsService,
  asIsoDateString,
  asOperatorId,
  asRelationshipId,
  isLifecycleState,
  type EngineContext,
  type IsoDateString,
  type LifecycleState,
  type RelationshipCollectionReadRequest,
  type RelationshipEngineDiagnosticsResult,
  type RelationshipServiceOptions,
  type WorkspaceId,
} from "@/lib/relationship-engine";
import {
  createRelationshipEngineReadServiceForWorkspace,
  type RelationshipEngineReadServiceBinding,
} from "./readServiceFactory";
import { RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES } from "../consumers/internalConsumers";

export type RelationshipEngineInternalDiagnosticsSurface = "diagnostics" | "health" | "validation";

export interface RelationshipEngineInternalDiagnosticsInput {
  surface: RelationshipEngineInternalDiagnosticsSurface;
  request: Request;
  session: PublicUser | null;
  serviceFactory?: (workspace: WorkspaceConfig) => RelationshipEngineReadServiceBinding;
  diagnosticsService?: RelationshipEngineDiagnosticsService;
}

const INTERNAL_ENDPOINTS: Record<RelationshipEngineInternalDiagnosticsSurface, string> = {
  diagnostics: "/api/internal/relationship-engine/diagnostics",
  health: "/api/internal/relationship-engine/health",
  validation: "/api/internal/relationship-engine/validation",
};

export function createRelationshipEngineInternalDiagnosticsGetRoute(
  surface: RelationshipEngineInternalDiagnosticsSurface,
) {
  return async function GET(request: Request) {
    return handleRelationshipEngineInternalDiagnosticsRequest({
      surface,
      request,
      session: await getSession(),
    });
  };
}

export function relationshipEngineInternalReadOnlyMethodNotAllowed() {
  return NextResponse.json(
    stableForJson({
      ok: false,
      error: {
        code: "relationship_engine_internal_read_only",
        message: "Relationship Engine internal diagnostics endpoints are read-only and only support GET.",
      },
      readOnly: {
        retrievalOnly: true,
        projectionOnly: true,
        mutations: false,
        queueExecution: false,
        notifications: false,
        reminders: false,
        productionScoring: false,
        neonWrites: false,
        timelinePersistence: false,
        autonomousWorkflows: false,
      },
    }),
    { status: 405, headers: { Allow: "GET" } },
  );
}

export async function handleRelationshipEngineInternalDiagnosticsRequest(
  input: RelationshipEngineInternalDiagnosticsInput,
): Promise<Response> {
  if (!input.session) {
    return internalError(401, "unauthorized", "Unauthorized");
  }
  if (!isAdminOperator(input.session)) {
    return internalError(403, "relationship_engine_admin_required", "Relationship Engine diagnostics require admin access.");
  }

  const url = new URL(input.request.url);
  const workspaceSlug = stringParam(url, "workspace") ?? input.session.workspaces?.[0] ?? null;
  if (!workspaceSlug) {
    return internalError(400, "missing_workspace", "Missing workspace");
  }

  const access = getWorkspaceAccess(input.session, workspaceSlug);
  if (!access.ok) {
    return internalError(access.status, "workspace_not_accessible", "Workspace not accessible");
  }

  const parsed = parseInternalDiagnosticsQuery(url, access.workspace);
  if (!parsed.ok) {
    return internalError(400, parsed.code, parsed.message);
  }

  const binding = (input.serviceFactory ?? createRelationshipEngineReadServiceForWorkspace)(access.workspace);
  const diagnosticsService = input.diagnosticsService ?? new RelationshipEngineDiagnosticsService();
  const diagnostics = await diagnosticsService.getDiagnostics({
    context: parsed.context,
    service: binding.service,
    repositoryMode: binding.repositoryMode,
    repositoryDiagnostics: binding.diagnostics,
    ...(parsed.relationshipIds ? { relationshipIds: parsed.relationshipIds } : {}),
    ...(parsed.query ? { query: parsed.query } : {}),
    page: parsed.page,
    options: parsed.options,
    generatedAtSource: parsed.generatedAtSource,
  });

  return internalResult(input.surface, diagnostics, access.workspace);
}

interface ParsedInternalDiagnosticsQuery {
  ok: true;
  context: EngineContext;
  relationshipIds?: RelationshipCollectionReadRequest["relationshipIds"];
  query?: RelationshipCollectionReadRequest["query"];
  page: RelationshipCollectionReadRequest["page"];
  options: RelationshipServiceOptions;
  generatedAtSource: "query_asOf" | "server_clock";
}

type InternalQueryParseResult =
  | ParsedInternalDiagnosticsQuery
  | { ok: false; code: string; message: string };

function parseInternalDiagnosticsQuery(url: URL, workspace: WorkspaceConfig): InternalQueryParseResult {
  const asOfProvided = Boolean(stringParam(url, "asOf"));
  const asOf = isoParam(url, "asOf");
  if (asOfProvided && !asOf) {
    return { ok: false, code: "invalid_as_of", message: "asOf must be an ISO timestamp" };
  }
  const limit = numberParam(url, "limit", 100, 1, 500);
  if (!limit.ok) return limit;
  const relationshipIds = parseRelationshipIds(url);
  if (!relationshipIds.ok) return relationshipIds;
  const lifecycle = parseLifecycle(url);
  if (!lifecycle.ok) return lifecycle;
  const updatedAfter = isoParam(url, "updatedAfter");
  if (stringParam(url, "updatedAfter") && !updatedAfter) {
    return { ok: false, code: "invalid_updated_after", message: "updatedAfter must be an ISO timestamp" };
  }
  const options = parseOptions(url);
  if (!options.ok) return options;
  const ownerId = stringParam(url, "ownerId");

  return {
    ok: true,
    context: {
      workspaceId: workspace.id as WorkspaceId,
      now: asOf ?? asIsoDateString(new Date().toISOString()),
    },
    ...(relationshipIds.relationshipIds.length > 0 ? { relationshipIds: relationshipIds.relationshipIds } : {}),
    query: {
      ...(lifecycle.lifecycle.length > 0 ? { lifecycle: lifecycle.lifecycle } : {}),
      ...(ownerId ? { ownerId: asOperatorId(ownerId) } : {}),
      ...(updatedAfter ? { updatedAfter } : {}),
    },
    page: {
      limit: limit.value,
      ...(stringParam(url, "cursor") ? { cursor: stringParam(url, "cursor") ?? undefined } : {}),
    },
    options: options.options,
    generatedAtSource: asOfProvided ? "query_asOf" : "server_clock",
  };
}

function internalResult(
  surface: RelationshipEngineInternalDiagnosticsSurface,
  diagnostics: RelationshipEngineDiagnosticsResult,
  workspace: WorkspaceConfig,
): Response {
  const data = surface === "health"
    ? diagnostics.health
    : surface === "validation"
      ? {
          validationWarnings: diagnostics.metadata.validationWarnings,
          confidence: diagnostics.metadata.confidence,
          missingData: diagnostics.metadata.missingData,
          readOnly: diagnostics.metadata.readOnly,
          consumerBoundaries: RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES,
        }
      : {
          ...diagnostics,
          consumerBoundaries: RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES,
          endpoints: INTERNAL_ENDPOINTS,
        };

  return NextResponse.json(stableForJson({
    ok: true,
    surface,
    workspace: workspace.slug,
    data,
    meta: {
      generatedAt: diagnostics.generatedAt,
      adminOnly: true,
      internalOnly: true,
      safeMetadataOnly: true,
      repositoryMode: diagnostics.metadata.repositoryMode,
      deterministic: diagnostics.metadata.deterministic,
      readOnly: diagnostics.metadata.readOnly,
    },
  }));
}

function internalError(status: number, code: string, message: string): Response {
  return NextResponse.json(stableForJson({
    ok: false,
    error: { code, message },
    readOnly: {
      retrievalOnly: true,
      projectionOnly: true,
      mutations: false,
      queueExecution: false,
      notifications: false,
      reminders: false,
      productionScoring: false,
      neonWrites: false,
      timelinePersistence: false,
      autonomousWorkflows: false,
    },
  }), { status });
}

function stringParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isoParam(url: URL, name: string): IsoDateString | null {
  const value = stringParam(url, name);
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return asIsoDateString(new Date(parsed).toISOString());
}

function numberParam(
  url: URL,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; code: string; message: string } {
  const raw = stringParam(url, name);
  if (!raw) return { ok: true, value: defaultValue };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return { ok: false, code: `invalid_${name}`, message: `${name} must be an integer between ${min} and ${max}` };
  }
  return { ok: true, value };
}

function positiveNumberParam(
  url: URL,
  name: string,
): { ok: true; value?: number } | { ok: false; code: string; message: string } {
  const raw = stringParam(url, name);
  if (!raw) return { ok: true };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, code: `invalid_${name}`, message: `${name} must be a positive number` };
  }
  return { ok: true, value };
}

function parseRelationshipIds(
  url: URL,
): { ok: true; relationshipIds: ReturnType<typeof asRelationshipId>[] } | { ok: false; code: string; message: string } {
  const raw = stringParam(url, "relationshipIds");
  if (!raw) return { ok: true, relationshipIds: [] };
  const ids = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (ids.length > 100) {
    return { ok: false, code: "too_many_relationship_ids", message: "relationshipIds is limited to 100 ids" };
  }
  return { ok: true, relationshipIds: [...new Set(ids)].sort().map(asRelationshipId) };
}

function parseLifecycle(
  url: URL,
): { ok: true; lifecycle: LifecycleState[] } | { ok: false; code: string; message: string } {
  const raw = stringParam(url, "lifecycle");
  if (!raw) return { ok: true, lifecycle: [] };
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const invalid = values.find((value) => !isLifecycleState(value));
  if (invalid) {
    return {
      ok: false,
      code: "invalid_lifecycle",
      message: `lifecycle must use canonical states: ${LIFECYCLE_STATES.join(", ")}`,
    };
  }
  return { ok: true, lifecycle: [...new Set(values as LifecycleState[])].sort() };
}

function parseOptions(
  url: URL,
): { ok: true; options: RelationshipServiceOptions } | { ok: false; code: string; message: string } {
  const staleTimelineAfterDays = positiveNumberParam(url, "staleTimelineAfterDays");
  if (!staleTimelineAfterDays.ok) return staleTimelineAfterDays;
  const staleProjectionAfterHours = positiveNumberParam(url, "staleProjectionAfterHours");
  if (!staleProjectionAfterHours.ok) return staleProjectionAfterHours;
  const followUpLookaheadDays = positiveNumberParam(url, "followUpLookaheadDays");
  if (!followUpLookaheadDays.ok) return followUpLookaheadDays;
  const followUpDueBefore = isoParam(url, "followUpDueBefore");
  if (stringParam(url, "followUpDueBefore") && !followUpDueBefore) {
    return {
      ok: false,
      code: "invalid_follow_up_due_before",
      message: "followUpDueBefore must be an ISO timestamp",
    };
  }
  return {
    ok: true,
    options: {
      ...(staleTimelineAfterDays.value ? { staleTimelineAfterDays: staleTimelineAfterDays.value } : {}),
      ...(staleProjectionAfterHours.value ? { staleProjectionAfterHours: staleProjectionAfterHours.value } : {}),
      ...(followUpLookaheadDays.value ? { followUpLookaheadDays: followUpLookaheadDays.value } : {}),
      ...(followUpDueBefore ? { followUpDueBefore } : {}),
    },
  };
}

function stableForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableForJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableForJson(record[key])]),
  );
}
