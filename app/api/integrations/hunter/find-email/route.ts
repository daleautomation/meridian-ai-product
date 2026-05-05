// Meridian — Hunter find-email endpoint.
//
// Server-side wrapper around lib/integrations/hunter.findEmailForLead.
// Lives behind the API boundary so the HUNTER_API_KEY env var stays
// out of the client bundle. Triggered only by the manual "Find Email"
// button in LeadDetail — never auto-fired.
//
// Body shape (the minimum the integration helper needs):
//   {
//     lead: {
//       id?: string;
//       website?: string;
//       domain?: string;
//       verifiedEmail?: string;
//       emailConfidence?: "high" | "medium" | "low";
//       contacts?: { contactName?: string };
//     }
//   }
//
// Returns:
//   200 { result: { email, confidence, rawScore?, contactName?, contactPosition? } | null }
//   200 { result: null }                                  ← when nothing found
//   400 { error: "missing_lead" }                         ← bad body
//
// Never 500 on a Hunter outage — findEmailForLead is fail-silent and
// returns null, which we forward as `{ result: null }`.
import { NextRequest, NextResponse } from "next/server";
import { findEmailForLead } from "@/lib/integrations/hunter";
import type { NormalizedLead } from "@/lib/leads/normalizedLead";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const lead = (body as { lead?: unknown } | null)?.lead;
  if (!lead || typeof lead !== "object") {
    return NextResponse.json({ error: "missing_lead" }, { status: 400 });
  }

  // The integration helper accepts a partial lead shape — we cast
  // through unknown rather than re-validating every field. The helper
  // itself is fail-silent so anything malformed becomes a clean null.
  const result = await findEmailForLead(lead as unknown as NormalizedLead);
  return NextResponse.json({ result }, { status: 200 });
}
