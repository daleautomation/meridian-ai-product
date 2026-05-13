import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TENANTS, toPublicUser } from "@/config/tenants";
import { WORKSPACES } from "@/config/workspaces";
import { buildRelationshipEngineOperatorSurface } from "@/lib/relationship-engine/operatorIntegration";

const now = "2026-05-13T18:20:00.000Z";

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const workspace = WORKSPACES.labortech;
  const admin = toPublicUser(TENANTS.dylan);
  const client = toPublicUser(TENANTS.labortech);

  const adminSurface = await buildRelationshipEngineOperatorSurface({ workspace, user: admin, now });
  assert.equal(adminSurface.kind, "relationship_engine_operator_surface");
  assert.equal(adminSurface.status, "ready");
  assert.equal(adminSurface.boundary.repositoriesAllowed, false);
  assert.equal(adminSurface.boundary.writesAllowed, false);
  assert.equal(adminSurface.boundary.queueExecutionAllowed, false);
  assert.equal(adminSurface.boundary.automationAllowed, false);
  assert.equal(adminSurface.health.readOnlyGuarantees.notifications, false);
  assert.equal(adminSurface.health.readOnlyGuarantees.neonWrites, false);
  assert.equal(adminSurface.health.readOnlyGuarantees.productionScoring, false);
  assert.equal(adminSurface.metadata.deterministic.replaySafeWithFixedAsOf, true);
  assert.deepEqual(adminSurface.metadata.deterministic.collectionOrder.queues, [
    "needs_attention",
    "overdue_follow_ups",
    "cooling_relationships",
    "retention_risk",
    "warm_opportunities",
    "reactivation_candidates",
  ]);
  assert.equal(adminSurface.queues.length, 6);
  assert.equal(adminSurface.access.adminDiagnosticsVisible, true);
  assert.ok(adminSurface.adminDiagnostics, "admin users should receive safe admin diagnostics metadata");

  const clientSurface = await buildRelationshipEngineOperatorSurface({ workspace, user: client, now });
  assert.equal(clientSurface.access.adminDiagnosticsVisible, false);
  assert.equal(clientSurface.adminDiagnostics, null);
  assert.equal(clientSurface.metadata.timelineDisplay.source, "relationship_engine_timeline_api");
  assert.equal(clientSurface.metadata.summaryDisplay.queueItemCount, 0);

  const serialized = JSON.stringify(adminSurface);
  assert.equal(/password|cookie|token|DATABASE_URL|connectionString/i.test(serialized), false);

  const integrationSource = readFileSync("lib/relationship-engine/operatorIntegration.ts", "utf8");
  const panelSource = readFileSync("components/operator/RelationshipEngineOperatorPanel.tsx", "utf8");
  for (const [label, source] of [
    ["operator integration", integrationSource],
    ["operator panel", panelSource],
  ] as const) {
    assert.equal(/relationship-engine\/repositories|from "\.\/repositories|from "\.\.\/repositories/.test(source), false, `${label} must not import repositories`);
    assert.equal(/method:\s*["']POST["']|method:\s*["']PATCH["']|method:\s*["']PUT["']|method:\s*["']DELETE["']/.test(source), false, `${label} must not define mutation calls`);
    assert.equal(/executeQueue|sendNotification|createReminder|writeOperatorSnapshot|neonWrite\s*\(/i.test(source), false, `${label} must not expose execution, notification, reminder, snapshot, or Neon write paths`);
  }

  console.log("relationship operator integration check passed", {
    repositoryMode: adminSurface.metadata.repositoryMode,
    queueKinds: adminSurface.queues.map((queue) => queue.queueKind),
    adminDiagnosticsVisible: adminSurface.access.adminDiagnosticsVisible,
    clientDiagnosticsVisible: clientSurface.access.adminDiagnosticsVisible,
  });
}
