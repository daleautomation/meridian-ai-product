// Meridian — Outcome Loop, capture endpoint.
//
// POST /api/outcomes/record
// Body: { customer, leadKey, outcome, source, note?, nextReviewAt?,
//         staleScoreAtTime?, decisionBucketAtTime? }
//
// Append-only. The auth session resolves who recorded it; the
// operator's allowed workspaces gate which customer slug they can
// write into. There is no PUT / PATCH / DELETE — continuity history
// is immutable by design.

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { recordOutcome } from "@/lib/recovery/outcomes/store";
import {
  isOutcomeSource,
  isOutcomeType,
  type OutcomeSource,
  type OutcomeType,
} from "@/lib/recovery/outcomes/types";

const PUBLIC_BRIEF_SOURCE: OutcomeSource = "recovery_brief";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const customer = typeof body.customer === "string" ? body.customer.trim() : "";
  const leadKey = typeof body.leadKey === "string" ? body.leadKey.trim() : "";
  const outcome = body.outcome;
  const source = body.source;
  const note = typeof body.note === "string" ? body.note.trim() || undefined : undefined;
  const nextReviewAt = typeof body.nextReviewAt === "string" ? body.nextReviewAt : undefined;
  const staleScoreAtTime =
    typeof body.staleScoreAtTime === "number" && Number.isFinite(body.staleScoreAtTime)
      ? body.staleScoreAtTime
      : undefined;
  const decisionBucketAtTime =
    typeof body.decisionBucketAtTime === "string" ? body.decisionBucketAtTime : undefined;

  if (!customer) {
    return NextResponse.json({ ok: false, error: "customer is required" }, { status: 400 });
  }
  if (!leadKey) {
    return NextResponse.json({ ok: false, error: "leadKey is required" }, { status: 400 });
  }
  if (!isOutcomeType(outcome)) {
    return NextResponse.json({ ok: false, error: "unknown outcome" }, { status: 400 });
  }
  if (!isOutcomeSource(source)) {
    return NextResponse.json({ ok: false, error: "unknown source" }, { status: 400 });
  }

  const session = await getSession();

  // The recovery_brief source is publicly capturable so a brief link
  // shared with a founder works without a session cookie. Every other
  // source requires the operator to be signed in AND to have the
  // customer workspace in their allow-list.
  if (source !== PUBLIC_BRIEF_SOURCE) {
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!session.workspaces.includes(customer)) {
      return NextResponse.json({ ok: false, error: "Forbidden workspace" }, { status: 403 });
    }
  }

  try {
    const record = await recordOutcome(customer, {
      leadKey,
      outcome: outcome as OutcomeType,
      source: source as OutcomeSource,
      note,
      nextReviewAt,
      operator: session?.id ?? undefined,
      staleScoreAtTime,
      decisionBucketAtTime,
    });
    return NextResponse.json({ ok: true, record });
  } catch (err) {
    const message = err instanceof Error ? err.message : "record failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
