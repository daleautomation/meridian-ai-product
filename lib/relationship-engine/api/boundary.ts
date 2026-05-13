// Meridian Relationship Engine — safe read-only API boundary.
//
// Route handlers stay thin: authenticate, authorize workspace access, call the
// RelationshipEngineReadService facade, and serialize projection-safe DTOs.

import { NextResponse } from "next/server";
import type { PublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import { getSession } from "@/lib/auth";
import {
  LIFECYCLE_STATES,
  asIsoDateString,
  asOperatorId,
  asRelationshipId,
  isLifecycleState,
  type EngineContext,
  type IsoDateString,
  type LifecycleState,
  type RelationshipCollectionReadRequest,
  type RelationshipServiceIssue,
  type RelationshipServiceOptions,
  type RelationshipServiceReadResult,
  type WorkspaceId,
} from "@/lib/relationship-engine";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";
import {
  createRelationshipEngineReadServiceForWorkspace,
  type RelationshipEngineReadServiceBinding,
} from "./readServiceFactory";

export type RelationshipEngineApiEndpoint =
  | "summary"
  | "timeline"
  | "feeds"
  | "queues"
  | "projection"
  | "health";

const FEED_ORDER = [
  "relationship_activity",
  "operator_relationship",
  "relationship_momentum",
  "overdue_relationship",
  "relationship_change",
] as const;

const QUEUE_ORDER = [
  "needs_attention",
  "overdue_follow_ups",
  "cooling_relationships",
  "retention_risk",
  "warm_opportunities",
  "reactivation_candidates",
] as const;

const ENDPOINTS: RelationshipEngineApiEndpoint[] = [
  "summary",
  "timeline",
  "feeds",
  "queues",
  "projection",
  "health",
];

const READ_ONLY_GUARANTEES = {
  retrievalOnly: true,
  projectionOnly: true,
  mutations: false,
  queueExecution: false,
  notifications: false,
  reminders: false,
  productionScoring: false,
  neonWrites: false,
  timelinePersistence: false,
} as const;

export interface RelationshipEngineApiRequestInput {
  endpoint: RelationshipEngineApiEndpoint;
  request: Request;
  session: PublicUser | null;
  serviceFactory?: (workspace: WorkspaceConfig) => RelationshipEngineReadServiceBinding;
}

export function createRelationshipEngineGetRoute(endpoint: RelationshipEngineApiEndpoint) {
  return async function GET(request: Request) {
    return handleRelationshipEngineApiRequest({
      endpoint,
      request,
      session: await getSession(),
    });
  };
}

export function relationshipEngineReadOnlyMethodNotAllowed() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "relationship_engine_read_only",
        message: "Relationship Engine API endpoints are read-only and only support GET.",
      },
      readOnly: READ_ONLY_GUARANTEES,
    },
    { status: 405, headers: { Allow: "GET" } },
  );
}

export async function handleRelationshipEngineApiRequest(input: RelationshipEngineApiRequestInput): Promise<Response> {
  if (!input.session) {
    return apiError(401, "unauthorized", "Unauthorized");
  }

  const url = new URL(input.request.url);
  const workspaceSlug = stringParam(url, "workspace") ?? input.session.workspaces?.[0] ?? null;
  if (!workspaceSlug) {
    return apiError(400, "missing_workspace", "Missing workspace");
  }

  const access = getWorkspaceAccess(input.session, workspaceSlug);
  if (!access.ok) {
    return apiError(access.status, "workspace_not_accessible", "Workspace not accessible");
  }

  const apiAccess = validateRelationshipEngineApiAccess(input.session, access.workspace);
  if (!apiAccess.ok) {
    return apiError(403, apiAccess.code, apiAccess.message);
  }

  const parsed = parseRelationshipEngineQuery(url, input.endpoint, access.workspace);
  if (!parsed.ok) {
    return apiError(400, parsed.code, parsed.message);
  }

  const binding = (input.serviceFactory ?? createRelationshipEngineReadServiceForWorkspace)(access.workspace);

  try {
    switch (input.endpoint) {
      case "summary": {
        const result = await binding.service.getRelationshipSummary({
          context: parsed.context,
          relationshipId: parsed.relationshipId,
          options: parsed.options,
        });
        return apiResult(input.endpoint, result, result.data, parsed, access.workspace, binding);
      }
      case "timeline": {
        const result = await binding.service.getRelationshipTimeline({
          context: parsed.context,
          relationshipId: parsed.relationshipId,
          options: parsed.options,
        });
        return apiResult(input.endpoint, result, result.data, parsed, access.workspace, binding);
      }
      case "feeds": {
        const result = await binding.service.getRelationshipFeeds(collectionRequest(parsed));
        return apiResult(
          input.endpoint,
          result,
          { feeds: orderedProjectionSet(result.data, FEED_ORDER) },
          parsed,
          access.workspace,
          binding,
        );
      }
      case "queues": {
        const result = await binding.service.getRelationshipQueues(collectionRequest(parsed));
        return apiResult(
          input.endpoint,
          result,
          { queues: orderedProjectionSet(result.data, QUEUE_ORDER) },
          parsed,
          access.workspace,
          binding,
        );
      }
      case "projection": {
        const result = await binding.service.getRelationshipProjection({
          context: parsed.context,
          relationshipId: parsed.relationshipId,
          options: parsed.options,
        });
        return apiResult(input.endpoint, result, projectionBundleForApi(result.data), parsed, access.workspace, binding);
      }
      case "health": {
        const result = await binding.service.getRelationshipFeeds(collectionRequest(parsed));
        return apiResult(
          input.endpoint,
          result,
          {
            status: "ok",
            service: "RelationshipEngineReadService",
            endpoints: ENDPOINTS.map((endpoint) => `/api/relationship-engine/${endpoint}`),
            repositoryMode: binding.repositoryMode,
            diagnostics: binding.diagnostics,
          },
          parsed,
          access.workspace,
          binding,
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && /Relationship .+ was not found/.test(error.message)) {
      return apiError(404, "relationship_not_found", "Relationship not found", parsed, access.workspace, binding);
    }
    return apiError(500, "relationship_engine_read_failed", "Relationship Engine read failed", parsed, access.workspace, binding);
  }
}

interface ParsedRelationshipEngineQuery {
  ok: true;
  context: EngineContext;
  relationshipId: ReturnType<typeof asRelationshipId>;
  relationshipIds?: ReturnType<typeof asRelationshipId>[];
  query?: RelationshipCollectionReadRequest["query"];
  page: { limit: number; cursor?: string };
  options: RelationshipServiceOptions;
  deterministic: {
    generatedAtSource: "query_asOf" | "server_clock";
    collectionOrder: readonly string[];
  };
}

type QueryParseResult =
  | ParsedRelationshipEngineQuery
  | { ok: false; code: string; message: string };

function parseRelationshipEngineQuery(
  url: URL,
  endpoint: RelationshipEngineApiEndpoint,
  workspace: WorkspaceConfig,
): QueryParseResult {
  const asOfProvided = Boolean(stringParam(url, "asOf"));
  const asOf = isoParam(url, "asOf");
  if (asOfProvided && !asOf) {
    return { ok: false, code: "invalid_as_of", message: "asOf must be an ISO timestamp" };
  }
  const now = asOf ?? asIsoDateString(new Date().toISOString());
  const limit = numberParam(url, "limit", 100, 1, 500);
  if (!limit.ok) return limit;
  const cursor = stringParam(url, "cursor");
  const relationshipIdValue = stringParam(url, "relationshipId") ?? "";
  const relationshipId = asRelationshipId(relationshipIdValue);

  if (requiresRelationshipId(endpoint) && !relationshipIdValue) {
    return {
      ok: false,
      code: "missing_relationship_id",
      message: "Missing relationshipId",
    };
  }

  const relationshipIds = parseRelationshipIds(url);
  if (!relationshipIds.ok) return relationshipIds;
  const lifecycle = parseLifecycle(url);
  if (!lifecycle.ok) return lifecycle;
  const options = parseOptions(url);
  if (!options.ok) return options;

  const updatedAfter = isoParam(url, "updatedAfter");
  if (stringParam(url, "updatedAfter") && !updatedAfter) {
    return { ok: false, code: "invalid_updated_after", message: "updatedAfter must be an ISO timestamp" };
  }
  const ownerId = stringParam(url, "ownerId");

  return {
    ok: true,
    context: {
      workspaceId: workspace.id as WorkspaceId,
      now,
    },
    relationshipId,
    ...(relationshipIds.relationshipIds.length > 0 ? { relationshipIds: relationshipIds.relationshipIds } : {}),
    query: {
      ...(lifecycle.lifecycle.length > 0 ? { lifecycle: lifecycle.lifecycle } : {}),
      ...(ownerId ? { ownerId: asOperatorId(ownerId) } : {}),
      ...(updatedAfter ? { updatedAfter } : {}),
    },
    page: {
      limit: limit.value,
      ...(cursor ? { cursor } : {}),
    },
    options: options.options,
    deterministic: {
      generatedAtSource: asOfProvided ? "query_asOf" : "server_clock",
      collectionOrder: endpoint === "queues" ? QUEUE_ORDER : endpoint === "feeds" ? FEED_ORDER : [],
    },
  };
}

function collectionRequest(parsed: ParsedRelationshipEngineQuery): RelationshipCollectionReadRequest {
  return {
    context: parsed.context,
    ...(parsed.relationshipIds ? { relationshipIds: parsed.relationshipIds } : {}),
    query: parsed.query,
    page: parsed.page,
    options: parsed.options,
  };
}

function requiresRelationshipId(endpoint: RelationshipEngineApiEndpoint): boolean {
  return endpoint === "summary" || endpoint === "timeline" || endpoint === "projection";
}

function validateRelationshipEngineApiAccess(
  session: PublicUser,
  workspace: WorkspaceConfig,
): { ok: true } | { ok: false; code: string; message: string } {
  if (workspace.access.dataMode === "demo") {
    return { ok: true };
  }
  if (session.accessRole === "admin_operator" || session.accessRole === "client_user") {
    return { ok: true };
  }
  return {
    ok: false,
    code: "relationship_engine_role_denied",
    message: "Relationship Engine reads require operator access for client workspaces",
  };
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

function orderedProjectionSet<T extends string>(
  projections: Partial<Record<T, unknown>>,
  order: readonly T[],
): unknown[] {
  return order.map((kind) => projections[kind]).filter((projection) => projection !== undefined);
}

function projectionBundleForApi(data: unknown): unknown {
  const bundle = data as {
    summary: unknown;
    timeline: unknown;
    feeds: Partial<Record<(typeof FEED_ORDER)[number], unknown>>;
    queues: Partial<Record<(typeof QUEUE_ORDER)[number], unknown>>;
  };
  return {
    summary: bundle.summary,
    timeline: bundle.timeline,
    feeds: orderedProjectionSet(bundle.feeds, FEED_ORDER),
    queues: orderedProjectionSet(bundle.queues, QUEUE_ORDER),
  };
}

function apiResult(
  endpoint: RelationshipEngineApiEndpoint,
  result: RelationshipServiceReadResult<unknown>,
  data: unknown,
  parsed: ParsedRelationshipEngineQuery,
  workspace: WorkspaceConfig,
  binding: RelationshipEngineReadServiceBinding,
) {
  return NextResponse.json(stableForJson({
    ok: true,
    endpoint,
    workspace: workspace.slug,
    data,
    meta: responseMeta(result, parsed, workspace, binding),
  }));
}

function responseMeta(
  result: RelationshipServiceReadResult<unknown>,
  parsed: ParsedRelationshipEngineQuery,
  workspace: WorkspaceConfig,
  binding: RelationshipEngineReadServiceBinding,
) {
  return {
    generatedAt: result.generatedAt,
    validation: {
      ok: result.validation.ok,
      issues: sortIssues(result.validation.issues),
    },
    warnings: sortIssues(result.warnings),
    confidence: result.confidence,
    evidence: sortEvidence(result.evidence),
    missingDataEffects: [...result.missingDataEffects].sort((a, b) =>
      a.field.localeCompare(b.field)
      || a.reason.localeCompare(b.reason)
      || a.effect.localeCompare(b.effect)),
    deterministic: {
      replaySafeWithFixedAsOf: true,
      generatedAtSource: parsed.deterministic.generatedAtSource,
      collectionOrder: parsed.deterministic.collectionOrder,
      repositoryMode: binding.repositoryMode,
    },
    access: {
      workspace: workspace.slug,
      workspaceId: workspace.id,
      dataMode: workspace.access.dataMode,
      readOnlyByDefault: workspace.access.readOnlyByDefault,
    },
    readOnly: READ_ONLY_GUARANTEES,
  };
}

function sortIssues(issues: RelationshipServiceIssue[]): RelationshipServiceIssue[] {
  return [...issues].sort((a, b) =>
    a.severity.localeCompare(b.severity)
    || a.code.localeCompare(b.code)
    || (a.relationshipId ?? "").localeCompare(b.relationshipId ?? "")
    || (a.timelineEventId ?? "").localeCompare(b.timelineEventId ?? "")
    || (a.source ?? "").localeCompare(b.source ?? "")
    || a.message.localeCompare(b.message));
}

function sortEvidence(evidence: RelationshipServiceReadResult<unknown>["evidence"]) {
  return [...evidence].sort((a, b) =>
    (a.occurredAt ?? "").localeCompare(b.occurredAt ?? "")
    || (a.timelineEventId ?? "").localeCompare(b.timelineEventId ?? "")
    || (a.promiseId ?? "").localeCompare(b.promiseId ?? "")
    || a.description.localeCompare(b.description)
    || a.confidence.localeCompare(b.confidence));
}

function apiError(
  status: number,
  code: string,
  message: string,
  parsed?: ParsedRelationshipEngineQuery,
  workspace?: WorkspaceConfig,
  binding?: RelationshipEngineReadServiceBinding,
) {
  return NextResponse.json(stableForJson({
    ok: false,
    error: { code, message },
    ...(parsed && workspace && binding
      ? {
          meta: {
            generatedAt: parsed.context.now,
            deterministic: {
              replaySafeWithFixedAsOf: true,
              generatedAtSource: parsed.deterministic.generatedAtSource,
              collectionOrder: parsed.deterministic.collectionOrder,
              repositoryMode: binding.repositoryMode,
            },
            access: {
              workspace: workspace.slug,
              workspaceId: workspace.id,
              dataMode: workspace.access.dataMode,
              readOnlyByDefault: workspace.access.readOnlyByDefault,
            },
            readOnly: READ_ONLY_GUARANTEES,
          },
        }
      : { readOnly: READ_ONLY_GUARANTEES }),
  }), { status });
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
