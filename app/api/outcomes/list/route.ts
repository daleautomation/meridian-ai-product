// Meridian — Outcome Loop, read endpoint.
//
// GET /api/outcomes/list?customer=<slug>&leadKey=<key>
//
// Returns the full append-only outcome history for the customer,
// optionally scoped to one leadKey. The list is publicly readable for
// a brief context (so a shared brief link can render its continuity
// strip without auth), but workspace operators see the same data —
// the resource is per-customer, not per-operator.

import { NextResponse } from "next/server";

import { listOutcomesFor } from "@/lib/recovery/outcomes/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customer = url.searchParams.get("customer")?.trim() ?? "";
  const leadKey = url.searchParams.get("leadKey")?.trim() || undefined;

  if (!customer) {
    return NextResponse.json({ ok: false, error: "customer is required" }, { status: 400 });
  }

  try {
    const outcomes = await listOutcomesFor(customer, leadKey);
    return NextResponse.json({ ok: true, outcomes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "list failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
