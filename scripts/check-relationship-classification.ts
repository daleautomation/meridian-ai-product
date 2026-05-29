// Meridian — relationship classification rules check.
//
// Locks the CRM-only relationship taxonomy that replaces opportunity
// scoring for contacts with no market evidence.

import {
  classifyRelationship,
  type RelationshipClassificationInput,
} from "../lib/enrichment/opportunity/relationshipClassification";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const NOW = new Date("2026-05-29T00:00:00.000Z");
const base = (o: Partial<RelationshipClassificationInput>): RelationshipClassificationInput => ({
  tags: [], hasPhone: true, hasEmail: true, lastInteractionAt: null, now: NOW, ...o,
});

function main() {
  // 1. Not reachable gates everything — even a seller.
  const nr = classifyRelationship(base({ tags: ["Seller"], hasPhone: false, hasEmail: false }));
  assert(nr.label === "not_reachable", `expected not_reachable, got ${nr.label}`);
  assert(nr.reachable === false, "not_reachable must report reachable=false");

  // 2. Seller + reachable + last-contact date → Past Seller Reconnect.
  const psr = classifyRelationship(base({ tags: ["Buyer", "Seller"], lastInteractionAt: "2023-12-15T06:00:00.000Z" }));
  assert(psr.label === "past_seller_reconnect", `expected past_seller_reconnect, got ${psr.label}`);
  assert(psr.staleDays !== null && psr.staleDays > 365, "stale days should be computed");
  assert(psr.confidence === "medium", "past_seller_reconnect confidence should be medium");

  // 3. Seller + reachable + NO date → Seller History (Verify Recency).
  const shv = classifyRelationship(base({ tags: ["Seller"], lastInteractionAt: null }));
  assert(shv.label === "seller_history_verify_recency", `expected seller_history_verify_recency, got ${shv.label}`);
  assert(shv.confidence === "low", "verify-recency confidence should be low");

  // 4. Buyer (no seller) → Sphere Reengagement.
  const sphereB = classifyRelationship(base({ tags: ["Buyer"], lastInteractionAt: "2024-01-01T00:00:00.000Z" }));
  assert(sphereB.label === "sphere_reengagement", `expected sphere_reengagement, got ${sphereB.label}`);

  // 5. Center of influence (no seller) → Sphere Reengagement.
  const sphereC = classifyRelationship(base({ tags: ["center of influence"] }));
  assert(sphereC.label === "sphere_reengagement", `expected sphere_reengagement, got ${sphereC.label}`);

  // 6. Reachable, no strong tag → Cold Relationship.
  const cold = classifyRelationship(base({ tags: ["iphone", "myContacts"] }));
  assert(cold.label === "cold_relationship", `expected cold_relationship, got ${cold.label}`);

  // 7. Seller wins over buyer when both tags present.
  const both = classifyRelationship(base({ tags: ["Buyer", "Seller"], lastInteractionAt: "2023-01-01T00:00:00.000Z" }));
  assert(both.label === "past_seller_reconnect", "seller must win over buyer");

  // 8. NEVER emits opportunity/market language.
  const forbidden = /opportunity|hot lead|seller signal/i;
  for (const c of [nr, psr, shv, sphereB, sphereC, cold]) {
    assert(!forbidden.test(c.displayLabel), `label must not use market language: ${c.displayLabel}`);
    for (const r of c.reasons) assert(!forbidden.test(r), `reason must not use market language: ${r}`);
  }

  console.log("✓ relationship-classification check passed (5 labels, reachability gate, no market language)");
}

main();
