import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveFeedback } from "@/lib/review/store";
import type { FeedbackEntry } from "@/lib/review/types";

export const dynamic = "force-dynamic";

const FEEDBACK_TYPES = new Set(["did_this", "ignored", "better_than_expected", "worse_than_expected"]);

/**
 * POST /api/reality/feedback
 * Records Dylan's response to a recommendation — the calibration signal the nightly
 * review reads. Persists durably (Neon when DATABASE_URL is set, so it survives
 * across serverless invocations; file/tmp fallback otherwise).
 */
export async function POST(req: NextRequest) {
  const user = await getSession().catch(() => null);
  const ownerId = user?.id ?? "dylan";

  let body: { subjectKey?: string; subjectLabel?: string; feedback?: string; rank?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!body.subjectKey || !body.feedback || !FEEDBACK_TYPES.has(body.feedback)) {
    return NextResponse.json({ ok: false, error: "subjectKey and a valid feedback type are required" }, { status: 400 });
  }

  const recordedAt = new Date().toISOString();
  const entry: FeedbackEntry & { id: string } = {
    id: `${ownerId}:${body.subjectKey}:${recordedAt}`,
    ownerId,
    subjectKey: body.subjectKey,
    subjectLabel: body.subjectLabel ?? body.subjectKey,
    feedback: body.feedback as FeedbackEntry["feedback"],
    rank: body.rank ?? null,
    recordedAt,
  };

  try {
    await saveFeedback(entry);
  } catch {
    return NextResponse.json({ ok: false, error: "could not persist feedback" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, recorded: entry.feedback });
}
