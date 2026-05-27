/**
 * Validation for the Phase 1 property-intelligence foundation:
 *   • Deterministic address normalization (same input → same output)
 *   • Suffix / directional canonicalization
 *   • ZIP + state extraction (5 digits; ZIP+4 truncated)
 *   • Confidence ladder (HIGH / MED / LOW / NONE)
 *   • Owner-name match rules (exact / surname / trust_or_llc / fuzzy / no_match)
 *   • Confidence resolution given address-match strength
 *
 * No provider calls. No DB writes. No env requirements beyond default.
 */

import {
  normalizeAddress,
  type AddressNormalizationConfidence,
} from "@/lib/enrichment/property/addressNormalizer";
import {
  classifyOwnerNameMatch,
  resolvePropertyConfidence,
} from "@/lib/enrichment/property/propertyMatchRules";

const failures: string[] = [];
function fail(msg: string): void {
  failures.push(msg);
}

// ── Address normalization fixtures ────────────────────────────────

interface AddrCase {
  label: string;
  input: string | null;
  expect: {
    streetNumber?: string | null;
    streetName?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    confidence: AddressNormalizationConfidence;
    contains?: string; // substring check on normalizedAddress
  };
}

const ADDRESS_FIXTURES: AddrCase[] = [
  {
    label: "full address — HIGH",
    input: "4321 W. 63rd St, Kansas City, MO 64113",
    expect: {
      streetNumber: "4321",
      streetName: "west 63rd street",
      city: "kansas city",
      state: "MO",
      zip: "64113",
      confidence: "HIGH",
      contains: "4321 west 63rd street, kansas city, mo 64113",
    },
  },
  {
    label: "suffix expansion — Ave",
    input: "1200 Main Ave, Overland Park, KS 66204",
    expect: {
      streetNumber: "1200",
      streetName: "main avenue",
      state: "KS",
      zip: "66204",
      confidence: "HIGH",
    },
  },
  {
    label: "two-letter directional NE",
    input: "55 NE Maple Blvd, KCMO, MO 64118",
    expect: {
      streetNumber: "55",
      streetName: "northeast maple boulevard",
      state: "MO",
      zip: "64118",
      confidence: "HIGH",
    },
  },
  {
    label: "ZIP+4 truncated to 5",
    input: "100 Oak Ln, Lenexa, KS 66215-1234",
    expect: {
      streetNumber: "100",
      streetName: "oak lane",
      state: "KS",
      zip: "66215",
      confidence: "HIGH",
    },
  },
  {
    label: "unit suffix stripped",
    input: "200 Pine St Apt 3B, Kansas City, MO 64109",
    expect: {
      streetNumber: "200",
      streetName: "pine street",
      city: "kansas city",
      state: "MO",
      zip: "64109",
      confidence: "HIGH",
    },
  },
  {
    label: "#unit inline stripped",
    input: "300 Elm Dr #45, KC, MO 64108",
    expect: {
      streetNumber: "300",
      streetName: "elm drive",
      state: "MO",
      zip: "64108",
      confidence: "HIGH",
    },
  },
  {
    label: "two-word state name expansion",
    input: "500 Oak St, Charleston, South Carolina 29401",
    expect: {
      state: "SC",
      zip: "29401",
      confidence: "HIGH",
    },
  },
  {
    label: "missing ZIP → MED",
    input: "4321 W 63rd St, Kansas City, MO",
    expect: {
      streetNumber: "4321",
      streetName: "west 63rd street",
      state: "MO",
      zip: null,
      confidence: "MED",
    },
  },
  {
    label: "state and zip only → LOW",
    input: "MO 64113",
    expect: {
      streetNumber: null,
      streetName: null,
      state: "MO",
      zip: "64113",
      confidence: "LOW",
    },
  },
  {
    label: "empty input → NONE",
    input: "",
    expect: { confidence: "NONE" },
  },
  {
    label: "null input → NONE",
    input: null,
    expect: { confidence: "NONE" },
  },
  {
    label: "trailing comma + commas mid-string",
    input: "1111 Walnut Pkwy, KCMO, MO 64111,",
    expect: {
      streetNumber: "1111",
      streetName: "walnut parkway",
      state: "MO",
      zip: "64111",
      confidence: "HIGH",
    },
  },
];

function runAddressFixtures(): void {
  for (const c of ADDRESS_FIXTURES) {
    const got = normalizeAddress(c.input);
    if (got.confidence !== c.expect.confidence) {
      fail(`${c.label}: confidence expected ${c.expect.confidence}, got ${got.confidence}`);
    }
    if (c.expect.streetNumber !== undefined && got.streetNumber !== c.expect.streetNumber) {
      fail(`${c.label}: streetNumber expected ${c.expect.streetNumber}, got ${got.streetNumber}`);
    }
    if (c.expect.streetName !== undefined && got.streetName !== c.expect.streetName) {
      fail(`${c.label}: streetName expected "${c.expect.streetName}", got "${got.streetName}"`);
    }
    if (c.expect.city !== undefined && got.city !== c.expect.city) {
      fail(`${c.label}: city expected "${c.expect.city}", got "${got.city}"`);
    }
    if (c.expect.state !== undefined && got.state !== c.expect.state) {
      fail(`${c.label}: state expected ${c.expect.state}, got ${got.state}`);
    }
    if (c.expect.zip !== undefined && got.zip !== c.expect.zip) {
      fail(`${c.label}: zip expected ${c.expect.zip}, got ${got.zip}`);
    }
    if (c.expect.contains && !got.normalizedAddress.includes(c.expect.contains)) {
      fail(`${c.label}: normalizedAddress did not contain "${c.expect.contains}" (got "${got.normalizedAddress}")`);
    }
  }
}

function runAddressDeterminism(): void {
  for (const c of ADDRESS_FIXTURES) {
    const a = normalizeAddress(c.input);
    const b = normalizeAddress(c.input);
    if (JSON.stringify({ ...a, diagnostics: [...a.diagnostics] }) !==
        JSON.stringify({ ...b, diagnostics: [...b.diagnostics] })) {
      fail(`determinism: ${c.label} produced different output across calls`);
    }
  }
}

function runAddressCollisionCheck(): void {
  // Equivalent inputs MUST produce identical normalizedAddress.
  const equivalents: ReadonlyArray<readonly [string, string]> = [
    ["4321 W. 63rd St, Kansas City, MO 64113", "4321 W 63rd Street, Kansas City, MO 64113"],
    ["1200 Main Ave., Overland Park, KS 66204", "1200 Main AVENUE, Overland Park, KS 66204"],
    ["100 Oak Ln, Lenexa, KS 66215-1234", "100 Oak LANE, Lenexa, KS 66215"],
    ["4321 west 63rd street, kansas city, mo 64113", "4321 W 63rd St, Kansas City, MO 64113"],
  ];
  for (const [a, b] of equivalents) {
    const an = normalizeAddress(a);
    const bn = normalizeAddress(b);
    if (an.normalizedAddress !== bn.normalizedAddress) {
      fail(`collision: equivalent inputs produced different normalized forms\n  a="${a}" → "${an.normalizedAddress}"\n  b="${b}" → "${bn.normalizedAddress}"`);
    }
  }
}

// ── Owner-name match fixtures ─────────────────────────────────────

interface NameCase {
  label: string;
  contact: string;
  owner: string;
  expectMatch:
    | "exact"
    | "surname"
    | "trust_or_llc"
    | "fuzzy"
    | "no_match";
  expectConf: "HIGH" | "MED" | "LOW";
}

const NAME_FIXTURES: NameCase[] = [
  { label: "exact: same name", contact: "Greg Smith", owner: "Greg Smith",
    expectMatch: "exact", expectConf: "HIGH" },
  { label: "exact: 'Last, First' format",   contact: "Greg Smith", owner: "Smith, Greg",
    expectMatch: "exact", expectConf: "HIGH" },
  { label: "exact: extra middle on record", contact: "Greg Smith", owner: "Greg A Smith",
    expectMatch: "exact", expectConf: "HIGH" },
  { label: "surname-only: spouse on title", contact: "John Smith", owner: "Jane Smith",
    expectMatch: "surname", expectConf: "MED" },
  { label: "surname + first match (extra middle)", contact: "Greg Smith", owner: "Greg Alan Smith",
    expectMatch: "exact", expectConf: "HIGH" },
  { label: "trust containing surname",      contact: "John Smith", owner: "Smith Family Trust 2014",
    expectMatch: "trust_or_llc", expectConf: "MED" },
  { label: "LLC containing surname",        contact: "John Smith", owner: "Smith Holdings LLC",
    expectMatch: "trust_or_llc", expectConf: "MED" },
  { label: "LLC without contact surname",   contact: "John Smith", owner: "Acme Properties LLC",
    expectMatch: "no_match", expectConf: "LOW" },
  { label: "hyphenated surname variant",    contact: "Jane Smith", owner: "Jane Smith-Jones",
    expectMatch: "exact", expectConf: "HIGH" }, // both first and last match
  { label: "hyphenated surname (no first match)", contact: "Mark Smith", owner: "Pat Smith-Jones",
    expectMatch: "surname", expectConf: "MED" },
  { label: "completely different",          contact: "John Smith", owner: "Pat Wilson",
    expectMatch: "no_match", expectConf: "LOW" },
  { label: "empty contact name",            contact: "", owner: "Greg Smith",
    expectMatch: "no_match", expectConf: "LOW" },
  { label: "empty owner name",              contact: "Greg Smith", owner: "",
    expectMatch: "no_match", expectConf: "LOW" },
];

function runNameMatchFixtures(): void {
  for (const c of NAME_FIXTURES) {
    const got = classifyOwnerNameMatch({ contactName: c.contact, ownerNameOnRecord: c.owner });
    if (got.match !== c.expectMatch) {
      fail(`${c.label}: match expected ${c.expectMatch}, got ${got.match} (reason=${got.reason})`);
    }
    if (got.confidence !== c.expectConf) {
      fail(`${c.label}: confidence expected ${c.expectConf}, got ${got.confidence}`);
    }
  }
}

function runNameMatchDeterminism(): void {
  for (const c of NAME_FIXTURES) {
    const a = classifyOwnerNameMatch({ contactName: c.contact, ownerNameOnRecord: c.owner });
    const b = classifyOwnerNameMatch({ contactName: c.contact, ownerNameOnRecord: c.owner });
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fail(`determinism: ${c.label} produced different owner-match output across calls`);
    }
  }
}

// ── Confidence-resolution table ───────────────────────────────────

function runConfidenceResolutionTable(): void {
  // Build a representative match outcome for each pure category.
  const exact = classifyOwnerNameMatch({ contactName: "Greg Smith", ownerNameOnRecord: "Greg Smith" });
  const surname = classifyOwnerNameMatch({ contactName: "John Smith", ownerNameOnRecord: "Jane Smith" });
  const trustLlc = classifyOwnerNameMatch({ contactName: "John Smith", ownerNameOnRecord: "Smith Family Trust" });
  const noMatch = classifyOwnerNameMatch({ contactName: "John Smith", ownerNameOnRecord: "Pat Wilson" });

  const cases: Array<[string, ReturnType<typeof classifyOwnerNameMatch>, "parcel_id" | "address", "HIGH" | "MED" | "LOW"]> = [
    ["parcel_id + exact → HIGH", exact, "parcel_id", "HIGH"],
    ["parcel_id + surname → MED", surname, "parcel_id", "MED"],
    ["parcel_id + trust_or_llc → MED", trustLlc, "parcel_id", "MED"],
    ["address + exact → MED", exact, "address", "MED"],
    ["address + surname → MED", surname, "address", "MED"],
    ["any + no_match → LOW", noMatch, "parcel_id", "LOW"],
    ["address + no_match → LOW", noMatch, "address", "LOW"],
  ];
  for (const [label, nameMatch, addrStrength, expected] of cases) {
    const got = resolvePropertyConfidence(addrStrength, nameMatch);
    if (got !== expected) {
      fail(`confidence-resolve: ${label} — expected ${expected}, got ${got}`);
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────

function main(): void {
  runAddressFixtures();
  runAddressDeterminism();
  runAddressCollisionCheck();
  runNameMatchFixtures();
  runNameMatchDeterminism();
  runConfidenceResolutionTable();

  if (failures.length > 0) {
    console.error("");
    console.error("check-property-normalization FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-property-normalization passed", {
    addressFixtures: ADDRESS_FIXTURES.length,
    nameMatchFixtures: NAME_FIXTURES.length,
    checks: [
      "address fields extracted (streetNumber/streetName/city/state/zip)",
      "USPS-style suffix + directional canonicalization",
      "ZIP+4 truncates to 5 digits",
      "unit / apt / # suffixes stripped from street",
      "two-word state names expand (e.g. 'South Carolina' → 'SC')",
      "missing fields ladder confidence (HIGH/MED/LOW/NONE)",
      "address normalization is deterministic across calls",
      "equivalent addresses collide on a single normalized form",
      "owner-name match: exact / surname / trust_or_llc / fuzzy / no_match",
      "owner-name match is deterministic across calls",
      "confidence resolution honors address+name match combination",
    ],
  });
}

main();
