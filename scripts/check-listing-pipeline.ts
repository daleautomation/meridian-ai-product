/**
 * check-listing-pipeline — validator for Property Intelligence v1
 * Commit 1 (listings ingestion substrate).
 *
 * Covers:
 *   • CSV parsing (header tolerance, naive parser correctness)
 *   • Status normalization (closed set, case-insensitive)
 *   • Malformed-row rejection (each ListingRejectionCode hit at least once)
 *   • Canonical propertyKey production
 *   • Listing index O(1) lookup + duplicate detection
 *   • Listing-agent classification (exact, surname+first, no-match, unknown)
 *   • Determinism (byte-identical output across repeated calls)
 *   • Banned-phrase scan on every string the substrate could emit
 *
 * No DB. No env. No external calls.
 */

import {
  normalizeListingStatus,
  parseMlsCsv,
  parseMlsRows,
} from "@/lib/enrichment/listings/csvAdapter";
import {
  buildListingIndex,
  lookupListingByAddress,
} from "@/lib/enrichment/listings/listingIndex";
import { classifyListingAgent } from "@/lib/enrichment/listings/listingAgent";
import type {
  CurrentListingStatus,
  ListingRecord,
  ListingRejectionCode,
  OperatorIdentifiers,
} from "@/lib/enrichment/listings/types";
import { canonicalPropertyKey, normalizeAddress } from "@/lib/enrichment/address";

const failures: string[] = [];
function fail(msg: string): void {
  failures.push(msg);
}

// Banned phrases — listings layer must never emit AI-flavored intent
// language. The substrate today only emits structured fields; this
// scan defends against any future regression that adds opener-like
// strings to the listing types or adapter.
const BANNED_PHRASES = [
  /high seller intent/i,
  /likely motivated/i,
  /ready to transact/i,
  /AI[-\s]?(?:believes|suggests|recommends|powered|driven)/i,
  /\bhot lead\b/i,
  /\bwarm lead\b/i,
  /\bcold lead\b/i,
] as const;

function assertCleanString(s: string, where: string): void {
  for (const re of BANNED_PHRASES) {
    if (re.test(s)) {
      fail(`${where}: banned phrase /${re.source}/ in "${s.slice(0, 80)}"`);
    }
  }
}

function assertRecordClean(record: ListingRecord): void {
  // Every string field the record carries gets scanned.
  assertCleanString(record.mlsNumber, "record.mlsNumber");
  assertCleanString(record.situsAddress, "record.situsAddress");
  assertCleanString(record.propertyKey, "record.propertyKey");
  assertCleanString(record.status, "record.status");
  if (record.listingAgent) assertCleanString(record.listingAgent, "record.listingAgent");
  if (record.listingBrokerage) assertCleanString(record.listingBrokerage, "record.listingBrokerage");
  assertCleanString(record.source, "record.source");
  if (record.recordUrl) assertCleanString(record.recordUrl, "record.recordUrl");
}

// ── Status normalization fixtures ─────────────────────────────────

const STATUS_CASES: Array<[string | undefined | null, CurrentListingStatus]> = [
  ["Active", "active"],
  ["ACTIVE", "active"],
  ["active", "active"],
  ["Coming Soon", "active"],
  ["New", "active"],
  ["pending", "pending"],
  ["Under Contract", "pending"],
  ["Contingent", "pending"],
  ["Sold", "sold_recently"],
  ["closed", "sold_recently"],
  ["Withdrawn", "withdrawn"],
  ["cancelled", "withdrawn"],
  ["canceled", "withdrawn"],
  ["Expired", "expired"],
  ["Off Market", "off_market"],
  ["TOM", "off_market"],
  ["something weird", "unknown"],
  ["", "unknown"],
  [undefined, "unknown"],
  [null, "unknown"],
];

function runStatusNormalizationChecks(): void {
  for (const [input, expected] of STATUS_CASES) {
    const got = normalizeListingStatus(input);
    if (got !== expected) {
      fail(`status: input ${JSON.stringify(input)} expected ${expected}, got ${got}`);
    }
  }
}

// ── CSV parsing fixtures ──────────────────────────────────────────

function happyCsv(): string {
  return [
    "mlsNumber,situsAddress,listingStatus,listingAgent,listingBrokerage,listPrice,listedAt,recordUrl,sourceName,observedAt",
    `"2412345","4321 W 63rd St, Kansas City, MO 64113","Active","Nicole Lonergan","Brookside Real Estate","549000","2026-05-10","https://heartlandmls.example/2412345","heartland_mls_export","2026-05-27"`,
    `"2412346","1200 Main Ave, Overland Park, KS 66204","Pending","Sarah Brown","Acme Realty","725000","2026-04-22","","heartland_mls_export","2026-05-27"`,
    `"2412347","100 Oak Ln, Lenexa, KS 66215","Sold","Lonergan, Nicole","Brookside Real Estate","450000","2026-03-15","","heartland_mls_export","2026-05-27"`,
  ].join("\n");
}

function runHappyPathCsvChecks(): void {
  const result = parseMlsCsv(happyCsv());
  if (result.records.length !== 3) {
    fail(`happy CSV: expected 3 records, got ${result.records.length}`);
  }
  if (result.rejections.length !== 0) {
    fail(`happy CSV: expected 0 rejections, got ${result.rejections.length}`);
  }
  if (result.sourceNames.length !== 1 || result.sourceNames[0] !== "heartland_mls_export") {
    fail(`happy CSV: sourceNames expected ["heartland_mls_export"], got ${JSON.stringify(result.sourceNames)}`);
  }
  const first = result.records[0];
  if (first.mlsNumber !== "2412345") fail("happy CSV: mlsNumber mismatch");
  if (first.status !== "active") fail("happy CSV: status mismatch");
  if (first.listPrice !== 549000) fail(`happy CSV: listPrice expected 549000, got ${first.listPrice}`);
  if (first.listingAgent !== "Nicole Lonergan") fail("happy CSV: listingAgent verbatim mismatch");
  if (!first.listedAt) fail("happy CSV: listedAt missing");
  if (!first.observedAt) fail("happy CSV: observedAt missing");

  // canonicalPropertyKey must align with what callers will produce
  // from CRM contact addresses at lookup time.
  const expectedKey = canonicalPropertyKey(
    normalizeAddress("4321 W 63rd St, Kansas City, MO 64113"),
  );
  if (first.propertyKey !== expectedKey) {
    fail(`happy CSV: propertyKey mismatch — got "${first.propertyKey}", expected "${expectedKey}"`);
  }

  for (const r of result.records) assertRecordClean(r);
}

function runHeaderToleranceChecks(): void {
  const snakeCase = [
    "mls_number,situs_address,listing_status,listing_agent,listing_brokerage,list_price,listed_at,record_url,source_name,observed_at",
    `"2412345","4321 W 63rd St, Kansas City, MO 64113","Active","Nicole Lonergan","Brookside","549000","2026-05-10","","heartland_mls_export","2026-05-27"`,
  ].join("\n");
  const camelCase = [
    "mlsNumber,situsAddress,listingStatus,listingAgent,listingBrokerage,listPrice,listedAt,recordUrl,sourceName,observedAt",
    `"2412345","4321 W 63rd St, Kansas City, MO 64113","Active","Nicole Lonergan","Brookside","549000","2026-05-10","","heartland_mls_export","2026-05-27"`,
  ].join("\n");
  const titleCase = [
    "MLS Number,Situs Address,Listing Status,Listing Agent,Listing Brokerage,List Price,Listed At,Record URL,Source Name,Observed At",
    `"2412345","4321 W 63rd St, Kansas City, MO 64113","Active","Nicole Lonergan","Brookside","549000","2026-05-10","","heartland_mls_export","2026-05-27"`,
  ].join("\n");

  const a = parseMlsCsv(snakeCase);
  const b = parseMlsCsv(camelCase);
  const c = parseMlsCsv(titleCase);
  if (a.records.length !== 1) fail("header tolerance: snake_case CSV rejected");
  if (b.records.length !== 1) fail("header tolerance: camelCase CSV rejected");
  if (c.records.length !== 1) fail("header tolerance: TitleCase CSV rejected");
  // The records must be byte-identical across header variants for the
  // same underlying data.
  if (JSON.stringify(a.records[0]) !== JSON.stringify(b.records[0])) {
    fail("header tolerance: snake_case + camelCase produced different records");
  }
  if (JSON.stringify(a.records[0]) !== JSON.stringify(c.records[0])) {
    fail("header tolerance: snake_case + TitleCase produced different records");
  }
}

// ── Malformed-row rejection fixtures ──────────────────────────────

interface RejectCase {
  label: string;
  row: Record<string, string>;
  expectedCode: ListingRejectionCode;
}

const REJECT_CASES: RejectCase[] = [
  {
    label: "missing mlsNumber",
    row: {
      mlsNumber: "",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      listingStatus: "Active",
      sourceName: "heartland_mls_export",
      observedAt: "2026-05-27",
    },
    expectedCode: "missing_mls_number",
  },
  {
    label: "missing source",
    row: {
      mlsNumber: "2412345",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      listingStatus: "Active",
      sourceName: "",
      observedAt: "2026-05-27",
    },
    expectedCode: "missing_source",
  },
  {
    label: "missing observedAt",
    row: {
      mlsNumber: "2412345",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      listingStatus: "Active",
      sourceName: "heartland_mls_export",
      observedAt: "",
    },
    expectedCode: "missing_observed_at",
  },
  {
    label: "invalid observedAt",
    row: {
      mlsNumber: "2412345",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      listingStatus: "Active",
      sourceName: "heartland_mls_export",
      observedAt: "yesterday",
    },
    expectedCode: "invalid_observed_at",
  },
  {
    label: "missing situsAddress",
    row: {
      mlsNumber: "2412345",
      situsAddress: "",
      listingStatus: "Active",
      sourceName: "heartland_mls_export",
      observedAt: "2026-05-27",
    },
    expectedCode: "missing_situs_address",
  },
  {
    label: "weak situsAddress (city only)",
    row: {
      mlsNumber: "2412345",
      situsAddress: "Kansas City",
      listingStatus: "Active",
      sourceName: "heartland_mls_export",
      observedAt: "2026-05-27",
    },
    expectedCode: "weak_situs_address",
  },
  {
    label: "invalid listedAt",
    row: {
      mlsNumber: "2412345",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      listingStatus: "Active",
      listedAt: "not-a-date",
      sourceName: "heartland_mls_export",
      observedAt: "2026-05-27",
    },
    expectedCode: "invalid_listed_at",
  },
  {
    label: "invalid listPrice (negative)",
    row: {
      mlsNumber: "2412345",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      listingStatus: "Active",
      listPrice: "-50000",
      sourceName: "heartland_mls_export",
      observedAt: "2026-05-27",
    },
    expectedCode: "invalid_list_price",
  },
  {
    label: "invalid listPrice (non-numeric)",
    row: {
      mlsNumber: "2412345",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      listingStatus: "Active",
      listPrice: "TBD",
      sourceName: "heartland_mls_export",
      observedAt: "2026-05-27",
    },
    expectedCode: "invalid_list_price",
  },
];

function runRejectionChecks(): void {
  for (const fx of REJECT_CASES) {
    const result = parseMlsRows([fx.row]);
    if (result.records.length !== 0) {
      fail(`rejection [${fx.label}]: expected 0 records, got ${result.records.length}`);
      continue;
    }
    if (result.rejections.length !== 1) {
      fail(`rejection [${fx.label}]: expected 1 rejection, got ${result.rejections.length}`);
      continue;
    }
    const r = result.rejections[0];
    if (r.code !== fx.expectedCode) {
      fail(`rejection [${fx.label}]: expected code ${fx.expectedCode}, got ${r.code} (detail=${r.detail})`);
    }
    if (r.rowIndex !== 0) fail(`rejection [${fx.label}]: rowIndex expected 0, got ${r.rowIndex}`);
    // The original row must be preserved verbatim.
    if (!r.row) fail(`rejection [${fx.label}]: row missing on rejection`);
  }
}

// ── Index + lookup fixtures ───────────────────────────────────────

function runIndexChecks(): void {
  const csv = happyCsv();
  const result = parseMlsCsv(csv);
  const idx = buildListingIndex(result.records);
  if (idx.size !== 3) fail(`index: expected size 3, got ${idx.size}`);
  if (idx.duplicatePropertyKeys.length !== 0) {
    fail(`index: expected no duplicates on happy CSV, got ${JSON.stringify(idx.duplicatePropertyKeys)}`);
  }

  // Lookup by the canonicalized form of the same situsAddress.
  const lookupKey = canonicalPropertyKey(
    normalizeAddress("4321 W 63rd St, Kansas City, MO 64113"),
  );
  const hit = lookupListingByAddress(idx, lookupKey);
  if (!hit) {
    fail(`index lookup: expected match for canonical key "${lookupKey}", got null`);
  } else if (hit.mlsNumber !== "2412345") {
    fail(`index lookup: got wrong record (mlsNumber=${hit.mlsNumber})`);
  }

  // Case-insensitive equivalence: same address with different casing
  // canonicalizes to the same key. (The existing canonicalPropertyKey
  // is intentionally strict about suffix tokens — "St" vs "Street"
  // are NOT collapsed; that's the no-fuzzy-matching contract.)
  const upperKey = canonicalPropertyKey(
    normalizeAddress("4321 W 63rd St, KANSAS CITY, MO 64113"),
  );
  if (upperKey !== lookupKey) {
    fail(
      `index lookup: case-only difference must produce same canonical key — got "${upperKey}" vs "${lookupKey}"`,
    );
  }

  // Negative lookups.
  const miss = lookupListingByAddress(idx, "no-such-key");
  if (miss !== null) fail("index lookup: missing key must return null");
  const blank = lookupListingByAddress(idx, "");
  if (blank !== null) fail("index lookup: empty key must return null");
  const nullKey = lookupListingByAddress(idx, null);
  if (nullKey !== null) fail("index lookup: null key must return null");
}

function runDuplicateDetectionCheck(): void {
  // Two listings on the same address — last record wins, key reported.
  const csv = [
    "mlsNumber,situsAddress,listingStatus,sourceName,observedAt",
    `"2412345","4321 W 63rd St, Kansas City, MO 64113","Active","heartland_mls_export","2026-05-27"`,
    `"2412345-relisted","4321 W 63rd St, Kansas City, MO 64113","Pending","heartland_mls_export","2026-05-27"`,
  ].join("\n");
  const result = parseMlsCsv(csv);
  const idx = buildListingIndex(result.records);
  if (idx.size !== 1) fail(`duplicate index: expected 1 unique key, got ${idx.size}`);
  if (idx.duplicatePropertyKeys.length !== 1) {
    fail(`duplicate index: expected 1 duplicate key reported, got ${idx.duplicatePropertyKeys.length}`);
  }
  // Last-wins: the pending listing should be the one surfaced.
  const hit = idx.byPropertyKey.get(idx.duplicatePropertyKeys[0]);
  if (!hit || hit.mlsNumber !== "2412345-relisted") {
    fail(`duplicate index: last-write-wins violated, got mlsNumber=${hit?.mlsNumber}`);
  }
}

// ── Agent classification fixtures ─────────────────────────────────

const NICOLE_IDENTIFIERS: OperatorIdentifiers = {
  names: ["Nicole Lonergan", "Lonergan, Nicole", "N. Lonergan"],
  displayLabel: "nicole",
};

interface AgentCase {
  label: string;
  input: string | null | undefined;
  expected: "nicole" | "other_agent" | "unknown";
}

const AGENT_CASES: AgentCase[] = [
  { label: "exact full name",          input: "Nicole Lonergan",       expected: "nicole" },
  { label: "last-comma-first format",  input: "Lonergan, Nicole",      expected: "nicole" },
  { label: "uppercased",               input: "NICOLE LONERGAN",       expected: "nicole" },
  { label: "with middle initial",      input: "Nicole A. Lonergan",    expected: "nicole" },
  { label: "hyphenated surname",       input: "Nicole Lonergan-Smith", expected: "nicole" },
  { label: "wrong full name",          input: "Sarah Brown",           expected: "other_agent" },
  { label: "first-name only — same first, different last", input: "Nicole Brown", expected: "other_agent" },
  { label: "shared surname only",      input: "Mary Lonergan",         expected: "other_agent" },
  { label: "empty string",             input: "",                      expected: "unknown" },
  { label: "null",                     input: null,                    expected: "unknown" },
  { label: "undefined",                input: undefined,               expected: "unknown" },
];

function runAgentClassificationChecks(): void {
  for (const fx of AGENT_CASES) {
    const got = classifyListingAgent(fx.input, NICOLE_IDENTIFIERS);
    if (got !== fx.expected) {
      fail(`agent [${fx.label}]: input ${JSON.stringify(fx.input)} expected ${fx.expected}, got ${got}`);
    }
  }
}

// ── Determinism ───────────────────────────────────────────────────

function runDeterminismChecks(): void {
  const csv = happyCsv();
  const a = parseMlsCsv(csv);
  const b = parseMlsCsv(csv);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail("determinism: parseMlsCsv produced different output across two calls");
  }

  const idxA = buildListingIndex(a.records);
  const idxB = buildListingIndex(b.records);
  if (idxA.size !== idxB.size) fail("determinism: index size unstable");
  if (JSON.stringify([...idxA.duplicatePropertyKeys]) !== JSON.stringify([...idxB.duplicatePropertyKeys])) {
    fail("determinism: duplicate-key list unstable");
  }

  // Agent classification determinism.
  for (const fx of AGENT_CASES) {
    const g1 = classifyListingAgent(fx.input, NICOLE_IDENTIFIERS);
    const g2 = classifyListingAgent(fx.input, NICOLE_IDENTIFIERS);
    if (g1 !== g2) fail(`agent determinism: ${fx.label} unstable across calls`);
  }
}

// ── Run ───────────────────────────────────────────────────────────

function main(): void {
  runStatusNormalizationChecks();
  runHappyPathCsvChecks();
  runHeaderToleranceChecks();
  runRejectionChecks();
  runIndexChecks();
  runDuplicateDetectionCheck();
  runAgentClassificationChecks();
  runDeterminismChecks();

  if (failures.length > 0) {
    console.error("");
    console.error("check-listing-pipeline FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-listing-pipeline passed", {
    statusFixtures: STATUS_CASES.length,
    rejectionFixtures: REJECT_CASES.length,
    agentFixtures: AGENT_CASES.length,
    checks: [
      "status normalization (closed set, case-insensitive)",
      "happy-path CSV parses 3 records with full provenance",
      "header tolerance: snake_case / camelCase / TitleCase produce identical records",
      "rejection codes: missing_mls_number / missing_source / missing_observed_at / invalid_observed_at / missing_situs_address / weak_situs_address / invalid_listed_at / invalid_list_price",
      "rejection rows preserve original CSV cells verbatim",
      "canonicalPropertyKey on listing address matches what callers will compute from CRM addresses",
      "buildListingIndex: O(1) lookup, last-write-wins, duplicates reported",
      "lookupListingByAddress: null / empty / missing keys return null",
      "classifyListingAgent: exact / last-comma-first / uppercased / middle-initial / hyphenated-surname → operator",
      "classifyListingAgent: same first OR same last alone never matches",
      "classifyListingAgent: empty / null / undefined → unknown",
      "determinism: parseMlsCsv + buildListingIndex + classifyListingAgent byte-stable across calls",
      "banned-phrase scan clean on every record string (no AI-flavored intent labels)",
    ],
  });
}

main();
