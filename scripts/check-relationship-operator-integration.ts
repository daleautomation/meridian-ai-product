import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TENANTS, toPublicUser } from "@/config/tenants";
import { WORKSPACES } from "@/config/workspaces";
import RelationshipEngineOperatorPanel from "@/components/operator/RelationshipEngineOperatorPanel";
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
  assert.equal(adminSurface.boundary.workflowExecutionAllowed, false);
  assert.equal(adminSurface.boundary.automationAllowed, false);
  assert.equal(adminSurface.boundary.remindersAllowed, false);
  assert.equal(adminSurface.boundary.notificationsAllowed, false);
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
  assert.equal(adminSurface.workflows.kind, "relationship_workflow_projection");
  assert.equal(adminSurface.workflows.boundary.workflowExecutionAllowed, false);
  assert.equal(adminSurface.multiOperatorWorkflows.kind, "multi_operator_workflow_orchestration");
  assert.equal(adminSurface.multiOperatorWorkflows.boundary.autoAssignmentAllowed, false);
  assert.equal(adminSurface.multiOperatorWorkflows.boundary.assignmentMutationAllowed, false);
  assert.equal(adminSurface.multiOperatorWorkflows.boundary.queueExecutionAllowed, false);
  assert.equal(adminSurface.multiOperatorWorkflows.boundary.workflowExecutionAllowed, false);
  assert.equal(adminSurface.multiOperatorWorkflows.boundary.automationAllowed, false);
  assert.equal(adminSurface.multiOperatorWorkflows.boundary.notificationsAllowed, false);
  assert.equal(adminSurface.multiOperatorWorkflows.boundary.neonWritesAllowed, false);
  assert.equal(adminSurface.workflowContinuity.kind, "operator_workflow_continuity_projection");
  assert.equal(adminSurface.workflowContinuity.boundary.hiddenWorkflowStateAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.autoAssignmentAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.assignmentMutationAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.queueExecutionAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.workflowExecutionAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.automationAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.remindersAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.notificationsAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.neonWritesAllowed, false);
  assert.equal(adminSurface.workflowContinuity.boundary.productionScoringAllowed, false);
  assert.deepEqual(adminSurface.multiOperatorWorkflows.ordering.groupOrder, [
    "my_relationships",
    "unassigned_review",
    "shared_review",
    "intern_queue",
    "needs_escalation",
    "needs_manager_review",
    "follow_up_review",
  ]);
  assert.deepEqual(adminSurface.workflows.ordering.groupOrder, [
    "needs_relationship_attention",
    "stale_relationship_review",
    "follow_up_review",
    "retention_review",
    "warm_opportunity_review",
    "reactivation_review",
  ]);
  assert.deepEqual(adminSurface.workflowContinuity.ordering.groupOrder, [
    "in_review",
    "shared_review",
    "escalated_review",
    "manager_review",
    "waiting_for_review",
    "dormant_relationship_review",
    "follow_up_continuity_review",
  ]);
  assert.deepEqual(adminSurface.workflowContinuity.ordering.reviewStateOrder, [
    "not_reviewed",
    "in_review",
    "reviewed",
    "shared_review",
    "escalated_review",
    "manager_review",
    "waiting_for_followup_review",
    "dormant_review",
  ]);
  assert.ok(adminSurface.workflowContinuity.items.every((item) => item.handoff.workflowContinuitySummary.workflowProgressionVisible));
  assert.ok(adminSurface.workflowContinuity.items.every((item) => item.explainability.whyVisible));
  assert.ok(adminSurface.workflowContinuity.items.every((item) => item.explainability.assignmentContext));
  assert.equal(adminSurface.access.adminDiagnosticsVisible, true);
  assert.ok(adminSurface.adminDiagnostics, "admin users should receive safe admin diagnostics metadata");
  assert.equal(adminSurface.metadata.repositoryMode, "read_only_file");
  const sourceReadiness = adminSurface.diagnostics.repositoryReadiness.safeMetadata.sourceReadiness as {
    operatorSnapshot?: boolean;
  } | null;
  assert.equal(
    sourceReadiness?.operatorSnapshot,
    true,
  );
  const panelMarkup = renderToStaticMarkup(createElement(RelationshipEngineOperatorPanel, { surface: adminSurface as never }));
  assert.match(panelMarkup, /Relationship Engine/);
  assert.match(panelMarkup, /Operator review surfaces/);
  assert.match(panelMarkup, /Multi-operator workload orchestration/);
  assert.match(panelMarkup, /Workflow continuity and handoffs/);
  assert.match(panelMarkup, /Review-state visibility only/);
  assert.match(panelMarkup, /Intern queue/);
  assert.match(panelMarkup, /Relationship workflow visibility/);

  const clientSurface = await buildRelationshipEngineOperatorSurface({ workspace, user: client, now });
  assert.equal(clientSurface.access.adminDiagnosticsVisible, false);
  assert.equal(clientSurface.adminDiagnostics, null);
  assert.equal(clientSurface.metadata.timelineDisplay.source, "relationship_engine_timeline_api");
  assert.ok(clientSurface.metadata.summaryDisplay.queueItemCount >= 0);

  const serialized = JSON.stringify(adminSurface);
  assert.equal(/password|cookie|token|DATABASE_URL|connectionString/i.test(serialized), false);

  const integrationSource = readFileSync("lib/relationship-engine/operatorIntegration.ts", "utf8");
  const multiOperatorSource = readFileSync("lib/relationship-engine/multiOperatorWorkflowOrchestration.ts", "utf8");
  const continuitySource = readFileSync("lib/relationship-engine/workflowContinuity.ts", "utf8");
  const panelSource = readFileSync("components/operator/RelationshipEngineOperatorPanel.tsx", "utf8");
  for (const [label, source] of [
    ["operator integration", integrationSource],
    ["multi-operator orchestration", multiOperatorSource],
    ["workflow continuity", continuitySource],
    ["operator panel", panelSource],
  ] as const) {
    assert.equal(/relationship-engine\/repositories|from "\.\/repositories|from "\.\.\/repositories/.test(source), false, `${label} must not import repositories`);
    assert.equal(/method:\s*["']POST["']|method:\s*["']PATCH["']|method:\s*["']PUT["']|method:\s*["']DELETE["']/.test(source), false, `${label} must not define mutation calls`);
    assert.equal(/executeQueue|sendNotification|createReminder|writeOperatorSnapshot|neonWrite\s*\(/i.test(source), false, `${label} must not expose execution, notification, reminder, snapshot, or Neon write paths`);
  }

  console.log("relationship operator integration check passed", {
    repositoryMode: adminSurface.metadata.repositoryMode,
    queueKinds: adminSurface.queues.map((queue) => queue.queueKind),
    workflowGroups: adminSurface.workflows.groups.map((group) => group.groupKind),
    multiOperatorGroups: adminSurface.multiOperatorWorkflows.groups.map((group) => group.groupKind),
    continuityGroups: adminSurface.workflowContinuity.groups.map((group) => group.groupKind),
    adminDiagnosticsVisible: adminSurface.access.adminDiagnosticsVisible,
    clientDiagnosticsVisible: clientSurface.access.adminDiagnosticsVisible,
  });
}
