// GET    /api/negotiation/state?itemId=X      → retrieve stored state
// POST   /api/negotiation/state                → update stored state
// DELETE /api/negotiation/state?itemId=X      → clear stored state
//
// Tenant-protected via session. State is shared across all tenants in the
// current single-user dev model — namespace by user later if needed.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getNegotiation,
  setNegotiation,
  clearNegotiation,
} from "@/lib/state/negotiationStore";
import type { NegotiationState } from "@/lib/scoring/acquisition";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return NextResponse.json(
      { error: "itemId query param required" },
      { status: 400 }
    );
  }
  const stored = await getNegotiation(itemId);
  return NextResponse.json({ stored });
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: {
    itemId?: string;
    negotiationState?: NegotiationState;
    lastOfferSent?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.itemId || !body.negotiationState) {
    return NextResponse.json(
      { error: "itemId and negotiationState required" },
      { status: 400 }
    );
  }
  const stored = await setNegotiation(String(body.itemId), {
    negotiationState: body.negotiationState,
    lastOfferSent: body.lastOfferSent,
  });
  return NextResponse.json({ stored });
}

export async function DELETE(req: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return NextResponse.json(
      { error: "itemId query param required" },
      { status: 400 }
    );
  }
  await clearNegotiation(itemId);
  return NextResponse.json({ ok: true });
}
