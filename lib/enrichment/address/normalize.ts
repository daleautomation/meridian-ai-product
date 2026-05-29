// Deterministic address normalization for property-key generation.
// No external geocoding — pure string transforms only.

export interface NormalizedAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  /** Original input before normalization (audit only). */
  raw: string;
  isPoBox: boolean;
  hasUnit: boolean;
}

export interface StreetComponents {
  houseNumber: string | null;
  preDirection: string | null;
  streetName: string | null;
  streetSuffix: string | null;
  postDirection: string | null;
  unit: string | null;
  poBoxNumber: string | null;
}

export interface WeakAddressReason {
  code: "empty" | "missing_city" | "missing_state" | "missing_postal" | "po_box_only" | "street_too_short";
  detail: string;
}

const US_STATE_ABBREV: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const STREET_SUFFIXES = new Set([
  "st",
  "street",
  "ave",
  "avenue",
  "blvd",
  "boulevard",
  "dr",
  "drive",
  "ln",
  "lane",
  "rd",
  "road",
  "ct",
  "court",
  "pl",
  "place",
  "way",
  "cir",
  "circle",
  "trl",
  "trail",
  "pkwy",
  "parkway",
]);

const UNIT_MARKERS = /^(?:#|apt|apartment|unit|ste|suite|bldg|building)\b/i;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeToken(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (/^\d+[a-z]?$/i.test(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseStreet(line: string): string {
  return collapseWhitespace(
    line
      .split(/\s+/)
      .map((part) => {
        const lower = part.toLowerCase();
        if (STREET_SUFFIXES.has(lower)) {
          const map: Record<string, string> = {
            st: "St",
            street: "St",
            ave: "Ave",
            avenue: "Ave",
            blvd: "Blvd",
            boulevard: "Blvd",
            dr: "Dr",
            drive: "Dr",
            ln: "Ln",
            lane: "Ln",
            rd: "Rd",
            road: "Rd",
            ct: "Ct",
            court: "Ct",
            pl: "Pl",
            place: "Pl",
            way: "Way",
            cir: "Cir",
            circle: "Cir",
            trl: "Trl",
            trail: "Trl",
            pkwy: "Pkwy",
            parkway: "Pkwy",
          };
          return map[lower] ?? titleCaseWord(part);
        }
        if (/^[nsew]$/i.test(part)) return part.toUpperCase();
        return titleCaseWord(part);
      })
      .join(" "),
  );
}

export function normalizeState(value: string): string {
  const trimmed = collapseWhitespace(value);
  if (!trimmed) return "";
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const mapped = US_STATE_ABBREV[normalizeToken(trimmed)];
  return mapped ?? trimmed.toUpperCase().slice(0, 2);
}

export function normalizePostalCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 9) return digits.slice(0, 9);
  if (digits.length >= 5) return digits.slice(0, 5);
  return digits;
}

/** Split "123 Main St, Seattle, WA 98101" or multi-line fragments. */
function splitAddressParts(raw: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const collapsed = collapseWhitespace(raw);
  if (!collapsed) return { street: "", city: "", state: "", zip: "" };

  const zipMatch = collapsed.match(/\b(\d{5}(?:-\d{4})?)\s*$/);
  const zip = zipMatch ? zipMatch[1] : "";
  let remainder = zipMatch ? collapsed.slice(0, zipMatch.index).replace(/,\s*$/, "") : collapsed;

  const parts = remainder.split(",").map((p) => collapseWhitespace(p)).filter(Boolean);
  if (parts.length >= 3) {
    const statePart = parts[parts.length - 1];
    const stateTokens = statePart.split(/\s+/);
    const state = stateTokens[0] ?? "";
    return {
      street: parts.slice(0, -2).join(", "),
      city: parts[parts.length - 2] ?? "",
      state,
      zip,
    };
  }
  if (parts.length === 2) {
    const cityState = parts[1].split(/\s+/);
    const state = cityState.length > 1 ? cityState[cityState.length - 1] : "";
    const city = cityState.slice(0, -1).join(" ");
    return { street: parts[0], city, state, zip };
  }

  const trailingStateZip = remainder.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)?$/);
  if (trailingStateZip) {
    const [, streetCity, state, z] = trailingStateZip;
    const cityMatch = streetCity.match(/^(.+?)\s+([^0-9]+)$/);
    if (cityMatch) {
      return {
        street: cityMatch[1].trim(),
        city: cityMatch[2].trim(),
        state,
        zip: z ?? zip,
      };
    }
    return { street: streetCity.trim(), city: "", state, zip: z ?? zip };
  }

  return { street: remainder, city: "", state: "", zip };
}

function splitStreetAndUnit(street: string): { line1: string; line2: string | null; hasUnit: boolean } {
  const collapsed = collapseWhitespace(street);
  if (!collapsed) return { line1: "", line2: null, hasUnit: false };

  const unitInline = collapsed.match(/^(.+?)\s+(#|apt\.?|apartment|unit|ste\.?|suite|bldg\.?)\s*(.+)$/i);
  if (unitInline) {
    return {
      line1: titleCaseStreet(unitInline[1]),
      line2: `${unitInline[2].replace(/\.$/, "")} ${unitInline[3]}`.trim(),
      hasUnit: true,
    };
  }

  const hashUnit = collapsed.match(/^(.+?)\s+(#\S+)$/);
  if (hashUnit) {
    return {
      line1: titleCaseStreet(hashUnit[1]),
      line2: hashUnit[2],
      hasUnit: true,
    };
  }

  return { line1: titleCaseStreet(collapsed), line2: null, hasUnit: false };
}

export function parseStreetComponents(streetLine: string): StreetComponents {
  const line = collapseWhitespace(streetLine);
  if (!line) {
    return {
      houseNumber: null,
      preDirection: null,
      streetName: null,
      streetSuffix: null,
      postDirection: null,
      unit: null,
      poBoxNumber: null,
    };
  }

  const poMatch = line.match(/^p\.?\s*o\.?\s*box\s*#?\s*(\S+)/i);
  if (poMatch) {
    return {
      houseNumber: null,
      preDirection: null,
      streetName: "PO Box",
      streetSuffix: null,
      postDirection: null,
      unit: null,
      poBoxNumber: poMatch[1],
    };
  }

  const { line1, line2 } = splitStreetAndUnit(line);
  const tokens = line1.split(/\s+/);
  let idx = 0;
  const houseNumber = tokens[idx] && /^\d+[a-z]?$/i.test(tokens[idx]) ? tokens[idx++] : null;
  const preDirection =
    tokens[idx] && /^[nsew]$/i.test(tokens[idx]) ? tokens[idx++].toUpperCase() : null;
  const suffixIdx = tokens.findIndex((t, i) => i >= idx && STREET_SUFFIXES.has(t.toLowerCase()));
  const streetName =
    suffixIdx === -1
      ? tokens.slice(idx).join(" ") || null
      : tokens.slice(idx, suffixIdx).join(" ") || null;
  const streetSuffix =
    suffixIdx === -1 ? null : tokens[suffixIdx].toLowerCase();
  const postDirection =
    suffixIdx !== -1 && tokens[suffixIdx + 1] && /^[nsew]$/i.test(tokens[suffixIdx + 1])
      ? tokens[suffixIdx + 1].toUpperCase()
      : null;

  return {
    houseNumber,
    preDirection,
    streetName,
    streetSuffix,
    postDirection,
    unit: line2,
    poBoxNumber: null,
  };
}

export function normalizeAddress(raw: string): NormalizedAddress {
  const parts = splitAddressParts(raw);
  const { line1, line2, hasUnit } = splitStreetAndUnit(parts.street);
  const isPoBox = /^p\.?\s*o\.?\s*box\b/i.test(parts.street) || /^po\s*box\b/i.test(line1);

  return {
    line1,
    line2,
    city: parts.city ? titleCaseWord(parts.city.split(/\s+/).join(" ")) : "",
    state: normalizeState(parts.state),
    postalCode: normalizePostalCode(parts.zip),
    country: "US",
    raw: raw.trim(),
    isPoBox,
    hasUnit,
  };
}

export function normalizeCityStateZip(input: {
  city?: string;
  state?: string;
  postalCode?: string;
}): { city: string; state: string; postalCode: string } {
  return {
    city: input.city ? titleCaseWord(collapseWhitespace(input.city)) : "",
    state: normalizeState(input.state ?? ""),
    postalCode: normalizePostalCode(input.postalCode ?? ""),
  };
}

/** Deterministic dedupe key — same inputs always yield the same key. */
export function canonicalPropertyKey(addr: NormalizedAddress): string {
  const street = normalizeToken(
    [addr.line1, addr.line2].filter(Boolean).join(" "),
  );
  const city = normalizeToken(addr.city);
  const state = normalizeToken(addr.state);
  const zip = normalizePostalCode(addr.postalCode);
  return [street, city, state, zip].join("|");
}

export function detectWeakAddress(addr: NormalizedAddress): WeakAddressReason | null {
  if (!addr.raw && !addr.line1) {
    return { code: "empty", detail: "No address provided" };
  }
  if (addr.isPoBox && !addr.line1.replace(/po\s*box/i, "").trim()) {
    return { code: "po_box_only", detail: "PO box without mailable street address" };
  }
  if (!addr.city) {
    return { code: "missing_city", detail: "City missing from address" };
  }
  if (!addr.state || addr.state.length !== 2) {
    return { code: "missing_state", detail: "State missing or not normalized to two-letter code" };
  }
  if (!addr.postalCode || addr.postalCode.length < 5) {
    return { code: "missing_postal", detail: "Postal code missing or incomplete" };
  }
  if (!addr.isPoBox) {
    const components = parseStreetComponents(addr.line1);
    const streetLen = (components.streetName ?? addr.line1).length;
    if (!components.houseNumber && streetLen < 4) {
      return { code: "street_too_short", detail: "Street line lacks house number and is too short" };
    }
  }
  return null;
}
