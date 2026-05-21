// Meridian — CRM import + relationship intelligence smoke checks.

import { computeImportDiagnostics } from "../lib/crm-import/diagnostics";
import { detectColumnMapping, normalizeCrmRow } from "../lib/crm-import/normalize";
import { findDedupePairs, verdictFromScore, scoreDuplicatePair } from "../lib/crm-import/dedupe";
import {
  deriveDisplayAsTrusted,
  isTrustDisplayAligned,
  TRUST_CONFIDENCE,
} from "../lib/crm-import/trust";
import { validateImportRows } from "../lib/crm-import/validate";
import { computeRelationshipScore } from "../lib/relationship-intelligence/scoring";
import { buildResurfacingBuckets } from "../lib/relationship-intelligence/resurfacing";
import type { ContactDatumTrust, CrmContactRecord } from "../lib/crm-import/types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertTrustDatum(datum: ContactDatumTrust, context: string) {
  assert(isTrustDisplayAligned(datum), `${context}: trust display matches level`);
  if (datum.trustLevel === "weak" || datum.trustLevel === "missing") {
    assert(!datum.displayAsTrusted, `${context}: weak/missing must not display as trusted`);
  }
  if (datum.trustLevel === "acceptable") {
    assert(!datum.displayAsTrusted, `${context}: acceptable must not display as verified`);
  }
  if (datum.displayAsTrusted) {
    assert(datum.trustLevel === "verified", `${context}: only verified may display as trusted`);
    assert(datum.confidence >= TRUST_CONFIDENCE.verified, `${context}: verified requires confidence threshold`);
  }
}

assert(deriveDisplayAsTrusted("verified") === true, "verified displays as trusted");
assert(deriveDisplayAsTrusted("acceptable") === false, "acceptable does not display as trusted");
assert(deriveDisplayAsTrusted("weak") === false, "weak does not display as trusted");

const headers = ["Full Name", "Account Name", "Phone", "Email", "Last Contact"];
const mapping = detectColumnMapping(headers);
assert(mapping.name === "Full Name", "name column should map");
assert(mapping.company === "Account Name", "company column should map");

const row = normalizeCrmRow(
  {
    "Full Name": "Jane Doe",
    "Account Name": "Acme Roofing",
    Phone: "(816) 555-1234",
    Email: "jane@acmeroofing.com",
    "Last Contact": "2026-01-15",
  },
  0,
  mapping,
  "hubspot",
);
assert(row.normalizedPhone === "8165551234", "phone normalized");
assertTrustDatum(row.dataTrust.phone, "import phone");
assertTrustDatum(row.dataTrust.email, "import email");
assert(row.dataTrust.phone.trustLevel === "acceptable", "csv phone is acceptable not verified");
assert(!row.dataTrust.phone.displayAsTrusted, "csv phone must not show verified styling");

const existing: CrmContactRecord = {
  id: "crm-test-1",
  workspaceId: "test",
  importJobId: null,
  name: "Jane Doe",
  company: "Acme Roofing LLC",
  phone: "8165551234",
  email: "jane@acmeroofing.com",
  address: null,
  notes: null,
  tags: [],
  lastInteractionAt: null,
  sourceCrm: "manual",
  normalizedPhone: "8165551234",
  normalizedEmail: "jane@acmeroofing.com",
  normalizedCompany: "acme roofing llc",
  normalizedName: "jane doe",
  dataTrust: row.dataTrust,
  relationshipScore: 70,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const { score } = scoreDuplicatePair(row, existing);
assert(verdictFromScore(score) !== "unique", "duplicate should be detected");
const pairs = findDedupePairs([row], [existing]);
assert(pairs.length === 1, "one dedupe pair expected");
assert(pairs[0].verdict !== "unique", "never silent — verdict surfaced");

const validation = validateImportRows([row], pairs);
assert(validation.valid >= 1, "row should be valid");

const intel = computeRelationshipScore({
  lastInteractionAt: row.lastInteractionAt,
  tags: row.tags,
  hasPhone: true,
  hasEmail: true,
  notesLength: 0,
  dataTrust: row.dataTrust,
});
assert(intel.total >= 0 && intel.total <= 100, "score in range");
assert(intel.factors.length >= 6, "factors present");

const buckets = buildResurfacingBuckets([existing]);
assert(buckets.length === 6, "six resurfacing buckets");

const diag = computeImportDiagnostics({
  headers,
  mapping,
  rows: [row],
});
assert(diag.mappedPhoneColumns.includes("Phone"), "diagnostics lists mapped phone column");
assert(diag.rowsMissingPhone === 0, "row with phone is not missing phone");

const noPhoneHeaders = ["Client Name", "Company", "E-mail", "Last Activity"];
const noPhoneMapping = detectColumnMapping(noPhoneHeaders);
const noPhoneRow = normalizeCrmRow(
  {
    "Client Name": "Sam Seller",
    Company: "Brookside Listing",
    "E-mail": "sam@example.com",
    "Last Activity": "2025-11-01",
  },
  0,
  noPhoneMapping,
  "brookside_csv",
);
assert(noPhoneRow.dataTrust.phone.trustLevel === "missing", "unmapped phone column yields missing trust");
const noPhoneDiag = computeImportDiagnostics({
  headers: noPhoneHeaders,
  mapping: noPhoneMapping,
  rows: [noPhoneRow],
});
assert(noPhoneDiag.mappedPhoneColumns.length === 0, "no phone column mapped");
assert(noPhoneDiag.highPhoneMissingRate, "100% missing phones triggers warning");

console.log("crm-import:check passed");
console.log("Brookside-style headers:", noPhoneHeaders.join(", "));
console.log("Mapping:", JSON.stringify(noPhoneMapping));
