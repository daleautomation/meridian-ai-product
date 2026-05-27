/**
 * check-opportunity-scoring — validator for Property Intelligence v1
 * Commit 2 (opportunity scoring model).
 *
 * Covers every WEIGHTS factor (applied + skipped paths), tier caps,
 * stale-listing decay, score arithmetic, provenance requirements,
 * determinism, and the banned-phrase scan. Pure-function validator —
 * no DB, no env, no external calls.
 */

import {
  scoreContactOpportunity,
  WEIGHTS,
} from "@/lib/enrichment/opportunity/scoreOpportunity";
import { classifyRelationshipType } from "@/lib/enrichment/opportunity/relationshipType";
import type {
  OpportunityScoringInput,
  OpportunitySignal,
  OpportunityFactorName,
} from "@/lib/enrichment/opportunity/types";

const failures: string[] = [];
function fail(msg: string): void {
  failures.push(msg);
}

const FIXED_NOW = new Date("2026-05-27T12:00:00.000Z");

// ── Banned-phrase scan (extends the global Meridian set) ──────────

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
      fail(`${where}: banned phrase /${re.source}/ in "${s.slice(0, 100)}"`);
    }
  }
}

function assertSignalClean(s: OpportunitySignal): void {
  assertCleanString(s.contactName, `signal[${s.contactId}].contactName`);
  assertCleanString(s.relationshipTypeSource, `signal[${s.contactId}].relationshipTypeSource`);
  if (s.listingAgentName) assertCleanString(s.listingAgentName, `signal[${s.contactId}].listingAgentName`);
  if (s.matchedPropertyAddress)
    assertCleanString(s.matchedPropertyAddress, `signal[${s.contactId}].matchedPropertyAddress`);
  for (const f of s.priorityFactors) {
    assertCleanString(f.evidenceLabel, `signal[${s.contactId}].factor[${f.name}].evidenceLabel`);
    assertCleanString(f.source, `signal[${s.contactId}].factor[${f.name}].source`);
  }
  for (const u of s.uncertaintyReasons) {
    if (u.detail) assertCleanString(u.detail, `signal[${s.contactId}].uncertainty[${u.code}].detail`);
  }
}

// ── Test input factory ───────────────────────────────────────────

function makeInput(overrides: Partial<OpportunityScoringInput> = {}): OpportunityScoringInput {
  return {
    contactId: "fixture-1",
    contactName: "Test Contact",
    relationshipType: "unknown",
    relationshipTypeSource: "crm:none",
    operatorSellerBias: 0,
    matchedPropertyAddress: null,
    parcelId: null,
    ownerName: null,
    ownerMatchConfidence: null,
    ownershipDurationYears: null,
    lastSaleDate: null,
    publicRecordSource: null,
    currentListingStatus: "unknown",
    listingAgentName: null,
    listingAgentMatch: "unknown",
    listingSource: null,
    listingObservedAt: null,
    hasActionableChannel: true,
    contactPathSource: "crm:email",
    lastInteractionAt: null,
    now: FIXED_NOW,
    ...overrides,
  };
}

function getFactor(s: OpportunitySignal, name: OpportunityFactorName) {
  return s.priorityFactors.find((f) => f.name === name);
}

// ── Universal invariants run after every fixture ─────────────────

function assertUniversalInvariants(label: string, s: OpportunitySignal): void {
  // Every factor appears in priorityFactors (closed set of 8).
  const expectedFactorNames: OpportunityFactorName[] = [
    "prior_seller_relationship",
    "prior_buyer_relationship",
    "operator_preference_seller_bias",
    "active_listing_found",
    "listed_by_another_agent",
    "ownership_duration_over_7yr",
    "stale_relationship_over_12mo",
    "verified_contact_path",
  ];
  for (const name of expectedFactorNames) {
    if (!s.priorityFactors.find((f) => f.name === name)) {
      fail(`${label}: priorityFactors missing ${name}`);
    }
  }
  if (s.priorityFactors.length !== expectedFactorNames.length) {
    fail(
      `${label}: priorityFactors length expected ${expectedFactorNames.length}, got ${s.priorityFactors.length}`,
    );
  }

  // transparentPriorityScore must equal sum of applied weights.
  const sum = s.priorityFactors.reduce(
    (acc, f) => acc + (f.applied ? f.weight : 0),
    0,
  );
  if (sum !== s.transparentPriorityScore) {
    fail(
      `${label}: transparentPriorityScore=${s.transparentPriorityScore} does not equal sum of applied weights=${sum}`,
    );
  }

  // Every applied factor has a non-empty source.
  for (const f of s.priorityFactors) {
    if (f.applied && f.source.trim().length === 0) {
      fail(`${label}: applied factor ${f.name} has empty source`);
    }
  }

  // Skipped + decayed factors contribute 0.
  for (const f of s.priorityFactors) {
    if (!f.applied) {
      // Sum-check above already proves the contribution is 0, but assert
      // the data shape too.
      if (f.decayed === true && f.weight === 0) {
        fail(`${label}: decayed factor ${f.name} has zero weight (should record canonical weight even when decayed)`);
      }
    }
  }

  // revenueOpportunitySignals matches the applied subset.
  const expectedSignals = s.priorityFactors
    .filter((f) => f.applied)
    .map((f) => f.name);
  if (
    JSON.stringify(s.revenueOpportunitySignals) !== JSON.stringify(expectedSignals)
  ) {
    fail(
      `${label}: revenueOpportunitySignals does not match applied factor names`,
    );
  }

  // uncertaintyReasons is always an array (may be empty).
  if (!Array.isArray(s.uncertaintyReasons)) {
    fail(`${label}: uncertaintyReasons must be an array`);
  }

  // Provenance fields populated.
  if (s.source !== "meridian_opportunity_v1") {
    fail(`${label}: source must be "meridian_opportunity_v1"`);
  }
  if (!s.fetchedAt) {
    fail(`${label}: fetchedAt must be set`);
  }

  // Banned-phrase scan.
  assertSignalClean(s);
}

// ── Fixtures ─────────────────────────────────────────────────────

function runFactorAppliedFixtures(): void {
  // 1. prior_seller_relationship applied
  {
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
      }),
    );
    assertUniversalInvariants("F1 prior_seller_applied", s);
    const f = getFactor(s, "prior_seller_relationship");
    if (!f?.applied) fail("F1: prior_seller_relationship should be applied");
    if (f && f.weight !== WEIGHTS.prior_seller_relationship)
      fail("F1: weight mismatch");
  }

  // 2. prior_seller skipped path
  {
    const s = scoreContactOpportunity(makeInput({ relationshipType: "unknown" }));
    assertUniversalInvariants("F2 prior_seller_skipped", s);
    if (getFactor(s, "prior_seller_relationship")?.applied)
      fail("F2: prior_seller should NOT be applied");
  }

  // 3. prior_buyer applied
  {
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_buyer",
        relationshipTypeSource: "crm:tag:Buyer",
      }),
    );
    assertUniversalInvariants("F3 prior_buyer_applied", s);
    if (!getFactor(s, "prior_buyer_relationship")?.applied)
      fail("F3: prior_buyer should be applied");
  }

  // 4. operator_preference_seller_bias applied (seller + sellerBias > 0)
  {
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
        operatorSellerBias: 15,
      }),
    );
    assertUniversalInvariants("F4 seller_bias_applied", s);
    const f = getFactor(s, "operator_preference_seller_bias");
    if (!f?.applied) fail("F4: seller_bias should be applied");
    if (f && f.weight !== 15) fail("F4: bias weight should equal 15");
    if (s.operatorPreferenceWeight !== 15)
      fail(`F4: operatorPreferenceWeight expected 15, got ${s.operatorPreferenceWeight}`);
  }

  // 5. operator_preference_seller_bias skipped when sellerBias=0
  {
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        operatorSellerBias: 0,
      }),
    );
    assertUniversalInvariants("F5 seller_bias_skipped_zero", s);
    if (getFactor(s, "operator_preference_seller_bias")?.applied)
      fail("F5: seller_bias should NOT apply when bias is 0");
  }

  // 6. operator_preference_seller_bias skipped when not prior_seller
  {
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_buyer",
        operatorSellerBias: 15,
      }),
    );
    assertUniversalInvariants("F6 seller_bias_skipped_buyer", s);
    if (getFactor(s, "operator_preference_seller_bias")?.applied)
      fail("F6: seller_bias should NOT apply to prior_buyer");
  }

  // 7. active_listing_found applied (fresh active listing)
  {
    const recent = new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        currentListingStatus: "active",
        listingObservedAt: recent,
        listingSource: "heartland_mls_export",
      }),
    );
    assertUniversalInvariants("F7 active_listing_applied", s);
    if (!getFactor(s, "active_listing_found")?.applied)
      fail("F7: active_listing_found should be applied");
  }

  // 8. active_listing_found decayed (stale > 60 days)
  {
    const old = new Date(FIXED_NOW.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        currentListingStatus: "active",
        listingObservedAt: old,
        listingSource: "heartland_mls_export",
      }),
    );
    assertUniversalInvariants("F8 active_listing_decayed", s);
    const f = getFactor(s, "active_listing_found");
    if (f?.applied) fail("F8: active_listing should NOT be applied for stale listing");
    if (!f?.decayed) fail("F8: active_listing should be marked decayed");
    // Score contribution must be 0
    if (s.transparentPriorityScore !== WEIGHTS.verified_contact_path)
      fail(`F8: decayed listing must contribute 0 to score; expected ${WEIGHTS.verified_contact_path}, got ${s.transparentPriorityScore}`);
    if (!s.uncertaintyReasons.some((u) => u.code === "stale_listing"))
      fail("F8: stale_listing uncertainty should be recorded");
  }

  // 9. listed_by_another_agent applied (with fresh active listing)
  {
    const recent = new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        currentListingStatus: "active",
        listingObservedAt: recent,
        listingSource: "heartland_mls_export",
        listingAgentMatch: "other_agent",
        listingAgentName: "Sarah Brown",
      }),
    );
    assertUniversalInvariants("F9 listed_by_other_applied", s);
    if (!getFactor(s, "listed_by_another_agent")?.applied)
      fail("F9: listed_by_another_agent should be applied");
  }

  // 10. listed_by_another_agent GATED when no active listing
  {
    const recent = new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        currentListingStatus: "off_market",
        listingObservedAt: recent,
        listingSource: "heartland_mls_export",
        listingAgentMatch: "other_agent",
      }),
    );
    assertUniversalInvariants("F10 listed_by_other_gated", s);
    if (getFactor(s, "listed_by_another_agent")?.applied)
      fail("F10: listed_by_another_agent should NOT apply when no active listing");
  }

  // 11. listed_by_another_agent decayed when listing is stale
  {
    const old = new Date(FIXED_NOW.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        currentListingStatus: "active",
        listingObservedAt: old,
        listingSource: "heartland_mls_export",
        listingAgentMatch: "other_agent",
      }),
    );
    assertUniversalInvariants("F11 listed_by_other_decayed", s);
    const f = getFactor(s, "listed_by_another_agent");
    if (f?.applied) fail("F11: listed_by_another_agent should not apply with stale listing");
    if (!f?.decayed) fail("F11: listed_by_another_agent should be marked decayed");
  }

  // 12. ownership_duration_over_7yr applied
  {
    const s = scoreContactOpportunity(
      makeInput({
        ownershipDurationYears: 14,
        publicRecordSource: "jackson_county_mo 2026-01-15",
      }),
    );
    assertUniversalInvariants("F12 ownership_dur_applied", s);
    if (!getFactor(s, "ownership_duration_over_7yr")?.applied)
      fail("F12: ownership_duration_over_7yr should be applied");
  }

  // 13. ownership_duration_over_7yr NOT applied below threshold
  {
    const s = scoreContactOpportunity(
      makeInput({ ownershipDurationYears: 3, publicRecordSource: "x" }),
    );
    assertUniversalInvariants("F13 ownership_dur_under", s);
    if (getFactor(s, "ownership_duration_over_7yr")?.applied)
      fail("F13: ownership_duration_over_7yr should NOT apply at 3 years");
  }

  // 14. stale_relationship_over_12mo applied
  {
    const old = new Date(FIXED_NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(makeInput({ lastInteractionAt: old }));
    assertUniversalInvariants("F14 stale_relationship_applied", s);
    if (!getFactor(s, "stale_relationship_over_12mo")?.applied)
      fail("F14: stale_relationship_over_12mo should be applied at 400 days");
  }

  // 15. stale_relationship_over_12mo NOT applied at 200 days
  {
    const recent = new Date(FIXED_NOW.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(makeInput({ lastInteractionAt: recent }));
    assertUniversalInvariants("F15 stale_relationship_recent", s);
    if (getFactor(s, "stale_relationship_over_12mo")?.applied)
      fail("F15: stale_relationship_over_12mo should NOT apply at 200 days");
  }

  // 16. verified_contact_path applied (default has actionable channel)
  {
    const s = scoreContactOpportunity(makeInput({}));
    assertUniversalInvariants("F16 verified_contact_applied", s);
    if (!getFactor(s, "verified_contact_path")?.applied)
      fail("F16: verified_contact_path should be applied when hasActionableChannel=true");
  }

  // 17. verified_contact_path NOT applied when no channel
  {
    const s = scoreContactOpportunity(
      makeInput({ hasActionableChannel: false, contactPathSource: null }),
    );
    assertUniversalInvariants("F17 verified_contact_skipped", s);
    if (getFactor(s, "verified_contact_path")?.applied)
      fail("F17: verified_contact_path should NOT apply when no channel");
  }
}

function runScoreDeltaFixtures(): void {
  // 18. Seller vs Buyer score delta — same data otherwise, seller should
  // score higher by (30 - 10 + 15-bias) = +35.
  {
    const seller = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
        operatorSellerBias: 15,
      }),
    );
    const buyer = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_buyer",
        relationshipTypeSource: "crm:tag:Buyer",
        operatorSellerBias: 15,
      }),
    );
    assertUniversalInvariants("F18a seller", seller);
    assertUniversalInvariants("F18b buyer", buyer);
    const expectedDelta = WEIGHTS.prior_seller_relationship + 15 - WEIGHTS.prior_buyer_relationship;
    const actualDelta = seller.transparentPriorityScore - buyer.transparentPriorityScore;
    if (actualDelta !== expectedDelta) {
      fail(`F18: seller-vs-buyer delta expected ${expectedDelta}, got ${actualDelta}`);
    }
    // Seller MUST rank higher.
    if (seller.transparentPriorityScore <= buyer.transparentPriorityScore) {
      fail("F18: seller score must be strictly greater than buyer score");
    }
  }
}

function runTierResolutionFixtures(): void {
  // 19. HIGH tier from score >= 70
  {
    const recent = new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(FIXED_NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
        operatorSellerBias: 15,
        currentListingStatus: "active",
        listingObservedAt: recent,
        listingSource: "heartland_mls_export",
        listingAgentMatch: "other_agent",
        ownershipDurationYears: 14,
        publicRecordSource: "jackson_county_mo",
        lastInteractionAt: old,
        ownerMatchConfidence: "HIGH",
      }),
    );
    assertUniversalInvariants("F19 HIGH tier", s);
    if (s.priorityTier !== "HIGH")
      fail(`F19: expected HIGH tier, got ${s.priorityTier} (score=${s.transparentPriorityScore})`);
    // Sanity: score should be 30 + 15 + 35 + 25 + 15 + 10 + 10 = 140
    if (s.transparentPriorityScore !== 140)
      fail(`F19: expected score 140, got ${s.transparentPriorityScore}`);
    if (s.tierCapReason !== null) fail("F19: no cap should apply");
  }

  // 20. MED tier (40 <= score < 70)
  {
    const old = new Date(FIXED_NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
        operatorSellerBias: 15,
        // No active listing, no ownership data
        lastInteractionAt: old, // +10 stale
      }),
    );
    assertUniversalInvariants("F20 MED tier", s);
    // 30 + 15 + 10 + 10 = 65
    if (s.transparentPriorityScore !== 65)
      fail(`F20: expected score 65, got ${s.transparentPriorityScore}`);
    if (s.priorityTier !== "MED")
      fail(`F20: expected MED tier, got ${s.priorityTier}`);
  }

  // 21. WEAK tier (score < 40, no caps)
  {
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "unknown",
        // Only verified contact path applies = 10
      }),
    );
    assertUniversalInvariants("F21 WEAK tier by score", s);
    if (s.priorityTier !== "WEAK")
      fail(`F21: expected WEAK tier, got ${s.priorityTier}`);
    if (s.tierCapReason !== null) fail("F21: WEAK from score should have no cap reason");
  }

  // 22. Weak owner match → REVIEW cap (high score)
  {
    const recent = new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
        operatorSellerBias: 15,
        currentListingStatus: "active",
        listingObservedAt: recent,
        listingSource: "heartland_mls_export",
        listingAgentMatch: "other_agent",
        ownershipDurationYears: 14,
        publicRecordSource: "jackson_county_mo",
        ownerMatchConfidence: "WEAK",
      }),
    );
    assertUniversalInvariants("F22 REVIEW cap", s);
    if (s.priorityTier !== "REVIEW")
      fail(`F22: expected REVIEW tier (weak owner match cap), got ${s.priorityTier}`);
    if (s.tierCapReason !== "weak_owner_match")
      fail(`F22: tierCapReason expected "weak_owner_match", got ${s.tierCapReason}`);
    if (!s.uncertaintyReasons.some((u) => u.code === "owner_match_weak"))
      fail("F22: uncertainty owner_match_weak should be recorded");
  }

  // 23. No actionable channel → WEAK cap
  {
    const old = new Date(FIXED_NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
        operatorSellerBias: 15,
        ownershipDurationYears: 14,
        publicRecordSource: "jackson_county_mo",
        lastInteractionAt: old,
        hasActionableChannel: false,
        contactPathSource: null,
      }),
    );
    assertUniversalInvariants("F23 WEAK cap by no channel", s);
    if (s.priorityTier !== "WEAK")
      fail(`F23: expected WEAK tier (no-channel cap), got ${s.priorityTier}`);
    if (s.tierCapReason !== "no_actionable_channel")
      fail(`F23: tierCapReason expected "no_actionable_channel", got ${s.tierCapReason}`);
  }

  // 24. Both caps fire → WEAK wins (lower rank)
  {
    const recent = new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const s = scoreContactOpportunity(
      makeInput({
        relationshipType: "prior_seller",
        relationshipTypeSource: "crm:tag:Seller",
        operatorSellerBias: 15,
        currentListingStatus: "active",
        listingObservedAt: recent,
        listingSource: "heartland_mls_export",
        listingAgentMatch: "other_agent",
        ownerMatchConfidence: "WEAK",
        hasActionableChannel: false,
        contactPathSource: null,
      }),
    );
    assertUniversalInvariants("F24 caps compose — WEAK wins", s);
    if (s.priorityTier !== "WEAK")
      fail(`F24: expected WEAK tier (both caps, WEAK<REVIEW), got ${s.priorityTier}`);
    if (s.tierCapReason !== "no_actionable_channel")
      fail(`F24: tierCapReason expected "no_actionable_channel" (lower-rank cap wins), got ${s.tierCapReason}`);
  }
}

function runUncertaintyFixtures(): void {
  // 25. no_listing_source_loaded + no_public_record_source_loaded
  {
    const s = scoreContactOpportunity(makeInput({}));
    assertUniversalInvariants("F25 no sources loaded", s);
    if (!s.uncertaintyReasons.some((u) => u.code === "no_listing_source_loaded"))
      fail("F25: no_listing_source_loaded should be present");
    if (!s.uncertaintyReasons.some((u) => u.code === "no_public_record_source_loaded"))
      fail("F25: no_public_record_source_loaded should be present");
  }

  // 26. owner_match_missing (matched property but no owner-match confidence)
  {
    const s = scoreContactOpportunity(
      makeInput({
        matchedPropertyAddress: "100 Main St, KC, MO 64108",
        publicRecordSource: "jackson_county_mo",
        ownerMatchConfidence: null,
      }),
    );
    assertUniversalInvariants("F26 owner_match_missing", s);
    if (!s.uncertaintyReasons.some((u) => u.code === "owner_match_missing"))
      fail("F26: owner_match_missing should be recorded when matchedProperty present but ownerMatch null");
  }
}

function runRelationshipClassifierFixtures(): void {
  // 27. Seller beats buyer when both tags present
  {
    const r = classifyRelationshipType(["Buyer", "Seller"]);
    if (r.relationshipType !== "prior_seller")
      fail(`F27: seller should win over buyer; got ${r.relationshipType}`);
    if (!r.relationshipTypeSource.startsWith("crm:tag:"))
      fail(`F27: relationshipTypeSource should cite the tag`);
  }
  // 28. Buyer-only
  {
    const r = classifyRelationshipType(["Buyer"]);
    if (r.relationshipType !== "prior_buyer") fail("F28: buyer expected");
  }
  // 29. Sphere when no transaction tag
  {
    const r = classifyRelationshipType(["sphere", "Past Buyer"]);
    if (r.relationshipType !== "prior_buyer")
      fail("F29: Past Buyer should beat sphere (transaction-style precedence)");
  }
  // 30. Sphere alone
  {
    const r = classifyRelationshipType(["center of influence"]);
    if (r.relationshipType !== "sphere") fail("F30: sphere expected");
  }
  // 31. Referral
  {
    const r = classifyRelationshipType(["Referral Source"]);
    if (r.relationshipType !== "referral") fail("F31: referral expected");
  }
  // 32. Empty
  {
    const r = classifyRelationshipType([]);
    if (r.relationshipType !== "unknown") fail("F32: unknown expected");
    if (r.relationshipTypeSource !== "crm:none") fail("F32: source crm:none expected");
  }
  // 33. Null/undefined
  {
    const r = classifyRelationshipType(null);
    if (r.relationshipType !== "unknown") fail("F33: unknown expected on null");
  }
}

function runDeterminismFixture(): void {
  // 34. Determinism — identical input produces byte-identical output
  const input = makeInput({
    relationshipType: "prior_seller",
    relationshipTypeSource: "crm:tag:Seller",
    operatorSellerBias: 15,
    currentListingStatus: "active",
    listingObservedAt: new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    listingSource: "heartland_mls_export",
    listingAgentMatch: "other_agent",
    listingAgentName: "Sarah Brown",
    ownershipDurationYears: 14,
    publicRecordSource: "jackson_county_mo",
    ownerMatchConfidence: "HIGH",
    lastInteractionAt: new Date(FIXED_NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const a = scoreContactOpportunity(input);
  const b = scoreContactOpportunity(input);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail("F34: scoreContactOpportunity not deterministic across two calls");
  }
}

function runFixtures(): void {
  runFactorAppliedFixtures();
  runScoreDeltaFixtures();
  runTierResolutionFixtures();
  runUncertaintyFixtures();
  runRelationshipClassifierFixtures();
  runDeterminismFixture();
}

function main(): void {
  runFixtures();

  if (failures.length > 0) {
    console.error("");
    console.error("check-opportunity-scoring FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-opportunity-scoring passed", {
    fixtures: 34,
    checks: [
      "prior_seller_relationship applied/skipped paths",
      "prior_buyer_relationship applied path",
      "operator_preference_seller_bias applied (+15) when seller AND bias>0",
      "operator_preference_seller_bias skipped when bias=0 OR not seller",
      "active_listing_found applied (fresh)",
      "active_listing_found decayed (stale >60 days) — contributes 0",
      "listed_by_another_agent applied (with fresh active listing + other_agent match)",
      "listed_by_another_agent gated when no active listing",
      "listed_by_another_agent decayed with stale listing",
      "ownership_duration_over_7yr applied at 14yr, skipped at 3yr",
      "stale_relationship_over_12mo applied at 400 days, skipped at 200 days",
      "verified_contact_path applied/skipped",
      "seller vs buyer score delta = +30 +15 -10 = +35",
      "HIGH tier when score >= 70 and no caps",
      "MED tier when 40 <= score < 70",
      "WEAK tier when score < 40 and no caps",
      "REVIEW cap fires on weak owner match (tier capped regardless of score)",
      "WEAK cap fires on no actionable channel",
      "Caps compose: when both fire, lower-rank WEAK wins",
      "tierCapReason names the binding cap",
      "uncertaintyReasons include no_listing_source_loaded + no_public_record_source_loaded by default",
      "uncertaintyReasons include owner_match_missing when matched property + null confidence",
      "uncertaintyReasons include stale_listing when listing > 60 days old",
      "every factor appears in priorityFactors (closed set of 8)",
      "transparentPriorityScore equals sum of applied weights",
      "every applied factor has non-empty source",
      "decayed factor's contribution to score is 0",
      "revenueOpportunitySignals matches applied factor names",
      "classifyRelationshipType: seller beats buyer (both tags present)",
      "classifyRelationshipType: transaction-style tag beats sphere/referral",
      "classifyRelationshipType: empty/null returns unknown + crm:none source",
      "determinism: identical input produces byte-identical OpportunitySignal",
      "banned-phrase scan clean (high seller intent / likely motivated / ready to transact / AI believes / hot|warm|cold lead)",
    ],
  });
}

main();
