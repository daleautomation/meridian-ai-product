// Temporary test endpoint for the first real Google Places ingestion.
// Runs ingestFromGooglePlaces, attaches decideNormalizedLead output, and
// returns the trimmed shape requested in the wiring step. Read-only —
// no persistence, no UI side effects.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ingestFromGooglePlaces } from "@/lib/ingestion/sources/googlePlaces";
import { decideNormalizedLead } from "@/lib/scoring/decision";
import type { ModuleId } from "@/lib/leads/normalizedLead";

export const dynamic = "force-dynamic";

const SUPPORTED: ModuleId[] = [
  "roofing",
  "hvac",
  "carpentry",
  "painting",
  "plumbing",
  "electrical",
  "remodeling",
];

function pickModule(raw: string | null): ModuleId {
  if (!raw) return "roofing";
  const v = raw.toLowerCase();
  return (SUPPORTED as string[]).includes(v) ? (v as ModuleId) : "roofing";
}

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const moduleId = pickModule(req.nextUrl.searchParams.get("module"));

  try {
    const ingested = await ingestFromGooglePlaces({
      workspaceSlug: "labortech",
      moduleId,
      limit: 5,
    });

    const leads = ingested.map((l) => {
      const decision = decideNormalizedLead(l);
      return {
        companyName: l.companyName,
        phone: l.phone,
        website: l.website,
        signals: l.signals,
        evidence: l.evidence,
        decision,
      };
    });

    return NextResponse.json({
      success: true,
      moduleId,
      count: leads.length,
      leads,
    });
  } catch (err) {
    console.error("[google-places-test] error:", err);
    const message = err instanceof Error ? err.message : "Ingestion failed";
    return NextResponse.json({ success: false, moduleId, error: message }, { status: 500 });
  }
}
