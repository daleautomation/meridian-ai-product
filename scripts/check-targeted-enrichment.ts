/**
 * Brookside targeted-enrichment validation.
 *
 * Asserts the orchestrator's determinism, queue gates (cap, dedupe,
 * recency, weak-address), and signal-output invariants (provenance,
 * confidence bounds, no unsupported seller claims) on a synthetic
 * brief + public-record fixture.
 */

import brooksideConfig from "@/config/signals/nicole-lonergan";
import {
  buildParcelIndex,
  parsePublicRecordRows,
} from "@/lib/enrichment/public-records";
import {
  DEFAULT_POLICY,
  emptyLedger,
  ledgerWithEnrichment,
  normalizePolicy,
  runTargetedEnrichment,
  type EnrichmentLedger,
  type EnrichmentSkipReason,
} from "@/lib/enrichment/workflows";
import type { RecoveryBrief, RecoveryBriefItem } from "@/lib/recovery/brief";

const FIXED_NOW = "2026-05-22T12:00:00.000Z";
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

// ── Fixture builders ──────────────────────────────────────────────

function briefItem(overrides: Partial<RecoveryBriefItem> & Pick<RecoveryBriefItem, "rank" | "leadKey" | "companyName">): RecoveryBriefItem {
  return {
    rank: overrides.rank,
    leadKey: overrides.leadKey,
    companyName: overrides.companyName,
    contactName: overrides.contactName ?? null,
    location: overrides.location ?? null,
    relationshipFreshness: overrides.relationshipFreshness ?? "Dormant for several months",
    staleness:
      overrides.staleness ?? {
        daysSinceTouch: 220,
        staleScore: 75,
        staleCategory: "Recovery candidate",
        lastTouchAt: "2025-10-14T00:00:00.000Z",
      },
    whyNow: overrides.whyNow ?? "Stub why-now.",
    verifiedContactPath: overrides.verifiedContactPath ?? "Manual verification needed",
    suggestedOpener: overrides.suggestedOpener ?? "Stub opener.",
    priorityContext: overrides.priorityContext ?? "Stub priority.",
    score: overrides.score ?? 0,
    weakOnly: overrides.weakOnly ?? false,
    headlineSignal: overrides.headlineSignal ?? null,
    signalContributions: overrides.signalContributions ?? [],
    scoreBreakdown: overrides.scoreBreakdown,
    recoveryScore: overrides.recoveryScore ?? 72,
    decision:
      overrides.decision ?? {
        bucket: "Call this week",
        score: 72,
        primaryOpportunity: undefined,
      },
  };
}

function buildBrief(items: RecoveryBriefItem[]): RecoveryBrief {
  return {
    customer: "nicole-lonergan",
    week: "2026-W21",
    generatedAt: FIXED_NOW,
    sourceCsv: "fixtures/test.csv",
    summary: {
      inputRows: items.length,
      opportunities: items.length,
      recoveryCandidates: items.length,
    },
    opportunities: items,
  };
}

// Five candidates designed to exercise every gate:
//   rank 1: strong address, matches by parcel — will enrich
//   rank 2: strong address, no match — skip no_match
//   rank 3: weak address (no zip)  — skip weak_address
//   rank 4: duplicates rank 1 propertyKey — skip duplicate_property_key
//   rank 5: ledger says enriched recently — skip already_enriched_recent
const ITEMS = [
  briefItem({ rank: 1, leadKey: "name:smith jane", companyName: "Smith, Jane", location: "1111 Cedar Blvd, Renton, WA 98057" }),
  briefItem({ rank: 2, leadKey: "name:doe john", companyName: "Doe, John", location: "200 Pine St, Seattle, WA 98101" }),
  briefItem({ rank: 3, leadKey: "name:partial address", companyName: "Partial, Address", location: "Seattle, WA" }),
  briefItem({ rank: 4, leadKey: "name:other party", companyName: "Other, Party", location: "1111 Cedar Blvd, Renton, WA 98057" }),
  briefItem({ rank: 5, leadKey: "name:recently enriched", companyName: "Recently, Enriched", location: "300 Oak Ave, Bellevue, WA 98004" }),
] as const;

const BRIEF = buildBrief([...ITEMS]);

const PUBLIC_RECORDS = parsePublicRecordRows([
  {
    parcelId: "KING-0005",
    situsAddress: "1111 Cedar Blvd, Renton, WA 98057",
    ownerName: "Smith, Jane",
    ownershipStartDate: "2014-09-21",
    sourceName: "county_recorder:king_wa",
    observedAt: "2025-04-01T00:00:00.000Z",
    recordUrl: "https://example.gov/r/KING-0005",
  },
  {
    parcelId: "KING-0006",
    situsAddress: "300 Oak Ave, Bellevue, WA 98004",
    ownerName: "Recently, Enriched",
    ownershipStartDate: "2010-06-15",
    sourceName: "county_recorder:king_wa",
    observedAt: "2025-04-01T00:00:00.000Z",
    recordUrl: "https://example.gov/r/KING-0006",
  },
]);

const INDEX = buildParcelIndex(PUBLIC_RECORDS.records);

// Ledger: rank 5 was enriched 7 days ago — within the 30-day window.
const LEDGER: EnrichmentLedger = ledgerWithEnrichment(
  emptyLedger(),
  "name:recently enriched",
  "2026-05-15T12:00:00.000Z",
  3,
);

function runDefault() {
  return runTargetedEnrichment({
    customer: "nicole-lonergan",
    brief: BRIEF,
    briefSource: "fixtures/brief.json",
    publicRecordIndex: INDEX,
    publicRecordSource: "fixtures/public-records.csv",
    workspaceConfig: brooksideConfig,
    ledger: LEDGER,
    policy: { ...DEFAULT_POLICY },
    nowIso: FIXED_NOW,
  });
}

// ── Checks ─────────────────────────────────────────────────────────

function main(): void {
  // 1. Determinism: two runs with identical inputs → identical audit JSON.
  const runA = runDefault();
  const runB = runDefault();
  const jsonA = JSON.stringify(runA.audit);
  const jsonB = JSON.stringify(runB.audit);
  if (jsonA !== jsonB) {
    fail("determinism: audit output differs between two identical runs");
  }

  const outcomes = runA.audit.outcomes;
  function find(leadKey: string) {
    return outcomes.find((o) => o.leadKey === leadKey);
  }

  // 2. Expected outcomes per rank.
  const rank1 = find("name:smith jane");
  if (!rank1 || rank1.result !== "enriched") {
    fail(`rank 1: expected enriched, got ${rank1?.result}`);
  } else {
    if (rank1.matchType !== "address" || rank1.matchConfidence !== "MED") {
      fail(`rank 1: expected MED address match, got ${rank1.matchType}/${rank1.matchConfidence}`);
    }
    if (rank1.signals.length === 0) fail("rank 1: enriched outcome must carry ≥1 signal");
    if (!rank1.evidence) fail("rank 1: enriched outcome must carry public-record evidence");
  }

  const rank2 = find("name:doe john");
  if (!rank2 || rank2.result !== "skipped" || rank2.skipReason !== "no_match") {
    fail(`rank 2: expected skipped/no_match, got ${rank2?.result}/${rank2?.skipReason}`);
  }

  const rank3 = find("name:partial address");
  if (!rank3 || rank3.result !== "skipped") {
    fail(`rank 3: expected skipped, got ${rank3?.result}`);
  } else if (
    rank3.skipReason !== "weak_address" &&
    rank3.skipReason !== "no_property_key"
  ) {
    fail(`rank 3: expected weak_address/no_property_key skip, got ${rank3.skipReason}`);
  }

  const rank4 = find("name:other party");
  if (!rank4 || rank4.result !== "skipped" || rank4.skipReason !== "duplicate_property_key") {
    fail(
      `rank 4: expected skipped/duplicate_property_key, got ${rank4?.result}/${rank4?.skipReason}`,
    );
  }

  const rank5 = find("name:recently enriched");
  if (!rank5 || rank5.result !== "skipped" || rank5.skipReason !== "already_enriched_recent") {
    fail(
      `rank 5: expected skipped/already_enriched_recent, got ${rank5?.result}/${rank5?.skipReason}`,
    );
  }

  // 3. Cap enforcement: cap=0 must skip every otherwise-eligible candidate
  // with outside_cap.
  const capped = runTargetedEnrichment({
    customer: "nicole-lonergan",
    brief: BRIEF,
    briefSource: "fixtures/brief.json",
    publicRecordIndex: INDEX,
    publicRecordSource: "fixtures/public-records.csv",
    workspaceConfig: brooksideConfig,
    ledger: emptyLedger(),
    policy: normalizePolicy({ cap: 0 }),
    nowIso: FIXED_NOW,
  });
  if (capped.audit.summary.enriched !== 0) {
    fail(`cap=0: expected 0 enriched, got ${capped.audit.summary.enriched}`);
  }
  const outsideCapCount = capped.audit.outcomes.filter(
    (o) => o.skipReason === "outside_cap",
  ).length;
  if (outsideCapCount === 0) {
    fail("cap=0: expected ≥1 outside_cap skip");
  }
  // Address-rejected and dedupe-rejected rows fire BEFORE the cap gate, so
  // they should still surface their own reason — not be swallowed by cap.
  const stillWeak = capped.audit.outcomes.find(
    (o) => o.leadKey === "name:partial address",
  );
  if (
    !stillWeak ||
    (stillWeak.skipReason !== "weak_address" && stillWeak.skipReason !== "no_property_key")
  ) {
    fail("cap=0 + weak address: address gate must fire before cap");
  }

  // 4. Provenance on enriched signals.
  if (rank1?.signals.length) {
    for (const s of rank1.signals) {
      if (!s.observedAt) fail(`rank 1 signal ${s.name}: missing observedAt`);
      if (!s.recordId) fail(`rank 1 signal ${s.name}: missing recordId`);
      if (!s.source) fail(`rank 1 signal ${s.name}: missing source`);
      if (s.weight < 0 || s.weight > 100) {
        fail(`rank 1 signal ${s.name}: weight ${s.weight} out of bounds`);
      }
      if (!["HIGH", "MED", "WEAK"].includes(s.confidence)) {
        fail(`rank 1 signal ${s.name}: invalid confidence ${s.confidence}`);
      }
      if (s.explanation) {
        const lower = s.explanation.toLowerCase();
        if (lower.includes("likely to sell") || lower.includes("predicted")) {
          fail(`rank 1 signal ${s.name}: unsupported seller claim in explanation`);
        }
      }
    }
  }

  // 5. No enrichment without verified facts: a candidate that matches a
  // public record carrying no ownership / permit / release facts should
  // skip with no_actionable_facts, not enrich.
  const factlessRecords = parsePublicRecordRows([
    {
      parcelId: "KING-7777",
      situsAddress: "500 Birch Way, Seattle, WA 98109",
      // no ownershipStartDate — admitted but produces no ownership block
      sourceName: "county_recorder:king_wa",
      observedAt: "2025-04-01T00:00:00.000Z",
    },
  ]);
  const factlessIndex = buildParcelIndex(factlessRecords.records);
  const factlessBrief = buildBrief([
    briefItem({
      rank: 1,
      leadKey: "name:factless",
      companyName: "Factless, Match",
      location: "500 Birch Way, Seattle, WA 98109",
      // Recent touch (under 180 days) so the stale-relationship signal
      // cannot fire — verifies that the public record alone, without
      // ownership / permit / release facts, produces zero signals.
      staleness: {
        daysSinceTouch: 30,
        staleScore: 20,
        staleCategory: "Cooling",
        lastTouchAt: "2026-04-22T12:00:00.000Z",
      },
    }),
  ]);
  const factlessRun = runTargetedEnrichment({
    customer: "nicole-lonergan",
    brief: factlessBrief,
    briefSource: "fixtures/factless-brief.json",
    publicRecordIndex: factlessIndex,
    publicRecordSource: "fixtures/factless.csv",
    workspaceConfig: brooksideConfig,
    ledger: emptyLedger(),
    policy: { ...DEFAULT_POLICY },
    nowIso: FIXED_NOW,
  });
  const factlessOutcome = factlessRun.audit.outcomes[0];
  if (!factlessOutcome || factlessOutcome.result !== "skipped") {
    fail(
      `no_actionable_facts: expected skipped, got ${factlessOutcome?.result}`,
    );
  } else if (factlessOutcome.skipReason !== "no_actionable_facts") {
    fail(
      `no_actionable_facts: expected reason no_actionable_facts, got ${factlessOutcome.skipReason}`,
    );
  }

  // 6. nextLedger update: every enriched leadKey should appear in
  // nextLedger with the run's nowIso.
  if (rank1?.result === "enriched") {
    const entry = runA.nextLedger.entriesByLeadKey.get("name:smith jane");
    if (!entry) fail("nextLedger: enriched leadKey missing from updated ledger");
    else if (entry.enrichedAt !== FIXED_NOW) {
      fail(`nextLedger: enrichedAt must equal nowIso (got ${entry.enrichedAt})`);
    }
  }
  // The previously-recent ledger entry must survive unchanged (we don't
  // bump it just because we re-considered it).
  const preserved = runA.nextLedger.entriesByLeadKey.get("name:recently enriched");
  if (!preserved || preserved.enrichedAt !== "2026-05-15T12:00:00.000Z") {
    fail("nextLedger: skipped-recent leadKey must be preserved unchanged");
  }

  // 7. Summary integrity: every outcome counted, byReason aligns.
  const summary = runA.audit.summary;
  const expectedTotal = ITEMS.length;
  if (summary.totalCandidates !== expectedTotal) {
    fail(
      `summary.totalCandidates ${summary.totalCandidates} ≠ expected ${expectedTotal}`,
    );
  }
  const seenReasons: EnrichmentSkipReason[] = [
    "weak_address",
    "no_property_key",
    "duplicate_property_key",
    "already_enriched_recent",
    "no_match",
  ];
  let sumByReason = 0;
  for (const r of seenReasons) sumByReason += summary.byReason[r];
  if (sumByReason !== summary.skipped) {
    fail(
      `summary.byReason total (${sumByReason}) ≠ summary.skipped (${summary.skipped})`,
    );
  }

  finish();
}

function finish(): void {
  if (failures.length > 0) {
    console.error("targeted enrichment check FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("targeted enrichment check passed", {
    checks: [
      "deterministic enrichment ordering (two identical runs → identical audit JSON)",
      "rank-1 enriched via address match (MED)",
      "rank-2 no_match skip",
      "rank-3 weak address skip",
      "rank-4 duplicate_property_key skip",
      "rank-5 already_enriched_recent skip",
      "cap=0 produces outside_cap reasons",
      "address gate fires before cap gate",
      "enriched signals carry provenance (source / recordId / observedAt)",
      "enriched signals carry valid confidence + bounded weight",
      "no unsupported seller claims in explanations",
      "no enrichment without verified facts (no_actionable_facts)",
      "nextLedger updates enriched leadKey",
      "nextLedger preserves skipped-recent entries",
      "audit summary.byReason totals match summary.skipped",
    ],
  });
}

main();
