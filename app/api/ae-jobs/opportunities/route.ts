import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listOpportunities,
  loadAeJobsStore,
  updateOpportunityChecklist,
  updateOpportunityFields,
} from "@/lib/ae-jobs/store";
import type { ChecklistKey } from "@/lib/ae-jobs/types";
import { CHECKLIST_KEYS } from "@/lib/ae-jobs/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const store = await loadAeJobsStore(user.id);
  return NextResponse.json({ success: true, store });
}

export async function PATCH(req: NextRequest) {
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

  const { opportunityId, checklist, fields } = body as {
    opportunityId?: string;
    checklist?: Partial<Record<ChecklistKey, boolean>>;
    fields?: Record<string, unknown>;
  };

  if (!opportunityId || typeof opportunityId !== "string") {
    return NextResponse.json({ success: false, error: "opportunityId required" }, { status: 400 });
  }

  let updated = null;

  if (checklist && typeof checklist === "object") {
    const safe: Partial<Record<ChecklistKey, boolean>> = {};
    for (const key of CHECKLIST_KEYS) {
      if (typeof checklist[key] === "boolean") safe[key] = checklist[key];
    }
    updated = await updateOpportunityChecklist(opportunityId, safe, user.id);
  }

  if (fields && typeof fields === "object") {
    updated = await updateOpportunityFields(
      opportunityId,
      fields as Parameters<typeof updateOpportunityFields>[1],
      user.id,
    );
  }

  if (!updated) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  const opportunities = await listOpportunities(user.id);
  return NextResponse.json({ success: true, opportunity: updated, opportunities });
}
