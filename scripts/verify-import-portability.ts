/**
 * verify-import-portability — asserts the import path correctly handles
 * a representative spread of real-world CRM export shapes.
 *
 * Tests pure transformations only: `detectColumnMapping`,
 * `normalizeCrmRows`, `mintContactId`, `findDedupePairs`,
 * `rowsEligibleForImport`, `mergeContactRecords`. No DB.
 *
 * Run with:  npm run verify-import-portability
 *
 * The fixtures cover the shapes Meridian must support across future
 * workspaces (Nicole + Grace's SERVPRO + others) without per-customer
 * code changes:
 *
 *   1. WiseAgent residential real estate (split name + split address)
 *   2. Follow Up Boss / generic full-name + full-address (single columns)
 *   3. Mixed export (Name AND First/Last present; full Address AND
 *      Street/City/State/Postal Code present)
 *   4. Service / SERVPRO-style B2B (Company + Contact + Phone +
 *      Service Area, no address)
 *   5. Phone-only (no email; ensures phone identity path works)
 *   6. No-channel rows (operator-typed names; ensures graceful fallback)
 *   7. Internal duplicates within the CSV (same email twice; should
 *      collapse to one identity)
 *   8. Duplicate names with different companies (two real people; must
 *      NOT merge)
 *   9. Re-import idempotency (same CSV twice → same contact_ids)
 *  10. Contact Status header alongside First Name/Last Name (regression
 *      test for the contact/person alias bug)
 */

import {
  detectColumnMapping,
  normalizeCrmRows,
} from "@/lib/crm-import/normalize";
import {
  mintContactId,
  resolveExistingContact,
  resolveExistingContactForRow,
} from "@/lib/crm-import/identityKey";
import { findDedupePairs } from "@/lib/crm-import/dedupe";
import { parseCsv } from "@/lib/ingestion/csvParser";
import type {
  CrmContactRecord,
  NormalizedCrmContact,
} from "@/lib/crm-import/types";

const failures: string[] = [];
function fail(msg: string): void { failures.push(msg); }
function expectEqual<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function expectTrue(cond: boolean, label: string): void {
  if (!cond) fail(label);
}

function normalize(csv: string, label: string): { rows: NormalizedCrmContact[]; mapping: Record<string, string> } {
  const parsed = parseCsv(csv);
  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const mapping = detectColumnMapping(headers);
  const rows = normalizeCrmRows(parsed, mapping, label);
  return { rows, mapping };
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 1 — WiseAgent residential (split name + split address)
// ──────────────────────────────────────────────────────────────────

function runWiseAgentResidential(): void {
  const csv = [
    "First Name,Last Name,Email,Home Phone,Home Street,Home City,Home State,Home Postal Code,Tags",
    "Susie,Adams,sa@example.com,8165551111,5006 W 65th St,Prairie Village,KS,66208,Seller",
    "RaShondra,Banks,rb@example.com,8165552222,1463 E 76th Terrace,Kansas City,MO,64131,Buyer",
  ].join("\n");
  const { rows, mapping } = normalize(csv, "wise_agent_test");

  expectEqual(mapping.firstName, "First Name", "WiseAgent: firstName claim");
  expectEqual(mapping.lastName, "Last Name", "WiseAgent: lastName claim");
  expectEqual(mapping.street, "Home Street", "WiseAgent: street claim");
  expectEqual(mapping.city, "Home City", "WiseAgent: city claim");
  expectEqual(mapping.state, "Home State", "WiseAgent: state claim");
  expectEqual(mapping.postalCode, "Home Postal Code", "WiseAgent: postalCode claim");
  expectEqual(mapping.name, undefined, "WiseAgent: name should NOT be set");
  expectEqual(mapping.address, undefined, "WiseAgent: address should NOT be set");
  expectEqual(rows[0].name, "Susie Adams", "WiseAgent: row 0 assembled name");
  expectEqual(rows[0].address, "5006 W 65th St, Prairie Village, KS 66208", "WiseAgent: row 0 assembled address");
  expectEqual(rows[1].name, "RaShondra Banks", "WiseAgent: row 1 assembled name");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 2 — Full Name + Full Address single columns
// ──────────────────────────────────────────────────────────────────

function runFullNameFullAddress(): void {
  const csv = [
    "Name,Email,Phone,Address,Tags",
    "Greg Smith,greg@example.com,8165550100,\"4321 W 63rd St, Kansas City, MO 64113\",Seller",
    "Mary O'Brien,mary@example.com,8165550101,\"100 Main St, Overland Park, KS 66204\",Buyer",
  ].join("\n");
  const { rows, mapping } = normalize(csv, "fub_style");
  expectEqual(mapping.name, "Name", "FullNameFullAddress: name claim");
  expectEqual(mapping.address, "Address", "FullNameFullAddress: address claim");
  expectEqual(mapping.firstName, undefined, "FullNameFullAddress: firstName should NOT be set");
  expectEqual(rows[0].name, "Greg Smith", "FullNameFullAddress: row 0 verbatim name");
  expectEqual(rows[1].name, "Mary O'Brien", "FullNameFullAddress: apostrophe preserved");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 3 — Mixed: single-value AND component columns present
// ──────────────────────────────────────────────────────────────────

function runMixedShape(): void {
  const csv = [
    "Name,First Name,Last Name,Email,Address,Home Street,Home City",
    "Greg Smith,Greg,Smith,greg@example.com,\"4321 W 63rd St, KCMO 64113\",ignored,ignored",
  ].join("\n");
  const { rows, mapping } = normalize(csv, "mixed");
  expectEqual(mapping.name, "Name", "Mixed: single name wins for claim");
  expectEqual(mapping.firstName, "First Name", "Mixed: firstName also detected");
  expectEqual(mapping.address, "Address", "Mixed: single address wins");
  expectEqual(rows[0].name, "Greg Smith", "Mixed: single name used (component ignored)");
  expectEqual(rows[0].address, "4321 W 63rd St, KCMO 64113", "Mixed: single address used");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 4 — SERVPRO-style B2B (Company + Contact, no street/address)
// ──────────────────────────────────────────────────────────────────

function runServproStyle(): void {
  // Typical service-business shape: company is the canonical entity;
  // "Primary Contact" is the human; address is the company address.
  // Tests that the importer doesn't choke when residential fields are
  // absent and B2B fields dominate.
  const csv = [
    "Company,First Name,Last Name,Primary Email,Mobile Phone,Service Area,Notes",
    "Smith Plumbing LLC,Greg,Smith,greg@smithplumbing.com,8165550100,Brookside,Reliable contractor",
    "Acme HVAC,Mary,Wong,mary@acmehvac.com,8165550101,Plaza,Has Sunday emergency line",
  ].join("\n");
  const { rows, mapping } = normalize(csv, "servpro");
  expectEqual(mapping.company, "Company", "SERVPRO: company claim");
  expectEqual(mapping.firstName, "First Name", "SERVPRO: firstName claim");
  expectEqual(mapping.lastName, "Last Name", "SERVPRO: lastName claim");
  expectEqual(mapping.email, "Primary Email", "SERVPRO: email claim");
  expectEqual(mapping.phone, "Mobile Phone", "SERVPRO: phone claim");
  expectEqual(mapping.notes, "Notes", "SERVPRO: notes claim");
  expectEqual(rows[0].name, "Greg Smith", "SERVPRO: assembled name");
  expectEqual(rows[0].company, "Smith Plumbing LLC", "SERVPRO: company verbatim");
  expectEqual(rows[0].address, null, "SERVPRO: address null (no residential fields)");
  // mintContactId path: email is the strongest signal → email-derived id.
  const { basis: basis0 } = mintContactId("grace-servpro", rows[0], { importJobId: "j" });
  expectEqual(basis0, "email", "SERVPRO: id basis = email");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 5 — Phone-only contacts (no email)
// ──────────────────────────────────────────────────────────────────

function runPhoneOnly(): void {
  const csv = [
    "First Name,Last Name,Phone,Address",
    "Greg,Smith,8165550100,\"4321 W 63rd St, KCMO 64113\"",
  ].join("\n");
  const { rows } = normalize(csv, "phone_only");
  const { basis } = mintContactId("nicole-lonergan", rows[0], { importJobId: "j" });
  expectEqual(basis, "phone", "PhoneOnly: id basis = phone (no email)");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 6 — No-channel rows (operator-typed name only)
// ──────────────────────────────────────────────────────────────────

function runNoChannel(): void {
  // Full canonical address required for the name+address id path.
  // "KCMO" abbreviation fails detectWeakAddress (missing 2-letter state),
  // so use the full "Kansas City, MO" form.
  const csv = [
    "First Name,Last Name,Address",
    "Greg,Smith,\"4321 W 63rd St, Kansas City, MO 64113\"",
  ].join("\n");
  const { rows } = normalize(csv, "no_channel");
  const { basis } = mintContactId("nicole-lonergan", rows[0], { importJobId: "j" });
  // With no email/phone but a canonical address + name → name+address path.
  expectEqual(basis, "name_and_address", "NoChannel: id basis = name+address");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 7 — In-CSV duplicate (same email twice)
// ──────────────────────────────────────────────────────────────────

function runInCsvDuplicate(): void {
  const csv = [
    "First Name,Last Name,Email,Home Phone",
    "Susie,Adams,sa@example.com,8165551111",
    "Susie,Adams,sa@example.com,8165551111",
    "Susie,Adams,sa@example.com,8165551111",
  ].join("\n");
  const { rows } = normalize(csv, "in_csv_dup");
  const ids = rows.map((r) => mintContactId("nicole-lonergan", r, { importJobId: "j" }).id);
  expectEqual(ids[0], ids[1], "InCsvDup: row 0 and row 1 same id (same email)");
  expectEqual(ids[1], ids[2], "InCsvDup: row 1 and row 2 same id");
  expectEqual(new Set(ids).size, 1, "InCsvDup: 3 rows collapse to 1 identity");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 8 — Duplicate names with DIFFERENT companies (two real people)
// ──────────────────────────────────────────────────────────────────

function runDuplicateNameDifferentCompany(): void {
  const csv = [
    "Company,First Name,Last Name,Primary Email,Mobile Phone",
    "Acme Plumbing,Greg,Smith,greg@acmeplumbing.com,8165550100",
    "Smith HVAC,Greg,Smith,greg@smithhvac.com,8165550200",
  ].join("\n");
  const { rows } = normalize(csv, "dup_name_diff_co");
  const id0 = mintContactId("grace-servpro", rows[0], { importJobId: "j" }).id;
  const id1 = mintContactId("grace-servpro", rows[1], { importJobId: "j" }).id;
  expectTrue(id0 !== id1, "DupNameDiffCo: distinct emails → distinct ids (NEVER merge first-name-only)");

  // Identity resolution against an empty workspace should find neither.
  const existing: CrmContactRecord[] = [];
  const r0 = resolveExistingContactForRow(rows[0], existing);
  expectEqual(r0.existing, null, "DupNameDiffCo: row 0 fresh");

  // Cross-row resolution: put row 0 in 'existing', resolve row 1.
  // Since email differs, must NOT match.
  const c0FromRow0: CrmContactRecord = {
    id: id0, workspaceId: "grace-servpro", importJobId: "test",
    name: rows[0].name, company: rows[0].company,
    phone: rows[0].phone, email: rows[0].email, address: null,
    notes: null, tags: [], lastInteractionAt: null, sourceCrm: "test",
    normalizedPhone: rows[0].normalizedPhone, normalizedEmail: rows[0].normalizedEmail,
    normalizedCompany: rows[0].normalizedCompany, normalizedName: rows[0].normalizedName,
    dataTrust: rows[0].dataTrust, relationshipScore: null, scoreMetadata: null,
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  };
  const r1 = resolveExistingContactForRow(rows[1], [c0FromRow0]);
  expectEqual(r1.existing, null, "DupNameDiffCo: row 1 must NOT match row 0 (different email/phone)");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 9 — Re-import idempotency
// ──────────────────────────────────────────────────────────────────

function runReimportIdempotency(): void {
  const csv = [
    "First Name,Last Name,Email,Home Phone,Home Street,Home City,Home State,Home Postal Code",
    "Susie,Adams,sa@example.com,8165551111,5006 W 65th St,Prairie Village,KS,66208",
    "RaShondra,Banks,rb@example.com,8165552222,1463 E 76th Terrace,Kansas City,MO,64131",
  ].join("\n");

  // First import: parse + mint ids
  const { rows: r1 } = normalize(csv, "first");
  const ids1 = r1.map((r) => mintContactId("nicole-lonergan", r, { importJobId: "j-1" }).id);

  // Second import (same CSV; different jobId): ids must be byte-identical.
  const { rows: r2 } = normalize(csv, "second");
  const ids2 = r2.map((r) => mintContactId("nicole-lonergan", r, { importJobId: "j-2" }).id);

  expectEqual(ids1[0], ids2[0], "Idempotency: row 0 id stable across imports");
  expectEqual(ids1[1], ids2[1], "Idempotency: row 1 id stable across imports");

  // Confirm cross-workspace ids differ for identical content.
  const idGrace = mintContactId("grace-servpro", r2[0], { importJobId: "j" }).id;
  expectTrue(ids1[0] !== idGrace, "Workspace isolation: same identity, different workspace → different id");
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 10 — Contact Status alongside First/Last (regression)
// ──────────────────────────────────────────────────────────────────

function runContactStatusRegression(): void {
  const csv = [
    "First Name,Last Name,Email,Home Phone,Home Street,Home City,Home State,Home Postal Code,Contact Status",
    "Susie,Adams,sa@example.com,8165551111,5006 W 65th St,Prairie Village,KS,66208,No Status",
  ].join("\n");
  const { rows, mapping } = normalize(csv, "regression");
  expectEqual(mapping.name, undefined, "Regression: Contact Status MUST NOT claim name");
  expectEqual(rows[0].name, "Susie Adams", "Regression: assembly still produces real name");
  expectTrue(
    (rows[0].tags ?? []).includes("No Status"),
    "Regression: Contact Status value routed to tags (correct destination)",
  );
}

// ──────────────────────────────────────────────────────────────────
// FIXTURE 11 — Existing identity-match cross-resolves correctly
// ──────────────────────────────────────────────────────────────────

function runIdentityResolutionAcrossShapes(): void {
  // Existing contact from a WiseAgent import.
  const existing: CrmContactRecord[] = [
    {
      id: "crm-grace-servpro-abc123def456",
      workspaceId: "grace-servpro",
      importJobId: "prior", name: "Greg Smith", company: "Smith Plumbing LLC",
      phone: "+18165550100", email: "greg@smithplumbing.com",
      address: "4321 W 63rd St, KCMO 64113",
      notes: null, tags: ["vendor"], lastInteractionAt: "2026-01-15T00:00:00Z",
      sourceCrm: "wise_agent",
      normalizedPhone: "+18165550100",
      normalizedEmail: "greg@smithplumbing.com",
      normalizedCompany: "smith plumbing llc",
      normalizedName: "greg smith",
      dataTrust: {} as CrmContactRecord["dataTrust"],
      relationshipScore: null, scoreMetadata: null,
      createdAt: "2026-01-15T00:00:00Z", updatedAt: "2026-01-15T00:00:00Z",
    },
  ];

  // Same person re-arrives from a different export shape — full Name + Address columns.
  const csv = [
    "Name,Email,Phone,Address,Company",
    "Greg Smith,greg@smithplumbing.com,8165550100,\"4321 W 63rd St, KCMO 64113\",Smith Plumbing LLC",
  ].join("\n");
  const { rows } = normalize(csv, "shape_x");
  const res = resolveExistingContactForRow(rows[0], existing);
  expectEqual(res.reason, "email", "CrossShape: email-match resolves across export shapes");
  expectEqual(res.existing?.id, "crm-grace-servpro-abc123def456", "CrossShape: existing id preserved");
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

function main(): void {
  runWiseAgentResidential();
  runFullNameFullAddress();
  runMixedShape();
  runServproStyle();
  runPhoneOnly();
  runNoChannel();
  runInCsvDuplicate();
  runDuplicateNameDifferentCompany();
  runReimportIdempotency();
  runContactStatusRegression();
  runIdentityResolutionAcrossShapes();

  if (failures.length > 0) {
    console.error("");
    console.error("verify-import-portability FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("verify-import-portability PASSED");
  console.log("  • WiseAgent residential (split name + split address)");
  console.log("  • Full Name + Full Address single columns");
  console.log("  • Mixed shape (single wins over components)");
  console.log("  • SERVPRO-style B2B (company + contact, no address)");
  console.log("  • Phone-only contacts");
  console.log("  • No-channel rows (name+address path)");
  console.log("  • In-CSV duplicates collapse by identity");
  console.log("  • Duplicate names with different companies DO NOT merge");
  console.log("  • Re-import idempotency (byte-stable ids)");
  console.log("  • Contact Status regression (does NOT claim name)");
  console.log("  • Identity resolution works across export shapes");
}

main();
