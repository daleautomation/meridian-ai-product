import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { makeEvent, writeEvent } from "@/lib/tracking/eventLog";

// Meridian — Usage event tracking endpoint.
//
// Server-side append-only log of operator actions. Reads the
// session cookie to attach userId; client never spoofs the user.
// Body fields override nothing of identity — only operational
// payload (leadId, companyName, tradeId, serviceBucketId, metadata).

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const eventType = typeof body.eventType === "string" ? body.eventType : null;
  if (!eventType) {
    return NextResponse.json({ ok: false, error: "missing_eventType" }, { status: 400 });
  }

  // Server-derived identity. Never trust the client's userId.
  const session = await getSession();
  const userId = session?.id ?? null;
  // Workspace can come from the session OR the explicit body (the
  // operator surface routes by workspace param, so we honour it
  // when present; defaults to the session's first workspace).
  const workspace =
    typeof body.workspace === "string" ? body.workspace
    : (session?.workspaces?.[0] ?? null);

  const event = makeEvent({
    eventType,
    userId,
    workspace,
    leadId: typeof body.leadId === "string" ? body.leadId : null,
    taskId: typeof body.taskId === "string" ? body.taskId : null,
    companyName: typeof body.companyName === "string" ? body.companyName : null,
    tradeId: typeof body.tradeId === "string" ? body.tradeId : null,
    serviceBucketId: typeof body.serviceBucketId === "string" ? body.serviceBucketId : null,
    metadata: (body.metadata && typeof body.metadata === "object") ? (body.metadata as Record<string, unknown>) : {},
  });

  const result = await writeEvent(event);
  // Never block UI — even if the write fails, return 200 so the
  // client's fire-and-forget POST doesn't surface an error.
  // eslint-disable-next-line no-console
  console.log(`[track] eventType=${event.eventType} user=${event.userId ?? "?"} workspace=${event.workspace ?? "?"} leadId=${event.leadId ?? "-"} ok=${result.ok}${result.reason ? ` reason=${result.reason}` : ""}`);
  return NextResponse.json({ ok: result.ok, reason: result.reason ?? undefined });
}
