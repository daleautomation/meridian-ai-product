import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyIngestionEvents, type IngestionBatch } from "@/lib/ae-jobs/ingestion";
import { loadAeJobsStore, saveAeJobsStore } from "@/lib/ae-jobs/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/ae-jobs/ingest
 * Accepts IngestionBatch from future Claude/Gmail parser. Admin-only for now.
 */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let batch: IngestionBatch;
  try {
    batch = (await req.json()) as IngestionBatch;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(batch?.events)) {
    return NextResponse.json({ success: false, error: "events array required" }, { status: 400 });
  }

  const store = await loadAeJobsStore(user.id);
  const seen = new Set<string>();
  const { opportunities, result } = applyIngestionEvents(store.opportunities, batch, seen);

  const nextStore = {
    ...store,
    opportunities,
    lastIngestedAt: batch.ingestedAt ?? new Date().toISOString(),
  };
  await saveAeJobsStore(nextStore);

  return NextResponse.json({ success: true, result, store: nextStore });
}
