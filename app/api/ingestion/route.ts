// Meridian AI — ingestion API.
//
// GET  /api/ingestion         → runner status + last run details
// POST /api/ingestion         → trigger manual run
// POST /api/ingestion?start   → start continuous runner
// POST /api/ingestion?stop    → stop continuous runner

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  runIngestion,
  startIngestionRunner,
  stopIngestionRunner,
  getRunnerStatus,
} from "@/lib/ingestion/runner";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getRunnerStatus());
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);

  if (url.searchParams.has("start")) {
    startIngestionRunner({ enabled: true, logging: true });
    return NextResponse.json({ action: "started", ...getRunnerStatus() });
  }

  if (url.searchParams.has("stop")) {
    stopIngestionRunner();
    return NextResponse.json({ action: "stopped", ...getRunnerStatus() });
  }

  // Default: trigger a single manual run
  const results = await runIngestion();
  return NextResponse.json({ action: "manual_run", results, ...getRunnerStatus() });
}
