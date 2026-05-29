// Meridian — listing agent classifier.
//
// Decides whether the agent named on a listing matches the operator
// whose workspace we are scoring. Pure, deterministic, case-insensitive.
// No fuzzy AI matching. No first-name-only collisions.
//
// Comparison rules (in order):
//   1. Exact token-set match against any configured operator name
//      → returns `displayLabel` (typically "nicole" or "operator").
//   2. Surname-match (last token of configured name matches a token
//      of the listing-agent string, AND first-name token also appears)
//      → same label.
//   3. Listing-agent string present but no match → "other_agent".
//   4. Listing-agent string absent (null / blank) → "unknown".
//
// First-name-only matches are NEVER treated as a hit (the same first
// name can belong to many agents in any MLS region).

import type {
  ListingAgentMatch,
  OperatorIdentifiers,
} from "./types";

const PUNCT_RE = /[.,'"`()\[\]<>{}!?;:]/g;

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(PUNCT_RE, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function tokenSet(value: string): Set<string> {
  return new Set(tokens(value));
}

function surnameOf(name: string): string | null {
  // Last non-initial token. Mirrors the convention used elsewhere in
  // Meridian (propertyMatchRules, integrity classifier).
  const t = tokens(name);
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i].length > 1) return t[i];
  }
  return null;
}

function firstNameOf(name: string): string | null {
  const t = tokens(name);
  return t.length > 0 ? t[0] : null;
}

/**
 * Determine whether the listing agent string matches one of the
 * operator's configured identifiers. Pure. Deterministic.
 *
 * Two-pass comparison: exact token-set equality first (catches
 * "Lonergan, Nicole" vs "Nicole Lonergan"); then surname + first
 * name both present (catches "Nicole A. Lonergan" or
 * "Nicole Lonergan-Smith" via hyphen-split inside the surname
 * comparison helper below).
 */
export function classifyListingAgent(
  agentName: string | null | undefined,
  operatorIdentifiers: OperatorIdentifiers,
): ListingAgentMatch {
  if (agentName === null || agentName === undefined) return "unknown";
  const agentTrimmed = agentName.trim();
  if (agentTrimmed.length === 0) return "unknown";

  const agentTokens = new Set<string>();
  for (const t of tokens(agentTrimmed)) {
    agentTokens.add(t);
    // Split hyphenated tokens so "smith-jones" produces matches on
    // both "smith" and "jones" — mirrors propertyMatchRules.
    if (t.includes("-")) {
      for (const p of t.split("-")) {
        if (p.length > 0) agentTokens.add(p);
      }
    }
  }

  for (const candidate of operatorIdentifiers.names) {
    const candidateTrimmed = candidate.trim();
    if (candidateTrimmed.length === 0) continue;

    // Exact token-set match (order-insensitive).
    const candidateTokens = tokenSet(candidateTrimmed);
    let candidateSubsetOfAgent = true;
    for (const t of candidateTokens) {
      if (!agentTokens.has(t)) {
        candidateSubsetOfAgent = false;
        break;
      }
    }
    if (candidateSubsetOfAgent && candidateTokens.size > 0) {
      return operatorIdentifiers.displayLabel;
    }

    // Surname + first-name both present in agent tokens.
    const surname = surnameOf(candidateTrimmed);
    const first = firstNameOf(candidateTrimmed);
    if (surname && first && agentTokens.has(surname) && agentTokens.has(first)) {
      return operatorIdentifiers.displayLabel;
    }
  }

  return "other_agent";
}
