/**
 * Brookside property enrichment validation.
 *
 * Asserts deterministic address keys, provenance on signals, confidence bounds,
 * and no unsupported seller claims.
 */

import assert from "node:assert/strict";
import brooksideConfig from "@/config/signals/nicole-lonergan";
import {
  buildPropertyEnrichmentSignals,
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
  parsePropertyEnrichmentFromRow,
} from "@/lib/enrichment";
import { buildSellerTimingSignals } from "@/lib/enrichment/property";
import { isWellFormedSignal, type RecoverySignal } from "@/lib/recovery/signals/types";

const FIXED_NOW = "2025-05-22T12:00:00.000Z";
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function assertDeterministicKey(raw: string, label: string): void {
  const a = canonicalPropertyKey(normalizeAddress(raw));
  const b = canonicalPropertyKey(normalizeAddress(raw));
  if (a !== b) fail(`${label}: canonical key not deterministic`);
}

function main(): void {
  assertDeterministicKey("123 Main St, Seattle, WA 98101", "standard");
  assertDeterministicKey("123  MAIN   ST,  Seattle,  Washington  98101", "noisy spacing");

  const dupA = canonicalPropertyKey(normalizeAddress("123 Main St, Seattle, WA 98101"));
  const dupB = canonicalPropertyKey(normalizeAddress("123 Main Street, Seattle, WA 98101"));
  if (dupA !== dupB) {
    fail("duplicate suppression: Main St vs Main Street should normalize to same key");
  }

  const weak = detectWeakAddress(normalizeAddress("Seattle"));
  if (!weak) fail("weak address: city-only should be weak");

  const poWeak = detectWeakAddress(normalizeAddress("PO Box 99"));
  if (!poWeak || poWeak.code !== "missing_city") {
    fail("weak address: PO box without city should be weak");
  }

  const row = {
    location: "456 Oak Ave, Bellevue, WA 98004",
    propertyOwnershipStartDate: "2010-06-01",
    propertyOwnershipObservedAt: "2025-04-01T00:00:00.000Z",
    propertyOwnershipRecordId: "deed-456",
    propertyOwnershipSource: "county_recorder:king_wa",
    parcelId: "KING-456",
    permitActivityRecordId: "permit-789",
    permitActivityObservedAt: "2025-03-15T00:00:00.000Z",
    neighborhoodTransferCount: "4",
    neighborhoodTransferObservedAt: "2025-04-10T00:00:00.000Z",
    neighborhoodTransferWindowDays: "365",
    neighborhoodTransferRecordId: "nb-window-1",
  };

  const enrichment = parsePropertyEnrichmentFromRow(row);
  if (!enrichment) {
    fail("row parser: expected enrichment input from fixture row");
  } else {
    const timing = buildSellerTimingSignals(enrichment, FIXED_NOW);
    if (timing.length === 0) fail("seller timing: expected at least one signal from fixture");

    for (const signal of timing) {
      if (!signal.evidenceLabel?.trim()) fail(`timing ${signal.kind}: empty evidenceLabel`);
      if (!signal.explanation?.trim()) fail(`timing ${signal.kind}: empty explanation`);
      if (!signal.recordId?.trim()) fail(`timing ${signal.kind}: empty recordId`);
      if (Object.keys(signal.evidence).length === 0) {
        fail(`timing ${signal.kind}: empty evidence metadata`);
      }
      const lower = signal.explanation.toLowerCase();
      if (lower.includes("likely to sell") || lower.includes("predicted")) {
        fail(`timing ${signal.kind}: unsupported seller claim in explanation`);
      }
    }

    const recovery = buildPropertyEnrichmentSignals({
      enrichment,
      config: brooksideConfig,
      leadKey: "lead-test-001",
      nowIso: FIXED_NOW,
    });

    for (const raw of recovery) {
      if (!isWellFormedSignal(raw)) {
        fail("recovery signal: not well-formed");
        continue;
      }
      const r: RecoverySignal = raw;
      if (r.weight < 0 || r.weight > 100) fail(`recovery signal ${r.name}: weight out of bounds`);
      if (!r.observedAt) fail(`recovery signal ${r.name}: missing observedAt`);
      if (!r.recordId) fail(`recovery signal ${r.name}: missing recordId`);
      if (!r.source) fail(`recovery signal ${r.name}: missing provenance source`);
    }

    const longTermDef = brooksideConfig.signals.find((s) => s.name === "long_term_owner");
    const crmDef = brooksideConfig.signals.find((s) => s.name === "crm_interest_signal");
    if (!longTermDef || !crmDef) {
      fail("config: missing long_term_owner or crm_interest_signal definition");
    } else if (longTermDef.defaultWeight <= crmDef.defaultWeight) {
      fail("weighting: long_term_owner must outrank crm_interest_signal in workspace config");
    }
  }

  const noEvidence = parsePropertyEnrichmentFromRow({ location: "789 Pine Rd, Kirkland, WA 98033" });
  if (noEvidence) {
    fail("row parser: must not invent enrichment without recorder/permit evidence");
  }

  if (failures.length > 0) {
    console.error("property enrichment check FAILED");
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
  }

  console.log("property enrichment check passed", {
    checks: [
      "deterministic canonicalPropertyKey",
      "duplicate address suppression",
      "weak-address detection",
      "provenance on timing signals",
      "confidence via well-formed RecoverySignal",
      "no unsupported seller claims",
      "non-empty evidence metadata",
      "seller-timing weight > CRM when both present",
      "no enrichment without verified facts",
    ],
  });
}

main();
