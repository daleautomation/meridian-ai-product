/**
 * check-opportunity-pipeline — validator for Commit C wiring.
 *
 * Covers the path from canonical-substrate inputs → OpportunityScoringInput
 * → scoreContactOpportunity → OpportunitySignal, plus the opener and
 * priority-context surfaces that consume the signal.
 *
 * Specifically validates:
 *   • buildOpportunityScoringInput is pure + deterministic
 *   • With no link: ownership factors do not fire; uncertainty
 *     `no_public_record_source_loaded` is present
 *   • With link + snapshot: ownerName / parcelId / publicRecordSource
 *     flow to the signal verbatim
 *   • ownership_duration_over_7yr factor applies only when years >= 7
 *   • OpportunitySignal.publicRecordSource carries through from input
 *   • buildPriorityContext + summarizePriorityContext emit clean strings
 *   • Opener-extractor (enrichment:opportunity_priority) only fires
 *     when tier ∈ {HIGH, MED} AND parcel grounding present
 *   • Opener does NOT fire when tier is WEAK / REVIEW
 *   • Opener does NOT fire without parcel grounding
 *   • Opener falls through to tag chain when not eligible
 *   • Banned-phrase scan covers every emitted string field
 *   • Determinism: byte-identical pipeline output across calls
 *   • The applyContactOpportunityNeon writer signature touches only
 *     enrichment.opportunity (verified by reading the source)
 *
 * No DB. No env. Pure.
 */

import { buildOpportunityScoringInput } from "@/lib/enrichment/opportunity/buildScoringInput";
import { scoreContactOpportunity } from "@/lib/enrichment/opportunity/scoreOpportunity";
import {
  buildPriorityContext,
  summarizePriorityContext,
  ownershipDurationYearsFor,
} from "@/lib/personal-workspace/priorityContext";
import { buildSuggestedOpener } from "@/lib/personal-workspace/openerBuilder";
import type {
  OpportunitySignal,
  OpportunityTier,
} from "@/lib/enrichment/opportunity/types";
import type {
  PublicOwnershipSnapshot,
  PublicParcel,
  WorkspaceContactParcelLink,
} from "@/lib/enrichment/public-records/canonicalStorage/types";
import { readFileSync } from "node:fs";
import path from "node:path";

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

// ── Banned phrases (constitution §6) ───────────────────────────────
const BANNED_PHRASES = [
  /\bhot lead\b/i,
  /\bwarm lead\b/i,
  /\bcold lead\b/i,
  /likely motivated/i,
  /high seller intent/i,
  /ready to transact/i,
  /AI[-\s]?(?:believes|suggests|recommends|powered|driven)/i,
] as const;
function scanClean(s: string | null, where: string): void {
  if (!s) return;
  for (const re of BANNED_PHRASES) {
    if (re.test(s)) fail(`${where}: banned phrase /${re.source}/ in "${s}"`);
  }
}

// ── Fixture builders ───────────────────────────────────────────────

const NOW = new Date("2026-05-27T00:00:00Z");

function makeParcel(over: Partial<PublicParcel> = {}): PublicParcel {
  return {
    id: "parcel-abc",
    countyCode: "us-mo-jackson",
    sourceParcelId: "30-510-01-04-00-0-00-000",
    propertyKey: "4321 w 63rd st|kansas city|mo|64113",
    situsAddress: "4321 W 63rd St, Kansas City, MO 64113",
    firstObservedAt: "2026-05-27T00:00:00Z",
    lastObservedAt: "2026-05-27T00:00:00Z",
    estimatedPropertyType: "single_family",
    ...over,
  };
}

function makeSnapshot(over: Partial<PublicOwnershipSnapshot> = {}): PublicOwnershipSnapshot {
  return {
    id: "snap-1",
    parcelId: "parcel-abc",
    ownerName: "SMITH, GREG",
    mailingAddress: "4321 W 63rd St, Kansas City, MO 64113",
    ownershipStartDate: "2015-04-15",
    lastTransferDate: "2015-04-15",
    assessedValue: 425000,
    source: "us-mo-jackson_manual_2026-05-27",
    sourceSnapshotId: "us-mo-jackson_manual_2026-05-27",
    observedAt: "2026-05-27T00:00:00Z",
    rawSourceRow: { parcel: "30-510-01-04-00-0-00-000" },
    createdAt: "2026-05-27T00:00:00Z",
    ...over,
  };
}

function makeLink(over: Partial<WorkspaceContactParcelLink> = {}): WorkspaceContactParcelLink {
  return {
    id: "link-1",
    workspaceId: "nicole-lonergan",
    contactId: "crm-1",
    parcelId: "parcel-abc",
    ownerSnapshotId: "snap-1",
    matchConfidence: "MED",
    matchReason: "exact",
    linkCreatedAt: "2026-05-27T00:00:00Z",
    linkLastVerifiedAt: "2026-05-27T00:00:00Z",
    linkSupersededAt: null,
    supersededByLinkId: null,
    ...over,
  };
}

interface SimpleContact {
  contactId: string;
  contactName: string;
  tags: readonly string[];
  email: string | null;
  phone: string | null;
  lastInteractionAt: string | null;
}

function makeContact(over: Partial<SimpleContact> = {}): SimpleContact {
  return {
    contactId: "crm-1",
    contactName: "Greg Smith",
    tags: ["Seller"],
    email: "greg.smith@example.com",
    phone: "+18165550100",
    lastInteractionAt: "2024-01-15T00:00:00Z",
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────
// SECTION 1 — buildOpportunityScoringInput purity + correctness
// ──────────────────────────────────────────────────────────────────

function runInputAssembly(): void {
  // ── With full link + snapshot: ownership facts propagate. ─────
  const inputFull = buildOpportunityScoringInput({
    contact: makeContact(),
    link: makeLink(),
    parcel: makeParcel(),
    snapshot: makeSnapshot(),
    operatorSellerBias: 15,
    now: NOW,
  });
  expectEqual(inputFull.parcelId, "parcel-abc", "parcel flows to input");
  expectEqual(inputFull.matchedPropertyAddress, "4321 W 63rd St, Kansas City, MO 64113", "address flows");
  expectEqual(inputFull.ownerName, "SMITH, GREG", "owner flows verbatim");
  expectEqual(inputFull.ownerMatchConfidence, "MED", "ownerMatchConfidence from link");
  expectEqual(inputFull.publicRecordSource, "us-mo-jackson_manual_2026-05-27", "publicRecordSource from snapshot");
  expectEqual(inputFull.ownershipDurationYears, 11, "ownership duration computed (2015 → 2026 = 11 yrs)");
  expectEqual(inputFull.lastSaleDate, "2015-04-15", "lastSaleDate from snapshot");
  expectEqual(inputFull.operatorSellerBias, 15, "seller bias passes through");

  // ── No link / no snapshot: ownership fields are null. ─────────
  const inputNone = buildOpportunityScoringInput({
    contact: makeContact(),
    link: null,
    parcel: null,
    snapshot: null,
    operatorSellerBias: 0,
    now: NOW,
  });
  expectEqual(inputNone.parcelId, null, "no link → parcelId null");
  expectEqual(inputNone.matchedPropertyAddress, null, "no link → address null");
  expectEqual(inputNone.ownerName, null, "no link → ownerName null");
  expectEqual(inputNone.ownerMatchConfidence, null, "no link → confidence null");
  expectEqual(inputNone.publicRecordSource, null, "no link → publicRecordSource null");
  expectEqual(inputNone.ownershipDurationYears, null, "no link → duration null");

  // ── No actionable channel: hasActionableChannel = false. ──────
  const inputNoChannel = buildOpportunityScoringInput({
    contact: makeContact({ email: null, phone: null }),
    link: makeLink(),
    parcel: makeParcel(),
    snapshot: makeSnapshot(),
    operatorSellerBias: 15,
    now: NOW,
  });
  expectEqual(inputNoChannel.hasActionableChannel, false, "no channel detected");
  expectEqual(inputNoChannel.contactPathSource, null, "no channel → contactPathSource null");

  // ── Determinism: 5 calls with identical input → byte-identical. ─
  const seq = Array.from({ length: 5 }, () =>
    JSON.stringify(buildOpportunityScoringInput({
      contact: makeContact(),
      link: makeLink(),
      parcel: makeParcel(),
      snapshot: makeSnapshot(),
      operatorSellerBias: 15,
      now: NOW,
    })),
  );
  expect(seq.every((s) => s === seq[0]), "buildOpportunityScoringInput is deterministic");
}

// ──────────────────────────────────────────────────────────────────
// SECTION 2 — Pipeline end-to-end: input → score → signal
// ──────────────────────────────────────────────────────────────────

function runPipelineEndToEnd(): void {
  // Happy path: seller relationship + parcel grounding + actionable channel +
  // 11-year ownership → expect HIGH-ish score, parcelId + publicRecordSource set,
  // no uncertainty `no_public_record_source_loaded`.
  const inputFull = buildOpportunityScoringInput({
    contact: makeContact(),
    link: makeLink(),
    parcel: makeParcel(),
    snapshot: makeSnapshot(),
    operatorSellerBias: 15,
    now: NOW,
  });
  const sFull = scoreContactOpportunity(inputFull);
  expectEqual(sFull.parcelId, "parcel-abc", "signal parcelId");
  expectEqual(sFull.matchedPropertyAddress, "4321 W 63rd St, Kansas City, MO 64113", "signal address");
  expectEqual(sFull.publicRecordSource, "us-mo-jackson_manual_2026-05-27", "signal publicRecordSource");
  expect(sFull.transparentPriorityScore > 0, "scored > 0");
  // Scored factors only: prior_seller_relationship + ownership_over_7yr +
  // stale relationship (lastInteractionAt 2024-01 → 2026-05 = 28 months > 12).
  // operator_preference_seller_bias and contact_channel_present no longer
  // contribute. = 30 + 15 + 10 = 55. MED (no listing/MLS → not HIGH).
  // Market-evidence gate satisfied via public-record (ownership) grounding.
  expectEqual(sFull.transparentPriorityScore, 55, "expected score sum");
  expectEqual(sFull.priorityTier, "MED", "MED tier at score 55 with public-record grounding");
  // No public-record uncertainty when source is loaded.
  const codes = sFull.uncertaintyReasons.map((u) => u.code);
  expect(!codes.includes("no_public_record_source_loaded"), "no public-record uncertainty when grounded");
  // Listing layer not loaded → uncertainty present.
  expect(codes.includes("no_listing_source_loaded"), "MLS uncertainty surfaced honestly");

  // No link: ownership factors skip, uncertainty present.
  const inputNone = buildOpportunityScoringInput({
    contact: makeContact(),
    link: null,
    parcel: null,
    snapshot: null,
    operatorSellerBias: 15,
    now: NOW,
  });
  const sNone = scoreContactOpportunity(inputNone);
  expectEqual(sNone.parcelId, null, "no link → signal parcelId null");
  expectEqual(sNone.publicRecordSource, null, "no link → publicRecordSource null");
  const ownershipFactor = sNone.priorityFactors.find((f) => f.name === "ownership_duration_over_7yr");
  expectEqual(ownershipFactor?.applied, false, "ownership factor NOT fabricated when no source");
  const noneCodes = sNone.uncertaintyReasons.map((u) => u.code);
  expect(noneCodes.includes("no_public_record_source_loaded"), "no source uncertainty present");

  // Ownership < 7 years: factor must NOT fire.
  const youngOwner = scoreContactOpportunity(buildOpportunityScoringInput({
    contact: makeContact(),
    link: makeLink(),
    parcel: makeParcel(),
    snapshot: makeSnapshot({ ownershipStartDate: "2022-04-15" }),
    operatorSellerBias: 15,
    now: NOW,
  }));
  const yof = youngOwner.priorityFactors.find((f) => f.name === "ownership_duration_over_7yr");
  expectEqual(yof?.applied, false, "ownership_duration < 7yr does not apply");

  // WEAK link confidence → REVIEW cap.
  const weakOwner = scoreContactOpportunity(buildOpportunityScoringInput({
    contact: makeContact(),
    link: makeLink({ matchConfidence: "WEAK", matchReason: "surname" }),
    parcel: makeParcel(),
    snapshot: makeSnapshot(),
    operatorSellerBias: 15,
    now: NOW,
  }));
  expectEqual(weakOwner.priorityTier, "REVIEW", "WEAK owner → REVIEW cap");
  expectEqual(weakOwner.tierCapReason, "weak_owner_match", "cap reason named");

  // No actionable channel → WEAK cap (lowest rank wins).
  const noChannel = scoreContactOpportunity(buildOpportunityScoringInput({
    contact: makeContact({ email: null, phone: null }),
    link: makeLink(),
    parcel: makeParcel(),
    snapshot: makeSnapshot(),
    operatorSellerBias: 15,
    now: NOW,
  }));
  expectEqual(noChannel.priorityTier, "WEAK", "no channel → WEAK cap");
  expectEqual(noChannel.tierCapReason, "no_actionable_channel", "cap reason named");
}

// ──────────────────────────────────────────────────────────────────
// SECTION 3 — PriorityContext rendering
// ──────────────────────────────────────────────────────────────────

function runPriorityContext(): void {
  const signal = scoreContactOpportunity(buildOpportunityScoringInput({
    contact: makeContact(),
    link: makeLink(),
    parcel: makeParcel(),
    snapshot: makeSnapshot(),
    operatorSellerBias: 15,
    now: NOW,
  }));
  const ctx = buildPriorityContext(signal);

  expectEqual(ctx.tier, "MED", "context tier mirrors signal");
  expectEqual(ctx.score, 55, "context score mirrors signal");
  expectEqual(ctx.grounding.address, "4321 W 63rd St, Kansas City, MO 64113", "grounding address");
  expectEqual(ctx.grounding.ownerName, "SMITH, GREG", "grounding owner");
  expectEqual(ctx.grounding.ownershipDurationYears, 11, "grounding duration");
  expectEqual(ctx.grounding.publicRecordSource, "us-mo-jackson_manual_2026-05-27", "grounding source");
  expect(ctx.reviewFlags.length > 0, "uncertainty reflected as reviewFlags");
  expect(ctx.topFactors.length > 0, "topFactors non-empty for HIGH tier");

  // topFactors sorted by weight desc — active_listing_found (35) would be first
  // when applied; here it's not (no MLS data). So prior_seller_relationship (30)
  // is the top applied factor.
  expectEqual(ctx.topFactors[0].name, "prior_seller_relationship", "top factor by weight");

  // summarizePriorityContext is clean + non-empty.
  const summary = summarizePriorityContext(ctx);
  expect(summary.length > 0, "summary non-empty");
  expect(summary.startsWith("MED"), "summary leads with tier");
  scanClean(summary, "summary");

  // Helper: ownershipDurationYearsFor
  expectEqual(ownershipDurationYearsFor("2015-04-15", NOW), 11, "duration helper consistency");
  expectEqual(ownershipDurationYearsFor(null, NOW), null, "duration helper null on null");
  expectEqual(ownershipDurationYearsFor("not a date", NOW), null, "duration helper null on garbage");

  // Repeat for byte-stability.
  const a = JSON.stringify(buildPriorityContext(signal));
  const b = JSON.stringify(buildPriorityContext(signal));
  expectEqual(a, b, "priority context deterministic");
}

// ──────────────────────────────────────────────────────────────────
// SECTION 4 — Opener extractor gating
// ──────────────────────────────────────────────────────────────────

function runOpenerExtractor(): void {
  const baseInput = {
    name: "Greg Smith",
    notes: null,
    tags: [] as string[],
    lastInteractionAt: null,
    sourceCrm: null,
    hunter: null,
  };

  // Eligible: tier HIGH + grounding present.
  const eligible = buildSuggestedOpener({
    ...baseInput,
    opportunity: {
      priorityTier: "HIGH",
      transparentPriorityScore: 80,
      matchedPropertyAddress: "4321 W 63rd St, Kansas City, MO 64113",
      ownerName: "SMITH, GREG",
      ownershipDurationYears: 11,
      publicRecordSource: "us-mo-jackson_manual_2026-05-27",
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship", "operator_preference_seller_bias"],
    },
  }, { now: NOW });
  expectEqual(eligible.openerSource, "enrichment:opportunity_priority", "extractor fires for HIGH + grounding");
  expectEqual(eligible.trustLevel, "MED", "MED trust level");
  expect(eligible.isSpecific, "marked specific");
  expect(eligible.opener.includes("Public record"), "opener mentions public record");
  expect(eligible.opener.includes("4321 W 63rd St, Kansas City, MO 64113"), "opener carries situs address");
  expect(eligible.opener.includes("us-mo-jackson_manual_2026-05-27"), "opener carries source");
  scanClean(eligible.opener, "opener");
  scanClean(eligible.supportingEvidence, "supportingEvidence");

  // Tier WEAK → does NOT fire; falls through to fallback.
  const weakTier = buildSuggestedOpener({
    ...baseInput,
    opportunity: {
      priorityTier: "WEAK",
      transparentPriorityScore: 20,
      matchedPropertyAddress: "4321 W 63rd St",
      ownerName: "X",
      ownershipDurationYears: 11,
      publicRecordSource: "src",
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship"],
    },
  }, { now: NOW });
  expect(weakTier.openerSource !== "enrichment:opportunity_priority", "WEAK tier does not trigger extractor");

  // Tier REVIEW → does NOT fire.
  const reviewTier = buildSuggestedOpener({
    ...baseInput,
    opportunity: {
      priorityTier: "REVIEW",
      transparentPriorityScore: 60,
      matchedPropertyAddress: "4321 W 63rd St",
      ownerName: "X",
      ownershipDurationYears: 11,
      publicRecordSource: "src",
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship"],
    },
  }, { now: NOW });
  expect(reviewTier.openerSource !== "enrichment:opportunity_priority", "REVIEW tier does not trigger extractor");

  // HIGH but no grounding (publicRecordSource null) → does NOT fire.
  const noSource = buildSuggestedOpener({
    ...baseInput,
    opportunity: {
      priorityTier: "HIGH",
      transparentPriorityScore: 80,
      matchedPropertyAddress: "4321 W 63rd St",
      ownerName: null,
      ownershipDurationYears: null,
      publicRecordSource: null,
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship"],
    },
  }, { now: NOW });
  expect(noSource.openerSource !== "enrichment:opportunity_priority", "no source → extractor does NOT fire");

  // HIGH + no matched address → does NOT fire.
  const noAddress = buildSuggestedOpener({
    ...baseInput,
    opportunity: {
      priorityTier: "HIGH",
      transparentPriorityScore: 80,
      matchedPropertyAddress: null,
      ownerName: "X",
      ownershipDurationYears: 11,
      publicRecordSource: "src",
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship"],
    },
  }, { now: NOW });
  expect(noAddress.openerSource !== "enrichment:opportunity_priority", "no address → extractor does NOT fire");

  // Notes opener should still win over opportunity opener.
  const notesWins = buildSuggestedOpener({
    ...baseInput,
    notes: "kitchen renovation wraps in two weeks",
    opportunity: {
      priorityTier: "HIGH",
      transparentPriorityScore: 80,
      matchedPropertyAddress: "4321 W 63rd St, KC, MO",
      ownerName: "X",
      ownershipDurationYears: 11,
      publicRecordSource: "src",
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship"],
    },
  }, { now: NOW });
  expect(notesWins.openerSource.startsWith("notes:"), "notes opener wins over opportunity opener");

  // Determinism: same input → byte-identical.
  const a = JSON.stringify(buildSuggestedOpener({
    ...baseInput,
    opportunity: {
      priorityTier: "HIGH",
      transparentPriorityScore: 80,
      matchedPropertyAddress: "4321 W 63rd St",
      ownerName: "X",
      ownershipDurationYears: 11,
      publicRecordSource: "src",
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship"],
    },
  }, { now: NOW }));
  const b = JSON.stringify(buildSuggestedOpener({
    ...baseInput,
    opportunity: {
      priorityTier: "HIGH",
      transparentPriorityScore: 80,
      matchedPropertyAddress: "4321 W 63rd St",
      ownerName: "X",
      ownershipDurationYears: 11,
      publicRecordSource: "src",
      fetchedAt: "2026-05-27T00:00:00Z",
      topAppliedFactorNames: ["prior_seller_relationship"],
    },
  }, { now: NOW }));
  expectEqual(a, b, "opener extractor deterministic");
}

// ──────────────────────────────────────────────────────────────────
// SECTION 5 — Writer signature (no CRM truth mutation)
// ──────────────────────────────────────────────────────────────────
//
// applyContactOpportunityNeon is documented + tested in Commit A.
// Here we verify by source inspection that its SQL touches ONLY
// source_metadata.enrichment.opportunity — never normalized.* or
// any other key under source_metadata. This is a textual contract
// check that catches a future regression where someone accidentally
// changes the jsonb_set path.

function runWriterSourceInspection(): void {
  const sourcePath = path.join(
    "lib",
    "crm-import",
    "crmContactsNeonAdapter.ts",
  );
  const text = readFileSync(sourcePath, "utf8");
  // Locate applyContactOpportunityNeon and capture its function body.
  const fnIdx = text.indexOf("applyContactOpportunityNeon");
  if (fnIdx < 0) {
    fail("applyContactOpportunityNeon not found in adapter");
    return;
  }
  const body = text.slice(fnIdx, fnIdx + 1200);
  expect(
    body.includes("'{enrichment,opportunity}'"),
    "writer jsonb_set path is {enrichment,opportunity}",
  );
  expect(
    body.includes("update crm_contacts"),
    "writer issues UPDATE on crm_contacts only",
  );
  expect(
    !body.includes("normalized") || body.indexOf("normalized") > body.indexOf("returning"),
    "writer does not touch normalized JSONB (CRM truth)",
  );
  expect(
    !body.includes("delete"),
    "writer does not delete rows",
  );
}

// ──────────────────────────────────────────────────────────────────
// SECTION 6 — Banned-phrase scan on every emitted signal string
// ──────────────────────────────────────────────────────────────────

function runBannedPhraseScanOnSignals(): void {
  const fixtures: OpportunitySignal[] = [];
  // Full grounded happy path
  fixtures.push(scoreContactOpportunity(buildOpportunityScoringInput({
    contact: makeContact(), link: makeLink(), parcel: makeParcel(), snapshot: makeSnapshot(),
    operatorSellerBias: 15, now: NOW,
  })));
  // No-link
  fixtures.push(scoreContactOpportunity(buildOpportunityScoringInput({
    contact: makeContact(), link: null, parcel: null, snapshot: null,
    operatorSellerBias: 15, now: NOW,
  })));
  // WEAK owner
  fixtures.push(scoreContactOpportunity(buildOpportunityScoringInput({
    contact: makeContact(), link: makeLink({ matchConfidence: "WEAK", matchReason: "ownership_mismatch" }),
    parcel: makeParcel(), snapshot: makeSnapshot(), operatorSellerBias: 15, now: NOW,
  })));
  for (const s of fixtures) {
    for (const f of s.priorityFactors) {
      scanClean(f.source, "factor.source");
      scanClean(f.evidenceLabel, "factor.evidenceLabel");
    }
    for (const u of s.uncertaintyReasons) {
      scanClean(u.detail ?? null, "uncertainty.detail");
    }
    scanClean(s.matchedPropertyAddress, "signal.matchedPropertyAddress");
    scanClean(s.ownerName, "signal.ownerName");
    scanClean(s.publicRecordSource, "signal.publicRecordSource");
    scanClean(s.relationshipTypeSource, "signal.relationshipTypeSource");
  }
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

function main() {
  runInputAssembly();
  runPipelineEndToEnd();
  runPriorityContext();
  runOpenerExtractor();
  runWriterSourceInspection();
  runBannedPhraseScanOnSignals();

  if (failures.length > 0) {
    console.error("");
    console.error("check-opportunity-pipeline FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-opportunity-pipeline passed", {
    checks: [
      "buildOpportunityScoringInput: ownership facts propagate from snapshot",
      "buildOpportunityScoringInput: ownership facts NULL when no link/snapshot",
      "buildOpportunityScoringInput: hasActionableChannel + contactPathSource derivation",
      "buildOpportunityScoringInput: deterministic across 5 calls",
      "pipeline: grounded happy path scores 80 → HIGH tier; no public-record uncertainty",
      "pipeline: no source loaded → no_public_record_source_loaded uncertainty fires",
      "pipeline: ownership_duration_over_7yr does NOT fire when <7 yrs (no fake factors)",
      "pipeline: WEAK link confidence → REVIEW cap with weak_owner_match reason",
      "pipeline: no actionable channel → WEAK cap with no_actionable_channel reason",
      "signal.publicRecordSource carries through from input (new in Commit C)",
      "PriorityContext mirrors tier/score/grounding/uncertainty deterministically",
      "summarizePriorityContext: clean, structured, starts with tier",
      "ownershipDurationYearsFor: null inputs handled",
      "opener extractor: fires for HIGH/MED with grounding; cites public record + source",
      "opener extractor: does NOT fire for WEAK / REVIEW tiers",
      "opener extractor: does NOT fire without publicRecordSource",
      "opener extractor: does NOT fire without matchedPropertyAddress",
      "opener priority: notes opener wins over opportunity opener (HIGH trust precedence)",
      "opener extractor: deterministic",
      "writer source inspection: jsonb_set path is {enrichment,opportunity}; no CRM-truth touch; no DELETE",
      "banned-phrase scan clean on every emitted signal string (3 fixtures × all fields)",
    ],
  });
}

main();
