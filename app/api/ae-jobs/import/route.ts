import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildAeJobsWorkspaceModel } from "@/lib/ae-jobs/workspace";
import { importOpportunities } from "@/lib/ae-jobs/store";
import type { JobOpportunity } from "@/lib/ae-jobs/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/ae-jobs/import
 * Manual JSON import — paste seed or exported opportunities.
 * Body: { mode?: "replace" | "merge", opportunities: JobOpportunity[] }
 */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { mode = "replace", opportunities } = body as {
    mode?: "replace" | "merge";
    opportunities?: JobOpportunity[];
  };

  if (!Array.isArray(opportunities) || opportunities.length === 0) {
    return NextResponse.json(
      { success: false, error: "opportunities array required" },
      { status: 400 },
    );
  }

  if (mode !== "replace" && mode !== "merge") {
    return NextResponse.json({ success: false, error: "mode must be replace or merge" }, { status: 400 });
  }

  const store = await importOpportunities(opportunities, mode, user.id);
  const model = buildAeJobsWorkspaceModel(store.opportunities, user, store.lastIngestedAt);

  return NextResponse.json({ success: true, store, model });
}
