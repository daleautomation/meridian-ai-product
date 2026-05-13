// Meridian Relationship Engine — safe workflow integration read models.
//
// Workflow integration is visibility-only. It composes service-produced feed and
// queue projections into operator review surfaces without executing work,
// sending reminders, mutating state, persisting output, or scoring production rank.

import type { ConfidenceLevel, IsoDateString, RelationshipId, TimelineEventId } from "./primitives";
import type {
  RelationshipProjectionEvidencePointer,
  RelationshipProjectionMissingData,
} from "./projections/dto";
import type {
  QueueItemReason,
  RelationshipFeedProjection,
  RelationshipQueueItem,
  RelationshipQueueKind,
  RelationshipQueueProjection,
  RelationshipReadModelLifecycleContext,
  RelationshipReadModelOwnerVisibility,
  RelationshipReadModelRelationshipState,
} from "./projections/operatorReadModels";

export type RelationshipWorkflowContextKind =
  | "relationship_maintenance_workflow"
  | "follow_up_review_workflow"
  | "relationship_health_workflow"
  | "dormant_reactivation_review_workflow"
  | "operator_workflow_context";

export type RelationshipWorkflowGroupingKind =
  | "needs_relationship_attention"
  | "stale_relationship_review"
  | "follow_up_review"
  | "retention_review"
  | "warm_opportunity_review"
  | "reactivation_review";

export interface RelationshipWorkflowBoundaryPolicy {
  integrationMode: "workflow_visibility_read_model";
  consumesServiceProjectionsOnly: true;
  repositoriesAllowed: false;
  workflowExecutionAllowed: false;
  automationAllowed: false;
  remindersAllowed: false;
  notificationsAllowed: false;
  persistenceAllowed: false;
  neonWritesAllowed: false;
  productionScoringAllowed: false;
  uiDerivedStateAllowed: false;
  reviewOnly: true;
}

export interface RelationshipWorkflowOrderingMetadata {
  strategy: "deterministic_workflow_grouping_v0";
  productionScoring: false;
  groupOrder: RelationshipWorkflowGroupingKind[];
  sourceQueueOrder: RelationshipQueueKind[];
  itemSortKeys: string[];
  tieBreakers: string[];
}

export interface RelationshipWorkflowWhyNow {
  summary: string;
  reasonCodes: string[];
  explanations: string[];
  dueAt?: IsoDateString;
  latestActivityAt?: IsoDateString;
  timelineReferences: TimelineEventId[];
  evidenceReferences: RelationshipProjectionEvidencePointer[];
}

export interface WorkflowReadyRelationshipSummary {
  relationshipId: RelationshipId;
  displayName: string;
  lifecycle: RelationshipReadModelRelationshipState["lifecycle"];
  warmth: RelationshipReadModelRelationshipState["warmth"];
  healthScore?: number;
  healthConfidence: ConfidenceLevel;
  ownerVisibility: RelationshipReadModelOwnerVisibility;
  lifecycleContext: RelationshipReadModelLifecycleContext;
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  whyNow: RelationshipWorkflowWhyNow;
  deterministicOrder: {
    groupKind: RelationshipWorkflowGroupingKind;
    groupRank: number;
    itemRank: number;
    sourceQueueKind: RelationshipQueueKind;
    sourceQueueRank: number;
    sourceQueueRankKey: string;
    sortKey: string;
  };
}

export interface RelationshipWorkflowGroup {
  groupKind: RelationshipWorkflowGroupingKind;
  label: string;
  description: string;
  generatedAt: IsoDateString;
  sourceQueueKinds: RelationshipQueueKind[];
  items: WorkflowReadyRelationshipSummary[];
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  ordering: RelationshipWorkflowOrderingMetadata;
  whyNowExplanations: string[];
  validation: RelationshipWorkflowValidationResult;
}

export interface RelationshipMaintenanceWorkflowContext {
  kind: "relationship_maintenance_workflow";
  groupKinds: RelationshipWorkflowGroupingKind[];
  description: string;
  groups: RelationshipWorkflowGroup[];
  reviewOnly: true;
}

export interface FollowUpReviewWorkflowContext {
  kind: "follow_up_review_workflow";
  groupKinds: RelationshipWorkflowGroupingKind[];
  description: string;
  groups: RelationshipWorkflowGroup[];
  reviewOnly: true;
}

export interface RelationshipHealthWorkflowContext {
  kind: "relationship_health_workflow";
  groupKinds: RelationshipWorkflowGroupingKind[];
  description: string;
  groups: RelationshipWorkflowGroup[];
  reviewOnly: true;
}

export interface DormantReactivationReviewWorkflowContext {
  kind: "dormant_reactivation_review_workflow";
  groupKinds: RelationshipWorkflowGroupingKind[];
  description: string;
  groups: RelationshipWorkflowGroup[];
  reviewOnly: true;
}

export interface OperatorWorkflowContext {
  kind: "operator_workflow_context";
  description: string;
  groups: RelationshipWorkflowGroup[];
  reviewOnly: true;
  boundary: RelationshipWorkflowBoundaryPolicy;
}

export type RelationshipWorkflowIssueSeverity = "error" | "warning";

export interface RelationshipWorkflowIssue {
  severity: RelationshipWorkflowIssueSeverity;
  code: string;
  message: string;
  groupKind?: RelationshipWorkflowGroupingKind;
  relationshipId?: RelationshipId;
}

export interface RelationshipWorkflowValidationResult {
  ok: boolean;
  issues: RelationshipWorkflowIssue[];
}

export interface RelationshipWorkflowExplanation {
  generatedBy: "relationship_workflow_integration_read_model";
  generatedAt: IsoDateString;
  inputSurfaces: Array<"RelationshipQueueProjection" | "RelationshipFeedProjection">;
  notes: string[];
}

export interface RelationshipWorkflowProjection {
  kind: "relationship_workflow_projection";
  generatedAt: IsoDateString;
  boundary: RelationshipWorkflowBoundaryPolicy;
  ordering: RelationshipWorkflowOrderingMetadata;
  groups: RelationshipWorkflowGroup[];
  workflowContexts: {
    relationshipMaintenance: RelationshipMaintenanceWorkflowContext;
    followUpReview: FollowUpReviewWorkflowContext;
    relationshipHealth: RelationshipHealthWorkflowContext;
    dormantReactivationReview: DormantReactivationReviewWorkflowContext;
    operatorWorkflow: OperatorWorkflowContext;
  };
  relationshipSummaries: WorkflowReadyRelationshipSummary[];
  visibility: {
    overdueRelationships: WorkflowReadyRelationshipSummary[];
    dormantRelationships: WorkflowReadyRelationshipSummary[];
    warmOpportunities: WorkflowReadyRelationshipSummary[];
  };
  metadata: {
    groupCounts: Record<RelationshipWorkflowGroupingKind, number>;
    sourceQueueCounts: Record<RelationshipQueueKind, number>;
    sourceFeedCounts: Record<string, number>;
    confidence: ConfidenceLevel;
    missingDataEffects: RelationshipProjectionMissingData[];
  };
  explanation: RelationshipWorkflowExplanation;
  validation: RelationshipWorkflowValidationResult;
}

export interface RelationshipWorkflowProjectionInput {
  generatedAt: IsoDateString;
  queues: RelationshipQueueProjection[];
  feeds?: RelationshipFeedProjection[];
}

export const RELATIONSHIP_WORKFLOW_BOUNDARY: RelationshipWorkflowBoundaryPolicy = {
  integrationMode: "workflow_visibility_read_model",
  consumesServiceProjectionsOnly: true,
  repositoriesAllowed: false,
  workflowExecutionAllowed: false,
  automationAllowed: false,
  remindersAllowed: false,
  notificationsAllowed: false,
  persistenceAllowed: false,
  neonWritesAllowed: false,
  productionScoringAllowed: false,
  uiDerivedStateAllowed: false,
  reviewOnly: true,
};

export const RELATIONSHIP_WORKFLOW_GROUP_ORDER: RelationshipWorkflowGroupingKind[] = [
  "needs_relationship_attention",
  "stale_relationship_review",
  "follow_up_review",
  "retention_review",
  "warm_opportunity_review",
  "reactivation_review",
];

export const RELATIONSHIP_WORKFLOW_SOURCE_QUEUE_ORDER: RelationshipQueueKind[] = [
  "needs_attention",
  "overdue_follow_ups",
  "cooling_relationships",
  "retention_risk",
  "warm_opportunities",
  "reactivation_candidates",
];

export const RELATIONSHIP_WORKFLOW_ORDERING: RelationshipWorkflowOrderingMetadata = {
  strategy: "deterministic_workflow_grouping_v0",
  productionScoring: false,
  groupOrder: RELATIONSHIP_WORKFLOW_GROUP_ORDER,
  sourceQueueOrder: RELATIONSHIP_WORKFLOW_SOURCE_QUEUE_ORDER,
  itemSortKeys: ["group rank asc", "source queue rank asc", "rankKey asc", "relationshipId asc", "item id asc"],
  tieBreakers: ["relationshipId", "source queue kind", "source queue item id"],
};

const GROUP_DEFINITIONS: Record<RelationshipWorkflowGroupingKind, {
  label: string;
  description: string;
  queueKinds: RelationshipQueueKind[];
}> = {
  needs_relationship_attention: {
    label: "Needs relationship attention",
    description: "Relationships with visible attention signals from deterministic queue projections.",
    queueKinds: ["needs_attention"],
  },
  stale_relationship_review: {
    label: "Stale relationship review",
    description: "Relationships whose latest activity is outside the configured maintenance window.",
    queueKinds: ["cooling_relationships"],
  },
  follow_up_review: {
    label: "Follow-up review",
    description: "Overdue follow-ups and promises for operator review only.",
    queueKinds: ["overdue_follow_ups"],
  },
  retention_review: {
    label: "Retention review",
    description: "Retention-risk relationships surfaced with evidence and lifecycle context.",
    queueKinds: ["retention_risk"],
  },
  warm_opportunity_review: {
    label: "Warm opportunity review",
    description: "Warm opportunity relationships visible without automatic outreach.",
    queueKinds: ["warm_opportunities"],
  },
  reactivation_review: {
    label: "Reactivation review",
    description: "Dormant or reactivation relationships visible for human review.",
    queueKinds: ["reactivation_candidates"],
  },
};

export function projectRelationshipWorkflowIntegration(
  input: RelationshipWorkflowProjectionInput,
): RelationshipWorkflowProjection {
  const queuesByKind = new Map(input.queues.map((queue) => [queue.queueKind, queue]));
  const groups = RELATIONSHIP_WORKFLOW_GROUP_ORDER.map((groupKind, index) =>
    buildWorkflowGroup(input.generatedAt, groupKind, index + 1, queuesByKind));
  const relationshipSummaries = uniqueRelationshipSummaries(groups);
  const missingDataEffects = uniqueMissingDataEffects(groups.flatMap((group) => group.missingDataEffects));
  const validation = validateRelationshipWorkflowProjection(groups);
  const projection: RelationshipWorkflowProjection = {
    kind: "relationship_workflow_projection",
    generatedAt: input.generatedAt,
    boundary: RELATIONSHIP_WORKFLOW_BOUNDARY,
    ordering: RELATIONSHIP_WORKFLOW_ORDERING,
    groups,
    workflowContexts: workflowContexts(groups),
    relationshipSummaries,
    visibility: {
      overdueRelationships: groupItems(groups, ["follow_up_review", "needs_relationship_attention"]),
      dormantRelationships: groupItems(groups, ["reactivation_review", "stale_relationship_review"])
        .filter((item) => item.lifecycle === "DORMANT" || item.lifecycle === "REACTIVATION"),
      warmOpportunities: groupItems(groups, ["warm_opportunity_review"]),
    },
    metadata: {
      groupCounts: groupCounts(groups),
      sourceQueueCounts: sourceQueueCounts(input.queues),
      sourceFeedCounts: sourceFeedCounts(input.feeds ?? []),
      confidence: combineConfidence(relationshipSummaries.map((item) => item.confidence)),
      missingDataEffects,
    },
    explanation: {
      generatedBy: "relationship_workflow_integration_read_model",
      generatedAt: input.generatedAt,
      inputSurfaces: ["RelationshipQueueProjection", "RelationshipFeedProjection"],
      notes: [
        "Workflow contexts are review-only visibility surfaces; they do not execute workflow actions.",
        "Grouping is derived only from relationship-engine service projections, never UI state or repositories.",
        "Ordering exposes deterministic rank metadata and does not introduce hidden prioritization.",
        "Missing data lowers confidence or limits visibility; it is not converted into automation.",
      ],
    },
    validation,
  };
  return projection;
}

function buildWorkflowGroup(
  generatedAt: IsoDateString,
  groupKind: RelationshipWorkflowGroupingKind,
  groupRank: number,
  queuesByKind: Map<RelationshipQueueKind, RelationshipQueueProjection>,
): RelationshipWorkflowGroup {
  const definition = GROUP_DEFINITIONS[groupKind];
  const sourceQueues = definition.queueKinds
    .map((queueKind) => queuesByKind.get(queueKind))
    .filter((queue): queue is RelationshipQueueProjection => Boolean(queue));
  const items = sourceQueues
    .flatMap((queue) => queue.items.map((item) => workflowSummaryFromQueueItem(item, groupKind, groupRank)))
    .sort(compareWorkflowSummaries)
    .map((item, index) => ({
      ...item,
      deterministicOrder: {
        ...item.deterministicOrder,
        itemRank: index + 1,
      },
    }));
  return {
    groupKind,
    label: definition.label,
    description: definition.description,
    generatedAt,
    sourceQueueKinds: definition.queueKinds,
    items,
    confidence: combineConfidence(items.map((item) => item.confidence)),
    missingDataEffects: uniqueMissingDataEffects(items.flatMap((item) => item.missingDataEffects)),
    ordering: RELATIONSHIP_WORKFLOW_ORDERING,
    whyNowExplanations: uniqueStrings(items.flatMap((item) => item.whyNow.explanations)),
    validation: validateWorkflowGroup(groupKind, items),
  };
}

function workflowSummaryFromQueueItem(
  item: RelationshipQueueItem,
  groupKind: RelationshipWorkflowGroupingKind,
  groupRank: number,
): WorkflowReadyRelationshipSummary {
  return {
    relationshipId: item.relationshipId,
    displayName: item.relationshipState.displayName,
    lifecycle: item.relationshipState.lifecycle,
    warmth: item.relationshipState.warmth,
    ...(item.relationshipState.healthScore === undefined ? {} : { healthScore: item.relationshipState.healthScore }),
    healthConfidence: item.relationshipState.healthConfidence,
    ownerVisibility: item.ownerVisibility,
    lifecycleContext: item.lifecycleContext,
    confidence: item.confidence,
    missingDataEffects: item.missingDataEffects,
    whyNow: whyNow(item),
    deterministicOrder: {
      groupKind,
      groupRank,
      itemRank: item.rank,
      sourceQueueKind: item.queueKind,
      sourceQueueRank: item.rank,
      sourceQueueRankKey: item.rankKey,
      sortKey: workflowSortKey(groupRank, item),
    },
  };
}

function whyNow(item: RelationshipQueueItem): RelationshipWorkflowWhyNow {
  const dueAt = earliestDueAt(item.reasons);
  const latestActivityAt = latestEvidenceAt(item.latestEvidence);
  return {
    summary: item.whyItExists,
    reasonCodes: item.reasons.map((reason) => reason.code).sort(),
    explanations: item.reasons.map((reason) => reason.explanation).sort(),
    ...(dueAt ? { dueAt } : {}),
    ...(latestActivityAt ? { latestActivityAt } : {}),
    timelineReferences: [...item.timelineReferences].sort(),
    evidenceReferences: item.latestEvidence,
  };
}

function workflowContexts(groups: RelationshipWorkflowGroup[]): RelationshipWorkflowProjection["workflowContexts"] {
  const maintenanceKinds: RelationshipWorkflowGroupingKind[] = [
    "needs_relationship_attention",
    "stale_relationship_review",
    "retention_review",
  ];
  const followUpKinds: RelationshipWorkflowGroupingKind[] = ["follow_up_review"];
  const healthKinds: RelationshipWorkflowGroupingKind[] = [
    "needs_relationship_attention",
    "stale_relationship_review",
    "retention_review",
  ];
  const dormantKinds: RelationshipWorkflowGroupingKind[] = ["reactivation_review"];
  return {
    relationshipMaintenance: {
      kind: "relationship_maintenance_workflow",
      groupKinds: maintenanceKinds,
      description: "Maintenance review across attention, staleness, and retention signals.",
      groups: selectGroups(groups, maintenanceKinds),
      reviewOnly: true,
    },
    followUpReview: {
      kind: "follow_up_review_workflow",
      groupKinds: followUpKinds,
      description: "Follow-up visibility for overdue promises and instructions.",
      groups: selectGroups(groups, followUpKinds),
      reviewOnly: true,
    },
    relationshipHealth: {
      kind: "relationship_health_workflow",
      groupKinds: healthKinds,
      description: "Relationship health review using lifecycle, stale activity, retention, and confidence context.",
      groups: selectGroups(groups, healthKinds),
      reviewOnly: true,
    },
    dormantReactivationReview: {
      kind: "dormant_reactivation_review_workflow",
      groupKinds: dormantKinds,
      description: "Dormant and reactivation relationship visibility without outreach automation.",
      groups: selectGroups(groups, dormantKinds),
      reviewOnly: true,
    },
    operatorWorkflow: {
      kind: "operator_workflow_context",
      description: "Operator workflow context assembled from deterministic relationship-engine review groups.",
      groups,
      reviewOnly: true,
      boundary: RELATIONSHIP_WORKFLOW_BOUNDARY,
    },
  };
}

function validateRelationshipWorkflowProjection(groups: RelationshipWorkflowGroup[]): RelationshipWorkflowValidationResult {
  const issues = groups.flatMap((group) => group.validation.issues);
  const seen = new Set<string>();
  for (const group of groups) {
    const groupIndex = RELATIONSHIP_WORKFLOW_GROUP_ORDER.indexOf(group.groupKind);
    if (groupIndex === -1) {
      issues.push(error("unknown_workflow_group", "Workflow group is not part of the deterministic group order.", group.groupKind));
    }
    for (const item of group.items) {
      if (item.deterministicOrder.groupKind !== group.groupKind) {
        issues.push(error("workflow_order_group_mismatch", "Workflow item deterministic order group does not match parent group.", group.groupKind, item.relationshipId));
      }
      if (item.whyNow.evidenceReferences.length === 0) {
        issues.push(warning("workflow_item_missing_evidence", "Workflow item has no evidence references; consumers must show the low-evidence state.", group.groupKind, item.relationshipId));
      }
      const key = `${group.groupKind}:${item.relationshipId}`;
      if (seen.has(key)) {
        issues.push(error("duplicate_workflow_relationship", "Workflow group contains the same relationship more than once.", group.groupKind, item.relationshipId));
      }
      seen.add(key);
    }
  }
  return result(issues);
}

function validateWorkflowGroup(
  groupKind: RelationshipWorkflowGroupingKind,
  items: WorkflowReadyRelationshipSummary[],
): RelationshipWorkflowValidationResult {
  const issues: RelationshipWorkflowIssue[] = [];
  for (const item of items) {
    if (item.lifecycleContext.terminal) {
      issues.push(error("terminal_relationship_in_workflow", "Terminal relationships must not appear in active workflow visibility groups.", groupKind, item.relationshipId));
    }
    if (item.ownerVisibility.visibleTo.length === 0) {
      issues.push(warning("workflow_item_missing_owner_visibility", "Workflow item has no owner visibility; consumers must not infer an owner.", groupKind, item.relationshipId));
    }
  }
  return result(issues);
}

function uniqueRelationshipSummaries(groups: RelationshipWorkflowGroup[]): WorkflowReadyRelationshipSummary[] {
  const byRelationship = new Map<RelationshipId, WorkflowReadyRelationshipSummary>();
  for (const item of groups.flatMap((group) => group.items).sort(compareWorkflowSummaries)) {
    if (!byRelationship.has(item.relationshipId)) byRelationship.set(item.relationshipId, item);
  }
  return [...byRelationship.values()].sort(compareWorkflowSummaries);
}

function groupItems(
  groups: RelationshipWorkflowGroup[],
  groupKinds: RelationshipWorkflowGroupingKind[],
): WorkflowReadyRelationshipSummary[] {
  const wanted = new Set(groupKinds);
  return groups
    .filter((group) => wanted.has(group.groupKind))
    .flatMap((group) => group.items)
    .sort(compareWorkflowSummaries);
}

function selectGroups(
  groups: RelationshipWorkflowGroup[],
  groupKinds: RelationshipWorkflowGroupingKind[],
): RelationshipWorkflowGroup[] {
  const wanted = new Set(groupKinds);
  return groups.filter((group) => wanted.has(group.groupKind));
}

function groupCounts(groups: RelationshipWorkflowGroup[]): Record<RelationshipWorkflowGroupingKind, number> {
  return Object.fromEntries(RELATIONSHIP_WORKFLOW_GROUP_ORDER.map((groupKind) => [
    groupKind,
    groups.find((group) => group.groupKind === groupKind)?.items.length ?? 0,
  ])) as Record<RelationshipWorkflowGroupingKind, number>;
}

function sourceQueueCounts(queues: RelationshipQueueProjection[]): Record<RelationshipQueueKind, number> {
  return Object.fromEntries(RELATIONSHIP_WORKFLOW_SOURCE_QUEUE_ORDER.map((queueKind) => [
    queueKind,
    queues.find((queue) => queue.queueKind === queueKind)?.items.length ?? 0,
  ])) as Record<RelationshipQueueKind, number>;
}

function sourceFeedCounts(feeds: RelationshipFeedProjection[]): Record<string, number> {
  return Object.fromEntries([...feeds]
    .sort((a, b) => a.feedKind.localeCompare(b.feedKind))
    .map((feed) => [feed.feedKind, feed.items.length]));
}

function uniqueMissingDataEffects(
  effects: RelationshipProjectionMissingData[],
): RelationshipProjectionMissingData[] {
  const byKey = new Map<string, RelationshipProjectionMissingData>();
  for (const effect of effects) {
    byKey.set(`${effect.field}:${effect.reason}:${effect.effect}:${effect.message}`, effect);
  }
  return [...byKey.values()].sort((a, b) =>
    a.field.localeCompare(b.field)
    || a.reason.localeCompare(b.reason)
    || a.effect.localeCompare(b.effect)
    || a.message.localeCompare(b.message));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function earliestDueAt(reasons: QueueItemReason[]): IsoDateString | undefined {
  return reasons
    .map((reason) => reason.dueAt)
    .filter((dueAt): dueAt is IsoDateString => Boolean(dueAt))
    .sort()[0];
}

function latestEvidenceAt(evidence: RelationshipProjectionEvidencePointer[]): IsoDateString | undefined {
  return evidence
    .map((pointer) => pointer.occurredAt)
    .filter((occurredAt): occurredAt is IsoDateString => Boolean(occurredAt))
    .sort()
    .at(-1);
}

function compareWorkflowSummaries(a: WorkflowReadyRelationshipSummary, b: WorkflowReadyRelationshipSummary): number {
  return a.deterministicOrder.sortKey.localeCompare(b.deterministicOrder.sortKey)
    || a.relationshipId.localeCompare(b.relationshipId);
}

function workflowSortKey(groupRank: number, item: RelationshipQueueItem): string {
  return [
    String(groupRank).padStart(2, "0"),
    String(item.rank).padStart(5, "0"),
    item.rankKey,
    item.relationshipId,
    item.id,
  ].join("|");
}

function combineConfidence(values: ConfidenceLevel[]): ConfidenceLevel {
  if (values.length === 0) return "unknown";
  return values.reduce((lowest, value) => (
    confidenceRank(value) > confidenceRank(lowest) ? value : lowest
  ), "high");
}

function confidenceRank(value: ConfidenceLevel): number {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unknown":
      return 3;
  }
}

function error(
  code: string,
  message: string,
  groupKind?: RelationshipWorkflowGroupingKind,
  relationshipId?: RelationshipId,
): RelationshipWorkflowIssue {
  return {
    severity: "error",
    code,
    message,
    ...(groupKind ? { groupKind } : {}),
    ...(relationshipId ? { relationshipId } : {}),
  };
}

function warning(
  code: string,
  message: string,
  groupKind?: RelationshipWorkflowGroupingKind,
  relationshipId?: RelationshipId,
): RelationshipWorkflowIssue {
  return {
    severity: "warning",
    code,
    message,
    ...(groupKind ? { groupKind } : {}),
    ...(relationshipId ? { relationshipId } : {}),
  };
}

function result(issues: RelationshipWorkflowIssue[]): RelationshipWorkflowValidationResult {
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}
