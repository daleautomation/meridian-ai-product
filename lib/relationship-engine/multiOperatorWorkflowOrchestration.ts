// Meridian Relationship Engine — multi-operator workflow orchestration DTOs.
//
// This layer organizes already-projected workflow visibility for multiple human
// operators. It never assigns owners, executes queues, persists projections,
// sends reminders or notifications, writes Neon, or computes production scores.

import type {
  ConfidenceLevel,
  IsoDateString,
  OperatorId,
  RelationshipId,
  TimelineEventId,
} from "./primitives";
import type { RelationshipProjectionMissingData } from "./projections/dto";
import type { RelationshipReadModelLifecycleContext } from "./projections/operatorReadModels";
import type {
  RelationshipWorkflowGroupingKind,
  RelationshipWorkflowProjection,
  WorkflowReadyRelationshipSummary,
} from "./workflowIntegration";

export type MultiOperatorWorkflowRole =
  | "operator"
  | "intern"
  | "account_manager"
  | "admin_operator"
  | "review_coordinator";

export type MultiOperatorWorkflowGroupingKind =
  | "my_relationships"
  | "unassigned_review"
  | "shared_review"
  | "intern_queue"
  | "needs_escalation"
  | "needs_manager_review"
  | "follow_up_review";

export type WorkflowOwnershipState =
  | "assigned_to_viewer"
  | "assigned_to_other_operator"
  | "shared_visibility"
  | "unassigned";

export type AssignmentVisibilityState =
  | "viewer_primary_owner"
  | "viewer_shared_reviewer"
  | "assigned_operator_visible"
  | "unassigned_review_visible"
  | "shared_review_visible"
  | "global_review_visible";

export type InternReviewStateKind =
  | "ready_for_intern_review"
  | "manager_context_required"
  | "not_intern_visible";

export type EscalationReviewStateKind =
  | "needs_escalation"
  | "needs_manager_review"
  | "standard_review";

export interface MultiOperatorWorkflowBoundaryPolicy {
  orchestrationMode: "multi_operator_visibility_read_model";
  consumesWorkflowProjectionOnly: true;
  consumesServiceProjectionsOnly: true;
  repositoriesAllowed: false;
  uiDerivedOwnershipAllowed: false;
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

export interface MultiOperatorWorkflowViewerContext {
  operatorId?: OperatorId;
  label: string;
  role: MultiOperatorWorkflowRole;
  sourceAccessRole?: string;
  visibilityScope:
    | "assigned_and_shared_review"
    | "all_review_groups"
    | "intern_review"
    | "manager_review";
}

export interface AssignedOperatorDTO {
  operatorId?: OperatorId;
  assignmentState: "assigned" | "unassigned";
  source: "relationship_engine_owner_visibility";
  whyAssigned: string;
  latestAssignmentEventId?: TimelineEventId;
  confidence: ConfidenceLevel;
}

export interface WorkflowOwnershipDTO {
  ownershipState: WorkflowOwnershipState;
  ownerId?: OperatorId;
  visibleTo: OperatorId[];
  visibleOperatorCount: number;
  relationshipEngineInformed: true;
  whyOwned: string;
}

export interface AssignmentVisibilityDTO {
  visibilityState: AssignmentVisibilityState;
  visibleToViewer: boolean;
  visibilityReason: string;
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
}

export interface AssignmentConfidenceDTO {
  level: ConfidenceLevel;
  reason: string;
  missingDataEffects: RelationshipProjectionMissingData[];
}

export interface SharedWorkflowStateDTO {
  shared: boolean;
  visibleTo: OperatorId[];
  reason: string;
  reviewOnly: true;
}

export interface InternReviewStateDTO {
  state: InternReviewStateKind;
  visibleInInternQueue: boolean;
  managerReviewRequired: boolean;
  reason: string;
  reviewOnly: true;
}

export interface EscalationReviewStateDTO {
  state: EscalationReviewStateKind;
  reasonCodes: string[];
  reason: string;
  reviewOnly: true;
}

export interface MultiOperatorWorkflowDeterministicOrder {
  strategy: "deterministic_multi_operator_workflow_grouping_v0";
  primaryGroupKind: MultiOperatorWorkflowGroupingKind;
  primaryGroupRank: number;
  sourceWorkflowGroupKind: RelationshipWorkflowGroupingKind;
  sourceWorkflowGroupRank: number;
  sourceQueueKind: WorkflowReadyRelationshipSummary["deterministicOrder"]["sourceQueueKind"];
  sourceQueueRank: number;
  sourceQueueRankKey: string;
  itemRank: number;
  sortKey: string;
  displayedInGroupKinds: MultiOperatorWorkflowGroupingKind[];
}

export interface MultiOperatorWorkflowItem {
  relationshipId: RelationshipId;
  displayName: string;
  lifecycle: WorkflowReadyRelationshipSummary["lifecycle"];
  warmth: WorkflowReadyRelationshipSummary["warmth"];
  healthScore?: number;
  healthConfidence: ConfidenceLevel;
  confidence: ConfidenceLevel;
  assignedOperator: AssignedOperatorDTO;
  workflowOwnership: WorkflowOwnershipDTO;
  assignmentVisibility: AssignmentVisibilityDTO;
  assignmentConfidence: AssignmentConfidenceDTO;
  sharedWorkflowState: SharedWorkflowStateDTO;
  internReviewState: InternReviewStateDTO;
  escalationReviewState: EscalationReviewStateDTO;
  whyAssigned: string;
  whyVisible: string;
  lifecycleContext: RelationshipReadModelLifecycleContext;
  missingDataEffects: RelationshipProjectionMissingData[];
  sourceWorkflowGroupKinds: RelationshipWorkflowGroupingKind[];
  whyNow: WorkflowReadyRelationshipSummary["whyNow"];
  deterministicOrder: MultiOperatorWorkflowDeterministicOrder;
}

export interface MultiOperatorWorkflowGroup {
  groupKind: MultiOperatorWorkflowGroupingKind;
  label: string;
  description: string;
  generatedAt: IsoDateString;
  operatorQueueSegment: boolean;
  roleAudience: MultiOperatorWorkflowRole[];
  visibilityReason: string;
  items: MultiOperatorWorkflowItem[];
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  ordering: MultiOperatorWorkflowOrderingMetadata;
  reviewOnly: true;
}

export interface MultiOperatorWorkflowOrderingMetadata {
  strategy: "deterministic_multi_operator_workflow_grouping_v0";
  productionScoring: false;
  groupOrder: MultiOperatorWorkflowGroupingKind[];
  sourceWorkflowGroupOrder: RelationshipWorkflowGroupingKind[];
  itemSortKeys: string[];
  tieBreakers: string[];
}

export interface MultiOperatorWorkflowValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  groupKind?: MultiOperatorWorkflowGroupingKind;
  relationshipId?: RelationshipId;
}

export interface MultiOperatorWorkflowValidationResult {
  ok: boolean;
  issues: MultiOperatorWorkflowValidationIssue[];
}

export interface MultiOperatorWorkflowExplanation {
  generatedBy: "multi_operator_workflow_orchestration_read_model";
  generatedAt: IsoDateString;
  notes: string[];
}

export interface MultiOperatorWorkflowOrchestrationProjection {
  kind: "multi_operator_workflow_orchestration";
  generatedAt: IsoDateString;
  viewer: MultiOperatorWorkflowViewerContext;
  boundary: MultiOperatorWorkflowBoundaryPolicy;
  ordering: MultiOperatorWorkflowOrderingMetadata;
  groups: MultiOperatorWorkflowGroup[];
  items: MultiOperatorWorkflowItem[];
  workloadSummary: {
    myRelationships: number;
    unassignedReview: number;
    sharedReview: number;
    internQueue: number;
    needsEscalation: number;
    needsManagerReview: number;
    followUpReview: number;
  };
  visibility: {
    myRelationships: MultiOperatorWorkflowItem[];
    unassignedReview: MultiOperatorWorkflowItem[];
    sharedReview: MultiOperatorWorkflowItem[];
    internQueue: MultiOperatorWorkflowItem[];
    needsEscalation: MultiOperatorWorkflowItem[];
    needsManagerReview: MultiOperatorWorkflowItem[];
    followUpReview: MultiOperatorWorkflowItem[];
  };
  metadata: {
    groupCounts: Record<MultiOperatorWorkflowGroupingKind, number>;
    confidence: ConfidenceLevel;
    missingDataEffects: RelationshipProjectionMissingData[];
    assignmentOverlap: Array<{
      relationshipId: RelationshipId;
      primaryGroupKind: MultiOperatorWorkflowGroupingKind;
      displayedInGroupKinds: MultiOperatorWorkflowGroupingKind[];
    }>;
  };
  explanation: MultiOperatorWorkflowExplanation;
  validation: MultiOperatorWorkflowValidationResult;
}

export interface MultiOperatorWorkflowOrchestrationInput {
  generatedAt: IsoDateString;
  workflow: RelationshipWorkflowProjection;
  viewer?: MultiOperatorWorkflowViewerContext;
}

export const MULTI_OPERATOR_WORKFLOW_BOUNDARY: MultiOperatorWorkflowBoundaryPolicy = {
  orchestrationMode: "multi_operator_visibility_read_model",
  consumesWorkflowProjectionOnly: true,
  consumesServiceProjectionsOnly: true,
  repositoriesAllowed: false,
  uiDerivedOwnershipAllowed: false,
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

export const MULTI_OPERATOR_WORKFLOW_GROUP_ORDER: MultiOperatorWorkflowGroupingKind[] = [
  "my_relationships",
  "unassigned_review",
  "shared_review",
  "intern_queue",
  "needs_escalation",
  "needs_manager_review",
  "follow_up_review",
];

export const MULTI_OPERATOR_WORKFLOW_ORDERING: MultiOperatorWorkflowOrderingMetadata = {
  strategy: "deterministic_multi_operator_workflow_grouping_v0",
  productionScoring: false,
  groupOrder: MULTI_OPERATOR_WORKFLOW_GROUP_ORDER,
  sourceWorkflowGroupOrder: [
    "needs_relationship_attention",
    "stale_relationship_review",
    "follow_up_review",
    "retention_review",
    "warm_opportunity_review",
    "reactivation_review",
  ],
  itemSortKeys: [
    "primary group rank asc",
    "source workflow sort key asc",
    "relationshipId asc",
  ],
  tieBreakers: ["relationshipId", "source workflow group", "source queue kind", "source queue rank key"],
};

const DEFAULT_VIEWER: MultiOperatorWorkflowViewerContext = {
  label: "All operators",
  role: "review_coordinator",
  visibilityScope: "all_review_groups",
};

const GROUP_DEFINITIONS: Record<MultiOperatorWorkflowGroupingKind, {
  label: string;
  description: string;
  roleAudience: MultiOperatorWorkflowRole[];
  visibilityReason: string;
}> = {
  my_relationships: {
    label: "My Relationships",
    description: "Relationships where the current operator is the canonical primary owner.",
    roleAudience: ["operator", "account_manager", "admin_operator"],
    visibilityReason: "Current operator id matches relationship-engine owner visibility.",
  },
  unassigned_review: {
    label: "Unassigned Review",
    description: "Relationships with no canonical owner; managers can review without auto-assignment.",
    roleAudience: ["account_manager", "admin_operator", "review_coordinator"],
    visibilityReason: "Relationship owner visibility is unassigned.",
  },
  shared_review: {
    label: "Shared Review",
    description: "Relationships visible to multiple operators and needing ownership clarity.",
    roleAudience: ["operator", "account_manager", "admin_operator"],
    visibilityReason: "Relationship owner visibility includes more than one operator.",
  },
  intern_queue: {
    label: "Intern Queue",
    description: "Explainable, review-only relationships safe for intern triage.",
    roleAudience: ["intern", "account_manager", "admin_operator"],
    visibilityReason: "Relationship has enough assignment and confidence context for intern review.",
  },
  needs_escalation: {
    label: "Needs Escalation",
    description: "Relationships with assignment gaps or low-confidence visibility requiring human escalation review.",
    roleAudience: ["account_manager", "admin_operator"],
    visibilityReason: "Assignment confidence, missing data, or lifecycle risk requires escalation visibility.",
  },
  needs_manager_review: {
    label: "Needs Manager Review",
    description: "Relationships that account managers should inspect before interns or operators act.",
    roleAudience: ["account_manager", "admin_operator"],
    visibilityReason: "Manager review is indicated by shared ownership, unassigned state, or retention context.",
  },
  follow_up_review: {
    label: "Follow-Up Review",
    description: "Follow-up workflows separated for human review without reminders or execution.",
    roleAudience: ["operator", "intern", "account_manager", "admin_operator"],
    visibilityReason: "Source workflow group is follow-up review.",
  },
};

export function projectMultiOperatorWorkflowOrchestration(
  input: MultiOperatorWorkflowOrchestrationInput,
): MultiOperatorWorkflowOrchestrationProjection {
  const viewer = input.viewer ?? DEFAULT_VIEWER;
  const sourceItems = uniqueWorkflowItems(input.workflow.relationshipSummaries);
  const items = sourceItems
    .map((item) => buildMultiOperatorItem(item, sourceGroupsFor(item, input.workflow), viewer))
    .sort(compareMultiOperatorItems)
    .map((item, index) => withItemRank(item, index));
  const groups = MULTI_OPERATOR_WORKFLOW_GROUP_ORDER.map((groupKind) =>
    buildGroup(input.generatedAt, groupKind, items));
  const validation = validateProjection(groups, items);
  const visibility = {
    myRelationships: groupItems(groups, "my_relationships"),
    unassignedReview: groupItems(groups, "unassigned_review"),
    sharedReview: groupItems(groups, "shared_review"),
    internQueue: groupItems(groups, "intern_queue"),
    needsEscalation: groupItems(groups, "needs_escalation"),
    needsManagerReview: groupItems(groups, "needs_manager_review"),
    followUpReview: groupItems(groups, "follow_up_review"),
  };

  return {
    kind: "multi_operator_workflow_orchestration",
    generatedAt: input.generatedAt,
    viewer,
    boundary: MULTI_OPERATOR_WORKFLOW_BOUNDARY,
    ordering: MULTI_OPERATOR_WORKFLOW_ORDERING,
    groups,
    items,
    workloadSummary: {
      myRelationships: visibility.myRelationships.length,
      unassignedReview: visibility.unassignedReview.length,
      sharedReview: visibility.sharedReview.length,
      internQueue: visibility.internQueue.length,
      needsEscalation: visibility.needsEscalation.length,
      needsManagerReview: visibility.needsManagerReview.length,
      followUpReview: visibility.followUpReview.length,
    },
    visibility,
    metadata: {
      groupCounts: groupCounts(groups),
      confidence: combineConfidence(items.map((item) => item.confidence)),
      missingDataEffects: uniqueMissingDataEffects(items.flatMap((item) => item.missingDataEffects)),
      assignmentOverlap: items.map((item) => ({
        relationshipId: item.relationshipId,
        primaryGroupKind: item.deterministicOrder.primaryGroupKind,
        displayedInGroupKinds: item.deterministicOrder.displayedInGroupKinds,
      })),
    },
    explanation: {
      generatedBy: "multi_operator_workflow_orchestration_read_model",
      generatedAt: input.generatedAt,
      notes: [
        "Multi-operator orchestration is assignment visibility only; it never mutates owners or creates assignments.",
        "Grouping consumes RelationshipWorkflowProjection DTOs produced by service/API boundaries, never repositories or UI state.",
        "Intern, manager, escalation, shared, and follow-up queues are review surfaces, not executable queues.",
        "Missing owner or low-confidence data remains visible as context and does not trigger automation.",
      ],
    },
    validation,
  };
}

function buildMultiOperatorItem(
  item: WorkflowReadyRelationshipSummary,
  sourceWorkflowGroupKinds: RelationshipWorkflowGroupingKind[],
  viewer: MultiOperatorWorkflowViewerContext,
): MultiOperatorWorkflowItem {
  const assignedOperator = assignedOperatorDto(item);
  const workflowOwnership = ownershipDto(item, viewer);
  const assignmentVisibility = visibilityDto(item, viewer, workflowOwnership);
  const assignmentConfidence = assignmentConfidenceDto(item);
  const sharedWorkflowState = sharedStateDto(item);
  const escalationReviewState = escalationStateDto(item, sourceWorkflowGroupKinds);
  const internReviewState = internStateDto(item, escalationReviewState);
  const displayedInGroupKinds = groupKindsForItem(
    item,
    workflowOwnership,
    internReviewState,
    escalationReviewState,
    sourceWorkflowGroupKinds,
  );
  const primaryGroupKind = displayedInGroupKinds[0] ?? "needs_manager_review";
  const primaryGroupRank = groupRank(primaryGroupKind);
  const sourceWorkflowGroupKind = sourceWorkflowGroupKinds[0] ?? item.deterministicOrder.groupKind;
  const sourceWorkflowGroupRank = sourceGroupRank(sourceWorkflowGroupKind);

  return {
    relationshipId: item.relationshipId,
    displayName: item.displayName,
    lifecycle: item.lifecycle,
    warmth: item.warmth,
    ...(item.healthScore === undefined ? {} : { healthScore: item.healthScore }),
    healthConfidence: item.healthConfidence,
    confidence: item.confidence,
    assignedOperator,
    workflowOwnership,
    assignmentVisibility,
    assignmentConfidence,
    sharedWorkflowState,
    internReviewState,
    escalationReviewState,
    whyAssigned: assignedOperator.whyAssigned,
    whyVisible: assignmentVisibility.visibilityReason,
    lifecycleContext: item.lifecycleContext,
    missingDataEffects: item.missingDataEffects,
    sourceWorkflowGroupKinds,
    whyNow: item.whyNow,
    deterministicOrder: {
      strategy: "deterministic_multi_operator_workflow_grouping_v0",
      primaryGroupKind,
      primaryGroupRank,
      sourceWorkflowGroupKind,
      sourceWorkflowGroupRank,
      sourceQueueKind: item.deterministicOrder.sourceQueueKind,
      sourceQueueRank: item.deterministicOrder.sourceQueueRank,
      sourceQueueRankKey: item.deterministicOrder.sourceQueueRankKey,
      itemRank: 0,
      sortKey: multiOperatorSortKey(primaryGroupRank, sourceWorkflowGroupRank, item),
      displayedInGroupKinds,
    },
  };
}

function assignedOperatorDto(item: WorkflowReadyRelationshipSummary): AssignedOperatorDTO {
  const ownerId = item.ownerVisibility.ownerId;
  return {
    ...(ownerId ? { operatorId: ownerId } : {}),
    assignmentState: ownerId ? "assigned" : "unassigned",
    source: "relationship_engine_owner_visibility",
    whyAssigned: ownerId
      ? "Canonical relationship-engine owner visibility identifies the assigned operator."
      : "No canonical relationship-engine owner is visible; the item remains unassigned for review.",
    ...(item.ownerVisibility.latestAssignmentEventId ? { latestAssignmentEventId: item.ownerVisibility.latestAssignmentEventId } : {}),
    confidence: item.ownerVisibility.confidence,
  };
}

function ownershipDto(
  item: WorkflowReadyRelationshipSummary,
  viewer: MultiOperatorWorkflowViewerContext,
): WorkflowOwnershipDTO {
  const ownerId = item.ownerVisibility.ownerId;
  const visibleTo = [...item.ownerVisibility.visibleTo].sort();
  const shared = visibleTo.length > 1;
  const viewerOwns = Boolean(viewer.operatorId && ownerId === viewer.operatorId);
  const ownershipState: WorkflowOwnershipState = item.ownerVisibility.unassigned
    ? "unassigned"
    : shared
      ? "shared_visibility"
      : viewerOwns
        ? "assigned_to_viewer"
        : "assigned_to_other_operator";
  return {
    ownershipState,
    ...(ownerId ? { ownerId } : {}),
    visibleTo,
    visibleOperatorCount: visibleTo.length,
    relationshipEngineInformed: true,
    whyOwned: ownershipExplanation(ownershipState),
  };
}

function visibilityDto(
  item: WorkflowReadyRelationshipSummary,
  viewer: MultiOperatorWorkflowViewerContext,
  ownership: WorkflowOwnershipDTO,
): AssignmentVisibilityDTO {
  const viewerIsOwner = Boolean(viewer.operatorId && ownership.ownerId === viewer.operatorId);
  const viewerShared = Boolean(viewer.operatorId && ownership.visibleTo.includes(viewer.operatorId) && !viewerIsOwner);
  const visibleToViewer = viewer.visibilityScope === "all_review_groups"
    || viewer.visibilityScope === "manager_review"
    || viewerIsOwner
    || viewerShared;
  const visibilityState: AssignmentVisibilityState = viewerIsOwner
    ? "viewer_primary_owner"
    : viewerShared
      ? "viewer_shared_reviewer"
      : item.ownerVisibility.unassigned
        ? "unassigned_review_visible"
        : ownership.visibleOperatorCount > 1
          ? "shared_review_visible"
          : ownership.ownerId
            ? "assigned_operator_visible"
            : "global_review_visible";

  return {
    visibilityState,
    visibleToViewer,
    visibilityReason: visibilityExplanation(visibilityState, viewer),
    confidence: item.ownerVisibility.confidence,
    missingDataEffects: item.missingDataEffects,
  };
}

function assignmentConfidenceDto(item: WorkflowReadyRelationshipSummary): AssignmentConfidenceDTO {
  const hasOwner = Boolean(item.ownerVisibility.ownerId);
  return {
    level: item.ownerVisibility.confidence,
    reason: hasOwner
      ? "Assignment confidence comes from relationship-engine owner visibility evidence."
      : "Assignment confidence is limited because no canonical owner is visible.",
    missingDataEffects: item.missingDataEffects.filter((effect) => effect.field === "ownerVisibility"),
  };
}

function sharedStateDto(item: WorkflowReadyRelationshipSummary): SharedWorkflowStateDTO {
  const visibleTo = [...item.ownerVisibility.visibleTo].sort();
  return {
    shared: visibleTo.length > 1,
    visibleTo,
    reason: visibleTo.length > 1
      ? "More than one operator is visible on the relationship; ownership should stay explicit."
      : "Relationship has a single visible operator or is unassigned.",
    reviewOnly: true,
  };
}

function internStateDto(
  item: WorkflowReadyRelationshipSummary,
  escalation: EscalationReviewStateDTO,
): InternReviewStateDTO {
  const managerReviewRequired = escalation.state !== "standard_review" || item.ownerVisibility.unassigned;
  const visibleInInternQueue = !managerReviewRequired
    && ["high", "medium"].includes(item.confidence)
    && !item.lifecycleContext.terminal;
  if (visibleInInternQueue) {
    return {
      state: "ready_for_intern_review",
      visibleInInternQueue: true,
      managerReviewRequired: false,
      reason: "Assignment, lifecycle, and confidence context are clear enough for intern review visibility.",
      reviewOnly: true,
    };
  }
  return {
    state: managerReviewRequired ? "manager_context_required" : "not_intern_visible",
    visibleInInternQueue: false,
    managerReviewRequired,
    reason: managerReviewRequired
      ? "Manager review is required before this relationship should appear in intern triage."
      : "Relationship is withheld from intern queue visibility by confidence or lifecycle context.",
    reviewOnly: true,
  };
}

function escalationStateDto(
  item: WorkflowReadyRelationshipSummary,
  sourceWorkflowGroupKinds: RelationshipWorkflowGroupingKind[],
): EscalationReviewStateDTO {
  const reasonCodes: string[] = [];
  if (item.ownerVisibility.unassigned) reasonCodes.push("unassigned_relationship");
  if (item.ownerVisibility.confidence === "low" || item.ownerVisibility.confidence === "unknown") {
    reasonCodes.push("low_assignment_confidence");
  }
  if (item.confidence === "low" || item.confidence === "unknown") reasonCodes.push("low_workflow_confidence");
  if (item.missingDataEffects.some((effect) => effect.effect === "limits_visibility")) {
    reasonCodes.push("visibility_limited_by_missing_data");
  }
  if (sourceWorkflowGroupKinds.includes("retention_review")) reasonCodes.push("retention_context");
  if (sourceWorkflowGroupKinds.includes("needs_relationship_attention")) reasonCodes.push("attention_context");

  if (reasonCodes.some((code) => [
    "unassigned_relationship",
    "low_assignment_confidence",
    "visibility_limited_by_missing_data",
  ].includes(code))) {
    return {
      state: "needs_escalation",
      reasonCodes: uniqueStrings(reasonCodes),
      reason: "Assignment or visibility gaps require escalation review before ownership is interpreted.",
      reviewOnly: true,
    };
  }
  if (reasonCodes.length > 0) {
    return {
      state: "needs_manager_review",
      reasonCodes: uniqueStrings(reasonCodes),
      reason: "Relationship has manager-review context, but no automatic escalation is triggered.",
      reviewOnly: true,
    };
  }
  return {
    state: "standard_review",
    reasonCodes: [],
    reason: "Relationship has enough owner and confidence context for standard review visibility.",
    reviewOnly: true,
  };
}

function groupKindsForItem(
  item: WorkflowReadyRelationshipSummary,
  ownership: WorkflowOwnershipDTO,
  intern: InternReviewStateDTO,
  escalation: EscalationReviewStateDTO,
  sourceWorkflowGroupKinds: RelationshipWorkflowGroupingKind[],
): MultiOperatorWorkflowGroupingKind[] {
  return MULTI_OPERATOR_WORKFLOW_GROUP_ORDER.filter((groupKind) => {
    switch (groupKind) {
      case "my_relationships":
        return ownership.ownershipState === "assigned_to_viewer";
      case "unassigned_review":
        return ownership.ownershipState === "unassigned";
      case "shared_review":
        return ownership.ownershipState === "shared_visibility";
      case "intern_queue":
        return intern.visibleInInternQueue;
      case "needs_escalation":
        return escalation.state === "needs_escalation";
      case "needs_manager_review":
        return escalation.state === "needs_manager_review"
          || ownership.ownershipState === "shared_visibility"
          || item.ownerVisibility.unassigned;
      case "follow_up_review":
        return sourceWorkflowGroupKinds.includes("follow_up_review");
    }
  });
}

function sourceGroupsFor(
  item: WorkflowReadyRelationshipSummary,
  workflow: RelationshipWorkflowProjection,
): RelationshipWorkflowGroupingKind[] {
  const groupKinds = workflow.groups
    .filter((group) => group.items.some((candidate) => candidate.relationshipId === item.relationshipId))
    .map((group) => group.groupKind)
    .sort((a, b) => sourceGroupRank(a) - sourceGroupRank(b));
  return groupKinds.length > 0 ? groupKinds : [item.deterministicOrder.groupKind];
}

function buildGroup(
  generatedAt: IsoDateString,
  groupKind: MultiOperatorWorkflowGroupingKind,
  items: MultiOperatorWorkflowItem[],
): MultiOperatorWorkflowGroup {
  const definition = GROUP_DEFINITIONS[groupKind];
  const groupItems = items
    .filter((item) => item.deterministicOrder.displayedInGroupKinds.includes(groupKind))
    .sort(compareMultiOperatorItems);
  return {
    groupKind,
    label: definition.label,
    description: definition.description,
    generatedAt,
    operatorQueueSegment: true,
    roleAudience: definition.roleAudience,
    visibilityReason: definition.visibilityReason,
    items: groupItems,
    confidence: combineConfidence(groupItems.map((item) => item.confidence)),
    missingDataEffects: uniqueMissingDataEffects(groupItems.flatMap((item) => item.missingDataEffects)),
    ordering: MULTI_OPERATOR_WORKFLOW_ORDERING,
    reviewOnly: true,
  };
}

function withItemRank(item: MultiOperatorWorkflowItem, index: number): MultiOperatorWorkflowItem {
  return {
    ...item,
    deterministicOrder: {
      ...item.deterministicOrder,
      itemRank: index + 1,
    },
  };
}

function uniqueWorkflowItems(items: WorkflowReadyRelationshipSummary[]): WorkflowReadyRelationshipSummary[] {
  const byRelationship = new Map<RelationshipId, WorkflowReadyRelationshipSummary>();
  for (const item of [...items].sort(compareWorkflowSummaries)) {
    if (!byRelationship.has(item.relationshipId)) byRelationship.set(item.relationshipId, item);
  }
  return [...byRelationship.values()];
}

function compareWorkflowSummaries(a: WorkflowReadyRelationshipSummary, b: WorkflowReadyRelationshipSummary): number {
  return a.deterministicOrder.sortKey.localeCompare(b.deterministicOrder.sortKey)
    || a.relationshipId.localeCompare(b.relationshipId);
}

function compareMultiOperatorItems(a: MultiOperatorWorkflowItem, b: MultiOperatorWorkflowItem): number {
  return a.deterministicOrder.sortKey.localeCompare(b.deterministicOrder.sortKey)
    || a.relationshipId.localeCompare(b.relationshipId);
}

function multiOperatorSortKey(
  primaryGroupRank: number,
  sourceWorkflowGroupRank: number,
  item: WorkflowReadyRelationshipSummary,
): string {
  return [
    String(primaryGroupRank).padStart(2, "0"),
    String(sourceWorkflowGroupRank).padStart(2, "0"),
    item.deterministicOrder.sortKey,
    item.relationshipId,
  ].join("|");
}

function groupRank(kind: MultiOperatorWorkflowGroupingKind): number {
  const index = MULTI_OPERATOR_WORKFLOW_GROUP_ORDER.indexOf(kind);
  return index === -1 ? MULTI_OPERATOR_WORKFLOW_GROUP_ORDER.length + 1 : index + 1;
}

function sourceGroupRank(kind: RelationshipWorkflowGroupingKind): number {
  const index = MULTI_OPERATOR_WORKFLOW_ORDERING.sourceWorkflowGroupOrder.indexOf(kind);
  return index === -1 ? MULTI_OPERATOR_WORKFLOW_ORDERING.sourceWorkflowGroupOrder.length + 1 : index + 1;
}

function groupItems(
  groups: MultiOperatorWorkflowGroup[],
  groupKind: MultiOperatorWorkflowGroupingKind,
): MultiOperatorWorkflowItem[] {
  return groups.find((group) => group.groupKind === groupKind)?.items ?? [];
}

function groupCounts(
  groups: MultiOperatorWorkflowGroup[],
): Record<MultiOperatorWorkflowGroupingKind, number> {
  return Object.fromEntries(MULTI_OPERATOR_WORKFLOW_GROUP_ORDER.map((groupKind) => [
    groupKind,
    groups.find((group) => group.groupKind === groupKind)?.items.length ?? 0,
  ])) as Record<MultiOperatorWorkflowGroupingKind, number>;
}

function validateProjection(
  groups: MultiOperatorWorkflowGroup[],
  items: MultiOperatorWorkflowItem[],
): MultiOperatorWorkflowValidationResult {
  const issues: MultiOperatorWorkflowValidationIssue[] = [];
  for (const group of groups) {
    const seen = new Set<RelationshipId>();
    if (group.reviewOnly !== true) {
      issues.push(error("group_not_review_only", "Multi-operator groups must remain review-only.", group.groupKind));
    }
    for (const item of group.items) {
      if (seen.has(item.relationshipId)) {
        issues.push(error("duplicate_group_relationship", "A multi-operator group contains a duplicate relationship.", group.groupKind, item.relationshipId));
      }
      seen.add(item.relationshipId);
      if (!item.deterministicOrder.displayedInGroupKinds.includes(group.groupKind)) {
        issues.push(error("group_membership_mismatch", "Item displayed group metadata does not include the parent group.", group.groupKind, item.relationshipId));
      }
      if (item.lifecycleContext.terminal) {
        issues.push(error("terminal_relationship_in_multi_operator_workflow", "Terminal relationships must not appear in active multi-operator visibility groups.", group.groupKind, item.relationshipId));
      }
    }
  }
  for (const item of items) {
    if (item.deterministicOrder.displayedInGroupKinds.length === 0) {
      issues.push(warning("relationship_without_multi_operator_group", "Relationship has workflow visibility but no multi-operator group membership.", undefined, item.relationshipId));
    }
  }
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

function ownershipExplanation(state: WorkflowOwnershipState): string {
  switch (state) {
    case "assigned_to_viewer":
      return "The viewing operator is the canonical primary owner.";
    case "assigned_to_other_operator":
      return "Another operator is the canonical primary owner.";
    case "shared_visibility":
      return "Multiple operators are visible for this relationship.";
    case "unassigned":
      return "No canonical owner is visible from assignment state.";
  }
}

function visibilityExplanation(
  state: AssignmentVisibilityState,
  viewer: MultiOperatorWorkflowViewerContext,
): string {
  switch (state) {
    case "viewer_primary_owner":
      return `${viewer.label} is the relationship owner in the read model.`;
    case "viewer_shared_reviewer":
      return `${viewer.label} appears in shared relationship visibility.`;
    case "assigned_operator_visible":
      return "Relationship is assigned to an operator and remains visible for workload organization.";
    case "unassigned_review_visible":
      return "Relationship is unassigned and visible for manager review without auto-assignment.";
    case "shared_review_visible":
      return "Relationship is shared and visible for ownership clarification.";
    case "global_review_visible":
      return "Relationship is visible through deterministic workflow review context.";
  }
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
  groupKind?: MultiOperatorWorkflowGroupingKind,
  relationshipId?: RelationshipId,
): MultiOperatorWorkflowValidationIssue {
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
  groupKind?: MultiOperatorWorkflowGroupingKind,
  relationshipId?: RelationshipId,
): MultiOperatorWorkflowValidationIssue {
  return {
    severity: "warning",
    code,
    message,
    ...(groupKind ? { groupKind } : {}),
    ...(relationshipId ? { relationshipId } : {}),
  };
}
