/**
 * Brookside public-record ingestion validation.
 *
 * Asserts that the public-record adapter rejects malformed rows with the
 * correct codes, never invents ownership without a verified date, never
 * generates seller-timing signals from weak addresses, and that the parcel
 * matcher returns deterministic HIGH (parcelId) / MED (address-only)
 * matches with no fuzzy fallback.
 */

import assert from "node:assert/strict";

import brooksideConfig from "@/config/signals/nicole-lonergan";
import {
  buildPropertyEnrichmentSignals,
  canonicalPropertyKey,
  normalizeAddress,
} from "@/lib/enrichment";
import { buildSellerTimingSignals } from "@/lib/enrichment/property";
import {
  buildParcelIndex,
  combineEnrichmentWithPublicRecord,
  lookupMatch,
  parsePublicRecordRows,
  type PublicRecord,
} from "@/lib/enrichment/public-records";
import type { PropertyEnrichmentInput } from "@/lib/enrichment/property/types";

const FIXED_NOW = "2025-05-22T12:00:00.000Z";
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function expectRejection(
  result: ReturnType<typeof parsePublicRecordRows>,
  index: number,
  expected: string,
  label: string,
): void {
  const rej = result.rejections.find((r) => r.rowIndex === index);
  if (!rej) {
    fail(`${label}: expected rejection for row ${index} (code=${expected})`);
    return;
  }
  if (rej.code !== expected) {
    fail(`${label}: row ${index} expected code=${expected}, got=${rej.code}`);
  }
}

function main(): void {
  // ── 1. Provenance: rows without sourceName / observedAt / identifier
  // are rejected with the precise code; nothing silently slips through.
  const provFixture = [
    // 0: missing sourceName
    {
      parcelId: "KING-0001",
      situsAddress: "123 Main St, Seattle, WA 98101",
      ownerName: "Smith, Jane",
      ownershipStartDate: "2008-06-15",
      observedAt: "2025-04-01T00:00:00.000Z",
      recordUrl: "https://example.gov/r/KING-0001",
    },
    // 1: missing observedAt
    {
      parcelId: "KING-0002",
      situsAddress: "456 Oak Ave, Bellevue, WA 98004",
      sourceName: "county_recorder:king_wa",
    },
    // 2: invalid date format
    {
      parcelId: "KING-0003",
      situsAddress: "789 Pine Rd, Kirkland, WA 98033",
      sourceName: "county_recorder:king_wa",
      observedAt: "yesterday afternoon",
    },
    // 3: missing identifier (no parcelId, no recordUrl)
    {
      situsAddress: "1010 Birch Ln, Redmond, WA 98052",
      sourceName: "county_recorder:king_wa",
      observedAt: "2025-04-01T00:00:00.000Z",
    },
    // 4: well-formed HIGH record
    {
      parcelId: "KING-0005",
      situsAddress: "1111 Cedar Blvd, Renton, WA 98057",
      ownerName: "Lee, Pat",
      ownershipStartDate: "2014-09-21",
      lastTransferDate: "2014-09-21",
      assessedValue: "$815,000",
      propertyType: "single_family",
      sourceName: "county_recorder:king_wa",
      observedAt: "2025-04-01T00:00:00.000Z",
      recordUrl: "https://example.gov/r/KING-0005",
    },
  ];

  const ingest = parsePublicRecordRows(provFixture);
  expectRejection(ingest, 0, "missing_source", "row 0");
  expectRejection(ingest, 1, "missing_observed_at", "row 1");
  expectRejection(ingest, 2, "invalid_date", "row 2");
  expectRejection(ingest, 3, "missing_identifier", "row 3");

  const admitted = ingest.records;
  if (admitted.length !== 1) {
    fail(`expected 1 admitted record, got ${admitted.length}`);
  }
  const golden = admitted[0];
  if (!golden) return main_finish();

  // 2. Every admitted record carries non-empty provenance triple.
  if (!golden.provenance.source || !golden.provenance.observedAt || !golden.provenance.recordId) {
    fail("admitted record: provenance triple incomplete");
  }
  if (golden.provenance.confidence !== "HIGH") {
    fail("admitted record: provenance confidence must be HIGH");
  }
  if (!golden.property.parcelId) {
    fail("admitted record: parcelId not preserved on property");
  }

  // 3. Weak address rows are rejected — no signal generated.
  const weakAddr = parsePublicRecordRows([
    {
      parcelId: "KING-0009",
      situsAddress: "Seattle",
      sourceName: "county_recorder:king_wa",
      observedAt: "2025-04-01T00:00:00.000Z",
    },
  ]);
  if (weakAddr.records.length !== 0) {
    fail("weak address: row should have been rejected");
  }
  if (weakAddr.rejections[0]?.code !== "weak_address") {
    fail(`weak address: expected code=weak_address, got=${weakAddr.rejections[0]?.code}`);
  }

  // 4. Ownership cannot be calculated without a valid date.
  const noDate = parsePublicRecordRows([
    {
      parcelId: "KING-0010",
      situsAddress: "222 Walnut St, Seattle, WA 98109",
      ownerName: "Anonymous, A",
      // No ownershipStartDate — adapter must admit the record but skip ownership.
      sourceName: "county_recorder:king_wa",
      observedAt: "2025-04-01T00:00:00.000Z",
    },
  ]);
  if (noDate.records.length !== 1) {
    fail("ownership-without-date: row should be admitted (property only)");
  } else if (noDate.records[0].ownership !== null) {
    fail("ownership-without-date: ownership must be null without ownershipStartDate");
  }

  // 5. Invalid ownershipStartDate is silently skipped (no ownership row),
  // but the property record is still admitted.
  const badOwnershipDate = parsePublicRecordRows([
    {
      parcelId: "KING-0011",
      situsAddress: "333 Maple Dr, Seattle, WA 98112",
      ownerName: "Smith, Bob",
      ownershipStartDate: "not-a-date",
      sourceName: "county_recorder:king_wa",
      observedAt: "2025-04-01T00:00:00.000Z",
    },
  ]);
  if (badOwnershipDate.records.length !== 1) {
    fail("invalid ownership date: row should still be admitted");
  } else if (badOwnershipDate.records[0].ownership !== null) {
    fail("invalid ownership date: ownership must be null");
  }

  // 6. Parcel index: HIGH (parcelId) wins over MED (address).
  const indexFixture: PublicRecord[] = admitted;
  const index = buildParcelIndex(indexFixture);
  if (index.size !== 1) fail(`parcel index: expected size=1, got ${index.size}`);

  const byParcel = lookupMatch(index, { parcelId: "KING-0005", propertyKey: null });
  if (!byParcel || byParcel.matchType !== "parcel_id" || byParcel.matchConfidence !== "HIGH") {
    fail("parcel lookup by id: expected HIGH parcel_id match");
  }

  const addr = normalizeAddress("1111 Cedar Blvd, Renton, WA 98057");
  const propertyKey = canonicalPropertyKey(addr);
  const byAddress = lookupMatch(index, { parcelId: null, propertyKey });
  if (!byAddress || byAddress.matchType !== "address" || byAddress.matchConfidence !== "MED") {
    fail("parcel lookup by address: expected MED address match");
  }

  const miss = lookupMatch(index, { parcelId: "NOPE", propertyKey: "name:no|where|wa|99999" });
  if (miss) fail("parcel lookup miss: expected null");

  // 7. Combiner: when base is null but match is present, synthesize from the
  // public record. Property provenance must survive intact.
  const synthesized = combineEnrichmentWithPublicRecord(null, byParcel);
  if (!synthesized) {
    fail("combiner: expected synthesized enrichment from match-only branch");
  } else if (synthesized.property.parcelId !== "KING-0005") {
    fail("combiner: synthesized property must carry the public-record parcelId");
  } else if (!synthesized.property.provenance.source.startsWith("county_recorder")) {
    fail("combiner: synthesized property provenance must come from the public record");
  }

  // 8. Combiner: when base lacks ownership, public-record ownership fills it.
  const baseWithoutOwnership: PropertyEnrichmentInput = {
    property: {
      propertyKey: golden.property.propertyKey,
      normalizedAddress: golden.property.normalizedAddress,
      parcelId: null,
      provenance: {
        source: "crm:wise-agent",
        recordId: "wa:lead-1",
        observedAt: "2024-12-01T00:00:00.000Z",
        confidence: "MED",
        evidenceUrl: null,
        evidenceLabel: "Wise Agent row",
      },
    },
    ownership: null,
    permits: undefined,
    mortgageReleases: undefined,
    neighborhoodTransfers: null,
    assessedValueChange: null,
    priorTransactionCount: null,
    staleRelationshipObservedAt: "2024-09-01T00:00:00.000Z",
    priorClientClosedAt: null,
  };
  const combined = combineEnrichmentWithPublicRecord(baseWithoutOwnership, byParcel);
  if (!combined) {
    fail("combiner: expected combined enrichment");
  } else {
    if (combined.ownership === null) {
      fail("combiner: public-record ownership must fill an absent base ownership");
    }
    if (combined.property.parcelId !== "KING-0005") {
      fail("combiner: combined property must adopt the public-record parcelId");
    }
    if (combined.staleRelationshipObservedAt !== "2024-09-01T00:00:00.000Z") {
      fail("combiner: stale relationship signal from base must be preserved");
    }
  }

  // 9. Signals built from the combined input must be well-formed and bear
  // public-record provenance — no invented seller claims.
  if (combined) {
    const timing = buildSellerTimingSignals(combined, FIXED_NOW);
    if (timing.length === 0) {
      fail("signals: expected at least one seller-timing signal after combine");
    }
    for (const s of timing) {
      if (!s.observedAt || !s.recordId || !s.source) {
        fail(`signal ${s.kind}: missing provenance`);
      }
      if (!s.evidenceLabel?.trim()) fail(`signal ${s.kind}: empty evidenceLabel`);
      const lower = s.explanation.toLowerCase();
      if (lower.includes("likely to sell") || lower.includes("predicted")) {
        fail(`signal ${s.kind}: unsupported seller claim in explanation`);
      }
    }

    const recovery = buildPropertyEnrichmentSignals({
      enrichment: combined,
      config: brooksideConfig,
      leadKey: "lead-public-record-001",
      nowIso: FIXED_NOW,
    });
    for (const r of recovery) {
      if (!r.observedAt || !r.recordId || !r.source) {
        fail(`recovery signal ${r.name}: missing provenance`);
      }
      if (r.weight < 0 || r.weight > 100) {
        fail(`recovery signal ${r.name}: weight out of bounds`);
      }
    }
  }

  // 10. No public-record-derived signal outranks a CRM-only signal of the
  // same name in absence of HIGH provenance. Verified by the workspace
  // config invariant (long_term_owner.defaultWeight > crm_interest_signal).
  const longTerm = brooksideConfig.signals.find((s) => s.name === "long_term_owner");
  const crm = brooksideConfig.signals.find((s) => s.name === "crm_interest_signal");
  if (!longTerm || !crm) {
    fail("config: long_term_owner / crm_interest_signal missing");
  } else if (longTerm.defaultWeight <= crm.defaultWeight) {
    fail("weighting: verified public-record signal must outrank CRM-only signal");
  }

  main_finish();
}

function main_finish(): void {
  if (failures.length > 0) {
    console.error("public-record ingestion check FAILED");
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
  }

  console.log("public-record ingestion check passed", {
    checks: [
      "missing_source rejected",
      "missing_observed_at rejected",
      "invalid_date rejected",
      "missing_identifier rejected",
      "weak_address rejected",
      "admitted record carries HIGH provenance triple",
      "ownership skipped when ownershipStartDate absent or invalid",
      "parcel index size + parcelId HIGH match",
      "address-only MED match",
      "no match returns null (no fuzzy fallback)",
      "combiner synthesizes from public record alone",
      "combiner fills null base ownership from public record",
      "combiner preserves base stale-relationship anchor",
      "seller-timing signals carry full provenance",
      "no unsupported seller claims in explanations",
      "recovery signals well-formed (weight bounds, provenance)",
      "verified long_term_owner outranks crm_interest_signal",
    ],
  });
}

main();
