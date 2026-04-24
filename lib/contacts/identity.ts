// Meridian AI — business identity normalization + candidate matching.
//
// Pure functions. No I/O. Deterministic scoring so the same inputs always
// produce the same match verdict.

import type {
  BusinessInput,
  Identity,
  ContactCandidate,
  CandidateScore,
} from "./types";

const GENERIC_SUFFIXES = /\b(llc|l\.?l\.?c\.?|inc\.?|incorporated|co\.?|company|corp\.?|corporation|ltd\.?|limited|pllc|lp|llp)\b\.?/gi;

export function normalizeIdentity(input: BusinessInput): Identity {
  const rawName = (input.companyName ?? "").trim();
  const lowered = rawName.toLowerCase();
  const noSuffix = lowered.replace(GENERIC_SUFFIXES, " ");
  const normalizedName = noSuffix
    .replace(/[.,&'"`]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const city = (input.city ?? "").trim().toLowerCase();
  const state = (input.state ?? "").trim().toUpperCase();
  const category = (input.category ?? "roofing").toLowerCase();
  const domain = (input.website ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  return {
    rawName,
    normalizedName,
    city,
    state,
    locationKey: `${city}|${state}`,
    category,
    domain,
  };
}

// ── Similarity ─────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

// Returns 0..1. Combines token Jaccard with Levenshtein for resilience
// against both typos and word re-ordering.
export function nameSimilarity(candidateName: string, inputName: string): number {
  if (!candidateName || !inputName) return 0;
  const ca = candidateName.toLowerCase().replace(GENERIC_SUFFIXES, "").replace(/[^a-z0-9 ]+/g, " ").trim();
  const cb = inputName.toLowerCase().replace(GENERIC_SUFFIXES, "").replace(/[^a-z0-9 ]+/g, " ").trim();
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  // Substring containment is a strong signal.
  const compactA = ca.replace(/\s+/g, "");
  const compactB = cb.replace(/\s+/g, "");
  if (compactA.includes(compactB) || compactB.includes(compactA)) {
    return 0.92;
  }

  // Token Jaccard.
  const ta = new Set(ca.split(/\s+/).filter(Boolean));
  const tb = new Set(cb.split(/\s+/).filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union > 0 ? inter / union : 0;

  // Normalized Levenshtein similarity on compact strings.
  const lev = levenshtein(compactA, compactB);
  const maxLen = Math.max(compactA.length, compactB.length);
  const levSim = maxLen > 0 ? 1 - lev / maxLen : 0;

  return Math.max(jaccard, levSim);
}

export function locationMatch(candidateAddress: string | undefined, identity: Identity): number {
  if (!candidateAddress) return 0;
  const addr = candidateAddress.toLowerCase();
  let score = 0;
  if (identity.city && addr.includes(identity.city)) score += 0.7;
  if (identity.state) {
    const stateLower = identity.state.toLowerCase();
    if (addr.includes(` ${stateLower} `) || addr.includes(`, ${stateLower}`) || addr.endsWith(` ${stateLower}`)) {
      score += 0.3;
    }
  }
  return Math.min(score, 1);
}

export function categoryMatch(candidate: ContactCandidate, identity: Identity): number {
  const fields = `${candidate.name} ${candidate.address ?? ""} ${candidate.website ?? ""}`.toLowerCase();
  const primary = identity.category === "roofing"
    ? ["roof", "roofing", "shingle", "storm damage", "metal roof"]
    : [identity.category];
  const hit = primary.some((k) => fields.includes(k));
  return hit ? 1 : 0.3;
}

// Weighted composite: name 60%, location 30%, category 10%.
export function scoreCandidate(candidate: ContactCandidate, identity: Identity): CandidateScore {
  const name = nameSimilarity(candidate.name, identity.rawName);
  const location = locationMatch(candidate.address, identity);
  const category = categoryMatch(candidate, identity);
  const total = name * 0.6 + location * 0.3 + category * 0.1;
  return { name, location, category, total };
}
