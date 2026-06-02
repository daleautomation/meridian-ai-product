// Meridian — Operations Center status-model check.
//
// Locks the pure aggregation logic: outcome→status mapping, deployment
// posture, and overall severity rollup. No I/O.

import {
  OPS_CHECKS,
  classifyOverall,
  deploymentStatus,
  parseCrmAuditVerdict,
  resolveCheckStatus,
  summarizeCounts,
  type OpsCheckResult,
} from "../lib/ops/opsCenter";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function r(status: OpsCheckResult["status"]): OpsCheckResult {
  return { id: "x", label: "x", category: "import", outcome: "PASS", status, detail: "" };
}

function main() {
  // 1. Catalog references only existing-style npm scripts (non-empty), no dup ids.
  const ids = new Set<string>();
  for (const c of OPS_CHECKS) {
    assert(!ids.has(c.id), `duplicate check id ${c.id}`);
    ids.add(c.id);
    assert(c.npmScript === null || c.npmScript.length > 0, `${c.id} has empty npmScript`);
  }

  // 2. Outcome → status mapping.
  const blockingDef = { id: "b", label: "b", npmScript: "x", category: "import" as const, onFail: "BLOCKING" as const };
  const reviewDef = { id: "r", label: "r", npmScript: "x", category: "import" as const, onFail: "REVIEW" as const };
  assert(resolveCheckStatus(blockingDef, "PASS") === "HEALTHY", "PASS → HEALTHY");
  assert(resolveCheckStatus(blockingDef, "FAIL") === "BLOCKING", "FAIL(blocking) → BLOCKING");
  assert(resolveCheckStatus(reviewDef, "FAIL") === "REVIEW", "FAIL(review) → REVIEW");
  assert(resolveCheckStatus(reviewDef, "NEEDS_CONFIG") === "REVIEW", "NEEDS_CONFIG → REVIEW");
  assert(resolveCheckStatus(blockingDef, "SKIPPED") === "REVIEW", "SKIPPED → REVIEW (not false HEALTHY)");

  // 3. Deployment posture.
  assert(deploymentStatus({ ciConfigured: true, productionTracksMain: true }) === "HEALTHY", "clean deploy → HEALTHY");
  assert(deploymentStatus({ ciConfigured: false, productionTracksMain: true }) === "REVIEW", "no CI → REVIEW");
  assert(deploymentStatus({ ciConfigured: true, productionTracksMain: false }) === "REVIEW", "branch prod → REVIEW");

  // 4. Overall = worst severity (checks + deployment).
  assert(classifyOverall([r("HEALTHY"), r("HEALTHY")], "HEALTHY") === "HEALTHY", "all healthy");
  assert(classifyOverall([r("HEALTHY"), r("REVIEW")], "HEALTHY") === "REVIEW", "one review → REVIEW");
  assert(classifyOverall([r("REVIEW"), r("BLOCKING")], "REVIEW") === "BLOCKING", "one blocking → BLOCKING");
  assert(classifyOverall([r("HEALTHY")], "REVIEW") === "REVIEW", "deployment review lifts overall");

  // 5. Counts.
  const counts = summarizeCounts([r("BLOCKING"), r("REVIEW"), r("HEALTHY"), r("HEALTHY")], "HEALTHY");
  assert(counts.blocking === 1 && counts.review === 1 && counts.healthy === 3, `counts wrong: ${JSON.stringify(counts)}`);

  // 6. Live Workspace Truth — crm:audit verdict parser (fail-safe to REVIEW).
  const clean = parseCrmAuditVerdict("Founder verdict\n  ✓ No blocking issues detected. Workspace is paid-customer ready from a data-integrity standpoint.\n");
  assert(clean.status === "HEALTHY", `clean verdict → HEALTHY, got ${clean.status}`);

  const blocking = parseCrmAuditVerdict("Founder verdict\n  • BLOCKING: 3 contacts still render \"Greg · Greg\".\n");
  assert(blocking.status === "BLOCKING", `Greg·Greg → BLOCKING, got ${blocking.status}`);

  // Integrity: blank name must reach the board as BLOCKING.
  const blank = parseCrmAuditVerdict("Founder verdict\n  • BLOCKING: 2 contacts have a blank name — import-integrity violation.\n");
  assert(blank.status === "BLOCKING", `blank name → BLOCKING, got ${blank.status}`);

  // Completeness: no actionable channel is now REVIEW, not BLOCKING.
  const noChannel = parseCrmAuditVerdict("Founder verdict\n  • REVIEW: 3 contacts have no actionable channel — completeness gap; relationship layer gates these as \"Not Reachable\".\n");
  assert(noChannel.status === "REVIEW", `no-actionable-channel → REVIEW, got ${noChannel.status}`);

  const weak = parseCrmAuditVerdict("Founder verdict\n  • MAJORITY-WEAK workspace: 60 of 105 rows are WEAK tier.\n");
  assert(weak.status === "REVIEW", `majority-weak → REVIEW, got ${weak.status}`);

  const advisory = parseCrmAuditVerdict("Founder verdict\n  • Hunter cannot be run usefully here — 0 eligible rows.\n");
  assert(advisory.status === "REVIEW", `advisory-only → REVIEW, got ${advisory.status}`);

  const empty = parseCrmAuditVerdict("crm:audit nicole-lonergan\n  No contacts found for this workspace.\n");
  assert(empty.status === "REVIEW", `no contacts → REVIEW, got ${empty.status}`);

  const garbage = parseCrmAuditVerdict("totally unexpected output");
  assert(garbage.status === "REVIEW", `unrecognized → REVIEW (fail-safe), got ${garbage.status}`);
  assert(garbage.status !== "HEALTHY", "unrecognized must NEVER be HEALTHY");

  // Blocking takes precedence over advisory bullets in the same verdict.
  const mixed = parseCrmAuditVerdict("Founder verdict\n  • BLOCKING: 3 Greg·Greg rows.\n  • Hunter cannot be run usefully here.\n");
  assert(mixed.status === "BLOCKING", `mixed verdict → BLOCKING wins, got ${mixed.status}`);

  console.log("✓ ops-center check passed (status model + crm:audit verdict parser, fail-safe to REVIEW)");
}

main();
