// Meridian AI — Google Places adapter.
//
// PRIMARY source for contact resolution. Uses Text Search followed by
// Place Details to get phone numbers. When no API key is configured the
// adapter returns [] rather than throwing — the resolver handles that as a
// source-unavailable state.
//
// Env vars (either works, GOOGLE_API_KEY preferred):
//   GOOGLE_API_KEY           — single Google Cloud key (recommended)
//   GOOGLE_PLACES_API_KEY    — legacy alias, kept for backward compat
//
// The caller can inspect isGooglePlacesConfigured() to emit a skip reason
// when the key is missing (see resolver debug detail).
//
// Matching strategy:
//   Runs a sequence of fallback queries until one returns live candidates.
//   Order is strictest → loosest so we prefer tight name+location matches
//   first and only fall back to generic "roofing in city" when we have to.
//   Per-query results are logged so mismatches are diagnosable.

import type { ContactCandidate, Identity } from "../types";
import { nameSimilarity } from "../identity";

const TEXTSEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";

type TextResult = {
  place_id: string;
  name: string;
  formatted_address?: string;
  types?: string[];
  business_status?: string;
};

type PlaceDetails = {
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
};

export function googlePlacesKey(): string | null {
  return process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? null;
}

export function isGooglePlacesConfigured(): boolean {
  return !!googlePlacesKey();
}

// Generate an ordered list of fallback queries. Dedupes while preserving
// order so the strongest query runs first. Empty strings are dropped.
function buildQueryFallbacks(identity: Identity): string[] {
  const { rawName, normalizedName, city, state, category } = identity;
  const loc = [city, state].filter(Boolean).join(" ").trim();

  const raw = [
    // 1. Full name + city/state + category (tightest)
    [rawName, loc, category].filter(Boolean).join(" "),
    // 2. Full name + city/state
    [rawName, loc].filter(Boolean).join(" "),
    // 3. Normalized name (LLC/Inc stripped) + city/state
    normalizedName && normalizedName !== rawName.toLowerCase()
      ? [normalizedName, loc].filter(Boolean).join(" ")
      : "",
    // 4. Full name alone
    rawName,
    // 5. Generic category fallback in city
    loc ? `${category || "roofing"} company ${loc}` : "",
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    const trimmed = q.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

async function runTextSearch(query: string, key: string): Promise<TextResult[]> {
  const url = `${TEXTSEARCH}?query=${encodeURIComponent(query)}&key=${key}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: TextResult[]; status?: string };
    if (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS") {
      console.warn(`[google_places] text_search status=${json.status} query="${query}"`);
    }
    return (json.results ?? []).filter((r) => r.business_status !== "CLOSED_PERMANENTLY");
  } catch (e) {
    console.warn(`[google_places] text_search error query="${query}" err=${e instanceof Error ? e.message : "unknown"}`);
    return [];
  }
}

async function runPlaceDetails(placeId: string, key: string): Promise<PlaceDetails | null> {
  const url = `${DETAILS}?place_id=${encodeURIComponent(placeId)}&fields=formatted_phone_number,international_phone_number,website,rating,user_ratings_total&key=${key}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: PlaceDetails; status?: string };
    if (json.status && json.status !== "OK") {
      console.warn(`[google_places] details status=${json.status} place_id=${placeId}`);
    }
    return json.result ?? null;
  } catch (e) {
    console.warn(`[google_places] details error place_id=${placeId} err=${e instanceof Error ? e.message : "unknown"}`);
    return null;
  }
}

async function enrichTopResults(
  results: TextResult[],
  key: string,
): Promise<ContactCandidate[]> {
  const top = results.slice(0, 3);
  const enriched = await Promise.all(
    top.map(async (place): Promise<ContactCandidate> => {
      const d = await runPlaceDetails(place.place_id, key);
      return {
        name: place.name,
        address: place.formatted_address,
        phone: d?.formatted_phone_number ?? d?.international_phone_number,
        website: d?.website,
        rating: d?.rating,
        reviewCount: d?.user_ratings_total,
        source: "google_places",
        sourceId: place.place_id,
      };
    }),
  );
  return enriched;
}

// Compact logger — one line per query. Keeps the key and candidate data out
// of the log; only metadata (name + similarity) is printed.
function logMatch(
  query: string,
  results: TextResult[],
  candidates: ContactCandidate[],
  identity: Identity,
) {
  const top = candidates[0];
  const sim = top ? nameSimilarity(top.name, identity.rawName).toFixed(2) : "—";
  const phoneCount = candidates.filter((c) => !!c.phone).length;
  console.info(
    `[google_places] query=${JSON.stringify(query)} results=${results.length} candidates=${candidates.length} withPhone=${phoneCount} top=${JSON.stringify(top?.name ?? null)} name_sim=${sim}`,
  );
}

export async function searchGooglePlaces(identity: Identity): Promise<ContactCandidate[]> {
  const key = googlePlacesKey();
  if (!key) return [];

  const queries = buildQueryFallbacks(identity);
  for (const query of queries) {
    const results = await runTextSearch(query, key);
    if (results.length === 0) {
      console.info(`[google_places] query=${JSON.stringify(query)} results=0 — trying next fallback`);
      continue;
    }
    const candidates = await enrichTopResults(results, key);
    logMatch(query, results, candidates, identity);
    if (candidates.length > 0) return candidates;
  }

  return [];
}
