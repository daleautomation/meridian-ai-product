// Meridian AI — contact resolution engine.
//
// Identity-first orchestrator: normalize business → query all candidate
// sources in parallel → score candidates → extract best phone or fallback
// route → score confidence → return a structured result.
//
// Never throws. Partial source failures degrade gracefully (empty arrays).
// Never returns a "no contact found" dead-end if any fallback URL exists.

import { normalizeIdentity, scoreCandidate } from "./identity";
import { searchGooglePlaces } from "./sources/googlePlaces";
import { searchYelp } from "./sources/yelp";
import { searchBBB } from "./sources/bbb";
import { searchFacebook } from "./sources/facebook";
import type {
  BusinessInput,
  ContactCandidate,
  ContactResolution,
  ContactSource,
  ContactConfidence,
  MatchedCandidate,
} from "./types";

// Below this score, we do not trust a candidate is the same business.
// Name similarity + location + category weighted. 0.80 matches the spec
// "name similarity > 80%" when location and category are also a clean hit.
const MATCH_THRESHOLD = 0.80;

type Adapter = {
  key: ContactSource;
  fn: (identity: ReturnType<typeof normalizeIdentity>) => Promise<ContactCandidate[]>;
};

const ADAPTERS: Adapter[] = [
  { key: "google_places", fn: searchGooglePlaces },
  { key: "yelp", fn: searchYelp },
  { key: "bbb", fn: searchBBB },
  { key: "facebook", fn: searchFacebook },
];

export async function resolveContact(input: BusinessInput): Promise<ContactResolution> {
  const identity = normalizeIdentity(input);
  const now = new Date().toISOString();
  const checkedSources: ContactSource[] = [];

  const settled = await Promise.allSettled(ADAPTERS.map((a) => a.fn(identity)));

  const allCandidates: ContactCandidate[] = [];
  settled.forEach((s, i) => {
    checkedSources.push(ADAPTERS[i].key);
    if (s.status === "fulfilled") allCandidates.push(...s.value);
  });

  if (allCandidates.length === 0) {
    return emptyResult(checkedSources, now);
  }

  const scored: MatchedCandidate[] = allCandidates
    .map((c) => ({ ...c, score: scoreCandidate(c, identity) }))
    .filter((c) => c.score.total >= MATCH_THRESHOLD)
    .sort((a, b) => b.score.total - a.score.total);

  if (scored.length === 0) {
    // We got candidates but nothing clears the threshold. Still return the
    // closest one's fallback URL if we have one so the operator can verify
    // manually instead of seeing a dead-end.
    const nearMiss = allCandidates
      .map((c) => ({ ...c, score: scoreCandidate(c, identity) }))
      .sort((a, b) => b.score.total - a.score.total)[0];
    if (nearMiss?.fallbackUrl) {
      return {
        phone: null,
        email: null,
        fallbackRoute: nearMiss.source === "facebook" ? "facebook" : "contact_page",
        fallbackUrl: nearMiss.fallbackUrl,
        source: nearMiss.source,
        confidence: "low",
        checkedSources,
        matchedName: nearMiss.name,
        lastCheckedAt: now,
        summary: "fallback",
      };
    }
    return emptyResult(checkedSources, now);
  }

  // Phone preference: first top-scored candidate with a phone.
  const withPhone = scored.find((c) => !!c.phone);

  if (withPhone) {
    const confidence: ContactConfidence =
      withPhone.source === "google_places" ? "high" :
      withPhone.source === "yelp" || withPhone.source === "bbb" ? "medium" :
      "low";
    return {
      phone: withPhone.phone ?? null,
      email: null, // never inferred
      fallbackRoute: null,
      fallbackUrl: withPhone.website ?? null,
      source: withPhone.source,
      confidence,
      checkedSources,
      matchedName: withPhone.name,
      matchedAddress: withPhone.address,
      rating: withPhone.rating,
      reviewCount: withPhone.reviewCount,
      lastCheckedAt: now,
      summary: "found",
    };
  }

  // No phone. Prefer Facebook fallback (Messenger is directly actionable),
  // then any candidate with a fallback URL (contact page).
  const fb = scored.find((c) => c.source === "facebook" && !!c.fallbackUrl);
  if (fb) {
    return {
      phone: null,
      email: null,
      fallbackRoute: "facebook",
      fallbackUrl: fb.fallbackUrl ?? null,
      source: "facebook",
      confidence: "medium",
      checkedSources,
      matchedName: fb.name,
      lastCheckedAt: now,
      summary: "fallback",
    };
  }

  const site = scored.find((c) => !!c.website);
  if (site?.website) {
    return {
      phone: null,
      email: null,
      fallbackRoute: "contact_page",
      fallbackUrl: site.website,
      source: site.source,
      confidence: "low",
      checkedSources,
      matchedName: site.name,
      lastCheckedAt: now,
      summary: "fallback",
    };
  }

  return emptyResult(checkedSources, now);
}

function emptyResult(checkedSources: ContactSource[], now: string): ContactResolution {
  return {
    phone: null,
    email: null,
    fallbackRoute: null,
    fallbackUrl: null,
    source: "none",
    confidence: "none",
    checkedSources,
    lastCheckedAt: now,
    summary: "empty",
  };
}
