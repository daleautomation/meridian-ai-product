// Meridian AI — Yelp Fusion adapter.
//
// Returns candidates when YELP_API_KEY is configured; otherwise returns [].

import type { ContactCandidate, Identity } from "../types";

const ENDPOINT = "https://api.yelp.com/v3/businesses/search";

type YelpBusiness = {
  id: string;
  name: string;
  phone?: string;
  display_phone?: string;
  location?: { display_address?: string[] };
  url?: string;
  rating?: number;
  review_count?: number;
};

export async function searchYelp(identity: Identity): Promise<ContactCandidate[]> {
  const key = process.env.YELP_API_KEY;
  if (!key) return [];

  const locationStr = [identity.city, identity.state].filter(Boolean).join(", ");
  if (!locationStr && !identity.rawName) return [];

  const params = new URLSearchParams({
    term: identity.rawName,
    location: locationStr || "Kansas City, MO",
    categories: "roofing",
    limit: "5",
  });

  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { businesses?: YelpBusiness[] };
    return (json.businesses ?? []).map((b) => ({
      name: b.name,
      address: b.location?.display_address?.join(", "),
      phone: b.display_phone || b.phone,
      website: b.url,
      rating: b.rating,
      reviewCount: b.review_count,
      source: "yelp",
      sourceId: b.id,
      fallbackUrl: b.url,
    }));
  } catch {
    return [];
  }
}
