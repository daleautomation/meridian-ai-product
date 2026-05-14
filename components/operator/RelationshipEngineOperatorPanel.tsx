"use client";

import type { CSSProperties } from "react";
import { palette } from "@/lib/theme";

type Confidence = "high" | "medium" | "low" | string;

interface IssueSummary {
  code: string;
  severity: "error" | "warning" | string;
  count: number;
  relationshipsAffected?: number;
  sources?: string[];
}

interface MissingDataEffect {
  field: string;
  reason: string;
  effect: string;
  message?: string;
}

interface QueueReason {
  code: string;
  label: string;
  explanation: string;
  confidence: Confidence;
  timelineEventIds?: string[];
  promiseIds?: string[];
  evidence?: unknown[];
}

interface QueueItem {
  id: string;
  rank: number;
  rankKey: string;
  relationshipId: string;
  whyItExists: string;
  confidence: Confidence;
  timelineReferences?: string[];
  latestEvidence?: Array<{ description?: string; confidence?: Confidence }>;
  missingDataEffects?: MissingDataEffect[];
  lifecycleContext?: { state?: string; explanation?: string; queueEligible?: boolean; terminal?: boolean };
  reasons?: QueueReason[];
  integrityFindings?: IssueSummary[];
  relationshipState?: { displayName?: string; lifecycle?: string; healthConfidence?: Confidence; healthScore?: number };
}

interface QueueProjection {
  queueKind: string;
  generatedAt: string;
  items: QueueItem[];
  ordering?: { strategy?: string; productionScoring?: boolean; sortKeys?: string[]; tieBreakers?: string[] };
  explanation?: { notes?: string[]; inputSources?: string[] };
  validation?: { ok?: boolean; issues?: IssueSummary[] };
}

interface FeedProjection {
  feedKind: string;
  items: Array<{
    id: string;
    title: string;
    body: string;
    confidence: Confidence;
    relationshipId: string;
    occurredAt: string;
    missingDataEffects?: MissingDataEffect[];
    lifecycleContext?: { explanation?: string };
    timelineReferences?: string[];
  }>;
}

interface WorkflowSummary {
  relationshipId: string;
  displayName: string;
  lifecycle: string;
  confidence: Confidence;
  missingDataEffects?: MissingDataEffect[];
  whyNow?: {
    summary?: string;
    reasonCodes?: string[];
    explanations?: string[];
    timelineReferences?: string[];
    evidenceReferences?: unknown[];
  };
  deterministicOrder?: {
    sourceQueueKind?: string;
    sourceQueueRank?: number;
    sourceQueueRankKey?: string;
    sortKey?: string;
  };
}

interface WorkflowGroup {
  groupKind: string;
  label: string;
  description: string;
  items: WorkflowSummary[];
  confidence: Confidence;
  sourceQueueKinds?: string[];
  ordering?: { strategy?: string; productionScoring?: boolean; itemSortKeys?: string[]; tieBreakers?: string[] };
  validation?: { ok?: boolean; issues?: IssueSummary[] };
}

interface WorkflowProjection {
  boundary?: {
    reviewOnly?: boolean;
    workflowExecutionAllowed?: boolean;
    automationAllowed?: boolean;
    remindersAllowed?: boolean;
    notificationsAllowed?: boolean;
    persistenceAllowed?: boolean;
    neonWritesAllowed?: boolean;
  };
  groups?: WorkflowGroup[];
  visibility?: {
    overdueRelationships?: WorkflowSummary[];
    dormantRelationships?: WorkflowSummary[];
    warmOpportunities?: WorkflowSummary[];
  };
  metadata?: {
    groupCounts?: Record<string, number>;
    confidence?: Confidence;
    missingDataEffects?: MissingDataEffect[];
  };
  explanation?: { notes?: string[] };
}

interface MultiOperatorWorkflowItem {
  relationshipId: string;
  displayName: string;
  lifecycle: string;
  confidence: Confidence;
  assignedOperator?: {
    operatorId?: string;
    assignmentState?: "assigned" | "unassigned" | string;
    whyAssigned?: string;
    confidence?: Confidence;
  };
  workflowOwnership?: {
    ownershipState?: string;
    visibleOperatorCount?: number;
    whyOwned?: string;
  };
  assignmentVisibility?: {
    visibilityState?: string;
    visibleToViewer?: boolean;
    visibilityReason?: string;
    confidence?: Confidence;
  };
  assignmentConfidence?: {
    level?: Confidence;
    reason?: string;
  };
  sharedWorkflowState?: {
    shared?: boolean;
    reason?: string;
  };
  internReviewState?: {
    state?: string;
    visibleInInternQueue?: boolean;
    managerReviewRequired?: boolean;
    reason?: string;
  };
  escalationReviewState?: {
    state?: string;
    reasonCodes?: string[];
    reason?: string;
  };
  whyAssigned?: string;
  whyVisible?: string;
  missingDataEffects?: MissingDataEffect[];
  sourceWorkflowGroupKinds?: string[];
  deterministicOrder?: {
    primaryGroupKind?: string;
    primaryGroupRank?: number;
    sourceWorkflowGroupKind?: string;
    sourceQueueKind?: string;
    sourceQueueRank?: number;
    sourceQueueRankKey?: string;
    itemRank?: number;
    sortKey?: string;
    displayedInGroupKinds?: string[];
  };
}

interface MultiOperatorWorkflowGroup {
  groupKind: string;
  label: string;
  description: string;
  roleAudience?: string[];
  visibilityReason?: string;
  items: MultiOperatorWorkflowItem[];
  confidence: Confidence;
  reviewOnly?: boolean;
  ordering?: { strategy?: string; productionScoring?: boolean; itemSortKeys?: string[]; tieBreakers?: string[] };
}

interface MultiOperatorWorkflowProjection {
  boundary?: {
    reviewOnly?: boolean;
    autoAssignmentAllowed?: boolean;
    assignmentMutationAllowed?: boolean;
    queueExecutionAllowed?: boolean;
    workflowExecutionAllowed?: boolean;
    automationAllowed?: boolean;
    remindersAllowed?: boolean;
    notificationsAllowed?: boolean;
    persistenceAllowed?: boolean;
    neonWritesAllowed?: boolean;
    productionScoringAllowed?: boolean;
    uiDerivedOwnershipAllowed?: boolean;
  };
  viewer?: {
    label?: string;
    role?: string;
    visibilityScope?: string;
  };
  groups?: MultiOperatorWorkflowGroup[];
  workloadSummary?: {
    myRelationships?: number;
    unassignedReview?: number;
    sharedReview?: number;
    internQueue?: number;
    needsEscalation?: number;
    needsManagerReview?: number;
    followUpReview?: number;
  };
  metadata?: {
    confidence?: Confidence;
    groupCounts?: Record<string, number>;
    assignmentOverlap?: Array<{ relationshipId?: string; primaryGroupKind?: string; displayedInGroupKinds?: string[] }>;
  };
  explanation?: { notes?: string[] };
}

interface WorkflowContinuityItem {
  relationshipId: string;
  displayName: string;
  reviewState?: {
    state?: string;
    label?: string;
    reason?: string;
    confidence?: Confidence;
  };
  handoff?: {
    previousReviewer?: { state?: string; operatorId?: string; reason?: string; confidence?: Confidence };
    latestReviewer?: { state?: string; operatorId?: string; reason?: string; confidence?: Confidence };
    latestReviewTimestamp?: string;
    handoffConfidence?: Confidence;
    workflowContinuitySummary?: { summary?: string; progressionState?: string; reviewContinuityReason?: string };
    assignmentContinuityContext?: {
      assignmentState?: string;
      assignedOperatorId?: string;
      visibleOperatorCount?: number;
      shared?: boolean;
      whyVisible?: string;
    };
  };
  explainability?: {
    whyVisible?: string;
    latestEvidence?: unknown[];
    reviewContinuityReason?: string;
    missingDataEffects?: MissingDataEffect[];
    deterministicOrdering?: { sortKey?: string; primaryGroupKind?: string; itemRank?: number };
  };
  confidence: Confidence;
  deterministicOrder?: {
    primaryGroupKind?: string;
    reviewState?: string;
    sourceMultiOperatorGroupKind?: string;
    sourceWorkflowGroupKind?: string;
    itemRank?: number;
    sortKey?: string;
    displayedInGroupKinds?: string[];
  };
  missingDataEffects?: MissingDataEffect[];
}

interface WorkflowContinuityGroup {
  groupKind: string;
  label: string;
  description: string;
  visibilityReason?: string;
  roleAudience?: string[];
  items: WorkflowContinuityItem[];
  confidence: Confidence;
  reviewOnly?: boolean;
  ordering?: { strategy?: string; productionScoring?: boolean; itemSortKeys?: string[]; tieBreakers?: string[] };
}

interface WorkflowContinuityProjection {
  boundary?: {
    reviewOnly?: boolean;
    hiddenWorkflowStateAllowed?: boolean;
    autoAssignmentAllowed?: boolean;
    assignmentMutationAllowed?: boolean;
    queueExecutionAllowed?: boolean;
    workflowExecutionAllowed?: boolean;
    automationAllowed?: boolean;
    remindersAllowed?: boolean;
    notificationsAllowed?: boolean;
    persistenceAllowed?: boolean;
    neonWritesAllowed?: boolean;
    productionScoringAllowed?: boolean;
    uiDerivedContinuityAllowed?: boolean;
  };
  groups?: WorkflowContinuityGroup[];
  visibility?: {
    inReview?: WorkflowContinuityItem[];
    sharedReview?: WorkflowContinuityItem[];
    escalatedReview?: WorkflowContinuityItem[];
    managerReview?: WorkflowContinuityItem[];
    waitingForReview?: WorkflowContinuityItem[];
    dormantRelationshipReview?: WorkflowContinuityItem[];
    followUpContinuityReview?: WorkflowContinuityItem[];
  };
  metadata?: {
    confidence?: Confidence;
    groupCounts?: Record<string, number>;
    reviewStateCounts?: Record<string, number>;
  };
  explanation?: { notes?: string[] };
}

interface DiagnosticSurface {
  status: "ok" | "warning" | "error" | "not_configured" | string;
  summary: string;
  issueSummary?: IssueSummary[];
  safeMetadata?: Record<string, unknown>;
}

interface OperatorSurface {
  status: "ready" | "degraded" | string;
  generatedAt: string;
  safeError?: string;
  access?: { adminOperator?: boolean; adminDiagnosticsVisible?: boolean };
  boundary?: {
    integrationMode?: string;
    repositoriesAllowed?: boolean;
    writesAllowed?: boolean;
    queueExecutionAllowed?: boolean;
    automationAllowed?: boolean;
    rawInternalsAllowed?: boolean;
    apiOnlyAlternative?: string[];
  };
  health?: {
    overallStatus?: string;
    normalizationStatus?: string;
    projectionStatus?: string;
    queueValidationStatus?: string;
    timelineValidationStatus?: string;
    deterministicReplayStatus?: string;
    repositoryMode?: string;
    staleProjectionWarnings?: IssueSummary[];
    missingDataWarnings?: { count?: number; fields?: string[]; reasons?: string[]; effects?: string[] };
    readOnlyGuarantees?: Record<string, boolean>;
  };
  queues?: QueueProjection[];
  feeds?: FeedProjection[];
  workflows?: WorkflowProjection;
  multiOperatorWorkflows?: MultiOperatorWorkflowProjection;
  workflowContinuity?: WorkflowContinuityProjection;
  diagnostics?: Record<string, DiagnosticSurface>;
  adminDiagnostics?: {
    metadata?: {
      validationWarnings?: IssueSummary[];
      missingData?: { count?: number; fields?: string[]; reasons?: string[]; effects?: string[] };
      deterministic?: { generatedAtSource?: string; replaySafeWithFixedAsOf?: boolean; collectionOrder?: Record<string, string[]> };
      readOnly?: Record<string, boolean>;
    };
  } | null;
  metadata?: {
    repositoryMode?: string;
    validationWarnings?: IssueSummary[];
    serviceWarnings?: IssueSummary[];
    missingData?: { count?: number; fields?: string[]; reasons?: string[]; effects?: string[] };
    confidence?: { overall?: Confidence; bySurface?: Record<string, Confidence> };
    deterministic?: { generatedAtSource?: string; replaySafeWithFixedAsOf?: boolean; collectionOrder?: Record<string, string[]> };
    timelineDisplay?: { message?: string; source?: string };
    summaryDisplay?: { relationshipCount?: number; queueItemCount?: number; feedItemCount?: number };
    apiEndpoints?: string[];
  };
}

export default function RelationshipEngineOperatorPanel({
  surface,
}: {
  surface?: OperatorSurface | null;
}) {
  if (!surface) {
    return (
      <section style={styles.shell} aria-label="Relationship Engine">
        <EmptyPanel title="Relationship Engine unavailable" body="No operator relationship surface was provided." />
      </section>
    );
  }

  const queues = Array.isArray(surface.queues) ? surface.queues : [];
  const feeds = Array.isArray(surface.feeds) ? surface.feeds : [];
  const workflows = surface.workflows;
  const multiOperatorWorkflows = surface.multiOperatorWorkflows;
  const workflowContinuity = surface.workflowContinuity;
  const health = surface.health ?? {};
  const metadata = surface.metadata ?? {};
  const queueItemCount = metadata.summaryDisplay?.queueItemCount ?? queues.reduce((sum, queue) => sum + queue.items.length, 0);
  const feedItemCount = metadata.summaryDisplay?.feedItemCount ?? feeds.reduce((sum, feed) => sum + feed.items.length, 0);

  return (
    <section style={styles.shell} aria-label="Relationship Engine operator integration">
      <div style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Relationship Engine</div>
          <h1 style={styles.title}>Operator review surfaces</h1>
          <p style={styles.copy}>
            Multi-operator workload visibility, workflow explainability, queue separation, and timeline readiness in one review flow.
          </p>
        </div>
        <div style={styles.heroMeta}>
          <StatusPill label={`Engine ${label(health.overallStatus ?? surface.status)}`} status={health.overallStatus ?? surface.status} />
          <span style={styles.metaLine}>Generated {shortDate(surface.generatedAt)}</span>
          <span style={styles.metaLine}>Repository {metadata.repositoryMode ?? health.repositoryMode ?? "unknown"}</span>
        </div>
      </div>

      {surface.safeError ? (
        <div style={styles.warningBox}>{surface.safeError}</div>
      ) : null}

      <div style={styles.metricGrid}>
        <MetricCard label="Relationships visible" value={metadata.summaryDisplay?.relationshipCount ?? 0} detail="From relationship-engine queues only" />
        <MetricCard label="Review queue items" value={queueItemCount} detail="Review-only; no execution path" />
        <MetricCard label="Feed items" value={feedItemCount} detail="Projection DTOs, not UI-derived" />
        <MetricCard label="Confidence" value={metadata.confidence?.overall ?? "low"} detail="Service envelope metadata" />
      </div>

      <div style={styles.operatorFlow}>
        <ReadOnlyGuarantees surface={surface} />
        <div style={styles.twoCol}>
          <HealthPanel health={health} />
          <SummaryTimelinePanel surface={surface} />
        </div>
        <MultiOperatorWorkflowPanel orchestration={multiOperatorWorkflows} />
        <WorkflowContinuityPanel continuity={workflowContinuity} />
        <WorkflowVisibilityPanel workflows={workflows} />
        <QueueReviewPanel queues={queues} />
        <FeedPanel feeds={feeds} />
        <DiagnosticsPanel diagnostics={surface.diagnostics ?? {}} metadata={metadata} />
        <AdminDiagnosticsPanel surface={surface} />
      </div>
    </section>
  );
}

function MultiOperatorWorkflowPanel({ orchestration }: { orchestration?: MultiOperatorWorkflowProjection }) {
  const groups = Array.isArray(orchestration?.groups) ? orchestration.groups : [];
  const summary = orchestration?.workloadSummary ?? {};
  return (
    <section style={styles.card}>
      <SectionHeader
        title="Multi-operator workload orchestration"
        detail={`${orchestration?.viewer?.label ?? "Operator"} · ${formatKind(orchestration?.viewer?.role ?? "review")}`}
      />
      <div style={styles.metricGrid}>
        <MetricCard label="My relationships" value={summary.myRelationships ?? 0} detail="Assigned to current operator" />
        <MetricCard label="Unassigned review" value={summary.unassignedReview ?? 0} detail="Visible without auto-assignment" />
        <MetricCard label="Shared review" value={summary.sharedReview ?? 0} detail="Ownership clarity surface" />
        <MetricCard label="Intern queue" value={summary.internQueue ?? 0} detail="Review-only intern triage" />
        <MetricCard label="Escalation" value={summary.needsEscalation ?? 0} detail="Human review required" />
        <MetricCard label="Manager review" value={summary.needsManagerReview ?? 0} detail="Account-manager visibility" />
        <MetricCard label="Follow-ups" value={summary.followUpReview ?? 0} detail="No reminders sent" />
        <MetricCard label="Confidence" value={orchestration?.metadata?.confidence ?? "unknown"} detail="Assignment-aware grouping" />
      </div>
      <div style={styles.workflowBoundary}>
        {[
          ["Auto-assignment", orchestration?.boundary?.autoAssignmentAllowed === false],
          ["Assignment mutation", orchestration?.boundary?.assignmentMutationAllowed === false],
          ["Queue execution", orchestration?.boundary?.queueExecutionAllowed === false],
          ["Automation", orchestration?.boundary?.automationAllowed === false],
          ["Reminders", orchestration?.boundary?.remindersAllowed === false],
          ["Notifications", orchestration?.boundary?.notificationsAllowed === false],
          ["Persistence", orchestration?.boundary?.persistenceAllowed === false],
          ["Neon writes", orchestration?.boundary?.neonWritesAllowed === false],
        ].map(([name, blocked]) => (
          <span key={String(name)} style={blocked ? styles.blocked : styles.unknown}>{name}: {blocked ? "blocked" : "unknown"}</span>
        ))}
      </div>
      {groups.length === 0 ? (
        <EmptyPanel title="No multi-operator groups returned" body="Operator workload segmentation remains empty until workflow projections provide relationship review items." />
      ) : (
        <div style={styles.workflowGrid}>
          {groups.map((group) => (
            <article key={group.groupKind} style={styles.workflowCard}>
              <div style={styles.queueHead}>
                <div>
                  <div style={styles.queueTitle}>{group.label || formatKind(group.groupKind)}</div>
                  <p style={styles.smallCopy}>{group.description}</p>
                </div>
                <StatusPill label={`${group.items.length} visible`} status={group.confidence} />
              </div>
              <div style={styles.ordering}>
                <span>Audience: {(group.roleAudience ?? []).map(formatKind).join(", ") || "operators"}</span>
                <span>Reason: {group.visibilityReason ?? "relationship-engine assignment visibility"}</span>
                <span>Production scoring: {group.ordering?.productionScoring === false ? "off" : "unknown"}</span>
              </div>
              {group.items.length === 0 ? (
                <div style={styles.emptyInline}>No relationships are visible in this operator segment.</div>
              ) : (
                group.items.slice(0, 3).map((item) => (
                  <MultiOperatorWorkflowItemCard key={`${group.groupKind}:${item.relationshipId}`} item={item} />
                ))
              )}
            </article>
          ))}
        </div>
      )}
      <p style={styles.smallCopy}>
        {orchestration?.explanation?.notes?.[0] ?? "Multi-operator orchestration organizes visibility only; it never assigns or executes work."}
      </p>
    </section>
  );
}

function MultiOperatorWorkflowItemCard({ item }: { item: MultiOperatorWorkflowItem }) {
  return (
    <div style={styles.queueItem}>
      <div style={styles.queueItemHead}>
        <div>
          <div style={styles.itemTitle}>{item.displayName}</div>
          <div style={styles.smallCopy}>
            {formatKind(item.workflowOwnership?.ownershipState ?? "visibility")} · primary {formatKind(item.deterministicOrder?.primaryGroupKind ?? "review")}
          </div>
        </div>
        <StatusPill label={`confidence ${item.confidence}`} status={item.confidence} />
      </div>
      <p style={styles.copy}>{item.assignmentVisibility?.visibilityReason ?? item.whyVisible ?? "Relationship is visible for operator review."}</p>
      <p style={styles.smallCopy}>
        Assigned {item.assignedOperator?.operatorId ?? "unassigned"} · assignment confidence {item.assignmentConfidence?.level ?? "unknown"} · source groups {(item.sourceWorkflowGroupKinds ?? []).map(formatKind).join(", ") || "workflow"}
      </p>
      <p style={styles.smallCopy}>
        Intern {formatKind(item.internReviewState?.state ?? "unknown")} · escalation {formatKind(item.escalationReviewState?.state ?? "standard_review")}
        {(item.escalationReviewState?.reasonCodes ?? []).length > 0 ? ` · reasons ${(item.escalationReviewState?.reasonCodes ?? []).join(", ")}` : ""}
      </p>
      <MissingEffects effects={item.missingDataEffects} />
    </div>
  );
}

function WorkflowContinuityPanel({ continuity }: { continuity?: WorkflowContinuityProjection }) {
  const groups = Array.isArray(continuity?.groups) ? continuity.groups : [];
  const visibility = continuity?.visibility ?? {};
  return (
    <section style={styles.card}>
      <SectionHeader title="Workflow continuity and handoffs" detail="Review-state visibility only" />
      <div style={styles.metricGrid}>
        <MetricCard label="In review" value={visibility.inReview?.length ?? 0} detail="Workflow progression visible" />
        <MetricCard label="Shared review" value={visibility.sharedReview?.length ?? 0} detail="Handoff clarity" />
        <MetricCard label="Escalated" value={visibility.escalatedReview?.length ?? 0} detail="Human review only" />
        <MetricCard label="Manager review" value={visibility.managerReview?.length ?? 0} detail="Account-manager readable" />
        <MetricCard label="Waiting" value={visibility.waitingForReview?.length ?? 0} detail="No hidden review state" />
        <MetricCard label="Dormant" value={visibility.dormantRelationshipReview?.length ?? 0} detail="No reactivation automation" />
        <MetricCard label="Follow-up" value={visibility.followUpContinuityReview?.length ?? 0} detail="No reminders sent" />
        <MetricCard label="Confidence" value={continuity?.metadata?.confidence ?? "unknown"} detail="Continuity DTOs" />
      </div>
      <div style={styles.workflowBoundary}>
        {[
          ["Hidden state", continuity?.boundary?.hiddenWorkflowStateAllowed === false],
          ["Auto-assignment", continuity?.boundary?.autoAssignmentAllowed === false],
          ["Assignment mutation", continuity?.boundary?.assignmentMutationAllowed === false],
          ["Queue execution", continuity?.boundary?.queueExecutionAllowed === false],
          ["Workflow execution", continuity?.boundary?.workflowExecutionAllowed === false],
          ["Automation", continuity?.boundary?.automationAllowed === false],
          ["Reminders", continuity?.boundary?.remindersAllowed === false],
          ["Notifications", continuity?.boundary?.notificationsAllowed === false],
          ["Persistence", continuity?.boundary?.persistenceAllowed === false],
          ["Neon writes", continuity?.boundary?.neonWritesAllowed === false],
        ].map(([name, blocked]) => (
          <span key={String(name)} style={blocked ? styles.blocked : styles.unknown}>{name}: {blocked ? "blocked" : "unknown"}</span>
        ))}
      </div>
      {groups.length === 0 ? (
        <EmptyPanel title="No continuity groups returned" body="Continuity remains empty until workflow projections provide review items." />
      ) : (
        <div style={styles.workflowGrid}>
          {groups.map((group) => (
            <article key={group.groupKind} style={styles.workflowCard}>
              <div style={styles.queueHead}>
                <div>
                  <div style={styles.queueTitle}>{group.label || formatKind(group.groupKind)}</div>
                  <p style={styles.smallCopy}>{group.description}</p>
                </div>
                <StatusPill label={`${group.items.length} visible`} status={group.confidence} />
              </div>
              <div style={styles.ordering}>
                <span>Audience: {(group.roleAudience ?? []).map(formatKind).join(", ") || "operators"}</span>
                <span>Reason: {group.visibilityReason ?? "workflow continuity visibility"}</span>
                <span>Production scoring: {group.ordering?.productionScoring === false ? "off" : "unknown"}</span>
              </div>
              {group.items.length === 0 ? (
                <div style={styles.emptyInline}>No relationships are visible in this continuity group.</div>
              ) : (
                group.items.slice(0, 3).map((item) => (
                  <WorkflowContinuityItemCard key={`${group.groupKind}:${item.relationshipId}`} item={item} />
                ))
              )}
            </article>
          ))}
        </div>
      )}
      <p style={styles.smallCopy}>
        {continuity?.explanation?.notes?.[0] ?? "Workflow continuity exposes handoff context only; it never progresses work automatically."}
      </p>
    </section>
  );
}

function WorkflowContinuityItemCard({ item }: { item: WorkflowContinuityItem }) {
  const handoff = item.handoff;
  return (
    <div style={styles.queueItem}>
      <div style={styles.queueItemHead}>
        <div>
          <div style={styles.itemTitle}>{item.displayName}</div>
          <div style={styles.smallCopy}>
            {item.reviewState?.label ?? formatKind(item.reviewState?.state ?? "review")} · primary {formatKind(item.deterministicOrder?.primaryGroupKind ?? "continuity")}
          </div>
        </div>
        <StatusPill label={`handoff ${handoff?.handoffConfidence ?? item.confidence}`} status={handoff?.handoffConfidence ?? item.confidence} />
      </div>
      <p style={styles.copy}>{handoff?.workflowContinuitySummary?.summary ?? item.explainability?.whyVisible ?? "Relationship continuity is visible for review."}</p>
      <p style={styles.smallCopy}>
        Previous reviewer {handoff?.previousReviewer?.operatorId ?? formatKind(handoff?.previousReviewer?.state ?? "not_observed")} · latest reviewer {handoff?.latestReviewer?.operatorId ?? formatKind(handoff?.latestReviewer?.state ?? "not_observed")}
      </p>
      <p style={styles.smallCopy}>
        Assignment {handoff?.assignmentContinuityContext?.assignedOperatorId ?? handoff?.assignmentContinuityContext?.assignmentState ?? "unknown"} · evidence refs {(item.explainability?.latestEvidence ?? []).length} · order {item.deterministicOrder?.itemRank ?? "n/a"}
      </p>
      <p style={styles.smallCopy}>{item.explainability?.reviewContinuityReason ?? item.reviewState?.reason}</p>
      <MissingEffects effects={item.missingDataEffects ?? item.explainability?.missingDataEffects} />
    </div>
  );
}

function WorkflowVisibilityPanel({ workflows }: { workflows?: WorkflowProjection }) {
  const groups = Array.isArray(workflows?.groups) ? workflows.groups : [];
  const visibility = workflows?.visibility ?? {};
  return (
    <section style={styles.card}>
      <SectionHeader title="Relationship workflow visibility" detail="Review-only workflow intelligence" />
      <div style={styles.grid4}>
        <MetricCard label="Workflow groups" value={groups.length} detail={workflows?.boundary?.reviewOnly ? "Review-only DTOs" : "Visibility metadata"} />
        <MetricCard label="Overdue visible" value={visibility.overdueRelationships?.length ?? 0} detail="No reminders sent" />
        <MetricCard label="Dormant visible" value={visibility.dormantRelationships?.length ?? 0} detail="No reactivation automation" />
        <MetricCard label="Warm opportunities" value={visibility.warmOpportunities?.length ?? 0} detail="No outreach execution" />
      </div>
      <div style={styles.workflowBoundary}>
        {[
          ["Workflow execution", workflows?.boundary?.workflowExecutionAllowed === false],
          ["Automation", workflows?.boundary?.automationAllowed === false],
          ["Reminders", workflows?.boundary?.remindersAllowed === false],
          ["Notifications", workflows?.boundary?.notificationsAllowed === false],
          ["Persistence", workflows?.boundary?.persistenceAllowed === false],
          ["Neon writes", workflows?.boundary?.neonWritesAllowed === false],
        ].map(([name, blocked]) => (
          <span key={String(name)} style={blocked ? styles.blocked : styles.unknown}>{name}: {blocked ? "blocked" : "unknown"}</span>
        ))}
      </div>
      {groups.length === 0 ? (
        <EmptyPanel title="No workflow groups returned" body="Workflow visibility remains empty until queue projections provide relationship review items." />
      ) : (
        <div style={styles.workflowGrid}>
          {groups.map((group) => (
            <article key={group.groupKind} style={styles.workflowCard}>
              <div style={styles.queueHead}>
                <div>
                  <div style={styles.queueTitle}>{group.label || formatKind(group.groupKind)}</div>
                  <p style={styles.smallCopy}>{group.description}</p>
                </div>
                <StatusPill label={`${group.items.length} visible`} status={group.validation?.ok === false ? "warning" : group.confidence} />
              </div>
              <div style={styles.ordering}>
                <span>Ordering: {group.ordering?.strategy ?? "deterministic_workflow_grouping_v0"}</span>
                <span>Production scoring: {group.ordering?.productionScoring === false ? "off" : "unknown"}</span>
                <span>Sources: {(group.sourceQueueKinds ?? []).join(", ") || "service queues"}</span>
              </div>
              {group.items.length === 0 ? (
                <div style={styles.emptyInline}>No relationships are visible in this workflow group.</div>
              ) : (
                group.items.slice(0, 3).map((item) => <WorkflowItemCard key={`${group.groupKind}:${item.relationshipId}`} item={item} />)
              )}
            </article>
          ))}
        </div>
      )}
      <p style={styles.smallCopy}>{workflows?.explanation?.notes?.[0] ?? "Workflow contexts inform operator review but do not execute actions."}</p>
    </section>
  );
}

function WorkflowItemCard({ item }: { item: WorkflowSummary }) {
  return (
    <div style={styles.queueItem}>
      <div style={styles.queueItemHead}>
        <div>
          <div style={styles.itemTitle}>{item.displayName}</div>
          <div style={styles.smallCopy}>{item.lifecycle} · {item.deterministicOrder?.sourceQueueKind ?? "workflow"} rank {item.deterministicOrder?.sourceQueueRank ?? "n/a"}</div>
        </div>
        <StatusPill label={`confidence ${item.confidence}`} status={item.confidence} />
      </div>
      <p style={styles.copy}>{item.whyNow?.summary ?? "Relationship is visible for workflow review."}</p>
      <p style={styles.smallCopy}>
        Reasons {(item.whyNow?.reasonCodes ?? []).join(", ") || "service supplied"} · evidence refs {(item.whyNow?.evidenceReferences ?? []).length} · timeline refs {(item.whyNow?.timelineReferences ?? []).length}
      </p>
      <MissingEffects effects={item.missingDataEffects} />
    </div>
  );
}

function ReadOnlyGuarantees({ surface }: { surface: OperatorSurface }) {
  const guarantees = surface.health?.readOnlyGuarantees ?? surface.adminDiagnostics?.metadata?.readOnly ?? {};
  const boundary = surface.boundary ?? {};
  const rows = [
    ["Repositories", boundary.repositoriesAllowed === false ? "blocked" : "unknown"],
    ["Writes", boundary.writesAllowed === false ? "blocked" : "unknown"],
    ["Queue execution", boundary.queueExecutionAllowed === false || guarantees.queueExecution === false ? "blocked" : "unknown"],
    ["Automation", boundary.automationAllowed === false || guarantees.autonomousWorkflows === false ? "blocked" : "unknown"],
    ["Notifications", guarantees.notifications === false ? "blocked" : "unknown"],
    ["Neon writes", guarantees.neonWrites === false ? "blocked" : "unknown"],
    ["Production scoring", guarantees.productionScoring === false ? "blocked" : "unknown"],
  ];
  return (
    <section style={styles.card}>
      <SectionHeader title="Read-only boundary" detail={`Mode: ${boundary.integrationMode ?? "service_facade"}`} />
      <div style={styles.guardGrid}>
        {rows.map(([name, state]) => (
          <div key={name} style={styles.guardItem}>
            <span style={styles.guardName}>{name}</span>
            <span style={state === "blocked" ? styles.blocked : styles.unknown}>{state}</span>
          </div>
        ))}
      </div>
      <p style={styles.smallCopy}>
        This panel displays service/API output only. It has no controls for queue dispatch, reminders, notifications, automation, scoring, or persistence.
      </p>
    </section>
  );
}

function HealthPanel({ health }: { health: OperatorSurface["health"] }) {
  const rows = [
    ["Normalization", health?.normalizationStatus],
    ["Projection", health?.projectionStatus],
    ["Queue validation", health?.queueValidationStatus],
    ["Timeline validation", health?.timelineValidationStatus],
    ["Deterministic replay", health?.deterministicReplayStatus],
  ];
  return (
    <section style={styles.card}>
      <SectionHeader title="Relationship health overview" detail="Diagnostics service metadata" />
      <div style={styles.statusList}>
        {rows.map(([name, status]) => (
          <div key={name} style={styles.statusRow}>
            <span>{name}</span>
            <StatusPill label={label(status)} status={status} />
          </div>
        ))}
      </div>
      <MissingDataSummary summary={health?.missingDataWarnings} />
      <IssueList title="Stale relationship warnings" issues={health?.staleProjectionWarnings ?? []} />
    </section>
  );
}

function SummaryTimelinePanel({ surface }: { surface: OperatorSurface }) {
  const display = surface.metadata?.timelineDisplay;
  const endpoints = surface.metadata?.apiEndpoints ?? surface.boundary?.apiOnlyAlternative ?? [];
  return (
    <section style={styles.card}>
      <SectionHeader title="Summary and timeline display" detail="Selection-safe empty state" />
      <div style={styles.timelineBox}>
        <div style={styles.timelineTitle}>Relationship timeline panel</div>
        <p style={styles.copy}>{display?.message ?? "Select a relationship queue item to inspect its timeline projection."}</p>
        <p style={styles.smallCopy}>Source: {display?.source ?? "relationship_engine_timeline_api"}</p>
      </div>
      <div style={styles.endpointList}>
        {endpoints.slice(0, 6).map((endpoint) => (
          <code key={endpoint} style={styles.code}>{endpoint}</code>
        ))}
      </div>
    </section>
  );
}

function QueueReviewPanel({ queues }: { queues: QueueProjection[] }) {
  return (
    <section style={styles.card}>
      <SectionHeader title="Explainable queue review" detail="Read-only deterministic queue projections" />
      {queues.length === 0 ? (
        <EmptyPanel title="No queue projections returned" body="The read facade returned no queue surfaces." />
      ) : (
        <div style={styles.queueGrid}>
          {queues.map((queue) => (
            <article key={queue.queueKind} style={styles.queueCard}>
              <div style={styles.queueHead}>
                <div>
                  <div style={styles.queueTitle}>{formatKind(queue.queueKind)}</div>
                  <div style={styles.smallCopy}>{queue.items.length} item{queue.items.length === 1 ? "" : "s"}</div>
                </div>
                <StatusPill label={queue.validation?.ok === false ? "warnings" : "ok"} status={queue.validation?.ok === false ? "warning" : "ok"} />
              </div>
              <div style={styles.ordering}>
                <span>Ordering: {queue.ordering?.strategy ?? "deterministic_read_model_v0"}</span>
                <span>Production scoring: {queue.ordering?.productionScoring === false ? "off" : "unknown"}</span>
                <span>Sort keys: {(queue.ordering?.sortKeys ?? []).join(" | ") || "service supplied"}</span>
              </div>
              {queue.items.length === 0 ? (
                <div style={styles.emptyInline}>No relationships need review in this queue.</div>
              ) : (
                queue.items.slice(0, 5).map((item) => <QueueItemCard key={item.id} item={item} />)
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function QueueItemCard({ item }: { item: QueueItem }) {
  return (
    <div style={styles.queueItem}>
      <div style={styles.queueItemHead}>
        <div>
          <div style={styles.itemTitle}>#{item.rank} {item.relationshipState?.displayName ?? item.relationshipId}</div>
          <div style={styles.smallCopy}>Rank key {item.rankKey}</div>
        </div>
        <StatusPill label={`confidence ${item.confidence}`} status={item.confidence} />
      </div>
      <p style={styles.copy}>{item.whyItExists}</p>
      {item.lifecycleContext?.explanation ? (
        <p style={styles.smallCopy}>Lifecycle: {item.lifecycleContext.explanation}</p>
      ) : null}
      <div style={styles.reasonList}>
        {(item.reasons ?? []).slice(0, 3).map((reason) => (
          <div key={`${item.id}:${reason.code}`} style={styles.reason}>
            <strong>{reason.label}</strong>
            <span>{reason.explanation}</span>
            <span>Evidence refs {(reason.evidence ?? []).length} · timeline refs {(reason.timelineEventIds ?? []).length} · confidence {reason.confidence}</span>
          </div>
        ))}
      </div>
      <EvidenceLine evidence={item.latestEvidence} timelineRefs={item.timelineReferences} />
      <MissingEffects effects={item.missingDataEffects} />
      <IssueList title="Integrity findings" issues={item.integrityFindings ?? []} compact />
    </div>
  );
}

function FeedPanel({ feeds }: { feeds: FeedProjection[] }) {
  const nonEmpty = feeds.filter((feed) => feed.items.length > 0);
  return (
    <section style={styles.card}>
      <SectionHeader title="Relationship intelligence feed" detail="Projection-backed activity and momentum visibility" />
      {nonEmpty.length === 0 ? (
        <EmptyPanel title="No feed items returned" body="Relationship read adapters are not yet wired, so the operator feed remains honestly empty." />
      ) : (
        nonEmpty.map((feed) => (
          <div key={feed.feedKind} style={styles.feedGroup}>
            <div style={styles.queueTitle}>{formatKind(feed.feedKind)}</div>
            {feed.items.slice(0, 5).map((item) => (
              <div key={item.id} style={styles.feedItem}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
                <span style={styles.smallCopy}>
                  {shortDate(item.occurredAt)} · confidence {item.confidence} · timeline refs {(item.timelineReferences ?? []).length}
                </span>
                <MissingEffects effects={item.missingDataEffects} />
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function DiagnosticsPanel({
  diagnostics,
  metadata,
}: {
  diagnostics: Record<string, DiagnosticSurface>;
  metadata: OperatorSurface["metadata"];
}) {
  const entries = Object.entries(diagnostics);
  return (
    <section style={styles.card}>
      <SectionHeader title="Safe diagnostics visibility" detail="Metadata-only service diagnostics" />
      <div style={styles.diagnosticGrid}>
        {entries.map(([key, surface]) => (
          <article key={key} style={styles.diagnosticCard}>
            <div style={styles.queueHead}>
              <div style={styles.queueTitle}>{formatKind(key)}</div>
              <StatusPill label={label(surface.status)} status={surface.status} />
            </div>
            <p style={styles.copy}>{surface.summary}</p>
            <IssueList title="Issues" issues={surface.issueSummary ?? []} compact />
          </article>
        ))}
      </div>
      <MissingDataSummary summary={metadata?.missingData} />
      <IssueList title="Validation warnings" issues={metadata?.validationWarnings ?? []} />
    </section>
  );
}

function AdminDiagnosticsPanel({ surface }: { surface: OperatorSurface }) {
  if (!surface.access?.adminDiagnosticsVisible || !surface.adminDiagnostics) {
    return (
      <section style={styles.card}>
        <SectionHeader title="Admin diagnostics" detail="Admin-only" />
        <p style={styles.copy}>Admin diagnostics are hidden for this session. Operator visibility remains limited to safe health and validation metadata.</p>
      </section>
    );
  }
  const metadata = surface.adminDiagnostics.metadata ?? {};
  return (
    <section style={styles.card}>
      <SectionHeader title="Admin diagnostics" detail="Internal-safe metadata" />
      <div style={styles.grid4}>
        <MetricCard label="Replay safe" value={metadata.deterministic?.replaySafeWithFixedAsOf ? "yes" : "unknown"} detail={metadata.deterministic?.generatedAtSource ?? "server_clock"} />
        <MetricCard label="Warnings" value={metadata.validationWarnings?.length ?? 0} detail="Validation warning groups" />
        <MetricCard label="Missing data" value={metadata.missingData?.count ?? 0} detail={(metadata.missingData?.fields ?? []).join(", ") || "none"} />
        <MetricCard label="Queue execution" value={metadata.readOnly?.queueExecution === false ? "blocked" : "unknown"} detail="No dispatch controls" />
      </div>
    </section>
  );
}

function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div style={styles.sectionHead}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      {detail ? <span style={styles.sectionDetail}>{detail}</span> : null}
    </div>
  );
}

function MetricCard({ label: labelText, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricLabel}>{labelText}</div>
      <div style={styles.smallCopy}>{detail}</div>
    </div>
  );
}

function StatusPill({ label: text, status }: { label: string; status?: string }) {
  const tone = statusTone(status);
  return <span style={{ ...styles.pill, ...tone }}>{text}</span>;
}

function MissingDataSummary({ summary }: { summary?: { count?: number; fields?: string[]; reasons?: string[]; effects?: string[] } }) {
  if (!summary || (summary.count ?? 0) === 0) {
    return <p style={styles.smallCopy}>Missing-data effects: none reported.</p>;
  }
  return (
    <div style={styles.missingBox}>
      <strong>Missing-data effects: {summary.count}</strong>
      <span>Fields: {(summary.fields ?? []).join(", ") || "unknown"}</span>
      <span>Reasons: {(summary.reasons ?? []).join(", ") || "unknown"}</span>
      <span>Effects: {(summary.effects ?? []).join(", ") || "unknown"}</span>
    </div>
  );
}

function MissingEffects({ effects }: { effects?: MissingDataEffect[] }) {
  if (!effects || effects.length === 0) return null;
  return (
    <div style={styles.missingBox}>
      {effects.slice(0, 3).map((effect) => (
        <span key={`${effect.field}:${effect.reason}`}>
          {effect.field}: {effect.effect} ({effect.reason}){effect.message ? ` - ${effect.message}` : ""}
        </span>
      ))}
    </div>
  );
}

function EvidenceLine({
  evidence,
  timelineRefs,
}: {
  evidence?: Array<{ description?: string; confidence?: Confidence }>;
  timelineRefs?: string[];
}) {
  const evidenceCount = evidence?.length ?? 0;
  const refCount = timelineRefs?.length ?? 0;
  return (
    <p style={styles.smallCopy}>
      Evidence refs {evidenceCount} · timeline refs {refCount}
      {evidence?.[0]?.description ? ` · latest: ${evidence[0].description}` : ""}
    </p>
  );
}

function IssueList({ title, issues, compact = false }: { title: string; issues: IssueSummary[]; compact?: boolean }) {
  if (!issues || issues.length === 0) {
    return compact ? null : <p style={styles.smallCopy}>{title}: none.</p>;
  }
  return (
    <div style={compact ? styles.issueListCompact : styles.issueList}>
      <strong>{title}</strong>
      {issues.slice(0, compact ? 3 : 6).map((issue) => (
        <span key={`${issue.severity}:${issue.code}`}>
          {issue.severity} · {issue.code} · {issue.count} count
          {typeof issue.relationshipsAffected === "number" ? ` · ${issue.relationshipsAffected} relationships` : ""}
        </span>
      ))}
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div style={styles.emptyPanel}>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function formatKind(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value?: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function label(value?: string): string {
  return value ? formatKind(value) : "Unknown";
}

function statusTone(status?: string): CSSProperties {
  if (status === "ok" || status === "ready" || status === "high") return styles.pillOk;
  if (status === "warning" || status === "medium") return styles.pillWarn;
  if (status === "error" || status === "degraded" || status === "low") return styles.pillError;
  return styles.pillNeutral;
}

const styles: Record<string, CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    color: palette.textPrimary,
    maxHeight: "calc(100vh - 118px)",
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingRight: "4px",
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-start",
    padding: "18px",
    borderRadius: "18px",
    border: `1px solid ${palette.borderLight}`,
    background: `linear-gradient(135deg, ${palette.surface} 0%, ${palette.bluePale} 100%)`,
  },
  heroMeta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "6px",
    minWidth: "180px",
  },
  eyebrow: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: palette.blue,
  },
  title: {
    margin: "4px 0 8px",
    fontSize: "24px",
    lineHeight: 1.1,
    letterSpacing: "-0.03em",
  },
  copy: {
    margin: 0,
    fontSize: "13px",
    lineHeight: 1.5,
    color: palette.textSecondary,
  },
  smallCopy: {
    margin: 0,
    fontSize: "11px",
    lineHeight: 1.45,
    color: palette.textTertiary,
  },
  metaLine: {
    fontSize: "11px",
    color: palette.textSecondary,
  },
  warningBox: {
    padding: "12px 14px",
    borderRadius: "12px",
    border: `1px solid ${palette.warning}`,
    background: palette.warningBg,
    color: palette.warning,
    fontSize: "13px",
  },
  card: {
    padding: "14px",
    borderRadius: "16px",
    border: `1px solid ${palette.borderLight}`,
    background: palette.surface,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  grid4: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "12px",
  },
  operatorFlow: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  metricCard: {
    padding: "14px",
    borderRadius: "14px",
    border: `1px solid ${palette.borderLight}`,
    background: palette.surface,
  },
  metricValue: {
    fontSize: "22px",
    fontWeight: 800,
    color: palette.textPrimary,
  },
  metricLabel: {
    marginTop: "3px",
    fontSize: "12px",
    fontWeight: 700,
    color: palette.textSecondary,
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "12px",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "16px",
    lineHeight: 1.2,
    letterSpacing: "-0.02em",
  },
  sectionDetail: {
    fontSize: "11px",
    color: palette.textTertiary,
  },
  guardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: "8px",
    marginBottom: "10px",
  },
  guardItem: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px",
    borderRadius: "10px",
    background: palette.surfaceHover,
    border: `1px solid ${palette.border}`,
  },
  guardName: {
    fontSize: "11px",
    color: palette.textSecondary,
  },
  blocked: {
    fontSize: "11px",
    fontWeight: 800,
    color: palette.success,
  },
  unknown: {
    fontSize: "11px",
    fontWeight: 800,
    color: palette.textTertiary,
  },
  statusList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    fontSize: "13px",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    width: "fit-content",
    borderRadius: "999px",
    padding: "3px 9px",
    fontSize: "11px",
    fontWeight: 800,
    border: "1px solid transparent",
    whiteSpace: "nowrap",
  },
  pillOk: {
    color: palette.success,
    borderColor: palette.success,
    background: palette.successBg,
  },
  pillWarn: {
    color: palette.warning,
    borderColor: palette.warning,
    background: palette.warningBg,
  },
  pillError: {
    color: palette.danger,
    borderColor: palette.danger,
    background: palette.dangerBg,
  },
  pillNeutral: {
    color: palette.textSecondary,
    borderColor: palette.border,
    background: palette.surfaceHover,
  },
  timelineBox: {
    padding: "14px",
    borderRadius: "12px",
    background: palette.surfaceHover,
    border: `1px dashed ${palette.border}`,
  },
  timelineTitle: {
    fontSize: "13px",
    fontWeight: 800,
    marginBottom: "4px",
  },
  endpointList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "12px",
  },
  code: {
    padding: "3px 7px",
    borderRadius: "7px",
    background: palette.surfaceHover,
    border: `1px solid ${palette.border}`,
    fontSize: "11px",
    color: palette.textSecondary,
  },
  queueGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "10px",
  },
  workflowBoundary: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    margin: "12px 0",
    fontSize: "11px",
  },
  workflowGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "10px",
    marginTop: "12px",
  },
  workflowCard: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "14px",
    borderRadius: "14px",
    border: `1px solid ${palette.borderLight}`,
    background: palette.bluePale,
  },
  queueCard: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "14px",
    borderRadius: "14px",
    border: `1px solid ${palette.borderLight}`,
    background: palette.surfaceHover,
  },
  queueHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "10px",
  },
  queueTitle: {
    fontSize: "13px",
    fontWeight: 800,
    color: palette.textPrimary,
  },
  ordering: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "10px",
    color: palette.textTertiary,
  },
  queueItem: {
    padding: "12px",
    borderRadius: "12px",
    background: palette.surface,
    border: `1px solid ${palette.borderLight}`,
  },
  queueItemHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  itemTitle: {
    fontSize: "12px",
    fontWeight: 800,
  },
  reasonList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginTop: "8px",
  },
  reason: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px",
    borderRadius: "10px",
    background: palette.surfaceHover,
    fontSize: "11px",
    color: palette.textSecondary,
  },
  emptyInline: {
    padding: "12px",
    borderRadius: "10px",
    background: palette.surface,
    color: palette.textTertiary,
    fontSize: "12px",
  },
  feedGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginTop: "10px",
  },
  feedItem: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "10px",
    borderRadius: "10px",
    border: `1px solid ${palette.borderLight}`,
    fontSize: "12px",
    color: palette.textSecondary,
  },
  diagnosticGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "12px",
  },
  diagnosticCard: {
    padding: "12px",
    borderRadius: "12px",
    border: `1px solid ${palette.borderLight}`,
    background: palette.surfaceHover,
  },
  missingBox: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    marginTop: "10px",
    padding: "10px",
    borderRadius: "10px",
    background: palette.warningBg,
    border: `1px solid ${palette.warning}`,
    color: palette.warning,
    fontSize: "11px",
  },
  issueList: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    marginTop: "10px",
    fontSize: "11px",
    color: palette.textSecondary,
  },
  issueListCompact: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    marginTop: "8px",
    fontSize: "10px",
    color: palette.textTertiary,
  },
  emptyPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "14px",
    borderRadius: "12px",
    border: `1px dashed ${palette.border}`,
    background: palette.surfaceHover,
    color: palette.textSecondary,
    fontSize: "13px",
  },
};
