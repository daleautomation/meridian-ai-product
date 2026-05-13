import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  isDurableOutcomeStatus,
  listDurableOutcomes,
  recordDurableOutcome,
} from "@/lib/execution/serverOutcomeStore";
import { makeEvent, writeEvent } from "@/lib/tracking/eventLog";
import { canMutateWorkspace, getWorkspaceAccess } from "@/lib/workspaceAccess";

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deriveLeadId(leadId: string | null, taskId: string | null): string | null {
  if (leadId) return leadId;
  const match = taskId?.match(/^lead-(.+)-(?:call|followup)$/);
  return match?.[1] ?? null;
}

function eventTypeForOutcome(status: string): string {
  switch (status) {
    case "Called":
      return "call_completed";
    case "Follow Up":
      return "follow_up_needed";
    case "Proposal Sent":
      return "proposal_sent";
    case "Closed Won":
      return "closed_won";
    case "Closed Lost":
      return "closed_lost";
    case "Not Qualified":
      return "not_qualified";
    default:
      return "outcome_recorded";
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return bad(401, "Unauthorized");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON");
  }

  const workspace = stringOrNull(body.workspace) ?? session.workspaces?.[0] ?? null;
  if (!workspace) return bad(400, "Missing workspace");
  const access = getWorkspaceAccess(session, workspace);
  if (!access.ok) return bad(access.status, "Workspace not accessible");
  if (!canMutateWorkspace(session, access.workspace)) return bad(403, "Workspace is read-only for this session");

  const outcomeStatus = body.outcomeStatus;
  if (!isDurableOutcomeStatus(outcomeStatus)) return bad(400, "Invalid outcomeStatus");

  const inputCompanyKey = stringOrNull(body.companyKey);
  const inputCrmKey = stringOrNull(body.crmKey);
  const companyKey = inputCompanyKey ?? inputCrmKey;
  const crmKey = inputCrmKey ?? inputCompanyKey;
  const taskId = stringOrNull(body.taskId);
  const leadId = deriveLeadId(stringOrNull(body.leadId), taskId);
  if (!leadId && !taskId) return bad(400, "Missing lead/task identity");
  if (!companyKey && !crmKey && !leadId && !taskId) return bad(400, "Missing lead identity");

  const sourceSurface = stringOrNull(body.sourceSurface);
  if (!sourceSurface) return bad(400, "Missing sourceSurface");

  const metadata = body.metadata && typeof body.metadata === "object"
    ? body.metadata as Record<string, unknown>
    : {};
  const nextActionDate = stringOrNull(body.nextActionDate);
  const nextAction = stringOrNull(body.nextAction)
    ?? (outcomeStatus === "Follow Up" && nextActionDate ? "follow_up_call" : null);

  const result = await recordDurableOutcome({
    workspace,
    companyKey,
    crmKey,
    leadId,
    taskId,
    operatorId: session.id,
    sourceSurface,
    outcomeStatus,
    occurredAt: stringOrNull(body.occurredAt),
    nextAction,
    nextActionDate,
    estimatedValue: numberOrNull(body.estimatedValue),
    meridianInfluenced: typeof body.meridianInfluenced === "boolean" ? body.meridianInfluenced : true,
    influenceReason: stringOrNull(body.influenceReason),
    idempotencyKey: stringOrNull(body.idempotencyKey),
    metadata,
    companyName: stringOrNull(body.companyName),
  });

  const attributionGrade =
    result.persisted
    && !!session.id
    && !!workspace
    && !!sourceSurface
    && !!outcomeStatus
    && (!!leadId || !!taskId)
    && (!!companyKey || !!crmKey);

  const event = makeEvent({
    eventId: result.outcome.eventId,
    eventType: eventTypeForOutcome(outcomeStatus),
    userId: session.id,
    operatorId: session.id,
    workspace,
    leadId: result.outcome.leadId,
    taskId: result.outcome.taskId,
    companyKey: result.outcome.companyKey,
    crmKey: result.outcome.crmKey,
    companyName: stringOrNull(body.companyName),
    sourceSurface: result.outcome.sourceSurface,
    previousStatus: result.outcome.previousStatus,
    nextStatus: result.outcome.nextStatus,
    outcomeStatus: result.outcome.outcomeStatus,
    nextAction: result.outcome.nextAction,
    nextActionDate: result.outcome.nextActionDate,
    estimatedValue: result.outcome.estimatedValue,
    meridianInfluenced: result.outcome.meridianInfluenced,
    influenceReason: result.outcome.influenceReason,
    occurredAt: result.outcome.occurredAt,
    recordedAt: result.outcome.recordedAt,
    idempotencyKey: result.outcome.idempotencyKey,
    timestamp: result.outcome.recordedAt,
    metadata: {
      ...metadata,
      persisted: result.persisted,
      crmUpdated: result.crmUpdated,
      duplicate: result.duplicate,
      attributionGrade,
      attributionKind: attributionGrade ? "commission" : "analytics",
    },
  });
  await writeEvent(event);

  if (!result.persisted) {
    return NextResponse.json({
      ok: false,
      error: "durable_persistence_failed",
      outcome: result.outcome,
      persisted: false,
      crmUpdated: false,
      duplicate: result.duplicate,
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    persisted: result.persisted,
    crmUpdated: result.crmUpdated,
    duplicate: result.duplicate,
  });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return bad(401, "Unauthorized");
  const url = new URL(req.url);
  const workspace = stringOrNull(url.searchParams.get("workspace")) ?? session.workspaces?.[0] ?? null;
  if (!workspace) return bad(400, "Missing workspace");
  const access = getWorkspaceAccess(session, workspace);
  if (!access.ok) return bad(access.status, "Workspace not accessible");
  const outcomes = await listDurableOutcomes(workspace);
  return NextResponse.json({ ok: true, outcomes });
}
