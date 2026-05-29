// Meridian — CRM import + relationship intelligence smoke checks.

import { execSync } from "node:child_process";
import { computeImportDiagnostics } from "../lib/crm-import/diagnostics";
import { detectColumnMapping, normalizeCrmRow } from "../lib/crm-import/normalize";
import { findDedupePairs, verdictFromScore, scoreDuplicatePair } from "../lib/crm-import/dedupe";
import {
  deriveDisplayAsTrusted,
  isTrustDisplayAligned,
  TRUST_CONFIDENCE,
} from "../lib/crm-import/trust";
import { validateImportRows } from "../lib/crm-import/validate";
import {
  buildContactScoreTransparency,
  effectivePriorityScore,
  scoreMetadataForImport,
} from "../lib/crm-import/scoreTransparency";
import { computeRelationshipScore, scoreFromCrmContact } from "../lib/relationship-intelligence/scoring";
import { buildResurfacingBuckets } from "../lib/relationship-intelligence/resurfacing";
import type { ContactDatumTrust, CrmContactRecord, CrmImportJob } from "../lib/crm-import/types";
import { __resetCrmSchemaReadyForTests } from "../lib/crm-import/initCrmContactsSchema";
import { useCrmNeonStorage } from "../lib/crm-import/storageConfig";
import {
  __resetCrmImportMemoryForTests,
  getImportJob,
  isCrmImportPersistenceAvailable,
  listContactsByWorkspace,
  saveImportJob,
  upsertContacts,
} from "../lib/crm-import/store";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

/** Fail CI if generated CRM contact/job files are tracked (runtime PII). */
function assertNoTrackedCrmRuntimeData(): void {
  const paths = [
    "data/crm-contacts",
    "data/crm-import-jobs",
    "data/crmImportJobs.json",
    "data/crmContacts.json",
    "data/crmImportRollbacks",
  ];
  for (const p of paths) {
    let tracked = "";
    try {
      tracked = execSync(`git ls-files -- ${p}`, { encoding: "utf8" }).trim();
    } catch {
      tracked = "";
    }
    assert(!tracked, `CRM runtime data must not be git-tracked (${p}): ${tracked}`);
  }
}

assertNoTrackedCrmRuntimeData();

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
  scoreMetadata: null,
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

const importMeta = scoreMetadataForImport(intel);
assert(importMeta?.storedAtImport === true, "import metadata marks storedAtImport");
assert(importMeta?.provenance === "imported", "import scores use imported provenance");
assert(importMeta?.verificationTier === "imported" || importMeta?.verificationTier === "confidence_low", "import verification tier set");

const scoredContact: CrmContactRecord = {
  ...existing,
  importJobId: "job-1",
  relationshipScore: intel.total,
  scoreMetadata: importMeta,
};
const persistedScore = scoreFromCrmContact(scoredContact);
assert(
  persistedScore.explanation.includes("Baseline import score")
    || persistedScore.explanation.includes("CRM import"),
  "persisted import score explains import provenance",
);
const transparency = buildContactScoreTransparency(scoredContact);
assert(!transparency.isAuthoritative, "baseline import transparency is not authoritative");
assert(transparency.verificationTier === "imported", "import contact tier is imported");
assert(transparency.dataQualityLabel.includes("Data Quality"), "data quality badge label present");
assert(transparency.recommendation.why.length > 0, "recommendation explains why");
assert(transparency.recommendation.evidence.length > 0, "recommendation lists evidence");
assert(transparency.reasonCodes.includes("BASELINE_IMPORT_SCORE"), "baseline reason code present");

const legacyTransparency = buildContactScoreTransparency({ ...existing, scoreMetadata: null });
assert(
  legacyTransparency.reasonCodes.includes("MISSING_PROVENANCE_METADATA"),
  "legacy contacts without scoreMetadata are flagged in reason codes",
);
assert(!legacyTransparency.isAuthoritative, "legacy contacts are not authoritative");

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
assert(noPhoneDiag.isEmailFirstExport, "Brookside-style export is email-first");
assert(noPhoneDiag.emailReachablePct === 100, "Brookside row has email");

async function checkContactsPersistence() {
  __resetCrmImportMemoryForTests();
  __resetCrmSchemaReadyForTests();
  assert(await isCrmImportPersistenceAvailable(), "CRM persistence must be writable in check env");

  const workspaceId = "nicole-lonergan";
  const contactId = `crm-persist-check-${useCrmNeonStorage() ? "neon" : "file"}-${Date.now().toString(36)}`;
  const persistScore = computeRelationshipScore({
    lastInteractionAt: null,
    tags: [],
    hasPhone: false,
    hasEmail: true,
    notesLength: 0,
    dataTrust: noPhoneRow.dataTrust,
  });
  const persistMeta = scoreMetadataForImport(persistScore);
  const contact: CrmContactRecord = {
    id: contactId,
    workspaceId,
    importJobId: "job-persist",
    name: "Persist Check",
    company: "Brookside",
    phone: null,
    email: "persist@example.com",
    address: null,
    notes: null,
    tags: [],
    lastInteractionAt: null,
    sourceCrm: "brookside_csv",
    normalizedPhone: null,
    normalizedEmail: "persist@example.com",
    normalizedCompany: "brookside",
    normalizedName: "persist check",
    dataTrust: noPhoneRow.dataTrust,
    relationshipScore: persistScore.total,
    scoreMetadata: {
      ...persistMeta,
      sourceFieldsUsed: ["email", "name", "company"],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { inserted } = await upsertContacts([contact]);
  assert(inserted === 1, "one contact inserted");

  __resetCrmImportMemoryForTests();
  const reloaded = await listContactsByWorkspace(workspaceId);
  assert(reloaded.length >= 1, "contacts survive memory reset via durable store");
  assert(reloaded.some((c) => c.id === contact.id), "persisted contact id round-trips");
  const roundTrip = reloaded.find((c) => c.id === contact.id);
  assert(roundTrip?.scoreMetadata?.provenance === "imported", "persisted contact keeps imported provenance");
  assert(
    roundTrip?.scoreMetadata?.verificationTier === "imported"
      || roundTrip?.scoreMetadata?.verificationTier === "confidence_low",
    "persisted contact keeps verification tier",
  );
  assert(
    effectivePriorityScore(roundTrip!, roundTrip!.relationshipScore ?? 0)
      <= (roundTrip!.relationshipScore ?? 0),
    "effective score is trust-adjusted down from raw import score",
  );

  if (useCrmNeonStorage()) {
    const otherWorkspace = await listContactsByWorkspace("labortech");
    assert(
      !otherWorkspace.some((c) => c.id === contact.id),
      "nicole contact must not appear in labortech workspace",
    );
  }
}

async function checkImportJobStore() {
  __resetCrmImportMemoryForTests();
  const job: CrmImportJob = {
    id: "import-test-ws-abc",
    workspaceId: "test-ws",
    sourceLabel: "check",
    state: "previewing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rowCount: 1,
    importedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    rollbackSnapshotId: null,
    error: null,
    headers,
    columnMapping: mapping,
    previewSample: [row],
    normalizedRows: [row],
    dedupePairs: [],
    mergeRecommendations: [],
  };
  await saveImportJob(job);
  const roundTrip = await getImportJob(job.id);
  assert(roundTrip?.id === job.id, "import job round-trips via in-memory store");
}

Promise.all([checkContactsPersistence(), checkImportJobStore()])
  .then(() => {
    console.log("crm-import:check passed");
    console.log("Brookside-style headers:", noPhoneHeaders.join(", "));
    console.log("Mapping:", JSON.stringify(noPhoneMapping));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
