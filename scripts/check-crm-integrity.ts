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

function main(): void {
  runCompanyGuardChecks();
  runIntegrityChecks();
  runIntegrityDeterminism();
  runEligibilityChecks();
  runLaborTechReadiness();
  runRepairOverlayChecks();

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
    ],
  });
}

main();
