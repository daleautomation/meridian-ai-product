import { NextRequest, NextResponse } from "next/server";
import { resolveBriefActionPatch, type BriefExecutionAction } from "@/lib/ae-jobs/brief-actions";
import {
  listOpportunities,
  loadAeJobsStore,
  updateOpportunityChecklist,
  updateOpportunityFields,
} from "@/lib/ae-jobs/store";
import { NEEDS_DYLAN_CATEGORIES } from "@/lib/ae-jobs/types";
import type { NeedsDylanCategory } from "@/lib/ae-jobs/types";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ACTIONS: BriefExecutionAction[] = ["mark_done", "snooze", "log_touchpoint"];

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

  const { opportunityId, action, category, note } = body as {
    opportunityId?: string;
    action?: string;
    category?: string;
    note?: string;
  };

  if (!opportunityId || typeof opportunityId !== "string") {
    return NextResponse.json({ success: false, error: "opportunityId required" }, { status: 400 });
  }

  if (!action || !ACTIONS.includes(action as BriefExecutionAction)) {
    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  }

  let safeCategory: NeedsDylanCategory | undefined;
  if (category !== undefined) {
    if (!NEEDS_DYLAN_CATEGORIES.includes(category as NeedsDylanCategory)) {
      return NextResponse.json({ success: false, error: "Invalid category" }, { status: 400 });
    }
    safeCategory = category as NeedsDylanCategory;
  }

  if (action === "mark_done" && !safeCategory) {
    return NextResponse.json({ success: false, error: "category required for mark_done" }, { status: 400 });
  }

  const store = await loadAeJobsStore(user.id);
  const opp = store.opportunities.find((o) => o.id === opportunityId);
  if (!opp) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  let patch;
  try {
    patch = resolveBriefActionPatch(opp, action as BriefExecutionAction, {
      category: safeCategory,
      note: typeof note === "string" ? note : "",
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Invalid action" },
      { status: 400 },
    );
  }

  let updated = opp;
  if (patch.checklist && Object.keys(patch.checklist).length > 0) {
    const next = await updateOpportunityChecklist(opportunityId, patch.checklist, user.id);
    if (!next) {
      return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
    }
    updated = next;
  }

  if (patch.fields && Object.keys(patch.fields).length > 0) {
    const next = await updateOpportunityFields(opportunityId, patch.fields, user.id);
    if (!next) {
      return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
    }
    updated = next;
  }

  const opportunities = await listOpportunities(user.id);
  return NextResponse.json({ success: true, opportunity: updated, opportunities });
}
