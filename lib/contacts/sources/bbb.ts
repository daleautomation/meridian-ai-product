// Meridian AI — BBB adapter.
//
// BBB has no public API for business search. When BBB_SEARCH_URL is set (for
// example to an internal scraping proxy), the adapter will use it with a
// `q` query param and expect the JSON shape documented below. Otherwise
// returns [] silently so the resolver moves on.
//
// Expected proxy response:
//   {
//     "results": [{
//       "name": "Titan Roofing",
//       "address": "1234 Main St, Overland Park, KS 66210",
//       "phone": "(816) 555-0184",
//       "url": "https://www.bbb.org/us/ks/overland-park/profile/...",
//       "rating": 4.8,
//       "reviewCount": 27
//     }]
//   }

import type { ContactCandidate, Identity } from "../types";

type BbbResult = {
  name: string;
  address?: string;
  phone?: string;
  url?: string;
  rating?: number;
  reviewCount?: number;
};

export async function searchBBB(identity: Identity): Promise<ContactCandidate[]> {
  const endpoint = process.env.BBB_SEARCH_URL;
  if (!endpoint) return [];

  const params = new URLSearchParams({
    q: identity.rawName,
    city: identity.city,
    state: identity.state,
    category: identity.category,
  });

  try {
    const res = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: BbbResult[] };
    return (json.results ?? []).map((r) => ({
      name: r.name,
      address: r.address,
      phone: r.phone,
      website: r.url,
      rating: r.rating,
      reviewCount: r.reviewCount,
      source: "bbb",
      fallbackUrl: r.url,
    }));
  } catch {
    return [];
  }
}
