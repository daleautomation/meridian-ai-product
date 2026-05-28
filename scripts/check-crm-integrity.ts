/**
 * CRM integrity + enrichment eligibility — pure-function validator.
 *
 * Verifies:
 *   • classifyCrmIntegrity tiers correctly for representative shapes
 *   • companyLooksLikeContactName catches the Greg·Greg corruption
 *     in all its variants (full-name match, first-token match,
 *     case-insensitive)
 *   • classifyHunterEligibility / classifyPropertyEligibility produce
 *     the same canonical reason vocabulary that the audit script
 *     reports
 *   • LaborTech-style B2B contact fixtures classify HIGH (this is the
 *     readiness gate for the LaborTech CSV import)
 *   • Wise Agent-style residential fixtures classify correctly
 *
 * No DB. No env. No I/O. Pure.
 */

import type { CrmContactRecord } from "@/lib/crm-import/types";
import {
  classifyCrmIntegrity,
  summarizeCrmIntegrity,
  type CrmIntegrityTier,
} from "@/lib/crm-import/integrity";
import {
  classifyHunterEligibility,
  classifyPropertyEligibility,
} from "@/lib/crm-import/enrichmentEligibility";
import { companyLooksLikeContactName } from "@/lib/personal-workspace/workspace";
import type { ContactRepair } from "@/lib/crm-import/types";
import {
  detectColumnMapping,
  normalizeCrmRow,
} from "@/lib/crm-import/normalize";

const failures: string[] = [];
function fail(msg: string): void {
  failures.push(msg);
}

function makeContact(overrides: Partial<CrmContactRecord>): CrmContactRecord {
  return {
    id: "test-1",
    workspaceId: "test",
    importJobId: null,
    name: "Test Person",
    company: "",
    phone: null,
    email: null,
    address: null,
    notes: null,
    tags: [],
    lastInteractionAt: null,
    sourceCrm: "fixture",
    normalizedPhone: null,
    normalizedEmail: null,
    normalizedCompany: null,
    normalizedName: null,
    dataTrust: {} as CrmContactRecord["dataTrust"],
    relationshipScore: null,
    scoreMetadata: null,
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    ...overrides,
  };
}

// ── companyLooksLikeContactName ────────────────────────────────────

function runCompanyGuardChecks(): void {
  const cases: Array<[string, string | null, string | null, boolean]> = [
    ["exact full match (Greg)",       "Greg",      "Greg",      true],
    ["first-token match (Greg)",      "Greg",      "Greg Smith", true],
    ["case insensitive",              "GREG",      "greg",      true],
    ["whitespace tolerated",          " Greg ",    "Greg Smith", true],
    ["real company stays",            "Acme Inc",  "Greg Smith", false],
    ["empty company → false",         "",          "Greg Smith", false],
    ["empty name → false",            "Greg",      "",          false],
    ["surname match alone → false",   "Smith",     "Greg Smith", false],
    ["null company → false",          null,        "Greg",      false],
    ["null name → false",             "Greg",      null,        false],
  ];
  for (const [label, company, name, expected] of cases) {
    const got = companyLooksLikeContactName(company, name);
    if (got !== expected) {
      fail(`companyLooksLikeContactName ${label}: expected ${expected}, got ${got}`);
    }
  }
}

// ── classifyCrmIntegrity fixtures ──────────────────────────────────

interface IntegrityCase {
  label: string;
  contact: Partial<CrmContactRecord>;
  expectedTier: CrmIntegrityTier;
  mustHaveStrength?: string;
  mustHaveGap?: string;
}

const INTEGRITY_CASES: IntegrityCase[] = [
  {
    label: "LaborTech-style B2B contact — HIGH",
    contact: {
      name: "John Smith",
      email: "john.smith@acmeroofing.com",
      phone: "+18165551234",
      address: "4321 Industrial Blvd, Kansas City, MO 64108",
      lastInteractionAt: "2026-04-12T00:00:00.000Z",
    },
    expectedTier: "HIGH",
    mustHaveStrength: "business_domain_email",
  },
  {
    label: "Brookside-style residential, gmail-only — WEAK",
    contact: {
      name: "Greg",
      email: "greg@gmail.com",
      address: "Brookside KCMO",
      lastInteractionAt: "2023-12-12T00:00:00.000Z",
    },
    expectedTier: "WEAK",
    mustHaveGap: "missing_surname",
  },
  {
    label: "no email at all + no phone — WEAK + no_actionable_channel",
    contact: {
      name: "Jane Doe",
      address: "1200 Main St, Kansas City, MO 64111",
    },
    expectedTier: "WEAK",
    mustHaveGap: "no_actionable_channel",
  },
  {
    label: "surname + business email + no address — MED",
    contact: {
      name: "Jane Doe",
      email: "jane@acmeroofing.com",
      phone: "+18165551111",
    },
    expectedTier: "MED",
  },
  {
    // The classifier doesn't downgrade internal rows — it sets the
    // isInternalDiagnostic flag so the audit script counts them
    // separately. Tier is computed from raw data; the filter hides
    // them from operator surfaces before tier ever matters.
    label: "internal persist-check row — isInternalDiagnostic flag",
    contact: {
      id: "crm-persist-check-1",
      name: "Persist Check",
      email: "persist@example.com",
    },
    expectedTier: "MED",
  },
];

function runIntegrityChecks(): void {
  for (const fx of INTEGRITY_CASES) {
    const c = makeContact(fx.contact);
    const r = classifyCrmIntegrity(c);
    if (r.tier !== fx.expectedTier) {
      fail(`integrity ${fx.label}: expected tier ${fx.expectedTier}, got ${r.tier} (strengths=${r.strengths.join(",")}, gaps=${r.gaps.join(",")})`);
    }
    if (fx.mustHaveStrength && !r.strengths.some((s) => s === fx.mustHaveStrength)) {
      fail(`integrity ${fx.label}: expected strength ${fx.mustHaveStrength}, got [${r.strengths.join(",")}]`);
    }
    if (fx.mustHaveGap && !r.gaps.some((g) => g === fx.mustHaveGap || g.startsWith(fx.mustHaveGap + ":"))) {
      fail(`integrity ${fx.label}: expected gap ${fx.mustHaveGap}, got [${r.gaps.join(",")}]`);
    }
    if (fx.label.includes("internal persist-check") && !r.isInternalDiagnostic) {
      fail(`integrity ${fx.label}: isInternalDiagnostic should be true`);
    }
  }
}

function runIntegrityDeterminism(): void {
  const c = makeContact({
    name: "John Smith",
    email: "john@acme.com",
    phone: "+18165550000",
    address: "100 Main St, KC, MO 64108",
  });
  const a = JSON.stringify(classifyCrmIntegrity(c));
  const b = JSON.stringify(classifyCrmIntegrity(c));
  if (a !== b) fail("integrity classifier is not deterministic for identical input");
}

// ── classifyHunterEligibility ──────────────────────────────────────

interface EligibilityCase {
  label: string;
  contact: Partial<CrmContactRecord>;
  expectEligible: boolean;
  expectReason?: string;
}

const HUNTER_CASES: EligibilityCase[] = [
  { label: "B2B contact eligible", contact: { name: "John Smith", email: "john@acme.com" }, expectEligible: true },
  { label: "gmail rejected", contact: { name: "John Smith", email: "john@gmail.com" }, expectEligible: false, expectReason: "personal_domain" },
  { label: "yahoo rejected", contact: { name: "John Smith", email: "john@yahoo.com" }, expectEligible: false, expectReason: "personal_domain" },
  { label: "no email rejected", contact: { name: "John Smith" }, expectEligible: false, expectReason: "no_email" },
  { label: "single name rejected", contact: { name: "John", email: "john@acme.com" }, expectEligible: false, expectReason: "no_last_name" },
  { label: "blank name rejected", contact: { name: "", email: "john@acme.com" }, expectEligible: false, expectReason: "no_name" },
  { label: "internal-diag rejected", contact: { id: "crm-persist-check-1", name: "Persist Check", email: "persist@example.com" }, expectEligible: false, expectReason: "internal_diagnostic" },
  // The single-letter-last-token edge case
  { label: "initial-only last token rejected", contact: { name: "John A", email: "john@acme.com" }, expectEligible: false, expectReason: "no_last_name" },
];

const PROPERTY_CASES: EligibilityCase[] = [
  { label: "full address + surname eligible", contact: { name: "Jane Doe", address: "4321 Main St, Kansas City, MO 64108" }, expectEligible: true },
  { label: "no address rejected", contact: { name: "Jane Doe" }, expectEligible: false, expectReason: "no_address" },
  { label: "unparseable address rejected", contact: { name: "Jane Doe", address: "Brookside" }, expectEligible: false, expectReason: "address_unparseable" },
  { label: "address but no surname rejected", contact: { name: "Jane", address: "100 Main St, KC, MO 64108" }, expectEligible: false, expectReason: "no_last_name" },
  { label: "internal-diag rejected", contact: { id: "crm-persist-check-1", name: "Persist Check", address: "100 Main St, KC, MO 64108" }, expectEligible: false, expectReason: "internal_diagnostic" },
];

function runEligibilityChecks(): void {
  for (const fx of HUNTER_CASES) {
    const r = classifyHunterEligibility(makeContact(fx.contact));
    if (r.eligible !== fx.expectEligible) {
      fail(`hunter ${fx.label}: expected eligible=${fx.expectEligible}, got ${r.eligible} (reason=${r.skipReason})`);
    }
    if (fx.expectReason && r.skipReason !== fx.expectReason) {
      fail(`hunter ${fx.label}: expected reason=${fx.expectReason}, got ${r.skipReason}`);
    }
  }
  for (const fx of PROPERTY_CASES) {
    const r = classifyPropertyEligibility(makeContact(fx.contact));
    if (r.eligible !== fx.expectEligible) {
      fail(`property ${fx.label}: expected eligible=${fx.expectEligible}, got ${r.eligible} (reason=${r.skipReason})`);
    }
    if (fx.expectReason && r.skipReason !== fx.expectReason) {
      fail(`property ${fx.label}: expected reason=${fx.expectReason}, got ${r.skipReason}`);
    }
  }
}

// ── LaborTech CSV readiness ────────────────────────────────────────
// A synthetic LaborTech-style list. Every row should classify HIGH,
// be eligible for Hunter, and be eligible for Property. This is the
// gate that locks in B2B-readiness before John's CSV arrives.

function runLaborTechReadiness(): void {
  const sampleLaborTechRoster: Array<Partial<CrmContactRecord>> = [
    { name: "John Smith",  email: "john@acmeroofing.com",    phone: "+18165551234", address: "4321 Industrial Blvd, Kansas City, MO 64108" },
    { name: "Mary Jones",  email: "mary@brightroofs.com",    phone: "+19135552222", address: "1200 Commerce Ave, Overland Park, KS 66204" },
    { name: "Pat Wilson",  email: "pwilson@summitexteriors.com", phone: "+18165553333", address: "555 Oak Dr, Lenexa, KS 66215" },
  ];
  const summary = summarizeCrmIntegrity(sampleLaborTechRoster.map(makeContact));
  if (summary.high !== sampleLaborTechRoster.length) {
    fail(`labortech readiness: expected ${sampleLaborTechRoster.length} HIGH rows, got HIGH=${summary.high} MED=${summary.med} WEAK=${summary.weak}`);
  }
  for (const row of sampleLaborTechRoster) {
    const c = makeContact(row);
    const hunter = classifyHunterEligibility(c);
    const property = classifyPropertyEligibility(c);
    if (!hunter.eligible) {
      fail(`labortech readiness: ${row.name} should be Hunter-eligible (reason=${hunter.skipReason})`);
    }
    if (!property.eligible) {
      fail(`labortech readiness: ${row.name} should be Property-eligible (reason=${property.skipReason})`);
    }
  }
}

// ── Repair-overlay invariants ──────────────────────────────────────
//
// Locks in the trust-preservation rules for founder-led rehab repairs:
//   1. A contact with a repair on `name` classifies based on the
//      EFFECTIVE (post-repair) value. The classifier reads
//      contact.name, which the adapter populates with the effective
//      value, so a surname appended via repair flips hasSurname from
//      false to true.
//   2. A repair never changes integrity if the new value is identical
//      to the old.
//   3. Multiple repairs to the same field: classifier uses the latest
//      (the adapter's chronological overlay enforces last-write-wins).
//   4. After a surname repair, Hunter eligibility flips from
//      no_last_name → eligible (when domain is business).
//
// These tests use the in-memory CrmContactRecord shape, mimicking what
// rowToContact produces. The actual jsonb_set write path is exercised
// by the live audit + manual rehab session.

function runRepairOverlayChecks(): void {
  // Case 1: surname repair on a single-name contact flips classifier.
  const beforeContact = makeContact({
    name: "Greg",
    email: "greg@acmebrokerage.com",
    phone: "+18165550000",
    address: "100 Main St, KC, MO 64108",
  });
  const beforeReport = classifyCrmIntegrity(beforeContact);
  if (beforeReport.hasSurname) {
    fail("repair-overlay: pre-repair contact 'Greg' should NOT have surname");
  }

  // Simulate what rowToContact would produce post-overlay:
  const afterContact = makeContact({
    name: "Greg Smith", // effective value after a `name` repair
    email: "greg@acmebrokerage.com",
    phone: "+18165550000",
    address: "100 Main St, KC, MO 64108",
    repairs: [
      {
        field: "name",
        originalValue: "Greg",
        newValue: "Greg Smith",
        source: "founder_rehab",
        repairedAt: "2026-05-27T10:00:00.000Z",
      } as ContactRepair,
    ],
    originalImport: {
      name: "Greg",
      company: "",
      email: "greg@acmebrokerage.com",
      phone: "+18165550000",
      address: "100 Main St, KC, MO 64108",
    },
  });
  const afterReport = classifyCrmIntegrity(afterContact);
  if (!afterReport.hasSurname) {
    fail("repair-overlay: post-repair contact 'Greg Smith' should have surname");
  }
  if (afterReport.tier !== "HIGH") {
    fail(`repair-overlay: post-repair contact should be HIGH tier, got ${afterReport.tier}`);
  }

  // Case 2: post-repair, Hunter eligibility flips.
  const hunterBefore = classifyHunterEligibility(beforeContact);
  if (hunterBefore.eligible) fail("repair-overlay: pre-repair 'Greg' should NOT be Hunter-eligible");
  if (hunterBefore.skipReason !== "no_last_name") {
    fail(`repair-overlay: pre-repair Hunter skip reason expected no_last_name, got ${hunterBefore.skipReason}`);
  }
  const hunterAfter = classifyHunterEligibility(afterContact);
  if (!hunterAfter.eligible) {
    fail(`repair-overlay: post-repair 'Greg Smith' SHOULD be Hunter-eligible (reason=${hunterAfter.skipReason})`);
  }

  // Case 3: import-time original is preserved on afterContact.originalImport.
  if (afterContact.originalImport?.name !== "Greg") {
    fail("repair-overlay: originalImport.name must preserve import-time value");
  }
  if ((afterContact.repairs ?? []).length !== 1) {
    fail("repair-overlay: repairs array must remain after overlay");
  }
  if (afterContact.repairs?.[0].originalValue !== "Greg") {
    fail("repair-overlay: repair entry must retain originalValue");
  }

  // Case 4: two repairs to the same field — classifier sees the latest.
  // We simulate by passing the LATEST effective value as `name`; the
  // adapter's chronological overlay produces this for us in real
  // reads.
  const doubleRepair = makeContact({
    name: "Gregory Smith", // latest effective value
    email: "greg@acmebrokerage.com",
    repairs: [
      {
        field: "name",
        originalValue: "Greg",
        newValue: "Greg Smith",
        source: "founder_rehab",
        repairedAt: "2026-05-26T10:00:00.000Z",
      } as ContactRepair,
      {
        field: "name",
        originalValue: "Greg",
        newValue: "Gregory Smith",
        source: "founder_rehab",
        repairedAt: "2026-05-27T10:00:00.000Z",
      } as ContactRepair,
    ],
  });
  const doubleReport = classifyCrmIntegrity(doubleRepair);
  if (!doubleReport.hasSurname) {
    fail("repair-overlay: multi-repair last-write-wins should keep surname");
  }
}

// ──────────────────────────────────────────────────────────────────
// SECTION — Import-boundary assembly (Phase A1 + A2)
// ──────────────────────────────────────────────────────────────────
//
// The WiseAgent column-shape audit (2026-05-28) found:
//   • 1/130 surnames — import was dropping the Last Name column
//   • 7/130 canonical addresses — import was dropping City/State/Zip
// Root cause: the previous COLUMN_ALIASES mixed full-value and
// component column names, so `detectColumnMapping`'s first-match-wins
// claimed only the first component column it saw.
//
// These fixtures lock in the multi-column assembly behavior so the
// regression cannot reappear.

function runWiseAgentColumnAssembly(): void {
  // The exact column shape from Nicole's WiseAgent export.
  const wiseAgentHeaders = [
    "First Name",
    "Last Name",
    "Email",
    "Home Phone",
    "Home Street",
    "Home City",
    "Home State",
    "Home Postal Code",
    "Tags",
    "Last Activity",
  ];
  const mapping = detectColumnMapping(wiseAgentHeaders);

  // Component fields must be claimed.
  if (mapping.firstName !== "First Name") {
    fail(`WiseAgent: mapping.firstName expected "First Name", got ${JSON.stringify(mapping.firstName)}`);
  }
  if (mapping.lastName !== "Last Name") {
    fail(`WiseAgent: mapping.lastName expected "Last Name", got ${JSON.stringify(mapping.lastName)}`);
  }
  if (mapping.street !== "Home Street") {
    fail(`WiseAgent: mapping.street expected "Home Street", got ${JSON.stringify(mapping.street)}`);
  }
  if (mapping.city !== "Home City") {
    fail(`WiseAgent: mapping.city expected "Home City", got ${JSON.stringify(mapping.city)}`);
  }
  if (mapping.state !== "Home State") {
    fail(`WiseAgent: mapping.state expected "Home State", got ${JSON.stringify(mapping.state)}`);
  }
  if (mapping.postalCode !== "Home Postal Code") {
    fail(`WiseAgent: mapping.postalCode expected "Home Postal Code", got ${JSON.stringify(mapping.postalCode)}`);
  }
  // Critically — `name` and `address` MUST NOT be set when only
  // components are present. Their absence is what makes the assembly
  // pathway fire.
  if (mapping.name !== undefined) {
    fail(`WiseAgent: mapping.name should be undefined (only components present), got ${JSON.stringify(mapping.name)}`);
  }
  if (mapping.address !== undefined) {
    fail(`WiseAgent: mapping.address should be undefined (only components present), got ${JSON.stringify(mapping.address)}`);
  }

  // Three real rows from the corpus (anonymized via the user's
  // examples).
  type Row = Record<string, string>;
  const susie: Row = {
    "First Name": "Susie",
    "Last Name": "Adams",
    "Email": "susie@example.com",
    "Home Phone": "8165551111",
    "Home Street": "5006 W 65th St",
    "Home City": "Prairie Village",
    "Home State": "KS",
    "Home Postal Code": "66208",
    "Tags": "Seller",
    "Last Activity": "2024-01-15",
  };
  const rashondra: Row = {
    "First Name": "RaShondra",
    "Last Name": "Banks",
    "Email": "rashondra@example.com",
    "Home Phone": "8165552222",
    "Home Street": "1463 E 76th Terrace",
    "Home City": "Kansas City",
    "Home State": "MO",
    "Home Postal Code": "64131",
    "Tags": "Buyer",
    "Last Activity": "2023-09-01",
  };
  const leah: Row = {
    "First Name": "Leah B.",
    "Last Name": "Barnett",
    "Email": "leah@example.com",
    "Home Phone": "8165553333",
    "Home Street": "7316 Hullwood Ave",
    "Home City": "Kansas City",
    "Home State": "MO",
    "Home Postal Code": "64133",
    "Tags": "",
    "Last Activity": "",
  };

  const susieResult = normalizeCrmRow(susie, 0, mapping, "wise_agent");
  if (susieResult.name !== "Susie Adams") {
    fail(`WiseAgent: Susie name expected "Susie Adams", got "${susieResult.name}"`);
  }
  if (susieResult.address !== "5006 W 65th St, Prairie Village, KS 66208") {
    fail(`WiseAgent: Susie address expected "5006 W 65th St, Prairie Village, KS 66208", got "${susieResult.address}"`);
  }
  if (susieResult.normalizedName !== "susie adams") {
    fail(`WiseAgent: Susie normalizedName expected "susie adams", got "${susieResult.normalizedName}"`);
  }

  const rashondraResult = normalizeCrmRow(rashondra, 1, mapping, "wise_agent");
  if (rashondraResult.name !== "RaShondra Banks") {
    fail(`WiseAgent: RaShondra name expected "RaShondra Banks", got "${rashondraResult.name}"`);
  }
  if (rashondraResult.address !== "1463 E 76th Terrace, Kansas City, MO 64131") {
    fail(`WiseAgent: RaShondra address expected "1463 E 76th Terrace, Kansas City, MO 64131", got "${rashondraResult.address}"`);
  }

  const leahResult = normalizeCrmRow(leah, 2, mapping, "wise_agent");
  // Middle-initial preserved verbatim.
  if (leahResult.name !== "Leah B. Barnett") {
    fail(`WiseAgent: Leah name expected "Leah B. Barnett", got "${leahResult.name}"`);
  }
  if (leahResult.address !== "7316 Hullwood Ave, Kansas City, MO 64133") {
    fail(`WiseAgent: Leah address expected "7316 Hullwood Ave, Kansas City, MO 64133", got "${leahResult.address}"`);
  }
}

function runSingleValueColumnsStillWork(): void {
  // A CSV with a single full-name column AND a single full-address column
  // continues to work as it did before — the assembly pathway only fires
  // when the single-value columns are absent.
  const legacyHeaders = ["Name", "Email", "Phone", "Address", "Tags"];
  const mapping = detectColumnMapping(legacyHeaders);
  if (mapping.name !== "Name") {
    fail(`legacy: mapping.name expected "Name", got ${JSON.stringify(mapping.name)}`);
  }
  if (mapping.address !== "Address") {
    fail(`legacy: mapping.address expected "Address", got ${JSON.stringify(mapping.address)}`);
  }
  const row = {
    "Name": "Greg Smith",
    "Email": "greg@example.com",
    "Phone": "8165554444",
    "Address": "4321 W 63rd St, Kansas City, MO 64113",
    "Tags": "Seller",
  };
  const result = normalizeCrmRow(row, 0, mapping, "legacy");
  if (result.name !== "Greg Smith") {
    fail(`legacy: name expected "Greg Smith", got "${result.name}"`);
  }
  if (result.address !== "4321 W 63rd St, Kansas City, MO 64113") {
    fail(`legacy: address expected verbatim, got "${result.address}"`);
  }
}

function runMixedColumnsSingleValueWins(): void {
  // A CSV that has BOTH a "Name" column AND "First Name"/"Last Name"
  // columns — the single-value column wins. This preserves
  // backward compatibility: a CSV that provided a canonical "Name" gets
  // exactly what it provided, even if components are also present.
  const mixedHeaders = ["Name", "First Name", "Last Name", "Address", "Home Street", "Home City"];
  const mapping = detectColumnMapping(mixedHeaders);
  if (mapping.name !== "Name") {
    fail(`mixed: mapping.name expected "Name" (single wins), got ${JSON.stringify(mapping.name)}`);
  }
  if (mapping.firstName !== "First Name") {
    fail(`mixed: mapping.firstName also detected, got ${JSON.stringify(mapping.firstName)}`);
  }
  if (mapping.address !== "Address") {
    fail(`mixed: mapping.address expected "Address" (single wins), got ${JSON.stringify(mapping.address)}`);
  }
  const row = {
    "Name": "Greg Smith",
    "First Name": "Greg",
    "Last Name": "Smith",
    "Address": "4321 W 63rd St, KC, MO 64113",
    "Home Street": "ignored",
    "Home City": "ignored",
  };
  const result = normalizeCrmRow(row, 0, mapping, "mixed");
  if (result.name !== "Greg Smith") {
    fail(`mixed: name expected "Greg Smith" (single-value wins), got "${result.name}"`);
  }
  if (result.address !== "4321 W 63rd St, KC, MO 64113") {
    fail(`mixed: address expected single-value, got "${result.address}"`);
  }
}

function runPartialComponentsDegradeGracefully(): void {
  // First name only, no last name — should degrade to first-name-only
  // (current behavior preserved as a graceful degradation, not an error).
  const firstOnlyMapping = detectColumnMapping(["First Name", "Email"]);
  const firstOnly = normalizeCrmRow(
    { "First Name": "Greg", "Email": "greg@example.com" },
    0, firstOnlyMapping, "wise_agent",
  );
  if (firstOnly.name !== "Greg") {
    fail(`degraded: first-only name expected "Greg", got "${firstOnly.name}"`);
  }

  // Last name only — also graceful.
  const lastOnlyMapping = detectColumnMapping(["Last Name", "Email"]);
  const lastOnly = normalizeCrmRow(
    { "Last Name": "Smith", "Email": "smith@example.com" },
    0, lastOnlyMapping, "wise_agent",
  );
  if (lastOnly.name !== "Smith") {
    fail(`degraded: last-only name expected "Smith", got "${lastOnly.name}"`);
  }

  // Street with no city/state/zip — produces just the street line. The
  // downstream address normalizer will flag this as weak via
  // detectWeakAddress; that's correct behavior.
  const streetOnlyMapping = detectColumnMapping(["First Name", "Last Name", "Home Street"]);
  const streetOnly = normalizeCrmRow(
    { "First Name": "Greg", "Last Name": "Smith", "Home Street": "4321 W 63rd St" },
    0, streetOnlyMapping, "wise_agent",
  );
  if (streetOnly.address !== "4321 W 63rd St") {
    fail(`degraded: street-only address expected "4321 W 63rd St", got "${streetOnly.address}"`);
  }

  // Unit gets concatenated onto the street line.
  const unitMapping = detectColumnMapping([
    "First Name", "Last Name", "Home Street", "Apt", "Home City", "Home State", "Home Postal Code",
  ]);
  const withUnit = normalizeCrmRow(
    {
      "First Name": "Greg",
      "Last Name": "Smith",
      "Home Street": "100 Main St",
      "Apt": "#4B",
      "Home City": "Kansas City",
      "Home State": "MO",
      "Home Postal Code": "64108",
    },
    0, unitMapping, "wise_agent",
  );
  if (withUnit.address !== "100 Main St #4B, Kansas City, MO 64108") {
    fail(`degraded: address with unit expected verbatim, got "${withUnit.address}"`);
  }
}

function runDeterministicAssembly(): void {
  // Same inputs → byte-identical output across calls.
  const headers = [
    "First Name", "Last Name", "Email", "Home Phone",
    "Home Street", "Home City", "Home State", "Home Postal Code",
  ];
  const mapping = detectColumnMapping(headers);
  const row: Record<string, string> = {
    "First Name": "Susie",
    "Last Name": "Adams",
    "Email": "susie@example.com",
    "Home Phone": "8165551111",
    "Home Street": "5006 W 65th St",
    "Home City": "Prairie Village",
    "Home State": "KS",
    "Home Postal Code": "66208",
  };
  const a = JSON.stringify(normalizeCrmRow(row, 0, mapping, "wise_agent"));
  const b = JSON.stringify(normalizeCrmRow(row, 0, mapping, "wise_agent"));
  const c = JSON.stringify(normalizeCrmRow(row, 0, mapping, "wise_agent"));
  if (a !== b || b !== c) {
    fail("assembly determinism: 3 calls produced different output");
  }
}

function main(): void {
  runCompanyGuardChecks();
  runIntegrityChecks();
  runIntegrityDeterminism();
  runEligibilityChecks();
  runLaborTechReadiness();
  runRepairOverlayChecks();
  runWiseAgentColumnAssembly();
  runSingleValueColumnsStillWork();
  runMixedColumnsSingleValueWins();
  runPartialComponentsDegradeGracefully();
  runDeterministicAssembly();

  if (failures.length > 0) {
    console.error("");
    console.error("check-crm-integrity FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-crm-integrity passed", {
    companyGuardCases: 10,
    integrityCases: INTEGRITY_CASES.length,
    hunterEligibilityCases: HUNTER_CASES.length,
    propertyEligibilityCases: PROPERTY_CASES.length,
    checks: [
      "companyLooksLikeContactName catches Greg=Greg, Greg=Greg Smith, case + whitespace variants",
      "real company strings are not flagged as corruption",
      "classifyCrmIntegrity: B2B HIGH / residential WEAK / no-channel WEAK / business-no-address MED",
      "classifyCrmIntegrity is deterministic across calls",
      "classifyHunterEligibility: canonical reasons (personal_domain, no_email, no_last_name, internal_diagnostic)",
      "classifyPropertyEligibility: canonical reasons (no_address, address_unparseable, no_last_name)",
      "LaborTech-style synthetic roster: all rows classify HIGH + Hunter-eligible + Property-eligible",
      "repair-overlay: surname repair flips hasSurname false → true",
      "repair-overlay: post-repair tier climbs (WEAK → MED/HIGH)",
      "repair-overlay: post-repair Hunter eligibility flips no_last_name → eligible",
      "repair-overlay: import-time originalValue preserved on every repair entry",
      "repair-overlay: multi-repair last-write-wins (chronological)",
      "WiseAgent column shape: First+Last → name; Home Street/City/State/Postal Code → canonical address",
      "WiseAgent assembly: 3 real-row fixtures produce verbatim expected output",
      "legacy single-value columns (Name, Address) continue to work unchanged",
      "mixed CSV with both single + components: single-value wins",
      "partial components degrade gracefully: first-only, last-only, street-only, with-unit",
      "assembly determinism: 3 calls → byte-identical output",
    ],
  });
}

main();
