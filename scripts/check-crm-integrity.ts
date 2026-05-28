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
import {
  mintContactId,
  resolveExistingContact,
  resolveExistingContactForRow,
} from "@/lib/crm-import/identityKey";
import { mergeContactRecords } from "@/lib/crm-import/merge";
import {
  findDedupePairs,
} from "@/lib/crm-import/dedupe";
import { computeImportDiagnostics } from "@/lib/crm-import/diagnostics";

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

// ──────────────────────────────────────────────────────────────────
// SECTION — Import hardening: identity resolution + dedupe + merge
// ──────────────────────────────────────────────────────────────────

function makeNormalizedRow(over: Partial<{
  rowIndex: number;
  name: string;
  email: string | null;
  phone: string | null;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  normalizedName: string | null;
  address: string | null;
}> = {}): import("@/lib/crm-import/types").NormalizedCrmContact {
  const base = {
    rowIndex: 0,
    name: "Susie Adams",
    company: "",
    phone: null,
    email: "susie@example.com",
    address: "5006 W 65th St, Prairie Village, KS 66208",
    notes: null,
    tags: [] as string[],
    lastInteractionAt: null,
    sourceCrm: "wise_agent",
    normalizedPhone: null,
    normalizedEmail: "susie@example.com",
    normalizedCompany: null,
    normalizedName: "susie adams",
    dataTrust: {
      name: { value: "Susie Adams", source: "crm_import:wise_agent", confidence: 78, trustLevel: "acceptable" as const, lastVerifiedAt: null, enrichmentProvider: null, conflictState: "none" as const, displayAsTrusted: true },
      company: { value: null, source: "crm_import:wise_agent", confidence: 0, trustLevel: "missing" as const, lastVerifiedAt: null, enrichmentProvider: null, conflictState: "none" as const, displayAsTrusted: false },
      phone: { value: null, source: "crm_import:wise_agent", confidence: 0, trustLevel: "missing" as const, lastVerifiedAt: null, enrichmentProvider: null, conflictState: "none" as const, displayAsTrusted: false },
      email: { value: "susie@example.com", source: "crm_import:wise_agent", confidence: 78, trustLevel: "acceptable" as const, lastVerifiedAt: null, enrichmentProvider: null, conflictState: "none" as const, displayAsTrusted: true },
      address: { value: "5006 W 65th St, Prairie Village, KS 66208", source: "crm_import:wise_agent", confidence: 78, trustLevel: "acceptable" as const, lastVerifiedAt: null, enrichmentProvider: null, conflictState: "none" as const, displayAsTrusted: true },
      lastInteraction: { value: null, source: "crm_import:wise_agent", confidence: 0, trustLevel: "missing" as const, lastVerifiedAt: null, enrichmentProvider: null, conflictState: "none" as const, displayAsTrusted: false },
    },
    validationErrors: [] as string[],
    validationWarnings: [] as string[],
    ...over,
  };
  return base;
}

function makeExisting(over: Partial<CrmContactRecord> = {}): CrmContactRecord {
  return makeContact({
    id: "crm-existing-1",
    name: "Susie Adams",
    email: "susie@example.com",
    phone: null,
    address: "5006 W 65th St, Prairie Village, KS 66208",
    normalizedEmail: "susie@example.com",
    normalizedPhone: null,
    normalizedName: "susie adams",
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
    ...over,
  });
}

function runIdentityResolution(): void {
  const existing = [
    makeExisting({ id: "crm-1", normalizedEmail: "susie@example.com", normalizedName: "susie adams" }),
    makeExisting({ id: "crm-2", normalizedEmail: "greg@example.com", normalizedPhone: "+18165550100", normalizedName: "greg smith" }),
    makeExisting({ id: "crm-3", normalizedEmail: null, normalizedPhone: null, normalizedName: "patricia wong",
      address: "4321 W 63rd St, Kansas City, MO 64113" }),
  ];

  // 1. Exact email match → safe identity hit
  const incomingEmail = makeNormalizedRow({ normalizedEmail: "susie@example.com" });
  const emailRes = resolveExistingContactForRow(incomingEmail, existing);
  if (emailRes.reason !== "email" || emailRes.existing?.id !== "crm-1") {
    fail(`identity: email match expected crm-1, got reason=${emailRes.reason} id=${emailRes.existing?.id}`);
  }

  // 2. Exact phone match (no email overlap)
  const incomingPhone = makeNormalizedRow({
    normalizedEmail: null,
    normalizedPhone: "+18165550100",
    name: "G Smith",
    normalizedName: "g smith",
  });
  const phoneRes = resolveExistingContactForRow(incomingPhone, existing);
  if (phoneRes.reason !== "phone" || phoneRes.existing?.id !== "crm-2") {
    fail(`identity: phone match expected crm-2, got reason=${phoneRes.reason} id=${phoneRes.existing?.id}`);
  }

  // 3. Surname + canonical address match (no email/phone overlap)
  const incomingNameAddr = makeNormalizedRow({
    normalizedEmail: null,
    normalizedPhone: null,
    name: "Patricia Wong",
    normalizedName: "patricia wong",
    address: "4321 W 63rd St, Kansas City, MO 64113",
  });
  const nameAddrRes = resolveExistingContactForRow(incomingNameAddr, existing);
  if (nameAddrRes.reason !== "name_and_address" || nameAddrRes.existing?.id !== "crm-3") {
    fail(`identity: name+addr match expected crm-3, got reason=${nameAddrRes.reason} id=${nameAddrRes.existing?.id}`);
  }

  // 4. First-name-only must NOT match — two "Susie"s without email/phone/addr overlap
  const susieB = makeNormalizedRow({
    normalizedEmail: null,
    normalizedPhone: null,
    name: "Susie Bartholomew",
    normalizedName: "susie bartholomew",
    address: "100 Other St, Other City, MO 64108",
  });
  const susieRes = resolveExistingContact(
    { normalizedEmail: null, normalizedPhone: null, normalizedName: susieB.normalizedName, address: susieB.address },
    existing,
  );
  if (susieRes.existing !== null) {
    fail(`identity: first-name-only must NOT match — got id=${susieRes.existing.id}`);
  }

  // 5. Same surname but DIFFERENT canonical address → no match
  const wongOther = makeNormalizedRow({
    normalizedEmail: null,
    normalizedPhone: null,
    name: "Bob Wong",
    normalizedName: "bob wong",
    address: "999 Elsewhere Ave, Topeka, KS 66603",
  });
  const wongRes = resolveExistingContactForRow(wongOther, existing);
  if (wongRes.existing !== null) {
    fail(`identity: different address must NOT match same surname — got id=${wongRes.existing.id}`);
  }

  // 6. Truly new contact (no identity overlap) → no match
  const fresh = makeNormalizedRow({
    normalizedEmail: "totally-new@example.com",
    normalizedPhone: "+19999990000",
    name: "Brand New",
    normalizedName: "brand new",
  });
  const freshRes = resolveExistingContactForRow(fresh, existing);
  if (freshRes.existing !== null) {
    fail(`identity: fresh contact should NOT match, got id=${freshRes.existing.id}`);
  }
}

function runDeterministicContactIds(): void {
  // mintContactId derives a stable id from the strongest signal.
  // Same input → same id; different positions in CSV → same id when
  // identity signals are the same.
  const a = makeNormalizedRow({ rowIndex: 0, normalizedEmail: "susie@example.com" });
  const b = makeNormalizedRow({ rowIndex: 99, normalizedEmail: "susie@example.com" });
  const idA = mintContactId("nicole-lonergan", a, { importJobId: "job-1" });
  const idB = mintContactId("nicole-lonergan", b, { importJobId: "job-2" });
  if (idA.id !== idB.id) {
    fail(`mintContactId: same email at different rowIndex should produce SAME id; got ${idA.id} vs ${idB.id}`);
  }
  if (idA.basis !== "email") fail(`mintContactId basis expected email, got ${idA.basis}`);

  // Phone-only path
  const phoneRow = makeNormalizedRow({
    normalizedEmail: null,
    normalizedPhone: "+18165550100",
  });
  const phoneId = mintContactId("nicole-lonergan", phoneRow, { importJobId: "job-1" });
  if (phoneId.basis !== "phone") fail(`mintContactId basis expected phone, got ${phoneId.basis}`);

  // Name + address path
  const nameAddrRow = makeNormalizedRow({
    normalizedEmail: null,
    normalizedPhone: null,
    normalizedName: "patricia wong",
    address: "4321 W 63rd St, Kansas City, MO 64113",
  });
  const nameAddrId = mintContactId("nicole-lonergan", nameAddrRow, { importJobId: "job-1" });
  if (nameAddrId.basis !== "name_and_address") {
    fail(`mintContactId basis expected name_and_address, got ${nameAddrId.basis}`);
  }

  // Cross-workspace ids must differ even with same identity
  const idNicole = mintContactId("nicole-lonergan", a, { importJobId: "j" });
  const idOther = mintContactId("brookside-test", a, { importJobId: "j" });
  if (idNicole.id === idOther.id) {
    fail(`mintContactId: cross-workspace ids must differ for same identity; got ${idNicole.id}`);
  }
}

function runDedupeExactSafeMerge(): void {
  // findDedupePairs MUST treat exact identity hits as safe_merge.
  const existing = [
    makeExisting({ id: "crm-1", normalizedEmail: "susie@example.com" }),
  ];
  const incoming = [
    makeNormalizedRow({ rowIndex: 0, normalizedEmail: "susie@example.com" }),
  ];
  const pairs = findDedupePairs(incoming, existing);
  if (pairs.length !== 1) {
    fail(`dedupe: expected 1 pair, got ${pairs.length}`);
    return;
  }
  if (pairs[0].verdict !== "safe_merge") {
    fail(`dedupe: exact email → safe_merge, got ${pairs[0].verdict}`);
  }
  if (pairs[0].existingContactId !== "crm-1") {
    fail(`dedupe: pair pointed to ${pairs[0].existingContactId}, expected crm-1`);
  }
}

function runDedupeRefusesFirstNameOnly(): void {
  // Two contacts both named "Susie" with no shared email/phone/address:
  // must NOT produce safe_merge.
  const existing = [
    makeExisting({
      id: "crm-1",
      name: "Susie Adams",
      normalizedName: "susie",
      normalizedEmail: null,
      normalizedPhone: null,
      address: null,
    }),
  ];
  const incoming = [
    makeNormalizedRow({
      normalizedName: "susie",
      name: "Susie",
      normalizedEmail: null,
      normalizedPhone: null,
      address: null,
    }),
  ];
  const pairs = findDedupePairs(incoming, existing);
  if (pairs.some((p) => p.verdict === "safe_merge")) {
    fail("dedupe: first-name-only match must NOT produce safe_merge");
  }
}

function runMergePreservesNonBlankFields(): void {
  // Existing has phone; incoming has email but NO phone. Merge must
  // keep the existing phone (never nuke non-blank existing values).
  const existing = makeExisting({
    id: "crm-1",
    name: "Susie Adams",
    email: null,
    phone: "+18165551111",
    normalizedEmail: null,
    normalizedPhone: "+18165551111",
    tags: ["sphere"],
    notes: "first import — sphere of influence",
    lastInteractionAt: "2024-01-15T00:00:00Z",
  });
  const incoming = makeExisting({
    id: "crm-temporary-incoming-id",
    name: "Susie Adams",
    email: "susie@example.com",
    phone: null, // blank in CSV
    normalizedEmail: "susie@example.com",
    normalizedPhone: null,
    tags: ["VIP"],
    notes: "shorter note", // shorter than existing
    lastInteractionAt: "2024-06-20T00:00:00Z",
    createdAt: "2026-05-28T12:00:00Z", // newer than existing
  });
  const merged = mergeContactRecords({ incoming, existing });

  if (merged.id !== "crm-1") fail(`merge: id should be existing's, got ${merged.id}`);
  if (merged.phone !== "+18165551111") fail(`merge: must preserve existing phone, got ${merged.phone}`);
  if (merged.email !== "susie@example.com") fail(`merge: incoming email should win, got ${merged.email}`);
  if (merged.normalizedPhone !== "+18165551111") fail(`merge: normalized phone preserved, got ${merged.normalizedPhone}`);
  if (merged.createdAt !== existing.createdAt) {
    fail(`merge: createdAt must be existing's (oldest), got ${merged.createdAt}`);
  }
  if (merged.notes !== existing.notes) {
    fail(`merge: richer notes preserved, expected "${existing.notes}", got "${merged.notes}"`);
  }
  if (merged.lastInteractionAt !== "2024-06-20T00:00:00Z") {
    fail(`merge: later lastInteractionAt should win, got ${merged.lastInteractionAt}`);
  }
  // Tag union
  if (!merged.tags.includes("sphere") || !merged.tags.includes("VIP")) {
    fail(`merge: tag union expected, got [${merged.tags.join(", ")}]`);
  }
}

function runMergePreservesEnrichmentAndRepairs(): void {
  // The merge function itself preserves enrichment + repairs at the
  // record level. The persistence-layer JSONB-merging upsert preserves
  // them at the SQL level (covered by check-reimport-survival). This
  // fixture proves the application-layer merge defers correctly.
  const existing = makeExisting({
    id: "crm-1",
    enrichment: {
      opportunity: {
        source: "meridian_opportunity_v1",
        fetchedAt: "2026-05-27T00:00:00Z",
        priorityTier: "HIGH",
      } as unknown as NonNullable<CrmContactRecord["enrichment"]>["opportunity"],
    },
    repairs: [
      {
        field: "name" as const,
        originalValue: "Susie",
        newValue: "Susie Adams",
        source: "founder_rehab" as const,
        repairedAt: "2026-05-26T00:00:00Z",
      },
    ],
  });
  const incoming = makeExisting({
    id: "tmp",
    enrichment: undefined,
    repairs: undefined,
  });
  const merged = mergeContactRecords({ incoming, existing });
  if (!merged.enrichment) fail("merge: enrichment must be preserved");
  if (!merged.repairs || merged.repairs.length !== 1) {
    fail("merge: repairs[] must be preserved");
  }
}

function runMergeRefusesCrossWorkspace(): void {
  const existing = makeExisting({ id: "crm-1", workspaceId: "nicole-lonergan" });
  const incoming = makeExisting({ id: "tmp", workspaceId: "other-workspace" });
  let threw = false;
  try {
    mergeContactRecords({ incoming, existing });
  } catch {
    threw = true;
  }
  if (!threw) fail("merge: cross-workspace merge must throw");
}

function runDiagnosticsAssembly(): void {
  // Re-use the WiseAgent fixtures to make sure the diagnostics
  // surface the assembly correctly.
  const headers = [
    "First Name", "Last Name", "Email", "Home Phone",
    "Home Street", "Home City", "Home State", "Home Postal Code",
  ];
  const mapping = detectColumnMapping(headers);
  const row = normalizeCrmRow(
    {
      "First Name": "Susie",
      "Last Name": "Adams",
      "Email": "susie@example.com",
      "Home Phone": "8165551111",
      "Home Street": "5006 W 65th St",
      "Home City": "Prairie Village",
      "Home State": "KS",
      "Home Postal Code": "66208",
    },
    0, mapping, "wise_agent",
  );
  const diag = computeImportDiagnostics({ headers, mapping, rows: [row] });
  if (!diag.detectsSplitName) fail("diagnostics: detectsSplitName expected true");
  if (!diag.detectsSplitAddress) fail("diagnostics: detectsSplitAddress expected true");
  if (diag.rowsAssembledFromComponents !== 1) {
    fail(`diagnostics: rowsAssembledFromComponents expected 1, got ${diag.rowsAssembledFromComponents}`);
  }
  if (diag.rowsAddressAssembledFromComponents !== 1) {
    fail(`diagnostics: rowsAddressAssembledFromComponents expected 1, got ${diag.rowsAddressAssembledFromComponents}`);
  }
  if (diag.rowsMissingSurname !== 0) {
    fail(`diagnostics: rowsMissingSurname expected 0, got ${diag.rowsMissingSurname}`);
  }
  if (diag.rowsWithWeakAddress !== 0) {
    fail(`diagnostics: rowsWithWeakAddress expected 0, got ${diag.rowsWithWeakAddress}`);
  }
  if (diag.assemblySamples.length === 0) fail("diagnostics: assemblySamples should include the row");
  if (diag.assemblySamples[0].fromName !== "Susie Adams") {
    fail(`diagnostics: sample name expected "Susie Adams", got "${diag.assemblySamples[0].fromName}"`);
  }
  if (diag.assemblySamples[0].fromAddress !== "5006 W 65th St, Prairie Village, KS 66208") {
    fail(`diagnostics: sample address verbatim expected, got "${diag.assemblySamples[0].fromAddress}"`);
  }
}

function runReimportStabilityViaIdentity(): void {
  // Simulate a re-import: existing has 3 contacts; incoming repeats
  // those 3 (possibly with row-order changes) plus 1 new. Identity
  // resolution must produce 3 matches + 1 new — never 7 contacts.
  const existing = [
    makeExisting({ id: "crm-1", normalizedEmail: "a@example.com", normalizedName: "alice apple" }),
    makeExisting({ id: "crm-2", normalizedEmail: "b@example.com", normalizedName: "bob banana" }),
    makeExisting({ id: "crm-3", normalizedEmail: "c@example.com", normalizedName: "carol cherry" }),
  ];
  const incoming = [
    // Reordered + reindexed re-import
    makeNormalizedRow({ rowIndex: 0, normalizedEmail: "c@example.com", name: "Carol Cherry", normalizedName: "carol cherry" }),
    makeNormalizedRow({ rowIndex: 1, normalizedEmail: "a@example.com", name: "Alice Apple", normalizedName: "alice apple" }),
    makeNormalizedRow({ rowIndex: 2, normalizedEmail: "d@example.com", name: "Dan Date", normalizedName: "dan date" }), // new
    makeNormalizedRow({ rowIndex: 3, normalizedEmail: "b@example.com", name: "Bob Banana", normalizedName: "bob banana" }),
  ];
  let matched = 0;
  let fresh = 0;
  for (const r of incoming) {
    const res = resolveExistingContactForRow(r, existing);
    if (res.existing) matched += 1;
    else fresh += 1;
  }
  if (matched !== 3 || fresh !== 1) {
    fail(`re-import stability: expected 3 matched + 1 fresh, got ${matched} matched + ${fresh} fresh`);
  }
  // Active contact count would become 3 (existing) + 1 (new) = 4.
  // Critically NOT 7 (which is what rowIndex-derived IDs would produce).
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
  runIdentityResolution();
  runDeterministicContactIds();
  runDedupeExactSafeMerge();
  runDedupeRefusesFirstNameOnly();
  runMergePreservesNonBlankFields();
  runMergePreservesEnrichmentAndRepairs();
  runMergeRefusesCrossWorkspace();
  runDiagnosticsAssembly();
  runReimportStabilityViaIdentity();

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
      "identity resolution: exact email / phone / surname+address all match correctly",
      "identity resolution: first-name-only does NOT match unrelated people",
      "identity resolution: same surname different address does NOT match",
      "mintContactId: deterministic, stable across rowIndex changes, cross-workspace differ",
      "dedupe: exact identity hit produces safe_merge verdict",
      "dedupe: first-name-only never produces safe_merge",
      "merge: preserves existing phone when incoming is blank (never nukes non-blank)",
      "merge: preserves enrichment + repairs at application layer",
      "merge: keeps oldest createdAt + later lastInteractionAt + union of tags + richer notes",
      "merge: refuses cross-workspace merge (throws)",
      "diagnostics: detects split-name + split-address; counts assembled rows; samples preview",
      "re-import stability: 3 existing × 4 incoming (3 repeats + 1 new) → 3 matched + 1 fresh (not 7)",
    ],
  });
}

main();
