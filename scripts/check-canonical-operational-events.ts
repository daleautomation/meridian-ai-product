import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalOperationalEventFixtures } from "@/fixtures/operational-events/canonical-operational-event-fixtures";
import type { CanonicalOperationalEventEnvelope } from "@/lib/relationship-engine/operational/events";

const eventModuleSource = readFileSync("lib/relationship-engine/operational/events.ts", "utf8");
const replayOrdered = [...canonicalOperationalEventFixtures].reverse().sort(compareOperationalEvents);
const duplicateReview = { ...canonicalOperationalEventFixtures[0] } satisfies CanonicalOperationalEventEnvelope;
const deduped = new Map<string, CanonicalOperationalEventEnvelope>();

for (const event of [canonicalOperationalEventFixtures[0], duplicateReview]) {
  deduped.set(event.idempotency.dedupeKey, event);
}

assert.deepEqual(
  replayOrdered.map((event) => event.id),
  [...canonicalOperationalEventFixtures].sort(compareOperationalEvents).map((event) => event.id),
  "operational event replay ordering must be deterministic under reversed inputs",
);
assert.equal(deduped.size, 1, "exact duplicate operational events must collapse by dedupe key");

for (const event of replayOrdered) {
  assert.equal(event.appendOnly.mutationSemanticsAllowed, false);
  assert.equal(event.appendOnly.overwriteSemanticsAllowed, false);
  assert.equal(event.boundary.persistenceAllowed, false);
  assert.equal(event.boundary.neonWritesAllowed, false);
  assert.equal(event.boundary.automationAllowed, false);
  assert.equal(event.boundary.queueExecutionAllowed, false);
  assert.equal(event.boundary.workflowExecutionAllowed, false);
  assert.equal(event.boundary.inferredReviewCompletionAllowed, false);
  assert.equal(event.boundary.uiDerivedWorkflowMemoryAllowed, false);
  assert.equal(event.boundary.projectionCacheCanonicalAllowed, false);
  assert.ok(event.explainability.evidence.length > 0);
  assert.ok(event.explainability.reasonCodes.length > 0);
  assert.ok(event.explainability.confidence.rationale);
  assert.ok(event.metadata.actor.actorId);
  assert.ok(event.metadata.source);
}

assert.equal(
  /from\s+["'][^"']*(?:\/repositories|relationship-engine\/repositories)[^"']*["']/.test(eventModuleSource),
  false,
  "operational event contracts must not import repositories",
);
assert.equal(
  /\b(?:executeQueue|sendNotification|createReminder|writeOperatorSnapshot|neonWrite|getNeonSql|neon)\s*\(|method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/i.test(eventModuleSource),
  false,
  "operational event contracts must not add write or automation paths",
);

console.log("canonical operational event envelope check passed", {
  families: [...new Set(replayOrdered.map((event) => event.family))],
  replayOrder: replayOrdered.map((event) => event.id),
  dedupedEvents: deduped.size,
  persistenceAllowed: replayOrdered.some((event) => event.boundary.persistenceAllowed),
  automationAllowed: replayOrdered.some((event) => event.boundary.automationAllowed),
});

function compareOperationalEvents(a: CanonicalOperationalEventEnvelope, b: CanonicalOperationalEventEnvelope): number {
  const occurred = a.ordering.occurredAt.localeCompare(b.ordering.occurredAt);
  if (occurred !== 0) return occurred;
  const recorded = a.ordering.recordedAt.localeCompare(b.ordering.recordedAt);
  if (recorded !== 0) return recorded;
  const family = a.ordering.familyRank - b.ordering.familyRank;
  if (family !== 0) return family;
  const kind = a.ordering.kindRank - b.ordering.kindRank;
  if (kind !== 0) return kind;
  return a.ordering.eventIdTieBreaker.localeCompare(b.ordering.eventIdTieBreaker);
}
