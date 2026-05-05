// Meridian AI — trade lead ingestion route.
//
// POST /api/ingestion/trade-leads
// Body: { tradeId: TradeId, market?: "kansas_city" }
//
// Pulls Google Places text-search results for the trade's declared
// query catalog, normalizes through normalizeTradeLead, dedupes, and
// returns the records. Server-side only — GOOGLE_PLACES_API_KEY never
// leaves this file. No persistence yet (returns the records and lets
// the client cache them locally until a real store lands).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  buildTradeSearchQueries,
  normalizeTradeLead,
  validateTradeLeadRecord,
  type TradeLeadRecord,
} from "@/lib/ingestion/tradeLeadIngestion";
import { isTradeId, type TradeId } from "@/lib/modules/tradeConfigs";

interface PlaceTextSearchResult {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  types?: string[];
}

interface PlaceDetailsResult {
  place_id?: string;
  name?: string;
  website?: string;
  formatted_phone_number?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  types?: string[];
}

// Google Places Web Service v1 (legacy textsearch + details). Stable,
// works with a basic Places API key, no extra OAuth.
const PLACES_TEXT_SEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const PLACES_DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json";
const DETAIL_FIELDS = [
  "place_id",
  "name",
  "website",
  "formatted_phone_number",
  "formatted_address",
  "rating",
  "user_ratings_total",
  "business_status",
  "types",
].join(",");

const MAX_RESULTS_PER_QUERY = 8;
const MAX_PLACE_DETAIL_LOOKUPS = 30;

function dedupeKey(name?: string, address?: string): string {
  return `${(name ?? "").toLowerCase().trim()}|${(address ?? "").toLowerCase().trim()}`;
}

async function googlePlacesTextSearch(
  query: string,
  apiKey: string,
): Promise<PlaceTextSearchResult[]> {
  const url = new URL(PLACES_TEXT_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("region", "us");
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null) as { results?: PlaceTextSearchResult[] } | null;
  if (!json?.results) return [];
  return json.results.slice(0, MAX_RESULTS_PER_QUERY);
}

async function googlePlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<PlaceDetailsResult | null> {
  const url = new URL(PLACES_DETAILS_URL);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", DETAIL_FIELDS);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null) as { result?: PlaceDetailsResult } | null;
  return json?.result ?? null;
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing GOOGLE_PLACES_API_KEY" },
      { status: 400 },
    );
  }

  let body: { tradeId?: unknown; market?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const rawTrade = body?.tradeId;
  if (typeof rawTrade !== "string" || !isTradeId(rawTrade)) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid tradeId" },
      { status: 400 },
    );
  }
  const tradeId = rawTrade as TradeId;
  const market = (typeof body?.market === "string" && body.market === "kansas_city")
    ? "kansas_city"
    : "kansas_city";

  // Use only the google_places source descriptor — the file declares
  // others (serpapi, apollo, etc.) but only Places is wired here.
  const sources = buildTradeSearchQueries(tradeId, market);
  const places = sources.find((s) => s.source === "google_places");
  if (!places) {
    return NextResponse.json(
      { ok: false, error: "No Places query catalog for this trade" },
      { status: 400 },
    );
  }

  // Run text search per query. Dedupe by place_id when available,
  // then by normalized name|address as a secondary guard so two queries
  // returning the same business with no place_id still collapse.
  const seenIds = new Set<string>();
  const seenNameAddr = new Set<string>();
  const detailQueue: Array<PlaceTextSearchResult & { _query: string }> = [];
  try {
    for (const query of places.queries) {
      const results = await googlePlacesTextSearch(query, apiKey);
      for (const r of results) {
        const idKey = r.place_id;
        const naKey = dedupeKey(r.name, r.formatted_address);
        if (idKey && seenIds.has(idKey)) continue;
        if (!idKey && seenNameAddr.has(naKey)) continue;
        if (idKey) seenIds.add(idKey);
        if (naKey) seenNameAddr.add(naKey);
        detailQueue.push({ ...r, _query: query });
        if (detailQueue.length >= MAX_PLACE_DETAIL_LOOKUPS) break;
      }
      if (detailQueue.length >= MAX_PLACE_DETAIL_LOOKUPS) break;
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Places text search failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // Fetch full details for each unique place. Skip closed businesses.
  const leads: TradeLeadRecord[] = [];
  for (const r of detailQueue) {
    if (!r.place_id) continue;
    let detail: PlaceDetailsResult | null = null;
    try {
      detail = await googlePlaceDetails(r.place_id, apiKey);
    } catch {
      detail = null;
    }
    const businessStatus = detail?.business_status ?? r.business_status;
    if (businessStatus && businessStatus !== "OPERATIONAL") continue;

    const types = detail?.types ?? r.types ?? [];
    // Compose the raw shape the normalizer expects, plus the extra
    // source context (originating query + Place types + raw signal
    // tokens) so downstream classifiers can make better calls without
    // re-fetching anything.
    const merged: Parameters<typeof normalizeTradeLead>[0] & {
      sourceQuery?: string;
      sourceTypes?: string[];
      rawSignals?: string[];
    } = {
      place_id: r.place_id,
      name: detail?.name ?? r.name,
      website: detail?.website,
      formatted_phone_number: detail?.formatted_phone_number,
      formatted_address: detail?.formatted_address ?? r.formatted_address,
      rating: detail?.rating ?? r.rating,
      user_ratings_total: detail?.user_ratings_total ?? r.user_ratings_total,
      sourceQuery: r._query,
      sourceTypes: types,
      rawSignals: [
        r._query,
        detail?.name ?? r.name ?? "",
        ...(types ?? []),
      ].filter(Boolean) as string[],
    };
    const normalized = normalizeTradeLead(merged, tradeId, "google_places");
    if (!normalized) continue;
    const ok = validateTradeLeadRecord(normalized).ok;
    if (ok) leads.push(normalized);
  }

  return NextResponse.json({
    ok: true,
    tradeId,
    market,
    count: leads.length,
    leads,
  });
}
