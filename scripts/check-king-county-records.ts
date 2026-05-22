/**
 * King County join validation.
 *
 * Asserts the deterministic joiner contract on a synthetic Assessor +
 * Recorder fixture: every rejection code fires once, output is byte-
 * identical and SHA-256-identical across runs, latest-transfer logic
 * picks the most recent ownership-transfer document (ignoring DOT and
 * other non-transfer instruments), and the joined CSV round-trips
 * through `parsePublicRecordCsv` with zero rejections.
 */

import { createHash } from "node:crypto";

import {
  parsePublicRecordCsv,
} from "@/lib/enrichment/public-records";
import {
  joinKingCountyRecords,
  serializeJoinedRowsToCsv,
  type AssessorRow,
  type JoinRejectionCode,
  type RecorderRow,
} from "@/lib/enrichment/public-records/king-county";

const FIXED_OBSERVED_AT = "2026-05-22T00:00:00.000Z";
const failures: string[] = [];

function fail(msg: string): void {
  failures.push(msg);
}

// ── Synthetic Assessor fixture — every rejection path + happy path ──
const ASSESSOR: AssessorRow[] = [
  // 0: happy path — joined to two recorder transfer docs (latest wins)
  {
    parcelId: "1234567890",
    situsAddress: "1111 Cedar Blvd, Renton, WA 98057",
    ownerName: "Smith, Jane",
    mailingAddress: "PO Box 1234, Seattle, WA 98101",
    propertyType: "single family",
    assessedValue: "815000",
  },
  // 1: malformed parcel
  { parcelId: "INVALID-XYZ", situsAddress: "100 Pine St, Seattle, WA 98101" },
  // 2: missing parcel
  { situsAddress: "200 Oak Ave, Bellevue, WA 98004" },
  // 3: weak address (city-only)
  { parcelId: "9876543210", situsAddress: "Seattle" },
  // 4 + 5: duplicate parcels — both rejected as a group
  { parcelId: "5555555555", situsAddress: "500 Birch Way, Seattle, WA 98109" },
  { parcelId: "5555555555", situsAddress: "501 Birch Way, Seattle, WA 98109" },
  // 6: missing situs address
  { parcelId: "1111222233" },
  // 7: hyphenated parcel that normalizes — second happy path
  {
    parcelId: "777777-7777",
    situsAddress: "222 Maple Dr, Bellevue, WA 98004",
    ownerName: "Lee, Pat",
    propertyType: "townhouse",
  },
];

// ── Synthetic Recorder fixture ──
const RECORDER: RecorderRow[] = [
  // Happy parcel 1234567890: earlier transfer (2010)
  {
    parcelId: "1234567890",
    documentType: "WD",
    recordingDate: "2010-03-15",
    documentNumber: "20100315000456",
  },
  // Happy parcel 1234567890: latest transfer (2014) — should win
  {
    parcelId: "1234567890",
    documentType: "SWD",
    recordingDate: "2014-09-21",
    documentNumber: "20140921000123",
  },
  // Happy parcel 1234567890: non-transfer (DOT) — ignored
  {
    parcelId: "1234567890",
    documentType: "DOT",
    recordingDate: "2020-01-15",
    documentNumber: "20200115000789",
  },
  // Recorder malformed parcel
  {
    parcelId: "BADPARCEL",
    documentType: "SWD",
    recordingDate: "2015-06-01",
    documentNumber: "20150601000111",
  },
  // Recorder malformed date
  {
    parcelId: "9876543210",
    documentType: "SWD",
    recordingDate: "yesterday afternoon",
    documentNumber: "20150601000222",
  },
  // Orphan recorder parcel — no matching assessor row at all
  {
    parcelId: "8888888888",
    documentType: "SWD",
    recordingDate: "2018-04-10",
    documentNumber: "20180410000333",
  },
  // Recorder missing parcel
  {
    documentType: "SWD",
    recordingDate: "2019-02-02",
    documentNumber: "20190202000444",
  },
  // Recorder for happy parcel 7777777777: single transfer
  {
    parcelId: "7777777777",
    documentType: "QCD",
    recordingDate: "2008-06-15",
    documentNumber: "20080615000555",
  },
];

function runOnce() {
  return joinKingCountyRecords({
    assessor: ASSESSOR,
    recorder: RECORDER,
    observedAt: FIXED_OBSERVED_AT,
  });
}

function main(): void {
  // 1. Determinism: two identical runs produce byte-identical CSV + audit.
  const runA = runOnce();
  const runB = runOnce();
  const csvA = serializeJoinedRowsToCsv(runA.rows);
  const csvB = serializeJoinedRowsToCsv(runB.rows);
  if (csvA !== csvB) fail("determinism: CSV output differs between two identical runs");
  const hashA = createHash("sha256").update(csvA).digest("hex");
  const hashB = createHash("sha256").update(csvB).digest("hex");
  if (hashA !== hashB) fail("determinism: CSV SHA-256 hashes differ");
  if (JSON.stringify(runA.audit) !== JSON.stringify(runB.audit)) {
    fail("determinism: audit JSON differs between two identical runs");
  }

  // 2. Accepted row count: exactly 2 (the two happy-path parcels).
  if (runA.rows.length !== 2) {
    fail(`accepted: expected 2 rows, got ${runA.rows.length}`);
  }

  // 3. Output ordering: parcelId ASC.
  if (runA.rows[0]?.parcelId !== "1234567890" || runA.rows[1]?.parcelId !== "7777777777") {
    fail(
      `ordering: expected [1234567890, 7777777777], got ${runA.rows.map((r) => r.parcelId).join(",")}`,
    );
  }

  // 4. Latest-transfer logic: parcel 1234567890 → 2014-09-21 wins
  //    (later than the 2010 WD, and the DOT is ignored).
  const happy = runA.rows[0];
  if (!happy) {
    fail("happy: missing primary joined row");
  } else {
    if (!happy.ownershipStartDate.startsWith("2014-09-21")) {
      fail(
        `latest-transfer: expected 2014-09-21, got ${happy.ownershipStartDate}`,
      );
    }
    if (!happy.lastTransferDate.startsWith("2014-09-21")) {
      fail(`lastTransferDate mirror: got ${happy.lastTransferDate}`);
    }
    if (happy.sourceName !== "county_recorder:king_wa") {
      fail(`sourceName: expected county_recorder:king_wa, got ${happy.sourceName}`);
    }
    if (!happy.recordUrl.includes("1234567890")) {
      fail("recordUrl: missing parcelId interpolation");
    }
    if (happy.observedAt !== FIXED_OBSERVED_AT) {
      fail(`observedAt: expected ${FIXED_OBSERVED_AT}, got ${happy.observedAt}`);
    }
  }

  // 5. Hyphenated parcel normalizes to 10 digits.
  const second = runA.rows[1];
  if (second?.parcelId !== "7777777777") {
    fail(`parcelId normalization: expected 7777777777, got ${second?.parcelId}`);
  }
  if (!second?.ownershipStartDate.startsWith("2008-06-15")) {
    fail(`second row: ownershipStartDate expected 2008-06-15, got ${second?.ownershipStartDate}`);
  }

  // 6. Every required rejection code fires at least once.
  const codesPresent = new Set(runA.audit.rejections.map((r) => r.code));
  const requiredCodes: JoinRejectionCode[] = [
    "missing_parcel_id",
    "malformed_parcel_id",
    "duplicate_parcel_id",
    "missing_situs_address",
    "weak_address",
    "malformed_date",
  ];
  for (const code of requiredCodes) {
    if (!codesPresent.has(code)) fail(`rejection: code ${code} did not fire`);
  }

  // 7. Source-specific rejection coverage.
  const assessorRejs = runA.audit.rejections.filter((r) => r.source === "assessor");
  const recorderRejs = runA.audit.rejections.filter((r) => r.source === "recorder");
  if (!assessorRejs.some((r) => r.code === "malformed_parcel_id")) {
    fail("rejection: expected assessor malformed_parcel_id");
  }
  if (!assessorRejs.some((r) => r.code === "missing_parcel_id")) {
    fail("rejection: expected assessor missing_parcel_id");
  }
  if (!assessorRejs.some((r) => r.code === "weak_address")) {
    fail("rejection: expected assessor weak_address");
  }
  if (!assessorRejs.some((r) => r.code === "missing_situs_address")) {
    fail("rejection: expected assessor missing_situs_address");
  }
  if (!assessorRejs.some((r) => r.code === "duplicate_parcel_id")) {
    fail("rejection: expected assessor duplicate_parcel_id");
  }
  if (!recorderRejs.some((r) => r.code === "missing_parcel_id")) {
    fail("rejection: expected recorder missing_parcel_id");
  }
  if (!recorderRejs.some((r) => r.code === "malformed_parcel_id")) {
    fail("rejection: expected recorder malformed_parcel_id");
  }
  if (!recorderRejs.some((r) => r.code === "malformed_date")) {
    fail("rejection: expected recorder malformed_date");
  }

  // 8. Duplicate audit list contains 5555555555 (and only that).
  if (
    runA.audit.duplicateParcelIds.length !== 1 ||
    runA.audit.duplicateParcelIds[0] !== "5555555555"
  ) {
    fail(
      `duplicates: expected [5555555555], got [${runA.audit.duplicateParcelIds.join(",")}]`,
    );
  }
  // Both rows of the dup group must be in rejections.
  const dupRows = assessorRejs.filter((r) => r.code === "duplicate_parcel_id");
  if (dupRows.length !== 2) {
    fail(`duplicates: expected 2 dup-row rejections, got ${dupRows.length}`);
  }

  // 9. Orphan recorder list contains 8888888888.
  if (
    runA.audit.orphanRecorderParcelIds.length !== 1 ||
    runA.audit.orphanRecorderParcelIds[0] !== "8888888888"
  ) {
    fail(
      `orphans: expected [8888888888], got [${runA.audit.orphanRecorderParcelIds.join(",")}]`,
    );
  }

  // 10. byCode totals match rejections.length.
  const byCodeTotal = Object.values(runA.audit.byCode).reduce((a, b) => a + b, 0);
  if (byCodeTotal !== runA.audit.rejections.length) {
    fail(`byCode totals (${byCodeTotal}) ≠ rejections.length (${runA.audit.rejections.length})`);
  }

  // 11. Pipeline compatibility: parsePublicRecordCsv accepts the CSV
  // with zero rejections and produces ownership blocks.
  const ingest = parsePublicRecordCsv(csvA);
  if (ingest.records.length !== 2) {
    fail(
      `pipeline: expected 2 records from parsed CSV, got ${ingest.records.length}`,
    );
  }
  if (ingest.rejections.length !== 0) {
    fail(
      `pipeline: expected 0 rejections, got ${ingest.rejections.length}: ${ingest.rejections
        .map((r) => r.code)
        .join(",")}`,
    );
  }
  for (const rec of ingest.records) {
    if (!rec.ownership) {
      fail(`pipeline: parcel ${rec.property.parcelId} produced no ownership block`);
    }
    if (rec.provenance.confidence !== "HIGH") {
      fail(`pipeline: parcel ${rec.property.parcelId} provenance not HIGH`);
    }
    if (!rec.provenance.source || !rec.provenance.recordId || !rec.provenance.observedAt) {
      fail(`pipeline: parcel ${rec.property.parcelId} missing provenance triple`);
    }
  }

  // 12. Invalid observedAt is itself a typed rejection — no rows admitted.
  const badObserved = joinKingCountyRecords({
    assessor: ASSESSOR,
    recorder: RECORDER,
    observedAt: "not a date",
  });
  if (badObserved.rows.length !== 0) {
    fail("missing_observed_at: invalid observedAt must admit zero rows");
  }
  if (
    !badObserved.audit.rejections.some(
      (r) => r.code === "missing_observed_at" && r.source === "input",
    )
  ) {
    fail("missing_observed_at: expected an input-level rejection");
  }

  finish();
}

function finish(): void {
  if (failures.length > 0) {
    console.error("king-county check FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("king-county check passed", {
    checks: [
      "deterministic CSV output (byte-identical across runs)",
      "deterministic SHA-256 hash across runs",
      "deterministic audit JSON across runs",
      "accepted row count correct (2)",
      "output rows sorted by parcelId ASC",
      "latest ownership-transfer date wins (2014 over 2010, DOT ignored)",
      "lastTransferDate mirrors ownershipStartDate from latest transfer",
      "sourceName = county_recorder:king_wa",
      "recordUrl interpolates {parcelId}",
      "observedAt stamped on every accepted row",
      "hyphenated parcel ids normalize to 10 digits",
      "assessor missing_parcel_id rejection",
      "assessor malformed_parcel_id rejection",
      "assessor duplicate_parcel_id rejection (all rows in dup group)",
      "assessor missing_situs_address rejection",
      "assessor weak_address rejection",
      "recorder missing_parcel_id rejection",
      "recorder malformed_parcel_id rejection",
      "recorder malformed_date rejection",
      "duplicate parcels surfaced in audit list",
      "orphan recorder parcels surfaced in audit list",
      "byCode totals match rejections.length",
      "parsePublicRecordCsv ingests the output with zero rejections",
      "every ingested record carries a HIGH-confidence provenance triple",
      "every ingested record produces an ownership block",
      "invalid observedAt emits an input-level missing_observed_at rejection",
    ],
  });
}

main();
