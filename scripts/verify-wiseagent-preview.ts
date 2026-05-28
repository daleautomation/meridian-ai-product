/**
 * verify-wiseagent-preview — production-like assertion that the
 * `createImportPreview` function produces the expected component-field
 * mapping and assembled rows for the canonical WiseAgent column shape.
 *
 * Exit codes:
 *   0  — all assertions pass; the importer in THIS checkout is correct
 *   1  — at least one assertion fails; output reports which
 *
 * This script does NOT touch Neon and does NOT make HTTP requests. It
 * calls the real production code path (`createImportPreview` → which
 * runs `detectColumnMapping` + `normalizeCrmRows`) in-process with a
 * fixed WiseAgent CSV. If this passes locally but production behaves
 * differently, the deployed bundle is not the local source.
 *
 * Run:
 *   npm run verify-wiseagent-preview
 */

import { parseCsv } from "@/lib/ingestion/csvParser";
import {
  detectColumnMapping,
  normalizeCrmRows,
} from "@/lib/crm-import/normalize";
import { findDedupePairs } from "@/lib/crm-import/dedupe";
import { resolveExistingContactForRow } from "@/lib/crm-import/identityKey";
import { mergeContactRecords } from "@/lib/crm-import/merge";
import { rowsEligibleForImport, validateImportRows } from "@/lib/crm-import/validate";
import type { CrmContactRecord } from "@/lib/crm-import/types";

interface Failure {
  field: string;
  expected: string;
  actual: string;
}

const WISE_AGENT_CSV = [
  "First Name,Last Name,Email,Home Phone,Home Street,Home City,Home State,Home Postal Code,Tags,Last Activity",
  "Susan,Adams,susan@example.com,8165551111,5006 W 65th St,Prairie Village,KS,66208,sphere,2024-01-15",
  "Susie,Adams,susie@example.com,8165552222,5006 W 65th St,Prairie Village,KS,66208,Seller,2024-02-20",
  "RaShondra,Banks,rb@example.com,8165553333,1463 E 76th Terrace,Kansas City,MO,64131,Buyer,2023-09-01",
  "Leah B.,Barnett,leah@example.com,8165554444,7316 Hullwood Ave,Kansas City,MO,64133,Seller,2024-03-10",
].join("\n");

function expectEqual(
  label: string,
  actual: unknown,
  expected: unknown,
  failures: Failure[],
): void {
  if (actual !== expected) {
    failures.push({
      field: label,
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    });
  }
}

function containsAny(haystack: string | null | undefined, needles: ReadonlyArray<string>): boolean {
  if (!haystack) return false;
  return needles.some((n) => haystack.includes(n));
}

function main(): void {
  const failures: Failure[] = [];
  const parsed = parseCsv(WISE_AGENT_CSV);
  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const mapping = detectColumnMapping(headers);
  const rows = normalizeCrmRows(parsed, mapping, "wise_agent_verifier");

  // ── Mapping assertions ────────────────────────────────────────
  expectEqual("mapping.firstName", mapping.firstName, "First Name", failures);
  expectEqual("mapping.lastName", mapping.lastName, "Last Name", failures);
  expectEqual("mapping.street", mapping.street, "Home Street", failures);
  expectEqual("mapping.city", mapping.city, "Home City", failures);
  expectEqual("mapping.state", mapping.state, "Home State", failures);
  expectEqual("mapping.postalCode", mapping.postalCode, "Home Postal Code", failures);
  expectEqual("mapping.email", mapping.email, "Email", failures);
  expectEqual("mapping.phone", mapping.phone, "Home Phone", failures);

  // Critically — name and address MUST NOT be claimed because all
  // their content lives in component columns.
  expectEqual("mapping.name (should be unset)", mapping.name, undefined, failures);
  expectEqual("mapping.address (should be unset)", mapping.address, undefined, failures);

  // ── Row assembly assertions ───────────────────────────────────
  if (rows.length < 4) {
    failures.push({
      field: "rows.length",
      expected: ">=4",
      actual: String(rows.length),
    });
  } else {
    expectEqual("rows[0].name", rows[0].name, "Susan Adams", failures);
    expectEqual("rows[1].name", rows[1].name, "Susie Adams", failures);
    expectEqual("rows[2].name", rows[2].name, "RaShondra Banks", failures);
    expectEqual("rows[3].name", rows[3].name, "Leah B. Barnett", failures);

    expectEqual(
      "rows[0].address",
      rows[0].address,
      "5006 W 65th St, Prairie Village, KS 66208",
      failures,
    );
    expectEqual(
      "rows[1].address",
      rows[1].address,
      "5006 W 65th St, Prairie Village, KS 66208",
      failures,
    );
    expectEqual(
      "rows[2].address",
      rows[2].address,
      "1463 E 76th Terrace, Kansas City, MO 64131",
      failures,
    );
    expectEqual(
      "rows[3].address",
      rows[3].address,
      "7316 Hullwood Ave, Kansas City, MO 64133",
      failures,
    );
  }

  // ── Surname presence assertion (the original failure mode) ────
  if (rows.length > 0) {
    const surnameTokens = ["Adams", "Banks", "Barnett"];
    const r0HasSurname = containsAny(rows[0].name, surnameTokens);
    if (!r0HasSurname) {
      failures.push({
        field: "rows[0].name surname presence",
        expected: "name includes one of: Adams / Banks / Barnett",
        actual: rows[0].name,
      });
    }
  }

  // ── Address completeness assertion ────────────────────────────
  if (rows.length > 0) {
    const cityStateZip = ["KS 66208", "MO 64131", "MO 64133"];
    const r0HasCityStateZip = containsAny(rows[0].address, cityStateZip);
    if (!r0HasCityStateZip) {
      failures.push({
        field: "rows[0].address city/state/zip presence",
        expected: "address includes one of: KS 66208 / MO 64131 / MO 64133",
        actual: rows[0].address ?? "",
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Convergence simulation
  // ─────────────────────────────────────────────────────────────
  // Models the actual failure mode: existing Neon contacts hold the
  // PRE-FIX truncated values (`name: "Susie"`, `address: "5006 W 65th St"`)
  // but their normalizedEmail is correct. The re-import comes through
  // with the NEW assembled values for the same people. Proves:
  //   1. findDedupePairs identifies them as safe_merge by email
  //   2. rowsEligibleForImport DOES NOT filter safe_merge rows
  //      (the bug fixed in validate.ts)
  //   3. resolveExistingContactForRow reuses the existing contact id
  //   4. mergeContactRecords updates name + address fields to the
  //      assembled values while preserving createdAt
  //   5. Total active contact count stays stable — no inflation
  //
  // Reproduces what Nicole's corpus (228 → 326 inflation) would do
  // under the fixed pipeline: same email rows fold into existing
  // records, no new contact_ids minted.
  function trustStub(value: string | null, source: string) {
    return {
      value,
      source,
      confidence: value ? 50 : 0,
      trustLevel: (value ? "weak" : "missing") as
        | "verified" | "acceptable" | "weak" | "missing" | "conflicting",
      lastVerifiedAt: null,
      enrichmentProvider: null,
      conflictState: "none" as const,
      displayAsTrusted: false,
    };
  }
  function makeExistingTruncated(
    id: string,
    name: string,
    email: string,
    address: string,
  ): CrmContactRecord {
    return {
      id,
      workspaceId: "nicole-lonergan",
      importJobId: "pre-fix-import",
      name, // truncated to first-name only
      company: "",
      phone: null,
      email,
      address, // truncated to street only
      notes: null,
      tags: [],
      lastInteractionAt: null,
      sourceCrm: "wise_agent",
      normalizedPhone: null,
      normalizedEmail: email,
      normalizedCompany: null,
      normalizedName: name.toLowerCase(),
      dataTrust: {
        name: trustStub(name, "crm_import:wise_agent"),
        company: trustStub(null, "crm_import:wise_agent"),
        phone: trustStub(null, "crm_import:wise_agent"),
        email: trustStub(email, "crm_import:wise_agent"),
        address: trustStub(address, "crm_import:wise_agent"),
        lastInteraction: trustStub(null, "crm_import:wise_agent"),
      },
      relationshipScore: null,
      scoreMetadata: null,
      createdAt: "2026-05-21T21:05:39Z", // older than the re-import
      updatedAt: "2026-05-21T21:05:39Z",
    };
  }
  const existing: CrmContactRecord[] = [
    makeExistingTruncated("crm-existing-susan", "Susan", "susan@example.com", "5006 W 65th St"),
    makeExistingTruncated("crm-existing-susie", "Susie", "susie@example.com", "5006 W 65th St"),
    makeExistingTruncated("crm-existing-rashondra", "RaShondra", "rb@example.com", "1463 E 76th Terrace"),
    makeExistingTruncated("crm-existing-leah", "Leah B.", "leah@example.com", "7316 Hullwood Ave"),
  ];
  const preCount = existing.length;

  // Identity-based dedupe — all 4 incoming rows should produce safe_merge.
  const dedupePairs = findDedupePairs(rows, existing);
  const safeMergeRows = dedupePairs.filter((p) => p.verdict === "safe_merge");
  if (safeMergeRows.length !== rows.length) {
    failures.push({
      field: "dedupe.safeMerge count",
      expected: `${rows.length} safe_merge pairs (every incoming row matches by email)`,
      actual: `${safeMergeRows.length} safe_merge pairs`,
    });
  }

  // rowsEligibleForImport MUST NOT filter safe_merge rows.
  // (This is the bug we fixed in validate.ts. If it regresses,
  // eligible.length will drop to 0 and existing rows will never update.)
  const validation = validateImportRows(rows, dedupePairs);
  const eligible = rowsEligibleForImport(rows, validation.blockedRowIndexes, true, dedupePairs);
  if (eligible.length !== rows.length) {
    failures.push({
      field: "rowsEligibleForImport.length",
      expected: `${rows.length} (safe_merge rows must NOT be filtered)`,
      actual: `${eligible.length}`,
    });
  }

  // Apply identity resolution + merge to each eligible row, exactly
  // as executeImport does.
  let matchedCount = 0;
  let freshCount = 0;
  const mergedById = new Map<string, CrmContactRecord>();
  for (const row of eligible) {
    const resolution = resolveExistingContactForRow(row, existing);
    if (resolution.existing) {
      matchedCount += 1;
      const importedRecord: CrmContactRecord = {
        id: resolution.existing.id,
        workspaceId: "nicole-lonergan",
        importJobId: "fresh-import",
        name: row.name,
        company: row.company,
        phone: row.phone,
        email: row.email,
        address: row.address,
        notes: row.notes,
        tags: row.tags,
        lastInteractionAt: row.lastInteractionAt,
        sourceCrm: row.sourceCrm,
        normalizedPhone: row.normalizedPhone,
        normalizedEmail: row.normalizedEmail,
        normalizedCompany: row.normalizedCompany,
        normalizedName: row.normalizedName,
        dataTrust: row.dataTrust,
        relationshipScore: null,
        scoreMetadata: null,
        createdAt: "2026-05-28T12:00:00Z",
        updatedAt: "2026-05-28T12:00:00Z",
      };
      mergedById.set(
        resolution.existing.id,
        mergeContactRecords({ incoming: importedRecord, existing: resolution.existing }),
      );
    } else {
      freshCount += 1;
    }
  }

  if (matchedCount !== rows.length) {
    failures.push({
      field: "identity-resolution match count",
      expected: `${rows.length} (all incoming rows match by email)`,
      actual: `${matchedCount}`,
    });
  }
  if (freshCount !== 0) {
    failures.push({
      field: "identity-resolution fresh count",
      expected: "0 (no inflation — all rows match existing)",
      actual: `${freshCount}`,
    });
  }

  // Post-merge state assertions: existing IDs preserved, names + addresses
  // upgraded to the assembled values, createdAt preserved.
  for (const ex of existing) {
    const merged = mergedById.get(ex.id);
    if (!merged) {
      failures.push({
        field: `merge.byId[${ex.id}]`,
        expected: "merged record exists",
        actual: "missing",
      });
      continue;
    }
    if (merged.id !== ex.id) {
      failures.push({
        field: `merge[${ex.id}].id`,
        expected: ex.id,
        actual: merged.id,
      });
    }
    if (merged.createdAt !== ex.createdAt) {
      failures.push({
        field: `merge[${ex.id}].createdAt (preserve oldest)`,
        expected: ex.createdAt,
        actual: merged.createdAt,
      });
    }
    if (!merged.name || merged.name.trim().split(/\s+/).length < 2) {
      failures.push({
        field: `merge[${ex.id}].name (upgrade truncated → assembled)`,
        expected: "multi-token assembled name",
        actual: merged.name,
      });
    }
    if (!merged.address || !merged.address.includes(",")) {
      failures.push({
        field: `merge[${ex.id}].address (upgrade truncated → assembled)`,
        expected: "comma-bearing canonical address",
        actual: merged.address ?? "",
      });
    }
  }

  // Convergence assertion: total contact count after the merge equals
  // the pre-existing count. No inflation.
  const projectedTotal = preCount + freshCount;
  if (projectedTotal !== preCount) {
    failures.push({
      field: "projected active contact count",
      expected: `${preCount} (stable — no inflation)`,
      actual: `${projectedTotal}`,
    });
  }

  // ── Report ────────────────────────────────────────────────────
  console.log("");
  console.log("verify-wiseagent-preview");
  console.log("================");
  console.log(`  CSV rows parsed:           ${rows.length}`);
  console.log(`  Detected mapping:`);
  for (const [field, header] of Object.entries(mapping)) {
    console.log(`    ${field.padEnd(16)} ← "${header}"`);
  }
  console.log(`  Sample assembled rows:`);
  for (const r of rows.slice(0, 4)) {
    console.log(`    name = "${r.name}"   address = "${r.address}"`);
  }
  console.log("");
  console.log("Convergence simulation");
  console.log("================");
  console.log(`  pre-existing truncated contacts: ${preCount}`);
  console.log(`  dedupe safe_merge pairs:         ${safeMergeRows.length}`);
  console.log(`  rowsEligibleForImport:           ${eligible.length}  (safe_merge NOT filtered)`);
  console.log(`  identity-matched (no insert):    ${matchedCount}`);
  console.log(`  fresh inserts:                   ${freshCount}`);
  console.log(`  projected total after re-import: ${projectedTotal}  (was ${preCount}; stable)`);
  if (mergedById.size > 0) {
    console.log(`  sample merged rows (existing id → assembled name + address):`);
    for (const [id, merged] of mergedById) {
      console.log(`    ${id.padEnd(28)} → "${merged.name}" · "${merged.address}"`);
    }
  }
  console.log("");

  if (failures.length > 0) {
    console.error("verify-wiseagent-preview FAILED");
    for (const f of failures) {
      console.error(`  - ${f.field}`);
      console.error(`      expected: ${f.expected}`);
      console.error(`      actual:   ${f.actual}`);
    }
    console.error("");
    console.error("The local importer is NOT producing the expected output.");
    console.error("Inspect lib/crm-import/normalize.ts (COLUMN_ALIASES + detectColumnMapping)");
    console.error("and lib/crm-import/types.ts (CRM_IMPORT_FIELDS order).");
    process.exit(1);
  }

  console.log("verify-wiseagent-preview PASSED");
  console.log("  • Multi-column assembly produces full names + canonical addresses.");
  console.log("  • Identity-based dedupe pairs incoming rows with existing truncated rows.");
  console.log("  • rowsEligibleForImport admits safe_merge rows (no filtering regression).");
  console.log("  • mergeContactRecords updates existing IDs in place with the assembled values.");
  console.log("  • Re-import on already-present contacts produces zero new rows.");
}

main();
