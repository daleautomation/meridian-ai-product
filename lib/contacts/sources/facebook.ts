// Meridian AI — Facebook adapter.
//
// Facebook Graph no longer exposes Pages Public Content. When
// FACEBOOK_SEARCH_URL is set (an internal proxy), the adapter calls it and
// expects the JSON shape documented below. Otherwise returns [].
//
// Expected proxy response:
//   {
//     "results": [{
//       "name": "Titan Roofing KC",
//       "pageUrl": "https://www.facebook.com/titanroofingkc",
//       "phone": "(816) 555-0184",
//       "city": "Overland Park, KS"
//     }]
//   }

import type { ContactCandidate, Identity } from "../types";

type FbResult = {
  name: string;
  pageUrl: string;
  phone?: string;
  city?: string;
};

export async function searchFacebook(identity: Identity): Promise<ContactCandidate[]> {
  const endpoint = process.env.FACEBOOK_SEARCH_URL;
  if (!endpoint) return [];

  const params = new URLSearchParams({
    q: identity.rawName,
    city: identity.city,
    state: identity.state,
  });

  try {
    const res = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: FbResult[] };
    return (json.results ?? []).map((r) => ({
      name: r.name,
      address: r.city,
      phone: r.phone,
      source: "facebook",
      fallbackUrl: r.pageUrl,
    }));
  } catch {
    return [];
  }
}
