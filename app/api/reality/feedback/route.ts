import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FEEDBACK_TYPES = new Set(["did_this", "ignored", "better_than_expected", "worse_than_expected"]);

/**
 * POST /api/reality/feedback
 * Records Dylan's response to a recommendation. Appends to a local JSONL feedback
 * log (data/reality/feedback.jsonl). This is the calibration signal the Trust Model
 * needs — later it graduates into execution_outcomes when the DB path is on.
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

  const entry = {
    ownerId,
    subjectKey: body.subjectKey,
    subjectLabel: body.subjectLabel ?? body.subjectKey,
    feedback: body.feedback,
    rank: body.rank ?? null,
    recordedAt: new Date().toISOString(),
    meridianInfluenced: true,
  };

  const dir = process.env.MERIDIAN_OUTCOMES_DIR ?? path.join(process.cwd(), "data", "reality");
  const file = path.join(dir, "feedback.jsonl");
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // On a read-only serverless FS, fall back to /tmp so feedback is never lost silently.
    try {
      await fs.appendFile(path.join("/tmp", "meridian-feedback.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      return NextResponse.json({ ok: false, error: "could not persist feedback" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, recorded: entry.feedback });
}
