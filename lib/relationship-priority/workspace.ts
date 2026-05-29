import type { PublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import type { RelationshipEngineOperatorSurface } from "@/lib/relationship-engine/operatorIntegration";
import {
  applyShowcaseDemoPreset,
  type RelationshipPriorityShowcaseConfig,
  type RelationshipPriorityShowcaseModel,
} from "@/lib/relationship-priority/showcase";
import {
  ageDaysFromIso,
  freshnessLabel,
  freshnessStateFor,
  type FreshnessState,
} from "@/lib/display/trustVisibility";
import type { ResurfacingBucket } from "@/lib/relationship-intelligence/resurfacing";
import {
  buildContactScoreTransparency,
  buildRecommendationExplanation,
  effectivePriorityScore,
  honestSuggestedActionLabel,
  type DataQualityTier,
} from "@/lib/crm-import/scoreTransparency";
import {
  contactHasReachableEmail,
  contactHasReachablePhone,
} from "@/lib/crm-import/reachability";
import { scoreFromCrmContact } from "@/lib/relationship-intelligence/scoring";
import {
  buildCombinedPriority,
  compareCombinedPriority,
  type MarketOpportunityDisplay,
} from "@/lib/enrichment/opportunity/combinedPriority";
import type { RelationshipClass } from "@/lib/enrichment/opportunity/relationshipClassification";
import type { CrmContactRecord, VerificationTier } from "@/lib/crm-import/types";

type EngineSummary = RelationshipEngineOperatorSurface["workflows"]["relationshipSummaries"][number];
type EngineQueueItem = RelationshipEngineOperatorSurface["queues"][number]["items"][number];
type EngineFeedItem = RelationshipEngineOperatorSurface["feeds"][number]["items"][number];

export type RelationshipPriorityNavId =
  | "priority"
  | "recovery"
  | "follow-up"
  | "outcomes"
  | "assistant";

export interface RelationshipPriorityWorkspaceModel {
  generatedAt: string;
  workspace: {
    slug: string;
    name: string;
    accentLabel: string;
    dataMode: WorkspaceConfig["access"]["dataMode"];
    readOnly: boolean;
  };
  operator: {
    name: string;
    role: PublicUser["accessRole"];
  };
  status: "ready" | "degraded";
  demoMode: boolean;
  hero: {
    question: string;
    focus: string;
    answer: string;
  };
  nav: Array<{
    id: RelationshipPriorityNavId;
    label: string;
    count: number;
  }>;
  summary: {
    priorityCount: number;
    readyNowCount: number;
    reachableCount: number;
    marketOpportunityCount: number;
    followUpsDue: number;
    compressedSignals: number;
  };
  priorityQueue: RelationshipPriorityCard[];
  recoveryQueue: RelationshipPriorityCard[];
  followUpQueue: RelationshipPriorityCard[];
  outcomeNotes: RelationshipPriorityOutcome[];
  assistantPrompts: string[];
  simplificationNotes: string[];
  deferred: string[];
  importPath: string;
  resurfacingBuckets: ResurfacingBucket[];
  crmContactCount: number;
  showcase?: RelationshipPriorityShowcaseModel;
}

export interface RelationshipPriorityCard {
  id: string;
  relationshipId: string;
  rank: number;
  company: string;
  relationship: string;
  relationshipClass?: RelationshipClass;
  relationshipConfidence?: "medium" | "low";
  relationshipReasons?: string[];
  reachable?: boolean;
  reachabilityStatus?: "Reachable" | "Not Reachable";
  lastInteractionRecency?: string;
  marketOpportunity?: MarketOpportunityDisplay | null;
  /** @deprecated Internal tiebreaker only — not shown in CRM-import UI. */
  marketFit: number;
  urgency: "Now" | "Today" | "This week";
  importance: "highest" | "high" | "medium";
  stage: string;
  topReasons: string[];
  bestContact: {
    name: string;
    title: string;
  };
  contactMethods: Array<{
    type: "Call" | "Email" | "LinkedIn";
    value: string;
    primary?: boolean;
    actionable?: boolean;
    downgraded?: boolean;
    disabledReason?: string | null;
  }>;
  recommendedAction: "Call" | "Email" | "Follow Up" | "Assign" | "Open Context";
  nextStep: string;
  suggestedAngle: string;
  verificationTier?: VerificationTier;
  verificationStatusLabel?: string;
  dataQualityTier?: DataQualityTier;
  dataQualityLabel?: string;
  recommendationWhy?: string;
  recommendationEvidence?: string[];
  recommendationMissing?: string[];
  phoneActionable?: boolean;
  emailActionable?: boolean;
  topSignals: string[];
  relationshipHistory: string[];
  followUpHistory: string[];
  optionalContext: {
    deepReport: string;
    aiAssistant: string;
    relationshipHistory: string;
  };
  marketFitRaw?: number;
  source: {
    kind: "relationship-engine" | "demo-generated" | "crm-import";
    queueKind?: string;
    confidence: string;
    generatedAt: string;
    freshnessLabel: string;
    freshnessState: FreshnessState;
    evidenceCount: number;
    missingDataCount: number;
    warnings: string[];
  };
}

export interface RelationshipPriorityOutcome {
  id: string;
  label: string;
  detail: string;
  relationshipId?: string;
}

export function buildRelationshipPriorityWorkspaceModel(args: {
  surface: RelationshipEngineOperatorSurface;
  workspace: WorkspaceConfig;
  user: PublicUser;
  showcaseConfig?: RelationshipPriorityShowcaseConfig | null;
  crmContacts?: CrmContactRecord[];
  resurfacingBuckets?: ResurfacingBucket[];
}): RelationshipPriorityWorkspaceModel {
  const { surface, workspace, user, showcaseConfig, crmContacts = [], resurfacingBuckets = [] } = args;
  const queueIndex = indexQueueItems(surface);
  const feedIndex = indexFeedItems(surface);
  const engineCards = surface.workflows.relationshipSummaries
    .slice()
    .sort((a, b) => a.deterministicOrder.sortKey.localeCompare(b.deterministicOrder.sortKey))
    .slice(0, 9)
    .map((summary, index) => engineSummaryToCard({
      summary,
      queueItem: queueIndex.get(summary.relationshipId),
      feedItems: feedIndex.get(summary.relationshipId) ?? [],
      index,
      generatedAt: surface.generatedAt,
    }));
  const generatedCards = generateDemoPriorityCards(workspace, surface.generatedAt);
  const demoMode = workspace.access.dataMode === "demo" || engineCards.length === 0;
  const crmCards = crmContactsToPriorityCards(crmContacts, surface.generatedAt);
  const priorityQueue = mergeDemoBackfill(
    [...crmCards, ...engineCards],
    generatedCards,
    demoMode && crmCards.length === 0,
  );
  const recoveryQueue = priorityQueue.filter((card) =>
    card.stage.toLowerCase().includes("retention")
    || card.stage.toLowerCase().includes("reactivation")
    || card.stage.toLowerCase().includes("stale")
    || card.topReasons.some((reason) => reason.toLowerCase().includes("cooling")),
  );
  const followUpQueue = priorityQueue.filter((card) =>
    card.recommendedAction === "Follow Up"
    || card.topReasons.some((reason) => reason.toLowerCase().includes("follow")),
  );
  const outcomeNotes = buildOutcomeNotes(priorityQueue);
  const followUpsDue = followUpQueue.length;

  const model: RelationshipPriorityWorkspaceModel = {
    generatedAt: surface.generatedAt,
    workspace: {
      slug: workspace.slug,
      name: workspace.branding?.displayName ?? workspace.name,
      accentLabel: workspace.branding?.accentLabel ?? "Relationship priority workspace",
      dataMode: workspace.access.dataMode,
      readOnly: workspace.access.readOnlyByDefault,
    },
    operator: {
      name: user.name ?? user.id,
      role: user.accessRole,
    },
    status: surface.status,
    demoMode,
    hero: {
      question: "Who matters, why now, and what should happen next?",
      focus: "Today's Priority Queue",
      answer: priorityQueue[0]
        ? `${priorityQueue[0].company} — ${priorityQueue[0].relationship}${priorityQueue[0].marketOpportunity ? ` · ${priorityQueue[0].marketOpportunity.label}` : ""}`
        : "Relationship signals are compressed into the next best operator action.",
    },
    nav: [
      { id: "priority", label: "Priority Queue", count: priorityQueue.length },
      { id: "recovery", label: "Recovery", count: recoveryQueue.length },
      { id: "follow-up", label: "Follow-Up", count: followUpsDue },
      { id: "outcomes", label: "Outcomes", count: outcomeNotes.length },
      { id: "assistant", label: "Assistant", count: 3 },
    ],
    summary: {
      priorityCount: priorityQueue.length,
      readyNowCount: priorityQueue.filter((card) => card.urgency === "Now").length,
      reachableCount: priorityQueue.filter((card) => card.reachable !== false).length,
      marketOpportunityCount: priorityQueue.filter((card) => card.marketOpportunity).length,
      followUpsDue,
      compressedSignals: surface.metadata.summaryDisplay.queueItemCount
        + surface.metadata.summaryDisplay.feedItemCount
        + generatedCards.length,
    },
    priorityQueue,
    recoveryQueue,
    followUpQueue,
    outcomeNotes,
    assistantPrompts: [
      "Draft the next best email for the selected relationship.",
      "Explain the recommended angle in one sentence.",
      "Prepare a 30-second call opener using only current signals.",
    ],
    simplificationNotes: [
      "Diagnostics stay behind the surface unless the operator asks for context.",
      "Secondary metrics are collapsed into market fit, urgency, and next step.",
      "Relationship engine queues are converted into one tactical priority list.",
    ],
    deferred: [
      "Live call/email execution hooks remain behind the action buttons.",
      "Deep Report opens as contextual detail rather than a default dashboard.",
      "Assistant actions are staged as prompts until execution endpoints are wired.",
    ],
    importPath: `/operator/import?workspace=${workspace.slug}`,
    resurfacingBuckets,
    crmContactCount: crmContacts.length,
  };
  return applyShowcaseDemoPreset(model, showcaseConfig);
}

function crmContactsToPriorityCards(
  contacts: CrmContactRecord[],
  _generatedAt: string,
): RelationshipPriorityCard[] {
  const now = new Date(_generatedAt);
  const combinedByContact = new Map(
    contacts.map((c) => [
      c.id,
      buildCombinedPriority({
        relationship: {
          tags: c.tags ?? [],
          hasPhone: contactHasReachablePhone(c),
          hasEmail: contactHasReachableEmail(c),
          lastInteractionAt: c.lastInteractionAt ?? null,
          now,
        },
        opportunity: c.enrichment?.opportunity ?? null,
        strengthTiebreaker: effectivePriorityScore(c, c.relationshipScore ?? 0),
      }),
    ]),
  );
  return contacts
    .slice()
    .sort((a, b) => {
      const cmp = compareCombinedPriority(
        combinedByContact.get(a.id)!,
        combinedByContact.get(b.id)!,
      );
      if (cmp !== 0) return cmp;
      return (
        effectivePriorityScore(b, b.relationshipScore ?? 0)
        - effectivePriorityScore(a, a.relationshipScore ?? 0)
      );
    })
    .slice(0, 12)
    .map((contact, index) => {
      const combined = combinedByContact.get(contact.id)!;
      const classification = combined.classification;
      const score = scoreFromCrmContact(contact);
      const transparency = buildContactScoreTransparency(contact);
      const recommendation = buildRecommendationExplanation(contact, transparency);
      const methods = transparency.contactMethods;
      const state = freshnessStateFor(ageDaysFromIso(contact.lastInteractionAt ?? contact.updatedAt));
      const trustWarnings = Object.entries(contact.dataTrust)
        .filter(([, datum]) => !datum.displayAsTrusted)
        .map(([field, datum]) => `${field}: ${datum.trustLevel}`);

      const hasReachablePhone = contactHasReachablePhone(contact);
      const hasReachableEmail = contactHasReachableEmail(contact);

      let recommendedAction: RelationshipPriorityCard["recommendedAction"] = "Open Context";
      if (hasReachablePhone && methods.phone.actionable) {
        recommendedAction = "Call";
      } else if (hasReachableEmail && methods.email.actionable) {
        recommendedAction = "Email";
      } else if (hasReachableEmail) {
        recommendedAction = "Email";
      }

      const contactMethods: RelationshipPriorityCard["contactMethods"] = [];
      if (contact.phone) {
        contactMethods.push({
          type: "Call",
          value: contact.phone,
          primary: hasReachablePhone,
          actionable: methods.phone.actionable,
          downgraded: methods.phone.downgraded,
          disabledReason: methods.phone.reason,
        });
      }
      if (contact.email) {
        contactMethods.push({
          type: "Email",
          value: contact.email,
          actionable: methods.email.actionable,
          downgraded: methods.email.downgraded,
          disabledReason: methods.email.reason,
        });
      }

      const stage =
        transparency.verificationTier === "verified" || transparency.verificationTier === "enriched"
          ? "Verified intelligence"
          : transparency.verificationTier === "confidence_low"
            ? "Needs review"
            : "Imported contact";

      return {
        id: `crm-${contact.id}`,
        relationshipId: contact.id,
        rank: index + 1,
        company: contact.company,
        relationship: classification.displayLabel,
        relationshipClass: classification.label,
        relationshipConfidence: classification.confidence,
        relationshipReasons: classification.reasons,
        reachable: classification.reachable,
        reachabilityStatus: combined.reachabilityStatus,
        lastInteractionRecency: combined.lastInteractionRecency,
        marketOpportunity: combined.marketOpportunity,
        marketFit: effectivePriorityScore(contact, contact.relationshipScore ?? score.total),
        marketFitRaw: contact.relationshipScore ?? score.total,
        urgency: index === 0 ? "Now" : index < 3 ? "Today" : "This week",
        importance: index === 0 ? "highest" : index < 3 ? "high" : "medium",
        stage,
        topReasons: compact([
          classification.reasons[0] ?? recommendation.why,
          combined.lastInteractionRecency,
          combined.reachabilityStatus,
        ]),
        bestContact: {
          name: contact.name,
          title: contact.company,
        },
        contactMethods,
        recommendedAction,
        nextStep:
          recommendedAction === "Call" && methods.phone.actionable
            ? `Call ${contact.name} at ${contact.phone}.`
            : recommendedAction === "Call"
              ? `Review phone trust before calling ${contact.name}.`
              : recommendedAction === "Email" && methods.email.actionable
                ? `Email ${contact.name} with one clear ask.`
                : recommendedAction === "Email"
                  ? `Review email trust before emailing ${contact.name}.`
                  : `Enrich or verify contact data before outreach.`,
        suggestedAngle: recommendation.why,
        verificationTier: transparency.verificationTier,
        verificationStatusLabel: transparency.verificationStatusLabel,
        dataQualityTier: transparency.dataQualityTier,
        dataQualityLabel: transparency.dataQualityLabel,
        recommendationWhy: recommendation.why,
        recommendationEvidence: recommendation.evidence,
        recommendationMissing: recommendation.missing,
        phoneActionable: methods.phone.actionable,
        emailActionable: methods.email.actionable,
        topSignals: recommendation.evidence.slice(0, 3),
        relationshipHistory: compact([
          contact.notes ? contact.notes.slice(0, 120) : null,
          contact.lastInteractionAt ? `Last touch ${relativeDate(contact.lastInteractionAt)}` : null,
        ]),
        followUpHistory: [
          trustWarnings.length > 0
            ? `Trust gaps: ${trustWarnings.join("; ")}`
            : `${transparency.verificationStatusLabel} — ${transparency.dataQualityLabel}`,
        ],
        optionalContext: {
          deepReport: "Review import provenance and datum trust.",
          aiAssistant: "Draft opener from scored factors only.",
          relationshipHistory: "Timeline from CRM import.",
        },
        source: {
          kind: "crm-import",
          queueKind: "crm_import",
          confidence: score.confidence,
          generatedAt: contact.updatedAt,
          freshnessLabel: freshnessLabel(state, ageDaysFromIso(contact.lastInteractionAt ?? contact.updatedAt)),
          freshnessState: state,
          evidenceCount: recommendation.evidence.length,
          missingDataCount: score.missingDataFlags.length + recommendation.missing.length,
          warnings: compact([
            ...trustWarnings,
            !contact.scoreMetadata
              ? "Legacy contact — score provenance not stored at import"
              : null,
            honestSuggestedActionLabel(recommendedAction, transparency) !== recommendedAction
              ? honestSuggestedActionLabel(recommendedAction, transparency)
              : null,
            methods.phone.reason,
            methods.email.reason,
          ]),
        },
      };
    });
}

function engineSummaryToCard(args: {
  summary: EngineSummary;
  queueItem?: EngineQueueItem;
  feedItems: EngineFeedItem[];
  index: number;
  generatedAt: string;
}): RelationshipPriorityCard {
  const { summary, queueItem, feedItems, index, generatedAt } = args;
  const marketFit = marketFitFromHealth(summary.healthScore, summary.confidence, index);
  const topReasons = compact([
    queueItem?.whyItExists,
    ...summary.whyNow.explanations,
    ...summary.whyNow.reasonCodes.map(formatToken),
  ]).slice(0, 3);
  const action = recommendedAction(summary, queueItem);
  const company = summary.displayName || `Relationship ${index + 1}`;
  const contact = contactFor(company, index);
  const evidenceCount = new Set([
    ...summary.whyNow.evidenceReferences.flatMap((ref) => ref.evidence.map((item) => item.id)),
    ...(queueItem?.latestEvidence ?? []).flatMap((ref) => ref.evidence.map((item) => item.id)),
    ...(queueItem?.reasons ?? []).flatMap((reason) => reason.evidence.map((ref) => ref.id)),
    ...feedItems.flatMap((item) => item.latestEvidence.flatMap((ref) => ref.evidence.map((evidence) => evidence.id))),
  ].filter(Boolean)).size;
  const missingData = [
    ...summary.missingDataEffects,
    ...(queueItem?.missingDataEffects ?? []),
  ];
  const sourceGeneratedAt = queueItem?.generatedAt ?? generatedAt;
  const freshnessState = freshnessStateFor(ageDaysFromIso(sourceGeneratedAt));

  return {
    id: `engine-${summary.relationshipId}`,
    relationshipId: summary.relationshipId,
    rank: index + 1,
    company,
    relationship: lifecycleLabel(summary.lifecycle),
    marketFit,
    urgency: urgencyFor(index, topReasons),
    importance: importanceFor(index, marketFit),
    stage: stageFor(summary, queueItem),
    topReasons: topReasons.length > 0 ? topReasons : ["Relationship engine flagged this account for operator review."],
    bestContact: contact.bestContact,
    contactMethods: contact.contactMethods,
    recommendedAction: action,
    nextStep: nextStepFor(action, company),
    suggestedAngle: suggestedAngleFor(summary, queueItem),
    topSignals: compact([
      ...summary.whyNow.reasonCodes.map(formatToken),
      ...feedItems.slice(0, 2).map((item) => item.title),
      summary.deterministicOrder.sourceQueueKind ? formatToken(summary.deterministicOrder.sourceQueueKind) : null,
    ]).slice(0, 4),
    relationshipHistory: compact([
      summary.whyNow.latestActivityAt ? `Latest activity ${relativeDate(summary.whyNow.latestActivityAt)}` : null,
      feedItems[0]?.body,
      `Lifecycle: ${lifecycleLabel(summary.lifecycle)}`,
    ]).slice(0, 3),
    followUpHistory: compact([
      summary.whyNow.dueAt ? `Due ${relativeDate(summary.whyNow.dueAt)}` : null,
      queueItem?.reasons?.find((reason) => reason.dueAt)?.label,
      summary.ownerVisibility.unassigned ? "No primary owner assigned." : null,
    ]).slice(0, 3),
    optionalContext: {
      deepReport: "Open compressed reasoning and evidence.",
      aiAssistant: "Prepare the best opener from current signals.",
      relationshipHistory: "Review timeline and prior touchpoints.",
    },
    source: {
      kind: "relationship-engine",
      queueKind: summary.deterministicOrder.sourceQueueKind,
      confidence: summary.confidence,
      generatedAt: sourceGeneratedAt,
      freshnessLabel: freshnessLabel(freshnessState, ageDaysFromIso(sourceGeneratedAt)),
      freshnessState,
      evidenceCount,
      missingDataCount: missingData.length,
      warnings: [
        ...missingData.map((effect) => effect.message),
        ...(queueItem?.integrityFindings ?? []).map((finding) => finding.message),
      ].slice(0, 3),
    },
  };
}

function generateDemoPriorityCards(
  workspace: WorkspaceConfig,
  generatedAt: string,
): RelationshipPriorityCard[] {
  const demoSeed = workspace.slug === "advisor-demo" ? "advisor" : "operator";
  const companies = [
    ["Northstar Roofing Group", "Owner", "Expansion signal", "Call"],
    ["Summit Exterior Partners", "General Manager", "Follow-up window", "Follow Up"],
    ["Blue Ridge Home Services", "Operations Lead", "Recovery risk", "Call"],
    ["Prairie Commercial Roofing", "Estimator", "Warm opportunity", "Email"],
    ["Atlas Building Envelope", "Partner", "Dormant account", "Open Context"],
    ["Harbor Restoration Co.", "Founder", "Recent intent", "Assign"],
  ] as const;

  return companies.map(([company, title, reason, action], index) => {
    const contact = contactFor(company, index + 10);
    const rank = index + 1;
    const actionValue = action as RelationshipPriorityCard["recommendedAction"];
    const state = freshnessStateFor(ageDaysFromIso(generatedAt));
    return {
      id: `demo-${demoSeed}-${rank}`,
      relationshipId: `demo-${demoSeed}-${rank}`,
      rank,
      company,
      relationship: index < 2 ? "Active relationship" : index === 2 ? "At-risk relationship" : "Warm relationship",
      marketFit: [96, 91, 88, 84, 79, 76][index] ?? 74,
      urgency: index === 0 ? "Now" : index < 4 ? "Today" : "This week",
      importance: index === 0 ? "highest" : index < 3 ? "high" : "medium",
      stage: index === 2 ? "Recovery" : index === 4 ? "Reactivation" : "Priority execution",
      topReasons: [
        `${reason} surfaced by the relationship workflow.`,
        index % 2 === 0 ? "Decision maker has recent activity." : "Follow-up promise is aging.",
        `Generated demo queue item refreshed ${relativeDate(generatedAt)}.`,
      ],
      bestContact: {
        name: contact.bestContact.name,
        title,
      },
      contactMethods: contact.contactMethods,
      recommendedAction: actionValue,
      nextStep: nextStepFor(actionValue, company),
      suggestedAngle: [
        "Lead with a specific operational improvement and ask for the next committed step.",
        "Reference the prior promise, then offer a short path to restart momentum.",
        "Acknowledge the gap and make the next action easy to accept.",
        "Use the warm signal to ask for a practical pilot conversation.",
        "Reopen with a concise note that gives them a reason to respond.",
        "Assign a relationship owner before the next touchpoint is lost.",
      ][index] ?? "Keep the touchpoint direct and action-oriented.",
      topSignals: [
        "Generated opportunity",
        index % 2 === 0 ? "High fit" : "Follow-up due",
        index === 2 ? "Recovery" : "Operator ready",
      ],
      relationshipHistory: [
        "Demo workflow includes prior touchpoint, open next step, and owner context.",
        "History stays collapsed until the operator opens context.",
      ],
      followUpHistory: [
        index % 2 === 0 ? "Last action created a clear next step." : "Follow-up state is waiting on operator action.",
      ],
      optionalContext: {
        deepReport: "Available after selection.",
        aiAssistant: "Ready to draft the opener.",
        relationshipHistory: "Loaded in the context panel.",
      },
      source: {
        kind: "demo-generated",
        queueKind: "generated_demo_priority_queue",
        confidence: "high",
        generatedAt,
        freshnessLabel: freshnessLabel(state, ageDaysFromIso(generatedAt)),
        freshnessState: state,
        evidenceCount: 3,
        missingDataCount: 0,
        warnings: [],
      },
    };
  });
}

function mergeDemoBackfill(
  engineCards: RelationshipPriorityCard[],
  generatedCards: RelationshipPriorityCard[],
  demoMode: boolean,
): RelationshipPriorityCard[] {
  const cards = demoMode
    ? [...engineCards, ...generatedCards].slice(0, 6)
    : engineCards;
  return cards.map((card, index) => ({
    ...card,
    rank: index + 1,
    importance: importanceFor(index, card.marketFit),
    urgency: index === 0 ? "Now" : index < 4 ? "Today" : card.urgency,
  }));
}

function indexQueueItems(surface: RelationshipEngineOperatorSurface): Map<string, EngineQueueItem> {
  const index = new Map<string, EngineQueueItem>();
  for (const queue of surface.queues) {
    for (const item of queue.items) {
      if (!index.has(item.relationshipId)) index.set(item.relationshipId, item);
    }
  }
  return index;
}

function indexFeedItems(surface: RelationshipEngineOperatorSurface): Map<string, EngineFeedItem[]> {
  const index = new Map<string, EngineFeedItem[]>();
  for (const feed of surface.feeds) {
    for (const item of feed.items) {
      const items = index.get(item.relationshipId) ?? [];
      items.push(item);
      index.set(item.relationshipId, items);
    }
  }
  return index;
}

function buildOutcomeNotes(cards: RelationshipPriorityCard[]): RelationshipPriorityOutcome[] {
  return cards.slice(0, 4).map((card) => ({
    id: `outcome-${card.id}`,
    relationshipId: card.relationshipId,
    label: `${card.recommendedAction} ready`,
    detail: `${card.company}: ${card.nextStep}`,
  }));
}

function marketFitFromHealth(
  healthScore: number | undefined,
  confidence: string,
  index: number,
): number {
  const base = typeof healthScore === "number" ? healthScore : 92 - index * 4;
  const confidenceBonus = confidence === "high" ? 3 : confidence === "medium" ? 1 : 0;
  return clamp(Math.round(base + confidenceBonus), 54, 98);
}

function recommendedAction(
  summary: EngineSummary,
  queueItem?: EngineQueueItem,
): RelationshipPriorityCard["recommendedAction"] {
  const text = [
    summary.deterministicOrder.sourceQueueKind,
    summary.whyNow.summary,
    queueItem?.whyItExists,
    ...summary.whyNow.reasonCodes,
  ].join(" ").toLowerCase();
  if (summary.ownerVisibility.unassigned || text.includes("missing owner")) return "Assign";
  if (text.includes("follow")) return "Follow Up";
  if (text.includes("reactivation") || text.includes("dormant")) return "Email";
  if (text.includes("retention") || text.includes("risk") || text.includes("attention")) return "Call";
  return "Open Context";
}

function nextStepFor(
  action: RelationshipPriorityCard["recommendedAction"],
  company: string,
): string {
  if (action === "Call") return `Call ${company} and ask for the next committed step.`;
  if (action === "Email") return `Send a concise note with one clear ask.`;
  if (action === "Follow Up") return `Close the loop on the promised follow-up today.`;
  if (action === "Assign") return `Assign an owner before outreach starts.`;
  return `Open context, confirm the angle, then execute.`;
}

function suggestedAngleFor(summary: EngineSummary, queueItem?: EngineQueueItem): string {
  const firstExplanation = summary.whyNow.explanations[0] ?? queueItem?.whyItExists;
  if (firstExplanation) return sentence(firstExplanation);
  if (summary.whyNow.summary) return sentence(summary.whyNow.summary);
  return "Lead with the clearest relationship signal and ask for one next step.";
}

function urgencyFor(index: number, reasons: string[]): RelationshipPriorityCard["urgency"] {
  const text = reasons.join(" ").toLowerCase();
  if (index === 0 || text.includes("overdue") || text.includes("risk")) return "Now";
  if (index < 4 || text.includes("follow")) return "Today";
  return "This week";
}

function importanceFor(index: number, marketFit: number): RelationshipPriorityCard["importance"] {
  if (index === 0 || marketFit >= 94) return "highest";
  if (index < 3 || marketFit >= 84) return "high";
  return "medium";
}

function stageFor(summary: EngineSummary, queueItem?: EngineQueueItem): string {
  const source = summary.deterministicOrder.sourceQueueKind ?? queueItem?.queueKind ?? "priority";
  return formatToken(source);
}

function lifecycleLabel(value: string): string {
  return formatToken(value || "relationship");
}

function contactFor(company: string, index: number): Pick<RelationshipPriorityCard, "bestContact" | "contactMethods"> {
  const first = ["Maya", "Eli", "Jordan", "Sam", "Avery", "Taylor"][index % 6];
  const last = company.split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, "") || "Operator";
  const domain = `${last.toLowerCase()}co.com`;
  const phoneSuffix = String(4100 + index * 137).padStart(4, "0").slice(-4);
  return {
    bestContact: {
      name: `${first} ${last}`,
      title: "Primary relationship owner",
    },
    contactMethods: [
      { type: "Call", value: `(816) 555-${phoneSuffix}`, primary: true },
      { type: "Email", value: `${first.toLowerCase()}@${domain}` },
    ],
  };
}

function relativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function compact(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
