// Meridian AI — Google Places adapter.
//
// PRIMARY source for contact resolution. Uses Text Search followed by
// Place Details to get phone numbers. When GOOGLE_PLACES_API_KEY is not
// configured the adapter returns [] rather than throwing — the resolver
// handles that as a source-unavailable state.

import type { ContactCandidate, Identity } from "../types";

const TEXTSEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";

type TextResult = {
  place_id: string;
  name: string;
  formatted_address?: string;
};

type PlaceDetails = {
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
};

export async function searchGooglePlaces(identity: Identity): Promise<ContactCandidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];

  const query = [identity.rawName, identity.city, identity.state, identity.category]
    .filter(Boolean)
    .join(" ");

  const searchUrl = `${TEXTSEARCH}?query=${encodeURIComponent(query)}&key=${key}`;

  let searchJson: { results?: TextResult[] } | null = null;
  try {
    const res = await fetch(searchUrl, { cache: "no-store" });
    if (!res.ok) return [];
    searchJson = (await res.json()) as { results?: TextResult[] };
  } catch {
    return [];
  }

  const top = (searchJson?.results ?? []).slice(0, 3);
  if (top.length === 0) return [];

  const enriched = await Promise.all(
    top.map(async (place): Promise<ContactCandidate | null> => {
      const detailsUrl = `${DETAILS}?place_id=${encodeURIComponent(place.place_id)}&fields=formatted_phone_number,international_phone_number,website,rating,user_ratings_total&key=${key}`;
      try {
        const res = await fetch(detailsUrl, { cache: "no-store" });
        if (!res.ok) {
          return {
            name: place.name,
            address: place.formatted_address,
            source: "google_places",
            sourceId: place.place_id,
          };
        }
        const json = (await res.json()) as { result?: PlaceDetails };
        const d = json.result ?? {};
        return {
          name: place.name,
          address: place.formatted_address,
          phone: d.formatted_phone_number ?? d.international_phone_number,
          website: d.website,
          rating: d.rating,
          reviewCount: d.user_ratings_total,
          source: "google_places",
          sourceId: place.place_id,
        };
      } catch {
        return {
          name: place.name,
          address: place.formatted_address,
          source: "google_places",
          sourceId: place.place_id,
        };
      }
    })
  );

  return enriched.filter((c): c is ContactCandidate => c !== null);
}
