/**
 * check-identity-resolution — validator for Commit B (preprocessing,
 * canonical ingestion, and deterministic identity resolution).
 *
 * Covers:
 *   • preNormalizeAddress: directional / suffix expansion is idempotent
 *   • canonicalPropertyKey: "W" / "West" / "Street" / "St" converge
 *     to the same canonical key AFTER preNormalizeAddress
 *   • buildCanonicalRow: header tolerance, required-field rejections,
 *     date / value coercion, rawSourceRow preservation
 *   • resolveContactParcel:
 *       – parcel_id-strength ladder: HIGH / MED / WEAK / WEAK-mismatch
 *       – address-strength ladder: MED / WEAK / WEAK / WEAK-mismatch
 *       – exact / surname / trust_or_llc / no_match outcomes
 *       – married-name (surname-only) handling
 *       – trust / LLC handling
 *       – ownership mismatch persists link at WEAK confidence (chip)
 *       – stale_observation review flag fires past threshold
 *       – NO_MATCH when no parcel provided
 *       – NO_MATCH when parcel provided but no snapshot
 *       – determinism: same input → byte-identical resolution
 *       – banned-phrase scan on every explanation string
 *
 * No DB. No env. Pure.
 */

import { preNormalizeAddress } from "@/lib/enrichment/address/preNormalize";
import {
  canonicalPropertyKey,
  normalizeAddress,
} from "@/lib/enrichment/address";
import {
  buildCanonicalRow,
  CANONICAL_COLUMNS,
  coerceIsoDate,
  parseCsvToRows,
  rowsToCanonicalCsv,
} from "@/lib/enrichment/public-records/preprocessing/canonicalCsv";
import { resolveContactParcel } from "@/lib/enrichment/identity-resolution/resolveContactParcel";
import type {
  ContactParcelResolution,
  ResolveContactParcelInput,
} from "@/lib/enrichment/identity-resolution/types";

const failures: string[] = [];
function fail(msg: string): void {
  failures.push(msg);
}
function expect(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}
function expectEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Banned phrases — any resolver-emitted text must stay structured.
const BANNED_PHRASES = [
  /high seller intent/i,
  /likely motivated/i,
  /ready to transact/i,
  /AI[-\s]?(?:believes|suggests|recommends|powered|driven)/i,
  /\bhot lead\b/i,
  /\bwarm lead\b/i,
  /\bcold lead\b/i,
] as const;
function scanClean(s: string, where: string): void {
  for (const re of BANNED_PHRASES) {
    if (re.test(s)) fail(`${where}: banned phrase /${re.source}/ in "${s}"`);
  }
}

// ──────────────────────────────────────────────────────────────────
// SECTION 1 — Pre-normalization + canonical-key convergence
// ──────────────────────────────────────────────────────────────────

function runPreNormalize(): void {
  // Idempotence.
  const a = preNormalizeAddress("4321 West 63rd Street, Kansas City, MO 64113");
  const b = preNormalizeAddress(a);
  expectEqual(a, b, "preNormalizeAddress idempotent");

  // Directional + suffix expansion canonicalization.
  expectEqual(
    preNormalizeAddress("4321 West 63rd Street"),
    "4321 W 63rd St",
    "West → W, Street → St",
  );
  expectEqual(
    preNormalizeAddress("4321 W 63rd Street"),
    "4321 W 63rd St",
    "W stays W, Street → St",
  );
  expectEqual(
    preNormalizeAddress("4321 W. 63rd St"),
    "4321 W 63rd St",
    "W. → W",
  );
  expectEqual(
    preNormalizeAddress("123 South Main Boulevard"),
    "123 S Main Blvd",
    "South → S, Boulevard → Blvd",
  );
  expectEqual(
    preNormalizeAddress("123 northeast 45th avenue"),
    "123 NE 45th Ave",
    "northeast → NE, avenue → Ave",
  );
  // Multi-word things like "Northside" do NOT get broken.
  expectEqual(
    preNormalizeAddress("100 Northside Drive"),
    "100 Northside Dr",
    "Northside (not a directional) is preserved; Drive → Dr",
  );
  expectEqual(
    preNormalizeAddress("100 Northside DRIVE"),
    "100 Northside Dr",
    "Drive case-insensitive",
  );
  // Empty / whitespace.
  expectEqual(preNormalizeAddress(""), "", "empty stays empty");
  expectEqual(preNormalizeAddress("   "), "", "whitespace trimmed");
}

function runCanonicalKeyConvergence(): void {
  // After preNormalizeAddress, the following pairs must produce the
  // SAME canonical key. Without it, they don't.
  const pairs: Array<[string, string, string]> = [
    [
      "4321 West 63rd Street, Kansas City, MO 64113",
      "4321 W 63rd St, Kansas City, MO 64113",
      "West/W + Street/St",
    ],
    [
      "4321 W. 63rd St., Kansas City, MO 64113",
      "4321 W 63rd St, Kansas City, MO 64113",
      "abbreviation period stripped",
    ],
    [
      "100 South Main Boulevard, KC, MO 64108",
      "100 S Main Blvd, KC, MO 64108",
      "South/S + Boulevard/Blvd",
    ],
    [
      "200 NORTHWEST 47th AVENUE, OVERLAND PARK, KS 66204",
      "200 NW 47th Ave, Overland Park, KS 66204",
      "uppercase + northwest expansion",
    ],
  ];
  for (const [a, b, label] of pairs) {
    const ka = canonicalPropertyKey(normalizeAddress(preNormalizeAddress(a)));
    const kb = canonicalPropertyKey(normalizeAddress(preNormalizeAddress(b)));
    expectEqual(ka, kb, `canonical key convergence: ${label}`);
  }

  // Negative — addresses that are NOT the same property must remain
  // distinct after preNormalize.
  const k1 = canonicalPropertyKey(
    normalizeAddress(preNormalizeAddress("4321 W 63rd St, Kansas City, MO 64113")),
  );
  const k2 = canonicalPropertyKey(
    normalizeAddress(preNormalizeAddress("4322 W 63rd St, Kansas City, MO 64113")),
  );
  expect(k1 !== k2, "different house numbers do NOT collide");
  const k3 = canonicalPropertyKey(
    normalizeAddress(preNormalizeAddress("4321 W 63rd St, Kansas City, MO 64113")),
  );
  const k4 = canonicalPropertyKey(
    normalizeAddress(preNormalizeAddress("4321 W 63rd St, Overland Park, KS 66204")),
  );
  expect(k3 !== k4, "different cities/states do NOT collide");
}

// ──────────────────────────────────────────────────────────────────
// SECTION 2 — Preprocessor row builder
// ──────────────────────────────────────────────────────────────────

const MANUAL_FIELD_MAP = {
  parcelId: ["parcelId", "parcel_id"],
  situsAddress: ["situsAddress", "situs_address", "propertyAddress", "property_address"],
  ownerName: ["ownerName", "owner_name", "owner"],
  mailingAddress: ["mailingAddress", "mailing_address"],
  ownershipStartDate: ["ownershipStartDate", "ownership_start_date", "deedDate"],
  lastTransferDate: ["lastTransferDate", "last_transfer_date", "saleDate"],
  assessedValue: ["assessedValue", "assessed_value", "appraisedValue"],
  propertyType: ["propertyType", "property_type"],
  recordUrl: ["recordUrl", "record_url"],
} as const;

function buildHappy(rowIdx = 0, overrides: Record<string, string> = {}) {
  return buildCanonicalRow({
    sourceRow: {
      parcelId: "30-510-01-04-00-0-00-000",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
      ownerName: "SMITH, GREGORY A",
      mailingAddress: "PO Box 123, KCMO 64113",
      ownershipStartDate: "2019-04-15",
      lastTransferDate: "2019-04-15",
      assessedValue: "425000",
      propertyType: "single_family",
      ...overrides,
    },
    rowIndex: rowIdx,
    countyCode: "us-mo-jackson",
    sourceName: "us-mo-jackson_manual_2026-05-27",
    sourceSnapshotId: "us-mo-jackson_manual_2026-05-27",
    observedAt: "2026-05-27T00:00:00Z",
    fieldMap: MANUAL_FIELD_MAP,
  });
}

function runBuildCanonicalRow(): void {
  // Happy path.
  const happy = buildHappy();
  if (happy.kind !== "row") {
    fail(`happy path rejected: ${JSON.stringify(happy)}`);
    return;
  }
  expectEqual(happy.row.countyCode, "us-mo-jackson", "happy countyCode");
  expectEqual(happy.row.parcelId, "30-510-01-04-00-0-00-000", "happy parcelId");
  expectEqual(happy.row.ownerName, "SMITH, GREGORY A", "happy owner verbatim");
  expectEqual(happy.row.assessedValue, "425000", "happy assessed coerced");
  expectEqual(happy.row.propertyType, "single_family", "happy property type accepted");

  // rawSourceRow is JSON-encoded.
  const parsed = JSON.parse(happy.row.rawSourceRow);
  expectEqual(parsed.parcelId, "30-510-01-04-00-0-00-000", "rawSourceRow parcelId preserved");
  expectEqual(parsed.ownerName, "SMITH, GREGORY A", "rawSourceRow owner preserved");

  // Pre-normalized situsAddress.
  expectEqual(happy.row.situsAddress, "4321 W 63rd St, Kansas City, MO 64113", "situs pre-normalized");

  // Header tolerance — snake_case input still maps.
  const snake = buildCanonicalRow({
    sourceRow: {
      parcel_id: "P-2",
      situs_address: "100 Main St, KC, MO 64108",
      owner_name: "JONES, MARY",
      mailing_address: "",
      ownership_start_date: "",
      last_transfer_date: "",
      assessed_value: "",
      property_type: "",
    },
    rowIndex: 0,
    countyCode: "us-mo-jackson",
    sourceName: "src",
    sourceSnapshotId: "snap",
    observedAt: "2026-05-27T00:00:00Z",
    fieldMap: MANUAL_FIELD_MAP,
  });
  if (snake.kind !== "row") {
    fail(`snake_case rejected: ${JSON.stringify(snake)}`);
  } else {
    expectEqual(snake.row.parcelId, "P-2", "snake_case parcelId picked");
  }

  // Required-field rejections.
  const missingParcel = buildHappy(0, { parcelId: "" });
  if (missingParcel.kind !== "rejection" || missingParcel.rejection.code !== "missing_parcel_id") {
    fail("missing parcelId did not produce missing_parcel_id rejection");
  }
  const missingSitus = buildHappy(0, { situsAddress: "" });
  if (missingSitus.kind !== "rejection" || missingSitus.rejection.code !== "missing_situs_address") {
    fail("missing situsAddress did not produce missing_situs_address rejection");
  }
  const missingOwner = buildHappy(0, { ownerName: "" });
  if (missingOwner.kind !== "rejection" || missingOwner.rejection.code !== "missing_owner_name") {
    fail("missing ownerName did not produce missing_owner_name rejection");
  }

  // Bad date.
  const badDate = buildHappy(0, { ownershipStartDate: "not a date" });
  if (badDate.kind !== "rejection" || badDate.rejection.code !== "invalid_date_field") {
    fail("bad ownershipStartDate did not produce invalid_date_field");
  }
  // Bad assessed value.
  const badValue = buildHappy(0, { assessedValue: "abc" });
  if (badValue.kind !== "rejection" || badValue.rejection.code !== "invalid_assessed_value") {
    fail("bad assessedValue did not produce invalid_assessed_value");
  }

  // Date coercion: MM/DD/YYYY.
  const usDate = buildHappy(0, { ownershipStartDate: "4/15/2019" });
  if (usDate.kind !== "row") fail("US date format rejected");
  else expectEqual(usDate.row.ownershipStartDate, "2019-04-15", "MM/DD/YYYY coerced");

  // Property type fallback to empty when unknown.
  const unknownType = buildHappy(0, { propertyType: "weird-type" });
  if (unknownType.kind !== "row") fail("unknown property type rejected");
  else expectEqual(unknownType.row.propertyType, "", "unknown property type → empty (no invention)");

  // Standalone coerceIsoDate.
  expectEqual(coerceIsoDate("2019-04-15"), "2019-04-15", "ISO date passthrough");
  expectEqual(coerceIsoDate("4/15/2019"), "2019-04-15", "MM/DD/YYYY");
  expectEqual(coerceIsoDate("April 15 2019"), "2019-04-15", "Date.parse fallback");
  expectEqual(coerceIsoDate("not a date"), null, "unparseable returns null");
  expectEqual(coerceIsoDate(""), null, "empty returns null");
}

function runCanonicalCsvRoundTrip(): void {
  // Round-trip: build rows → serialize CSV → parse CSV → values intact.
  const r1 = buildHappy(0, { parcelId: "P-1", situsAddress: "4321 W 63rd St, KC, MO 64113" });
  const r2 = buildHappy(1, { parcelId: "P-2", situsAddress: "100 Main St, KC, MO 64108" });
  if (r1.kind !== "row" || r2.kind !== "row") {
    fail("round-trip setup: rows did not build");
    return;
  }
  const csv = rowsToCanonicalCsv([r1.row, r2.row]);
  const parsed = parseCsvToRows(csv);
  expectEqual(parsed.length, 2, "round-trip row count");
  for (const col of CANONICAL_COLUMNS) {
    expectEqual(parsed[0][col], r1.row[col], `round-trip col ${col}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// SECTION 3 — Identity resolver: confidence ladder
// ──────────────────────────────────────────────────────────────────

function baseInput(
  contactName: string,
  ownerName: string,
  overrides: Partial<ResolveContactParcelInput> = {},
): ResolveContactParcelInput {
  return {
    contact: {
      contactId: "crm-1",
      contactName,
      contactAddress: "4321 W 63rd St, Kansas City, MO 64113",
    },
    parcel: {
      parcelId: "parcel-abc",
      countyCode: "us-mo-jackson",
      propertyKey: "key",
      situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
    },
    snapshot: {
      snapshotId: "snap-1",
      ownerName,
      observedAt: "2026-04-01T00:00:00Z",
    },
    ...overrides,
  };
}

const NOW = new Date("2026-05-27T00:00:00Z");

function resolveAt(now: Date, input: ResolveContactParcelInput, staleDays = 540): ContactParcelResolution {
  return resolveContactParcel(input, { now, staleThresholdDays: staleDays });
}

function runResolverLadder(): void {
  // ── address strength (default) ─────────────────────────────────
  // Exact → MED
  const exactAddr = resolveAt(NOW, baseInput("Greg Smith", "Smith, Greg"));
  expectEqual(exactAddr.tier, "MED", "address+exact → MED");
  expectEqual(exactAddr.matchConfidence, "MED", "address+exact confidence");
  expectEqual(exactAddr.matchReason, "exact", "address+exact reason");
  expectEqual(exactAddr.reviewReasons.length, 0, "address+exact no review");

  // Surname → WEAK + surname_only_match
  const surnameAddr = resolveAt(NOW, baseInput("Greg Smith", "Smith, Mary"));
  expectEqual(surnameAddr.tier, "WEAK", "address+surname → WEAK");
  expectEqual(surnameAddr.matchReason, "surname", "address+surname reason");
  expect(
    surnameAddr.reviewReasons.includes("surname_only_match"),
    "surname_only_match review tag",
  );

  // Trust/LLC → WEAK + trust_or_llc_owner
  const trustAddr = resolveAt(NOW, baseInput("Greg Smith", "Smith Family Trust 2014"));
  expectEqual(trustAddr.tier, "WEAK", "address+trust → WEAK");
  expectEqual(trustAddr.matchReason, "trust_or_llc", "address+trust reason");
  expect(
    trustAddr.reviewReasons.includes("trust_or_llc_owner"),
    "trust_or_llc_owner review tag",
  );

  // LLC owner without surname → no_match → WEAK + ownership_mismatch
  const llcMismatch = resolveAt(NOW, baseInput("Greg Smith", "Acme Holdings LLC"));
  expectEqual(llcMismatch.tier, "WEAK", "address+LLC-without-surname → WEAK");
  expectEqual(llcMismatch.matchReason, "ownership_mismatch", "address+LLC-without-surname → ownership_mismatch");
  expect(
    llcMismatch.reviewReasons.includes("ownership_mismatch"),
    "ownership_mismatch review tag",
  );

  // Total mismatch → WEAK + ownership_mismatch
  const totalMismatch = resolveAt(NOW, baseInput("Greg Smith", "Patricia Wong"));
  expectEqual(totalMismatch.tier, "WEAK", "address+mismatch → WEAK");
  expectEqual(totalMismatch.matchReason, "ownership_mismatch", "address+mismatch reason");

  // ── parcel_id strength ─────────────────────────────────────────
  // Exact → HIGH
  const exactPid = resolveAt(NOW, baseInput("Greg Smith", "Smith, Greg", { matchedBy: "parcel_id" }));
  expectEqual(exactPid.tier, "HIGH", "parcel_id+exact → HIGH");
  expectEqual(exactPid.matchConfidence, "HIGH", "parcel_id+exact confidence");

  // Surname → MED
  const surnamePid = resolveAt(NOW, baseInput("Greg Smith", "Smith, Mary", { matchedBy: "parcel_id" }));
  expectEqual(surnamePid.tier, "MED", "parcel_id+surname → MED");

  // Trust → MED
  const trustPid = resolveAt(NOW, baseInput("Greg Smith", "Smith Family Trust", { matchedBy: "parcel_id" }));
  expectEqual(trustPid.tier, "MED", "parcel_id+trust → MED");

  // Mismatch → WEAK + ownership_mismatch
  const mismatchPid = resolveAt(NOW, baseInput("Greg Smith", "Patricia Wong", { matchedBy: "parcel_id" }));
  expectEqual(mismatchPid.tier, "WEAK", "parcel_id+mismatch → WEAK");
  expectEqual(mismatchPid.matchReason, "ownership_mismatch", "parcel_id+mismatch reason");
}

function runResolverMarriedName(): void {
  // Married name on title — surname matches, first name doesn't.
  const married = resolveAt(NOW, baseInput("Greg Smith", "Smith, Mary"));
  expectEqual(married.matchReason, "surname", "married surname match reason");
  expect(
    married.explanation.toLowerCase().includes("spouse-on-title")
    || married.explanation.toLowerCase().includes("married"),
    "married-name explanation mentions spouse or married variant",
  );
}

function runResolverTrustsAndLlcs(): void {
  // Trust containing surname → trust_or_llc match.
  const trustWithSurname = resolveAt(NOW, baseInput("Greg Smith", "Smith Family Trust 2014"));
  expectEqual(trustWithSurname.matchReason, "trust_or_llc", "trust w/ surname → trust_or_llc");

  // LLC containing surname → trust_or_llc match.
  const llcWithSurname = resolveAt(NOW, baseInput("Greg Smith", "Smith Holdings LLC"));
  expectEqual(llcWithSurname.matchReason, "trust_or_llc", "LLC w/ surname → trust_or_llc");

  // LLC without surname → ownership_mismatch.
  const llcWithoutSurname = resolveAt(NOW, baseInput("Greg Smith", "Acme Properties LLC"));
  expectEqual(llcWithoutSurname.matchReason, "ownership_mismatch", "LLC w/o surname → mismatch");
}

function runResolverStaleObservation(): void {
  // Observation > 540 days ago → stale_observation flag fires.
  const oldNow = new Date("2026-05-27T00:00:00Z");
  const old = resolveAt(oldNow, baseInput("Greg Smith", "Smith, Greg", {
    snapshot: { snapshotId: "snap-old", ownerName: "Smith, Greg", observedAt: "2024-01-01T00:00:00Z" },
  }));
  expect(old.reviewReasons.includes("stale_observation"), "stale_observation flag fires past threshold");
  // Tier itself stays at MED (the cap is a downstream decision, not the
  // resolver's job; the resolver tags the review reason).
  expectEqual(old.tier, "MED", "stale does not down-tier here");

  // Recent observation: no stale flag.
  const recent = resolveAt(oldNow, baseInput("Greg Smith", "Smith, Greg", {
    snapshot: { snapshotId: "snap-recent", ownerName: "Smith, Greg", observedAt: "2026-04-15T00:00:00Z" },
  }));
  expect(!recent.reviewReasons.includes("stale_observation"), "recent obs has no stale flag");

  // Custom threshold of 30 days makes "60 days ago" stale.
  const customStale = resolveAt(oldNow, baseInput("Greg Smith", "Smith, Greg", {
    snapshot: { snapshotId: "snap-c", ownerName: "Smith, Greg", observedAt: "2026-03-15T00:00:00Z" },
  }), 30);
  expect(customStale.reviewReasons.includes("stale_observation"), "custom stale threshold honored");
}

function runResolverNoMatchPaths(): void {
  // Parcel null → NO_MATCH.
  const noParcel = resolveAt(NOW, {
    contact: { contactId: "crm-1", contactName: "Greg Smith", contactAddress: "x" },
    parcel: null,
    snapshot: null,
  });
  expectEqual(noParcel.tier, "NO_MATCH", "no parcel → NO_MATCH");
  expectEqual(noParcel.matchConfidence, null, "no parcel → null confidence");
  expectEqual(noParcel.matchReason, null, "no parcel → null reason");
  expectEqual(noParcel.parcelId, null, "no parcel → null parcelId");

  // Parcel but no snapshot → NO_MATCH.
  const noSnap = resolveAt(NOW, baseInput("Greg Smith", "X", { snapshot: null }));
  expectEqual(noSnap.tier, "NO_MATCH", "parcel + null snapshot → NO_MATCH");
  expectEqual(noSnap.matchConfidence, null, "null snapshot → null confidence");
  expectEqual(noSnap.parcelId, "parcel-abc", "null snapshot still reports parcelId for audit");
  expectEqual(noSnap.snapshotId, null, "null snapshot → null snapshotId");
}

function runResolverDeterminism(): void {
  const fixedNow = new Date("2026-05-27T00:00:00Z");
  const a = resolveAt(fixedNow, baseInput("Greg Smith", "Smith, Greg"));
  const b = resolveAt(fixedNow, baseInput("Greg Smith", "Smith, Greg"));
  const c = resolveAt(fixedNow, baseInput("Greg Smith", "Smith, Greg"));
  expectEqual(JSON.stringify(a), JSON.stringify(b), "resolver determinism (call 1 vs 2)");
  expectEqual(JSON.stringify(b), JSON.stringify(c), "resolver determinism (call 2 vs 3)");
}

function runResolverExplanationCleanliness(): void {
  // Every resolution path should emit a banned-phrase-clean explanation.
  const inputs: ReadonlyArray<[string, string]> = [
    ["Greg Smith", "Smith, Greg"],
    ["Greg Smith", "Smith, Mary"],
    ["Greg Smith", "Smith Family Trust 2014"],
    ["Greg Smith", "Acme Holdings LLC"],
    ["Greg Smith", "Patricia Wong"],
  ];
  for (const [contact, owner] of inputs) {
    const r = resolveAt(NOW, baseInput(contact, owner));
    scanClean(r.explanation, `explanation [${contact}|${owner}]`);
    expect(r.explanation.length > 0, `explanation non-empty for ${contact}|${owner}`);
  }
  // Stale path explanation must mention "verify" / "review" framing.
  const stale = resolveAt(NOW, baseInput("Greg Smith", "Smith, Greg", {
    snapshot: { snapshotId: "s", ownerName: "Smith, Greg", observedAt: "2024-01-01T00:00:00Z" },
  }));
  expect(stale.explanation.toLowerCase().includes("verify"), "stale explanation mentions verify");
}

// ──────────────────────────────────────────────────────────────────
// SECTION 4 — Workspace-isolation contract for the resolver
// ──────────────────────────────────────────────────────────────────
//
// The resolver itself doesn't know about workspaces — it operates on
// contact + parcel + snapshot tuples. Workspace isolation is enforced
// at the LINK layer (validated in check-public-record-storage).
//
// This section instead verifies that the resolver does not embed any
// workspace identifier in its output that a caller could accidentally
// use to bypass the link adapter's workspace_id filter.

function runResolverWorkspaceShape(): void {
  const r = resolveAt(NOW, baseInput("Greg Smith", "Smith, Greg"));
  // The output must not carry a workspaceId — that field belongs to the
  // link entity, not the resolution decision.
  const keys = new Set(Object.keys(r));
  expect(!keys.has("workspaceId"), "ContactParcelResolution does not expose workspaceId");
  // contactId is opaque; the resolver never decides what workspace it
  // belongs to.
  expect(typeof r.contactId === "string", "contactId is a string opaque identifier");
}

// ──────────────────────────────────────────────────────────────────
// SECTION 5 — Repeat-resolution byte-identity
// ──────────────────────────────────────────────────────────────────

function runRepeatResolution(): void {
  // 50 calls; all outputs must be byte-identical.
  const fixedNow = new Date("2026-05-27T00:00:00Z");
  let prev: string | null = null;
  for (let i = 0; i < 50; i++) {
    const r = resolveAt(fixedNow, baseInput("Greg Smith", "Smith, Greg"));
    const json = JSON.stringify(r);
    if (prev !== null && prev !== json) {
      fail(`repeat resolution drift at iteration ${i}`);
      break;
    }
    prev = json;
  }
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

function main() {
  runPreNormalize();
  runCanonicalKeyConvergence();
  runBuildCanonicalRow();
  runCanonicalCsvRoundTrip();
  runResolverLadder();
  runResolverMarriedName();
  runResolverTrustsAndLlcs();
  runResolverStaleObservation();
  runResolverNoMatchPaths();
  runResolverDeterminism();
  runResolverExplanationCleanliness();
  runResolverWorkspaceShape();
  runRepeatResolution();

  if (failures.length > 0) {
    console.error("");
    console.error("check-identity-resolution FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-identity-resolution passed", {
    checks: [
      "preNormalizeAddress: idempotent",
      "preNormalizeAddress: directional expansion (West → W, Northeast → NE)",
      "preNormalizeAddress: suffix expansion (Street → St, Boulevard → Blvd)",
      "preNormalizeAddress: abbreviation period stripped (W. → W)",
      "preNormalizeAddress: non-directional words ('Northside') preserved",
      "canonicalPropertyKey convergence after preNormalize for 4 abbreviation variants",
      "canonicalPropertyKey: different house numbers do NOT collide",
      "canonicalPropertyKey: different cities/states do NOT collide",
      "buildCanonicalRow: happy path, header tolerance (snake_case / camelCase)",
      "buildCanonicalRow: rawSourceRow JSON-encoded preserves source columns verbatim",
      "buildCanonicalRow: situsAddress pre-normalized before canonical store",
      "buildCanonicalRow: missing parcelId / situs / owner → typed rejection",
      "buildCanonicalRow: invalid date / value → typed rejection",
      "buildCanonicalRow: MM/DD/YYYY → ISO YYYY-MM-DD",
      "buildCanonicalRow: unknown property type falls back to empty (never invents)",
      "canonical CSV round-trip: serialize → parse preserves every column",
      "resolver address-strength ladder: exact MED / surname WEAK / trust WEAK / mismatch WEAK",
      "resolver parcel_id-strength ladder: exact HIGH / surname MED / trust MED / mismatch WEAK",
      "married-name handling: surname-only fires surname_only_match review",
      "trust/LLC handling: containing-surname → trust_or_llc; bare LLC → ownership_mismatch",
      "stale_observation review flag fires past threshold; absent within threshold; custom threshold honored",
      "NO_MATCH when no parcel input",
      "NO_MATCH when parcel without snapshot (parcelId still surfaced for audit)",
      "resolver determinism: same input → byte-identical output across 50 calls",
      "explanation strings clean of banned phrases on every code path",
      "stale explanation mentions verify framing",
      "ContactParcelResolution does NOT expose workspaceId (isolation kept at link layer)",
    ],
  });
}

main();
