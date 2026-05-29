// Meridian — deterministic US residential address normalizer.
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §5 Deterministic Signal Rules — same input → same output. No
//       fuzzy AI parsing, no LLM disambiguation, no network calls.
//   §10 Auditability — every transformation is traceable; the
//       returned `confidence` declares how strong the parse was.
//
// Strict rules:
//   • Pure function. No `Date.now()`, no `Math.random()`, no I/O.
//   • USPS Publication 28 suffix + directional canonicalization,
//     enough subset to handle Wise Agent / Follow Up Boss / similar
//     residential CRM exports without claiming exhaustive USPS
//     coverage.
//   • Output never invents fields. If the input is missing a ZIP,
//     the output's `zip` is null. The audit layer reports coverage;
//     the normalizer does not paper over absence.
//   • Confidence is a property of the parse, not of the underlying
//     address's real-world existence. We are saying "we extracted
//     these components reliably," not "this address exists."

// ── Public types ───────────────────────────────────────────────────

export type AddressNormalizationConfidence = "HIGH" | "MED" | "LOW" | "NONE";

export interface NormalizedAddress {
  /** Canonical single-line normalized form, e.g.
   *  "4321 west 63rd street, kansas city, mo 64113". Lowercase, no
   *  punctuation, single-spaced. Empty string when input was unusable.
   */
  normalizedAddress: string;
  streetNumber: string | null;
  streetName: string | null;   // includes pre-directional + suffix
  city: string | null;
  state: string | null;        // 2-letter USPS code, uppercase
  zip: string | null;          // 5 digits; ZIP+4 truncated to 5
  confidence: AddressNormalizationConfidence;
  /** Diagnostic flags so the audit layer can explain why confidence
   *  was downgraded. Never operator-facing. */
  diagnostics: readonly string[];
}

// ── USPS-style canonical maps (Pub 28 subset) ──────────────────────

// Single canonical suffix per common abbreviation. Lowercased here.
const STREET_SUFFIX_MAP: ReadonlyMap<string, string> = new Map([
  ["st", "street"],
  ["st.", "street"],
  ["str", "street"],
  ["ave", "avenue"],
  ["av", "avenue"],
  ["ave.", "avenue"],
  ["blvd", "boulevard"],
  ["blvd.", "boulevard"],
  ["dr", "drive"],
  ["dr.", "drive"],
  ["ln", "lane"],
  ["ln.", "lane"],
  ["rd", "road"],
  ["rd.", "road"],
  ["ct", "court"],
  ["ct.", "court"],
  ["cir", "circle"],
  ["cir.", "circle"],
  ["pl", "place"],
  ["pl.", "place"],
  ["pkwy", "parkway"],
  ["pkwy.", "parkway"],
  ["hwy", "highway"],
  ["hwy.", "highway"],
  ["ter", "terrace"],
  ["ter.", "terrace"],
  ["trl", "trail"],
  ["trl.", "trail"],
  ["sq", "square"],
  ["sq.", "square"],
  ["xing", "crossing"],
  ["xing.", "crossing"],
]);

// Lowercased pre/post directional. Two-letter abbreviations expand
// to a two-word form so "NE" → "northeast" (single token), but "N"
// stays single-token "north".
const DIRECTIONAL_MAP: ReadonlyMap<string, string> = new Map([
  ["n", "north"],
  ["s", "south"],
  ["e", "east"],
  ["w", "west"],
  ["ne", "northeast"],
  ["nw", "northwest"],
  ["se", "southeast"],
  ["sw", "southwest"],
  ["n.", "north"],
  ["s.", "south"],
  ["e.", "east"],
  ["w.", "west"],
]);

const UNIT_PREFIXES = new Set([
  "apt",
  "apt.",
  "unit",
  "ste",
  "ste.",
  "suite",
  "#",
  "no",
  "no.",
]);

// 2-letter USPS state codes. Lowercased here for matching.
const US_STATES: ReadonlySet<string> = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in",
  "ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv",
  "nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn",
  "tx","ut","vt","va","wa","wv","wi","wy","dc",
]);

// Full state names for reverse lookup. Lowercased.
const STATE_NAME_TO_CODE: ReadonlyMap<string, string> = new Map([
  ["alabama","al"],["alaska","ak"],["arizona","az"],["arkansas","ar"],
  ["california","ca"],["colorado","co"],["connecticut","ct"],["delaware","de"],
  ["florida","fl"],["georgia","ga"],["hawaii","hi"],["idaho","id"],
  ["illinois","il"],["indiana","in"],["iowa","ia"],["kansas","ks"],
  ["kentucky","ky"],["louisiana","la"],["maine","me"],["maryland","md"],
  ["massachusetts","ma"],["michigan","mi"],["minnesota","mn"],["mississippi","ms"],
  ["missouri","mo"],["montana","mt"],["nebraska","ne"],["nevada","nv"],
  ["new hampshire","nh"],["new jersey","nj"],["new mexico","nm"],["new york","ny"],
  ["north carolina","nc"],["north dakota","nd"],["ohio","oh"],["oklahoma","ok"],
  ["oregon","or"],["pennsylvania","pa"],["rhode island","ri"],["south carolina","sc"],
  ["south dakota","sd"],["tennessee","tn"],["texas","tx"],["utah","ut"],
  ["vermont","vt"],["virginia","va"],["washington","wa"],["west virginia","wv"],
  ["wisconsin","wi"],["wyoming","wy"],["district of columbia","dc"],
]);

// ── Helpers ────────────────────────────────────────────────────────

function stripPunctuation(token: string): string {
  // Strip leading/trailing commas, semicolons, etc. but keep dots so
  // we can match "st." style abbreviations against the suffix map.
  return token.replace(/^[,;:]+|[,;:]+$/g, "");
}

function canonicalToken(token: string): string {
  const lower = stripPunctuation(token).toLowerCase();
  const suffix = STREET_SUFFIX_MAP.get(lower);
  if (suffix) return suffix;
  const directional = DIRECTIONAL_MAP.get(lower);
  if (directional) return directional;
  // Strip a single trailing period after canonicalization fallback so
  // "Apt." → "apt" matches the unit-prefix set.
  return lower.replace(/\.$/, "");
}

function isUnitPrefix(token: string): boolean {
  return UNIT_PREFIXES.has(token.toLowerCase()) || /^#/.test(token);
}

function extractZipFromString(s: string): string | null {
  const m = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

function detectState(tokens: readonly string[]): { state: string | null; consumedIndices: readonly number[] } {
  // Check single-token 2-letter codes first; then 1- or 2-word state names.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = stripPunctuation(tokens[i]).toLowerCase();
    if (US_STATES.has(t)) return { state: t.toUpperCase(), consumedIndices: [i] };
  }
  // 2-word state names ("new york", "south dakota") and 1-word names.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const single = stripPunctuation(tokens[i]).toLowerCase();
    const candidate1 = STATE_NAME_TO_CODE.get(single);
    if (candidate1) return { state: candidate1.toUpperCase(), consumedIndices: [i] };
    if (i > 0) {
      const pair = `${stripPunctuation(tokens[i - 1]).toLowerCase()} ${single}`;
      const candidate2 = STATE_NAME_TO_CODE.get(pair);
      if (candidate2) return { state: candidate2.toUpperCase(), consumedIndices: [i - 1, i] };
    }
  }
  return { state: null, consumedIndices: [] };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Normalize a freeform CRM address. Pure, deterministic, no I/O.
 *
 * Input expectations (in approximate order of severity):
 *   • freeform single-line: "4321 W. 63rd St, Kansas City, MO 64113"
 *   • multi-line with newlines or commas
 *   • partial (city/state only, or street only)
 *   • empty/null → returns NONE-confidence empty result
 *
 * Output confidence:
 *   HIGH — street number + street name + city + state + ZIP all extracted
 *   MED  — at least street number + state OR ZIP + (street name or city)
 *   LOW  — only state and/or ZIP, no street
 *   NONE — input was empty/null or yielded nothing usable
 */
export function normalizeAddress(raw: string | null | undefined): NormalizedAddress {
  const diagnostics: string[] = [];
  const empty: NormalizedAddress = {
    normalizedAddress: "",
    streetNumber: null,
    streetName: null,
    city: null,
    state: null,
    zip: null,
    confidence: "NONE",
    diagnostics: Object.freeze(["empty_input"]),
  };
  if (typeof raw !== "string") return empty;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return empty;

  // Replace newlines + multiple separators with single commas so
  // tokenization is uniform.
  const flat = trimmed.replace(/\s*[\n\r]+\s*/g, ", ").replace(/\s+/g, " ").trim();

  // ZIP is easy and unambiguous — grab it from the whole string before
  // tokenization so a trailing "MO 64113-1234" doesn't get split weirdly.
  const zip = extractZipFromString(flat);
  if (!zip) diagnostics.push("no_zip");

  // Tokenize on whitespace + commas. Commas are preserved as separators
  // so we can later detect "street, city" boundaries.
  const tokensWithCommas = flat
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // State detection (last-mention wins) — exclude tokens that are clearly
  // ZIPs.
  const stateLookupTokens = tokensWithCommas.filter((t) => !/^\d{5}/.test(t));
  const stateResult = detectState(stateLookupTokens);
  const state = stateResult.state;
  if (!state) diagnostics.push("no_state");

  // Strip ZIP + state tokens from the remainder. Map back to original
  // indices via marker tokens.
  const remainingTokens: string[] = [];
  for (let i = 0; i < tokensWithCommas.length; i++) {
    const t = tokensWithCommas[i];
    const clean = stripPunctuation(t).toLowerCase();
    if (/^\d{5}(?:-\d{4})?$/.test(clean)) continue;
    if (state && US_STATES.has(clean) && clean === state.toLowerCase()) continue;
    if (state && STATE_NAME_TO_CODE.get(clean) === state.toLowerCase()) continue;
    remainingTokens.push(t);
  }

  // Find first comma index — heuristic for street vs city boundary.
  // CRMs often write "4321 W 63rd St, Kansas City, MO 64113".
  const firstCommaIdx = remainingTokens.findIndex((t) => /,$/.test(t));

  let streetTokens: string[];
  let cityTokens: string[];
  if (firstCommaIdx >= 0) {
    streetTokens = remainingTokens.slice(0, firstCommaIdx + 1).map((t) => t.replace(/,$/, ""));
    cityTokens = remainingTokens.slice(firstCommaIdx + 1).map((t) => t.replace(/,$/, ""));
  } else {
    // No comma — heuristic: first token that starts with a digit is the
    // street number; everything after is street; if no digit, treat all
    // as street (city absent).
    streetTokens = remainingTokens.map((t) => t.replace(/,$/, ""));
    cityTokens = [];
    diagnostics.push("no_comma_boundary");
  }

  // Strip unit suffixes from street tokens (Apt 2B, #305, Unit 4).
  const streetWithoutUnit: string[] = [];
  for (let i = 0; i < streetTokens.length; i++) {
    if (isUnitPrefix(streetTokens[i])) {
      // Skip this token and the next (the unit value itself).
      i++;
      continue;
    }
    if (/^#\d/.test(streetTokens[i])) continue; // "#305" inline
    streetWithoutUnit.push(streetTokens[i]);
  }

  // Extract street number (must be the first token, must start with a digit).
  let streetNumber: string | null = null;
  const streetRemainder: string[] = [];
  if (streetWithoutUnit.length > 0 && /^\d/.test(streetWithoutUnit[0])) {
    streetNumber = streetWithoutUnit[0].replace(/\D.*$/, "") || streetWithoutUnit[0];
    streetRemainder.push(...streetWithoutUnit.slice(1));
  } else {
    streetRemainder.push(...streetWithoutUnit);
    if (streetRemainder.length > 0) diagnostics.push("no_street_number");
  }

  const streetName = streetRemainder.length === 0
    ? null
    : streetRemainder.map(canonicalToken).filter(Boolean).join(" ");

  const city = cityTokens.length === 0
    ? null
    : cityTokens.map((t) => stripPunctuation(t).toLowerCase()).filter(Boolean).join(" ");

  // Confidence laddering.
  let confidence: AddressNormalizationConfidence;
  if (streetNumber && streetName && city && state && zip) confidence = "HIGH";
  else if (
    (streetNumber && state) ||
    (zip && (streetName || city))
  ) confidence = "MED";
  else if (state || zip) confidence = "LOW";
  else confidence = "NONE";

  // Canonical single-line form.
  const parts: string[] = [];
  if (streetNumber) parts.push(streetNumber);
  if (streetName) parts.push(streetName);
  const cityState = [city, state ? state.toLowerCase() : null].filter(Boolean).join(", ");
  const normalizedAddress = (() => {
    if (parts.length === 0 && !cityState && !zip) return "";
    const street = parts.join(" ");
    const cityStateZip = [cityState, zip].filter(Boolean).join(" ");
    return [street, cityStateZip].filter(Boolean).join(", ");
  })();

  return {
    normalizedAddress,
    streetNumber,
    streetName,
    city,
    state,
    zip,
    confidence,
    diagnostics: Object.freeze(diagnostics),
  };
}
