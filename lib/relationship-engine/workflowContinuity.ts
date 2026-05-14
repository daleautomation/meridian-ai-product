// Meridian Relationship Engine — operator workflow continuity read models.
//
// Continuity is visibility-only. It preserves review context, handoff context,
// assignment context, and deterministic progression metadata without executing
// queues, mutating assignments, sending reminders, notifying operators, writing
// storage, or introducing autonomous workflow state.

import type {
  ConfidenceLevel,
  IsoDateString,
  OperatorId,
  RelationshipId,
  TimelineEventId,
} from "./primitives";
import type {
  RelationshipProjectionEvidencePointer,
  RelationshipProjectionMissingData,
} from "./projections/dto";
import type { RelationshipReadModelLifecycleContext } from "./projections/operatorReadModels";
import type {
  MultiOperatorWorkflowGroupingKind,
  MultiOperatorWorkflowItem,
  MultiOperatorWorkflowOrchestrationProjection,
} from "./multiOperatorWorkflowOrchestration";
import type {
  RelationshipWorkflowGroupingKind,
  RelationshipWorkflowProjection,
} from "./workflowIntegration";

export type WorkflowReviewStateKind =
  | "not_reviewed"
  | "in_review"
  | "reviewed"
  | "shared_review"
  | "escalated_review"
  | "manager_review"
  | "waiting_for_followup_review"
  | "dormant_review";

export type WorkflowContinuityGroupingKind =
  | "in_review"
  | "shared_review"
  | "escalated_review"
  | "manager_review"
  | "waiting_for_review"
  | "dormant_relationship_review"
  | "follow_up_continuity_review";

export type OperatorReviewReferenceState =
  | "observed"
  | "assignment_anchor"
  | "not_observed";

export interface WorkflowContinuityBoundaryPolicy {
  continuityMode: "operator_workflow_continuity_visibility_read_model";
  consumesWorkflowProjectionOnly: true;
  consumesMultiOperatorProjectionOnly: true;
  consumesServiceProjectionsOnly: true;
  repositoriesAllowed: false;
  uiDerivedContinuityAllowed: false;
  hiddenWorkflowStateAllowed: false;
  autoAssignmentAllowed: false;
  assignmentMutationAllowed: false;
  queueExecutionAllowed: false;
  workflowExecutionAllowed: false;
  automationAllowed: false;
  remindersAllowed: false;
  notificationsAllowed: false;
  persistenceAllowed: false;
  neonWritesAllowed: false;
  productionScoringAllowed: false;
  reviewOnly: true;
}

export interface WorkflowContinuityOrderingMetadata {
  strategy: "deterministic_operator_workflow_continuity_v0";
  productionScoring: false;
  groupOrder: WorkflowContinuityGroupingKind[];
  reviewStateOrder: WorkflowReviewStateKind[];
  sourceWorkflowGroupOrder: RelationshipWorkflowGroupingKind[];
  sourceMultiOperatorGroupOrder: MultiOperatorWorkflowGroupingKind[];
  itemSortKeys: string[];
  tieBreakers: string[];
}

export interface WorkflowReviewStateVisibilityDTO {
  state: WorkflowReviewStateKind;
  label: string;
  visible: boolean;
  reviewOnly: true;
  reason: string;
  missingDataEffect: string;
  sourceWorkflowGroupKinds: RelationshipWorkflowGroupingKind[];
  sourceMultiOperatorGroupKinds: MultiOperatorWorkflowGroupingKind[];
  confidence: ConfidenceLevel;
}

export interface OperatorReviewerDTO {
  state: OperatorReviewReferenceState;
  operatorId?: OperatorId;
  source:
    | "relationship_engine_review_visibility"
    | "relationship_engine_owner_visibility";
  reason: string;
  latestAssignmentEventId?: TimelineEventId;
  confidence: ConfidenceLevel;
}

export interface WorkflowContinuitySummaryDTO {
  summary: string;
  progressionState:
    | "not_started"
    | "active_review"
    | "shared_review"
    | "escalation_review"
    | "manager_review"
    | "follow_up_review"
    | "dormant_review"
    | "review_complete_not_inferred";
  reviewContinuityReason: string;
  workflowProgressionVisible: true;
  reviewOnly: true;
}

export interface AssignmentContinuityContextDTO {
  assignmentState: "assigned" | "unassigned";
  assignedOperatorId?: OperatorId;
  ownershipState?: string;
  visibleOperatorCount: number;
  shared: boolean;
  visibleToViewer: boolean;
  assignmentConfidence: ConfidenceLevel;
  whyAssigned: string;
  whyVisible: string;
  source: "relationship_engine_owner_visibility";
  reviewOnly: true;
}

export interface RelationshipContinuityContextDTO {
  relationshipId: RelationshipId;
  displayName: string;
  lifecycle: MultiOperatorWorkflowItem["lifecycle"];
  lifecycleContext: RelationshipReadModelLifecycleContext;
  sourceWorkflowGroupKinds: RelationshipWorkflowGroupingKind[];
  sourceQueueKind?: MultiOperatorWorkflowItem["deterministicOrder"]["sourceQueueKind"];
  latestEvidence: RelationshipProjectionEvidencePointer[];
  reasonCodes: string[];
  whyNow: string;
  reviewOnly: true;
}

export interface OperatorHandoffVisibilityDTO {
  previousReviewer: OperatorReviewerDTO;
  latestReviewer: OperatorReviewerDTO;
  latestReviewTimestamp?: IsoDateString;
  workflowContinuitySummary: WorkflowContinuitySummaryDTO;
  assignmentContinuityContext: AssignmentContinuityContextDTO;
  relationshipContinuityContext: RelationshipContinuityContextDTO;
  handoffConfidence: ConfidenceLevel;
  reviewOnly: true;
}

export interface WorkflowContinuityExplainabilityDTO {
  whyVisible: string;
  latestEvidence: RelationshipProjectionEvidencePointer[];
  reviewContinuityReason: string;
  lifecycleContext: RelationshipReadModelLifecycleContext;
  assignmentContext: AssignmentContinuityContextDTO;
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  deterministicOrdering: WorkflowContinuityItemOrdering;
}

export interface WorkflowContinuityItemOrdering {
  strategy: "deterministic_operator_workflow_continuity_v0";
  primaryGroupKind: WorkflowContinuityGroupingKind;
  primaryGroupRank: number;
  reviewState: WorkflowReviewStateKind;
  reviewStateRank: number;
  sourceMultiOperatorGroupKind: MultiOperatorWorkflowGroupingKind;
  sourceMultiOperatorGroupRank: number;
  sourceWorkflowGroupKind: RelationshipWorkflowGroupingKind;
  sourceWorkflowGroupRank: number;
  sourceQueueRankKey: string;
  itemRank: number;
  sortKey: string;
  displayedInGroupKinds: WorkflowContinuityGroupingKind[];
}

export interface WorkflowContinuityItem {
  relationshipId: RelationshipId;
  displayName: string;
  reviewState: WorkflowReviewStateVisibilityDTO;
  handoff: OperatorHandoffVisibilityDTO;
  explainability: WorkflowContinuityExplainabilityDTO;
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  sourceWorkflowGroupKinds: RelationshipWorkflowGroupingKind[];
  sourceMultiOperatorGroupKinds: MultiOperatorWorkflowGroupingKind[];
  deterministicOrder: WorkflowContinuityItemOrdering;
  reviewOnly: true;
}

export interface WorkflowContinuityGroup {
  groupKind: WorkflowContinuityGroupingKind;
  label: string;
  description: string;
  generatedAt: IsoDateString;
  visibilityReason: string;
  roleAudience: Array<"operator" | "intern" | "account_manager" | "review_coordinator">;
  items: WorkflowContinuityItem[];
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  ordering: WorkflowContinuityOrderingMetadata;
  reviewOnly: true;
}

export interface WorkflowContinuityValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  groupKind?: WorkflowContinuityGroupingKind;
  relationshipId?: RelationshipId;
}

export interface WorkflowContinuityValidationResult {
  ok: boolean;
  issues: WorkflowContinuityValidationIssue[];
}

export interface WorkflowContinuityProjection {
  kind: "operator_workflow_continuity_projection";
  generatedAt: IsoDateString;
  boundary: WorkflowContinuityBoundaryPolicy;
  ordering: WorkflowContinuityOrderingMetadata;
  reviewStateCatalog: WorkflowReviewStateVisibilityDTO[];
  groups: WorkflowContinuityGroup[];
  items: WorkflowContinuityItem[];
  visibility: {
    inReview: WorkflowContinuityItem[];
    sharedReview: WorkflowContinuityItem[];
    escalatedReview: WorkflowContinuityItem[];
    managerReview: WorkflowContinuityItem[];
    waitingForReview: WorkflowContinuityItem[];
    dormantRelationshipReview: WorkflowContinuityItem[];
    followUpContinuityReview: WorkflowContinuityItem[];
  };
  metadata: {
    groupCounts: Record<WorkflowContinuityGroupingKind, number>;
    reviewStateCounts: Record<WorkflowReviewStateKind, number>;
    confidence: ConfidenceLevel;
    missingDataEffects: RelationshipProjectionMissingData[];
  };
  explanation: {
    generatedBy: "operator_workflow_continuity_read_model";
    generatedAt: IsoDateString;
    notes: string[];
  };
  validation: WorkflowContinuityValidationResult;
}

export interface WorkflowContinuityProjectionInput {
  generatedAt: IsoDateString;
  workflow: RelationshipWorkflowProjection;
  multiOperatorWorkflow: MultiOperatorWorkflowOrchestrationProjection;
}

export const WORKFLOW_CONTINUITY_BOUNDARY: WorkflowContinuityBoundaryPolicy = {
  continuityMode: "operator_workflow_continuity_visibility_read_model",
  consumesWorkflowProjectionOnly: true,
  consumesMultiOperatorProjectionOnly: true,
  consumesServiceProjectionsOnly: true,
  repositoriesAllowed: false,
  uiDerivedContinuityAllowed: false,
  hiddenWorkflowStateAllowed: false,
  autoAssignmentAllowed: false,
  assignmentMutationAllowed: false,
  queueExecutionAllowed: false,
  workflowExecutionAllowed: false,
  automationAllowed: false,
  remindersAllowed: false,
  notificationsAllowed: false,
  persistenceAllowed: false,
  neonWritesAllowed: false,
  productionScoringAllowed: false,
  reviewOnly: true,
};

export const WORKFLOW_REVIEW_STATE_ORDER: WorkflowReviewStateKind[] = [
  "not_reviewed",
  "in_review",
  "reviewed",
  "shared_review",
  "escalated_review",
  "manager_review",
  "waiting_for_followup_review",
  "dormant_review",
];

export const WORKFLOW_CONTINUITY_GROUP_ORDER: WorkflowContinuityGroupingKind[] = [
  "in_review",
  "shared_review",
  "escalated_review",
  "manager_review",
  "waiting_for_review",
  "dormant_relationship_review",
  "follow_up_continuity_review",
];

export const WORKFLOW_CONTINUITY_ORDERING: WorkflowContinuityOrderingMetadata = {
  strategy: "deterministic_operator_workflow_continuity_v0",
  productionScoring: false,
  groupOrder: WORKFLOW_CONTINUITY_GROUP_ORDER,
  reviewStateOrder: WORKFLOW_REVIEW_STATE_ORDER,
  sourceWorkflowGroupOrder: [
    "needs_relationship_attention",
    "stale_relationship_review",
    "follow_up_review",
    "retention_review",
    "warm_opportunity_review",
    "reactivation_review",
  ],
  sourceMultiOperatorGroupOrder: [
    "my_relationships",
    "unassigned_review",
    "shared_review",
    "intern_queue",
    "needs_escalation",
    "needs_manager_review",
    "follow_up_review",
  ],
  itemSortKeys: [
    "continuity group rank asc",
    "review state rank asc",
    "source multi-operator rank asc",
    "source workflow rank asc",
    "source queue rank key asc",
    "relationshipId asc",
  ],
  tieBreakers: ["relationshipId", "source multi-operator group", "source workflow group", "source queue rank key"],
};

const GROUP_DEFINITIONS: Record<WorkflowContinuityGroupingKind, {
  label: string;
  description: string;
  visibilityReason: string;
  roleAudience: WorkflowContinuityGroup["roleAudience"];
}> = {
  in_review: {
    label: "In Review",
    description: "Relationships currently visible in an operator review lane.",
    visibilityReason: "The relationship has active review visibility from multi-operator workflow DTOs.",
    roleAudience: ["operator", "intern", "account_manager", "review_coordinator"],
  },
  shared_review: {
    label: "Shared Review",
    description: "Relationships visible to more than one operator, preserving handoff clarity.",
    visibilityReason: "Relationship-engine owner visibility exposes multiple visible operators.",
    roleAudience: ["operator", "account_manager", "review_coordinator"],
  },
  escalated_review: {
    label: "Escalated Review",
    description: "Relationships with assignment or evidence gaps requiring human escalation review.",
    visibilityReason: "Escalation state is visible from deterministic multi-operator workflow DTOs.",
    roleAudience: ["account_manager", "review_coordinator"],
  },
  manager_review: {
    label: "Manager Review",
    description: "Relationships account managers should inspect before operator or intern action.",
    visibilityReason: "Manager review context is visible without creating assignments or actions.",
    roleAudience: ["account_manager", "review_coordinator"],
  },
  waiting_for_review: {
    label: "Waiting For Review",
    description: "Relationships visible but lacking canonical completed-review evidence.",
    visibilityReason: "No canonical review completion state exists in the read model.",
    roleAudience: ["operator", "intern", "account_manager", "review_coordinator"],
  },
  dormant_relationship_review: {
    label: "Dormant Relationship Review",
    description: "Dormant and reactivation relationships kept visible without outreach automation.",
    visibilityReason: "Lifecycle context indicates dormant or reactivation review visibility.",
    roleAudience: ["account_manager", "review_coordinator"],
  },
  follow_up_continuity_review: {
    label: "Follow-Up Continuity Review",
    description: "Follow-up workflow continuity visibility without reminders or execution.",
    visibilityReason: "Source workflow grouping indicates follow-up review continuity.",
    roleAudience: ["operator", "intern", "account_manager", "review_coordinator"],
  },
};

export function projectOperatorWorkflowContinuity(
  input: WorkflowContinuityProjectionInput,
): WorkflowContinuityProjection {
  const items = input.multiOperatorWorkflow.items
    .map(buildContinuityItem)
    .sort(compareContinuityItems)
    .map((item, index) => withItemRank(item, index));
  const groups = WORKFLOW_CONTINUITY_GROUP_ORDER.map((groupKind) =>
    buildContinuityGroup(input.generatedAt, groupKind, items));
  const visibility = {
    inReview: groupItems(groups, "in_review"),
    sharedReview: groupItems(groups, "shared_review"),
    escalatedReview: groupItems(groups, "escalated_review"),
    managerReview: groupItems(groups, "manager_review"),
    waitingForReview: groupItems(groups, "waiting_for_review"),
    dormantRelationshipReview: groupItems(groups, "dormant_relationship_review"),
    followUpContinuityReview: groupItems(groups, "follow_up_continuity_review"),
  };
  const validation = validateProjection(groups, items);

  return {
    kind: "operator_workflow_continuity_projection",
    generatedAt: input.generatedAt,
    boundary: WORKFLOW_CONTINUITY_BOUNDARY,
    ordering: WORKFLOW_CONTINUITY_ORDERING,
    reviewStateCatalog: reviewStateCatalog(),
    groups,
    items,
    visibility,
    metadata: {
      groupCounts: groupCounts(groups),
      reviewStateCounts: reviewStateCounts(items),
      confidence: combineConfidence(items.map((item) => item.confidence)),
      missingDataEffects: uniqueMissingDataEffects(items.flatMap((item) => item.missingDataEffects)),
    },
    explanation: {
      generatedBy: "operator_workflow_continuity_read_model",
      generatedAt: input.generatedAt,
      notes: [
        "Continuity is read-only visibility over relationship workflow and multi-operator workflow DTOs.",
        "Reviewer handoff fields expose observed or missing context; they never infer hidden review completion.",
        "Assignment continuity uses relationship-engine owner visibility and never mutates owners.",
        "Ordering is deterministic and does not introduce production scoring or autonomous progression.",
      ],
    },
    validation,
  };
}

function buildContinuityItem(item: MultiOperatorWorkflowItem): WorkflowContinuityItem {
  const reviewState = reviewStateDto(item);
  const sourceMultiOperatorGroupKinds = sourceMultiOperatorGroups(item);
  const displayedInGroupKinds = continuityGroupKindsFor(item, reviewState.state);
  const primaryGroupKind = displayedInGroupKinds[0] ?? "waiting_for_review";
  const primaryGroupRank = groupRank(primaryGroupKind);
  const sourceMultiOperatorGroupKind = sourceMultiOperatorGroupKinds[0] ?? item.deterministicOrder.primaryGroupKind;
  const sourceWorkflowGroupKind = item.sourceWorkflowGroupKinds[0] ?? item.deterministicOrder.sourceWorkflowGroupKind;
  const assignmentContext = assignmentContextDto(item);
  const relationshipContext = relationshipContextDto(item);
  const workflowContinuitySummary = workflowContinuitySummaryDto(item, reviewState.state);
  const handoff: OperatorHandoffVisibilityDTO = {
    previousReviewer: previousReviewerDto(),
    latestReviewer: latestReviewerDto(item),
    ...(latestReviewTimestamp(item) ? { latestReviewTimestamp: latestReviewTimestamp(item) } : {}),
    workflowContinuitySummary,
    assignmentContinuityContext: assignmentContext,
    relationshipContinuityContext: relationshipContext,
    handoffConfidence: handoffConfidence(item),
    reviewOnly: true,
  };
  const deterministicOrder: WorkflowContinuityItemOrdering = {
    strategy: "deterministic_operator_workflow_continuity_v0",
    primaryGroupKind,
    primaryGroupRank,
    reviewState: reviewState.state,
    reviewStateRank: reviewStateRank(reviewState.state),
    sourceMultiOperatorGroupKind,
    sourceMultiOperatorGroupRank: sourceMultiOperatorGroupRank(sourceMultiOperatorGroupKind),
    sourceWorkflowGroupKind,
    sourceWorkflowGroupRank: sourceWorkflowGroupRank(sourceWorkflowGroupKind),
    sourceQueueRankKey: item.deterministicOrder.sourceQueueRankKey,
    itemRank: 0,
    sortKey: continuitySortKey(primaryGroupRank, reviewState.state, sourceMultiOperatorGroupKind, sourceWorkflowGroupKind, item),
    displayedInGroupKinds,
  };

  return {
    relationshipId: item.relationshipId,
    displayName: item.displayName,
    reviewState,
    handoff,
    explainability: {
      whyVisible: item.whyVisible,
      latestEvidence: latestEvidence(item.whyNow.evidenceReferences),
      reviewContinuityReason: workflowContinuitySummary.reviewContinuityReason,
      lifecycleContext: item.lifecycleContext,
      assignmentContext,
      confidence: item.confidence,
      missingDataEffects: item.missingDataEffects,
      deterministicOrdering: deterministicOrder,
    },
    confidence: item.confidence,
    missingDataEffects: item.missingDataEffects,
    sourceWorkflowGroupKinds: item.sourceWorkflowGroupKinds,
    sourceMultiOperatorGroupKinds,
    deterministicOrder,
    reviewOnly: true,
  };
}

function reviewStateCatalog(): WorkflowReviewStateVisibilityDTO[] {
  return WORKFLOW_REVIEW_STATE_ORDER.map((state) => ({
    state,
    label: reviewStateLabel(state),
    visible: state !== "reviewed",
    reviewOnly: true,
    reason: state === "reviewed"
      ? "Reserved for future canonical review evidence; continuity does not infer completed review."
      : reviewStateReason(state),
    missingDataEffect: state === "reviewed"
      ? "Completed-review evidence is not available in the current read model."
      : "Missing data lowers confidence or changes visibility text only.",
    sourceWorkflowGroupKinds: [],
    sourceMultiOperatorGroupKinds: [],
    confidence: state === "reviewed" ? "unknown" : "medium",
  }));
}

function reviewStateDto(item: MultiOperatorWorkflowItem): WorkflowReviewStateVisibilityDTO {
  const state = reviewStateFor(item);
  return {
    state,
    label: reviewStateLabel(state),
    visible: true,
    reviewOnly: true,
    reason: reviewStateReason(state),
    missingDataEffect: missingDataEffectForState(item, state),
    sourceWorkflowGroupKinds: item.sourceWorkflowGroupKinds,
    sourceMultiOperatorGroupKinds: sourceMultiOperatorGroups(item),
    confidence: combineConfidence([item.confidence, item.assignmentConfidence?.level ?? "unknown"]),
  };
}

function reviewStateFor(item: MultiOperatorWorkflowItem): WorkflowReviewStateKind {
  if (item.sourceWorkflowGroupKinds.includes("follow_up_review")) return "waiting_for_followup_review";
  if (item.lifecycle === "DORMANT" || item.lifecycle === "REACTIVATION" || item.sourceWorkflowGroupKinds.includes("reactivation_review")) {
    return "dormant_review";
  }
  if (item.escalationReviewState.state === "needs_escalation") return "escalated_review";
  if (item.escalationReviewState.state === "needs_manager_review" || item.internReviewState.managerReviewRequired) {
    return "manager_review";
  }
  if (item.sharedWorkflowState.shared) return "shared_review";
  if (item.assignmentVisibility.visibleToViewer) return "in_review";
  return "not_reviewed";
}

function workflowContinuitySummaryDto(
  item: MultiOperatorWorkflowItem,
  state: WorkflowReviewStateKind,
): WorkflowContinuitySummaryDTO {
  return {
    summary: `${item.displayName} is visible for ${reviewStateLabel(state).toLowerCase()}.`,
    progressionState: progressionStateFor(state),
    reviewContinuityReason: reviewStateReason(state),
    workflowProgressionVisible: true,
    reviewOnly: true,
  };
}

function assignmentContextDto(item: MultiOperatorWorkflowItem): AssignmentContinuityContextDTO {
  return {
    assignmentState: item.assignedOperator.assignmentState,
    ...(item.assignedOperator.operatorId ? { assignedOperatorId: item.assignedOperator.operatorId } : {}),
    ownershipState: item.workflowOwnership.ownershipState,
    visibleOperatorCount: item.workflowOwnership.visibleOperatorCount,
    shared: item.sharedWorkflowState.shared,
    visibleToViewer: item.assignmentVisibility.visibleToViewer,
    assignmentConfidence: item.assignmentConfidence.level,
    whyAssigned: item.whyAssigned,
    whyVisible: item.whyVisible,
    source: "relationship_engine_owner_visibility",
    reviewOnly: true,
  };
}

function relationshipContextDto(item: MultiOperatorWorkflowItem): RelationshipContinuityContextDTO {
  return {
    relationshipId: item.relationshipId,
    displayName: item.displayName,
    lifecycle: item.lifecycle,
    lifecycleContext: item.lifecycleContext,
    sourceWorkflowGroupKinds: item.sourceWorkflowGroupKinds,
    sourceQueueKind: item.deterministicOrder.sourceQueueKind,
    latestEvidence: latestEvidence(item.whyNow.evidenceReferences),
    reasonCodes: item.whyNow.reasonCodes,
    whyNow: item.whyNow.summary,
    reviewOnly: true,
  };
}

function previousReviewerDto(): OperatorReviewerDTO {
  return {
    state: "not_observed",
    source: "relationship_engine_review_visibility",
    reason: "No canonical previous-reviewer field is exposed by the current read model.",
    confidence: "unknown",
  };
}

function latestReviewerDto(item: MultiOperatorWorkflowItem): OperatorReviewerDTO {
  if (item.assignedOperator.operatorId) {
    return {
      state: "assignment_anchor",
      operatorId: item.assignedOperator.operatorId,
      source: "relationship_engine_owner_visibility",
      reason: "Canonical owner visibility is the current handoff anchor; no review completion is inferred.",
      ...(item.assignedOperator.latestAssignmentEventId ? { latestAssignmentEventId: item.assignedOperator.latestAssignmentEventId } : {}),
      confidence: item.assignedOperator.confidence,
    };
  }
  return {
    state: "not_observed",
    source: "relationship_engine_review_visibility",
    reason: "No canonical latest reviewer is visible; the relationship remains waiting for human review.",
    confidence: "unknown",
  };
}

function continuityGroupKindsFor(
  item: MultiOperatorWorkflowItem,
  state: WorkflowReviewStateKind,
): WorkflowContinuityGroupingKind[] {
  return WORKFLOW_CONTINUITY_GROUP_ORDER.filter((groupKind) => {
    switch (groupKind) {
      case "in_review":
        return ["in_review", "shared_review"].includes(state) || item.assignmentVisibility.visibleToViewer;
      case "shared_review":
        return item.sharedWorkflowState.shared || state === "shared_review";
      case "escalated_review":
        return state === "escalated_review" || item.escalationReviewState.state === "needs_escalation";
      case "manager_review":
        return state === "manager_review" || item.internReviewState.managerReviewRequired;
      case "waiting_for_review":
        return state === "not_reviewed" || item.assignedOperator.assignmentState === "unassigned" || latestReviewerDto(item).state === "not_observed";
      case "dormant_relationship_review":
        return state === "dormant_review";
      case "follow_up_continuity_review":
        return state === "waiting_for_followup_review";
    }
  });
}

function sourceMultiOperatorGroups(item: MultiOperatorWorkflowItem): MultiOperatorWorkflowGroupingKind[] {
  return item.deterministicOrder.displayedInGroupKinds.length > 0
    ? item.deterministicOrder.displayedInGroupKinds
    : [item.deterministicOrder.primaryGroupKind];
}

function buildContinuityGroup(
  generatedAt: IsoDateString,
  groupKind: WorkflowContinuityGroupingKind,
  items: WorkflowContinuityItem[],
): WorkflowContinuityGroup {
  const definition = GROUP_DEFINITIONS[groupKind];
  const groupItems = items
    .filter((item) => item.deterministicOrder.displayedInGroupKinds.includes(groupKind))
    .sort(compareContinuityItems);
  return {
    groupKind,
    label: definition.label,
    description: definition.description,
    generatedAt,
    visibilityReason: definition.visibilityReason,
    roleAudience: definition.roleAudience,
    items: groupItems,
    confidence: combineConfidence(groupItems.map((item) => item.confidence)),
    missingDataEffects: uniqueMissingDataEffects(groupItems.flatMap((item) => item.missingDataEffects)),
    ordering: WORKFLOW_CONTINUITY_ORDERING,
    reviewOnly: true,
  };
}

function validateProjection(
  groups: WorkflowContinuityGroup[],
  items: WorkflowContinuityItem[],
): WorkflowContinuityValidationResult {
  const issues: WorkflowContinuityValidationIssue[] = [];
  for (const group of groups) {
    const seen = new Set<RelationshipId>();
    if (group.reviewOnly !== true) {
      issues.push(error("continuity_group_not_review_only", "Continuity groups must remain review-only.", group.groupKind));
    }
    for (const item of group.items) {
      if (seen.has(item.relationshipId)) {
        issues.push(error("duplicate_continuity_relationship", "Continuity group contains a duplicate relationship.", group.groupKind, item.relationshipId));
      }
      seen.add(item.relationshipId);
      if (!item.deterministicOrder.displayedInGroupKinds.includes(group.groupKind)) {
        issues.push(error("continuity_group_membership_mismatch", "Item displayed group metadata does not include the parent group.", group.groupKind, item.relationshipId));
      }
      if (item.explainability.latestEvidence.length === 0) {
        issues.push(warning("continuity_item_missing_evidence", "Continuity item has no latest evidence; consumers must show low-evidence context.", group.groupKind, item.relationshipId));
      }
    }
  }
  for (const item of items) {
    if (item.reviewOnly !== true) {
      issues.push(error("continuity_item_not_review_only", "Continuity items must remain review-only.", undefined, item.relationshipId));
    }
    if (item.deterministicOrder.displayedInGroupKinds.length === 0) {
      issues.push(warning("continuity_item_without_group", "Continuity item has no deterministic group membership.", undefined, item.relationshipId));
    }
    if (!item.explainability.whyVisible || !item.explainability.reviewContinuityReason) {
      issues.push(error("continuity_item_missing_explainability", "Continuity item must expose why visible and review continuity reason.", undefined, item.relationshipId));
    }
  }
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

function latestEvidence(
  evidence: RelationshipProjectionEvidencePointer[],
): RelationshipProjectionEvidencePointer[] {
  return [...evidence].sort((a, b) =>
    (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "")
    || (b.timelineEventId ?? "").localeCompare(a.timelineEventId ?? "")
    || a.description.localeCompare(b.description)).slice(0, 3);
}

function latestReviewTimestamp(item: MultiOperatorWorkflowItem): IsoDateString | undefined {
  return latestEvidence(item.whyNow.evidenceReferences)[0]?.occurredAt;
}

function handoffConfidence(item: MultiOperatorWorkflowItem): ConfidenceLevel {
  if (item.assignedOperator.assignmentState === "unassigned") return "low";
  if (item.assignedOperator.confidence === "unknown") return "unknown";
  if (item.assignedOperator.confidence === "low" || item.confidence === "low" || item.confidence === "unknown") return "low";
  return "medium";
}

function reviewStateReason(state: WorkflowReviewStateKind): string {
  switch (state) {
    case "not_reviewed":
      return "No canonical review activity is visible; continuity remains waiting for human review.";
    case "in_review":
      return "The relationship is visible in an active operator review lane.";
    case "reviewed":
      return "Canonical completed-review evidence is required before continuity can show reviewed.";
    case "shared_review":
      return "Multiple operators are visible, so handoff context must remain explicit.";
    case "escalated_review":
      return "Assignment or missing-data context requires escalation visibility.";
    case "manager_review":
      return "Manager context is required before downstream operator or intern action.";
    case "waiting_for_followup_review":
      return "Follow-up continuity is visible, but no reminder or follow-up execution is triggered.";
    case "dormant_review":
      return "Dormant relationship continuity is visible without reactivation automation.";
  }
}

function reviewStateLabel(state: WorkflowReviewStateKind): string {
  switch (state) {
    case "not_reviewed":
      return "Not Reviewed";
    case "in_review":
      return "In Review";
    case "reviewed":
      return "Reviewed";
    case "shared_review":
      return "Shared Review";
    case "escalated_review":
      return "Escalated Review";
    case "manager_review":
      return "Manager Review";
    case "waiting_for_followup_review":
      return "Waiting For Follow-Up Review";
    case "dormant_review":
      return "Dormant Review";
  }
}

function progressionStateFor(state: WorkflowReviewStateKind): WorkflowContinuitySummaryDTO["progressionState"] {
  switch (state) {
    case "not_reviewed":
      return "not_started";
    case "in_review":
      return "active_review";
    case "reviewed":
      return "review_complete_not_inferred";
    case "shared_review":
      return "shared_review";
    case "escalated_review":
      return "escalation_review";
    case "manager_review":
      return "manager_review";
    case "waiting_for_followup_review":
      return "follow_up_review";
    case "dormant_review":
      return "dormant_review";
  }
}

function missingDataEffectForState(
  item: MultiOperatorWorkflowItem,
  state: WorkflowReviewStateKind,
): string {
  if (item.missingDataEffects.length === 0) return "No missing-data effect is reported for this continuity item.";
  if (state === "not_reviewed" || state === "escalated_review" || state === "manager_review") {
    return "Missing data is exposed as handoff context and does not trigger assignment or escalation actions.";
  }
  return "Missing data is visible as confidence context only.";
}

function withItemRank(item: WorkflowContinuityItem, index: number): WorkflowContinuityItem {
  const deterministicOrder = {
    ...item.deterministicOrder,
    itemRank: index + 1,
  };
  return {
    ...item,
    deterministicOrder,
    explainability: {
      ...item.explainability,
      deterministicOrdering: deterministicOrder,
    },
  };
}

function groupItems(
  groups: WorkflowContinuityGroup[],
  groupKind: WorkflowContinuityGroupingKind,
): WorkflowContinuityItem[] {
  return groups.find((group) => group.groupKind === groupKind)?.items ?? [];
}

function groupCounts(
  groups: WorkflowContinuityGroup[],
): Record<WorkflowContinuityGroupingKind, number> {
  return Object.fromEntries(WORKFLOW_CONTINUITY_GROUP_ORDER.map((groupKind) => [
    groupKind,
    groups.find((group) => group.groupKind === groupKind)?.items.length ?? 0,
  ])) as Record<WorkflowContinuityGroupingKind, number>;
}

function reviewStateCounts(items: WorkflowContinuityItem[]): Record<WorkflowReviewStateKind, number> {
  return Object.fromEntries(WORKFLOW_REVIEW_STATE_ORDER.map((state) => [
    state,
    items.filter((item) => item.reviewState.state === state).length,
  ])) as Record<WorkflowReviewStateKind, number>;
}

function compareContinuityItems(a: WorkflowContinuityItem, b: WorkflowContinuityItem): number {
  return a.deterministicOrder.sortKey.localeCompare(b.deterministicOrder.sortKey)
    || a.relationshipId.localeCompare(b.relationshipId);
}

function continuitySortKey(
  primaryGroupRank: number,
  reviewState: WorkflowReviewStateKind,
  sourceMultiOperatorGroupKind: MultiOperatorWorkflowGroupingKind,
  sourceWorkflowGroupKind: RelationshipWorkflowGroupingKind,
  item: MultiOperatorWorkflowItem,
): string {
  return [
    String(primaryGroupRank).padStart(2, "0"),
    String(reviewStateRank(reviewState)).padStart(2, "0"),
    String(sourceMultiOperatorGroupRank(sourceMultiOperatorGroupKind)).padStart(2, "0"),
    String(sourceWorkflowGroupRank(sourceWorkflowGroupKind)).padStart(2, "0"),
    item.deterministicOrder.sourceQueueRankKey,
    item.relationshipId,
  ].join("|");
}

function groupRank(kind: WorkflowContinuityGroupingKind): number {
  const index = WORKFLOW_CONTINUITY_GROUP_ORDER.indexOf(kind);
  return index === -1 ? WORKFLOW_CONTINUITY_GROUP_ORDER.length + 1 : index + 1;
}

function reviewStateRank(kind: WorkflowReviewStateKind): number {
  const index = WORKFLOW_REVIEW_STATE_ORDER.indexOf(kind);
  return index === -1 ? WORKFLOW_REVIEW_STATE_ORDER.length + 1 : index + 1;
}

function sourceMultiOperatorGroupRank(kind: MultiOperatorWorkflowGroupingKind): number {
  const index = WORKFLOW_CONTINUITY_ORDERING.sourceMultiOperatorGroupOrder.indexOf(kind);
  return index === -1 ? WORKFLOW_CONTINUITY_ORDERING.sourceMultiOperatorGroupOrder.length + 1 : index + 1;
}

function sourceWorkflowGroupRank(kind: RelationshipWorkflowGroupingKind): number {
  const index = WORKFLOW_CONTINUITY_ORDERING.sourceWorkflowGroupOrder.indexOf(kind);
  return index === -1 ? WORKFLOW_CONTINUITY_ORDERING.sourceWorkflowGroupOrder.length + 1 : index + 1;
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
  groupKind?: WorkflowContinuityGroupingKind,
  relationshipId?: RelationshipId,
): WorkflowContinuityValidationIssue {
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
  groupKind?: WorkflowContinuityGroupingKind,
  relationshipId?: RelationshipId,
): WorkflowContinuityValidationIssue {
  return {
    severity: "warning",
    code,
    message,
    ...(groupKind ? { groupKind } : {}),
    ...(relationshipId ? { relationshipId } : {}),
  };
}
