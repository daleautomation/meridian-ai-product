// Meridian — Public-Record Intelligence Architecture v1, Commit B
//
// Shared pre-normalization for raw addresses BEFORE the canonical
// pipeline (normalizeAddress + canonicalPropertyKey) consumes them.
//
// Why this exists (Architecture doc §11.5): the existing
// `canonicalPropertyKey` is intentionally STRICT — case-insensitive
// only. "West" and "W" produce different canonical keys; so do
// "Street" and "St" (the latter pair are unified inside normalizeAddress
// via its suffix map, but multi-letter directional words are not).
//
// To make CRM × MLS × county × Dotloop joins deterministic, EVERY
// source's preprocessor must pass its addresses through this helper
// first so abbreviation usage is consistent before canonicalization.
//
// Pure. No I/O. No external state. Same input → same output.

const DIRECTIONAL_EXPANSIONS: ReadonlyArray<[RegExp, string]> = [
  // Whole-word directionals → single-letter abbreviation.
  // Word-boundary anchored so "Northside Dr" is NOT touched.
  [/\bnorth\b/gi, "N"],
  [/\bsouth\b/gi, "S"],
  [/\beast\b/gi, "E"],
  [/\bwest\b/gi, "W"],
  [/\bnortheast\b/gi, "NE"],
  [/\bnorthwest\b/gi, "NW"],
  [/\bsoutheast\b/gi, "SE"],
  [/\bsouthwest\b/gi, "SW"],
];

const SUFFIX_EXPANSIONS: ReadonlyArray<[RegExp, string]> = [
  // Long-form suffix → standard abbreviation. The existing
  // normalizeAddress already does most of these via its STREET_SUFFIX
  // table, but applying them here keeps the canonical CSV output
  // visually consistent so founder review is easier.
  [/\bstreet\b/gi, "St"],
  [/\bavenue\b/gi, "Ave"],
  [/\bboulevard\b/gi, "Blvd"],
  [/\bdrive\b/gi, "Dr"],
  [/\blane\b/gi, "Ln"],
  [/\broad\b/gi, "Rd"],
  [/\bcourt\b/gi, "Ct"],
  [/\bplace\b/gi, "Pl"],
  [/\bcircle\b/gi, "Cir"],
  [/\btrail\b/gi, "Trl"],
  [/\bparkway\b/gi, "Pkwy"],
];

/**
 * Apply deterministic whole-word substitutions so that "W" / "West",
 * "St" / "Street", etc. converge to one form BEFORE the canonical
 * normalizer runs. Removes trailing periods from any single-letter
 * directional ("W." → "W").
 *
 * The transform is idempotent: running it twice yields the same
 * output as running it once.
 */
export function preNormalizeAddress(raw: string): string {
  if (!raw) return "";
  let out = raw;
  // Strip period after a single-letter directional ("W." → "W").
  out = out.replace(/\b([NSEW])\./gi, "$1");
  // Strip period after a standard suffix abbreviation ("St." → "St").
  out = out.replace(
    /\b(St|Ave|Blvd|Dr|Ln|Rd|Ct|Pl|Cir|Trl|Pkwy)\./gi,
    "$1",
  );
  for (const [re, repl] of DIRECTIONAL_EXPANSIONS) {
    out = out.replace(re, repl);
  }
  for (const [re, repl] of SUFFIX_EXPANSIONS) {
    out = out.replace(re, repl);
  }
  // Collapse internal whitespace; preserve leading/trailing trim.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}
