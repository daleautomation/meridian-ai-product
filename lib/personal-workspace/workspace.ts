import type { PublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import type { CrmContactRecord } from "@/lib/crm-import/types";
import {
  computeWorkspaceReachability,
  contactHasReachableEmail,
  contactHasReachablePhone,
  type WorkspaceReachabilityProfile,
} from "@/lib/crm-import/reachability";
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
  deriveEnrichmentStatus,
  effectivePriorityScore,
  enrichmentStatusLabel,
  honestSuggestedActionLabel,
  isGenericRecommendation,
  verificationStatusLabel,
  type ContactScoreTransparency,
  type DataQualityTier,
  type EnrichmentStatus,
  type VerificationTier,
} from "@/lib/crm-import/scoreTransparency";
import { scoreFromCrmContact } from "@/lib/relationship-intelligence/scoring";
import { workspaceImportPath } from "@/lib/workspaceRouting";
import { personalCopyForWorkspace, PERSONAL_NAV, type PersonalNavId } from "./config";
import { buildSuggestedOpenerFromContact, type SuggestedOpener } from "./openerBuilder";

export type PersonalPrimaryChannel = "email" | "phone" | "none";

export interface PersonalContactCard {
  id: string;
  contactId: string;
  rank: number;
  name: string;
  company: string;
  relationshipLabel: string;
  strength: number;
  strengthRaw: number;
  timing: "Soon" | "This week" | "When ready";
  stage: string;
  reasons: string[];
  email: string | null;
  phone: string | null;
  primaryChannel: PersonalPrimaryChannel;
  reachabilityNote: string | null;
  suggestedAction: "Reach out" | "Send a note" | "Follow up" | "Review context" | "Enrich first";
  nextStep: string;
  angle: string;
  signals: string[];
  history: string[];
  activityMemory: string[];
  trustNotes: string[];
  source: {
    freshnessLabel: string;
    freshnessState: FreshnessState;
    confidence: string;
    missingFields: number;
  };
  enrichmentStatus: EnrichmentStatus;
  enrichmentLabel: string;
  verificationTier: VerificationTier;
  verificationStatusLabel: string;
  dataQualityTier: DataQualityTier;
  dataQualityLabel: string;
  scoreLabel: string;
  scoreExplanation: string;
  scoreProvenance: ContactScoreTransparency["provenance"];
  scoreReasonCodes: string[];
  scoreIsAuthoritative: boolean;
  recommendationWhy: string;
  recommendationEvidence: string[];
  recommendationMissing: string[];
  phoneActionable: boolean;
  emailActionable: boolean;
  phoneDowngraded: boolean;
  emailDowngraded: boolean;
  contactMethodNote: string | null;
  nextStepIsTemplate: boolean;
  suggestedActionLabel: string;
}

export interface PersonalInsightRow {
  id: string;
  contactId: string;
  name: string;
  company: string;
  insight: string;
  strength: number;
}

export interface PersonalResurfacingHighlight {
  bucketId: string;
  bucketLabel: string;
  contactId: string;
  contactName: string;
  whyNow: string;
  recommendedAction: string;
  recommendationWhy: string;
  recommendationEvidence: string[];
  recommendationMissing: string[];
  verificationStatusLabel: string;
  dataQualityLabel: string;
}

export interface PersonalWorkspaceModel {
  generatedAt: string;
  workspace: {
    slug: string;
    name: string;
    accentLabel: string;
    readOnly: boolean;
  };
  user: { name: string };
  hero: {
    focus: string;
    answer: string;
  };
  reachability: WorkspaceReachabilityProfile;
  resurfacingHighlights: PersonalResurfacingHighlight[];
  nav: Array<{ id: PersonalNavId; label: string; count: number }>;
  summary: {
    totalContacts: number;
    priorityCount: number;
    followUpsDue: number;
    dormantCount: number;
    needsEnrichment: number;
    averageStrength: number;
  };
  priorityContacts: PersonalContactCard[];
  allContacts: PersonalContactCard[];
  followUps: PersonalContactCard[];
  insights: PersonalInsightRow[];
  dormantOpportunities: PersonalContactCard[];
  missingInformation: PersonalContactCard[];
  importPath: string;
  crmContactCount: number;
  copy: ReturnType<typeof personalCopyForWorkspace>;
  emptyByNav: Record<PersonalNavId, string>;
}

const DORMANT_BUCKET_IDS = new Set([
  "forgotten_high_value",
  "stale_reengage",
  "dormant_high_frequency",
]);

const MISSING_BUCKET_IDS = new Set(["incomplete_relationships"]);

const RESURFACING_HIGHLIGHT_BUCKETS = new Set([
  "overdue_follow_ups",
  "forgotten_high_value",
  "stale_reengage",
  "dormant_high_frequency",
]);

export function buildPersonalWorkspaceModel(args: {
  workspace: WorkspaceConfig;
  user: PublicUser;
  crmContacts: CrmContactRecord[];
  resurfacingBuckets: ResurfacingBucket[];
  generatedAt?: string;
}): PersonalWorkspaceModel {
  const { workspace, user, crmContacts, resurfacingBuckets } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const reachability = computeWorkspaceReachability(crmContacts);
  const copy = personalCopyForWorkspace(workspace.branding);
  const phoneLight = reachability.phoneLight;

  const allContacts = crmContacts
    .slice()
    .sort((a, b) => prioritySortScore(b, phoneLight) - prioritySortScore(a, phoneLight))
    .map((contact, index) =>
      crmContactToCard(contact, index + 1, { phoneLight, copy, workspaceSlug: workspace.slug }),
    );

  const priorityContacts = allContacts.slice(0, 8);

  const followUpIds = new Set(
    resurfacingBuckets
      .filter((b) => b.id === "overdue_follow_ups")
      .flatMap((b) => b.contacts.map((c) => c.contactId)),
  );
  const followUps = allContacts.filter(
    (card) =>
      followUpIds.has(card.contactId)
      || card.suggestedAction === "Follow up"
      || card.reasons.some((r) => /follow/i.test(r)),
  );

  const dormantIds = new Set(
    resurfacingBuckets
      .filter((b) => DORMANT_BUCKET_IDS.has(b.id))
      .flatMap((b) => b.contacts.map((c) => c.contactId)),
  );
  const dormantOpportunities = allContacts.filter((card) => dormantIds.has(card.contactId));

  const missingIds = new Set(
    resurfacingBuckets
      .filter((b) => MISSING_BUCKET_IDS.has(b.id))
      .flatMap((b) => b.contacts.map((c) => c.contactId)),
  );
  const missingInformation = allContacts.filter((card) => {
    if (missingIds.has(card.contactId)) {
      return card.primaryChannel === "none" || card.suggestedAction === "Enrich first";
    }
    return card.suggestedAction === "Enrich first" && card.primaryChannel === "none";
  });

  const insights: PersonalInsightRow[] = crmContacts.slice(0, 12).map((contact) => {
    const transparency = buildContactScoreTransparency(contact);
    return {
      id: `insight-${contact.id}`,
      contactId: contact.id,
      name: contact.name,
      company: contact.company,
      insight: transparency.explanation,
      strength: transparency.value,
    };
  });

  const resurfacingHighlights = buildResurfacingHighlights(resurfacingBuckets);

  const followUpsDue = followUps.length;
  const dormantCount = dormantOpportunities.length;
  const needsEnrichment = missingInformation.length;

  const importedOnlyCount = crmContacts.filter(
    (c) => deriveEnrichmentStatus(c) === "imported_only",
  ).length;

  const heroAnswer = buildHeroAnswer({
    priorityContacts,
    crmContactCount: crmContacts.length,
    phoneLight,
    resurfacingHighlights,
    copy,
    importedOnlyCount,
  });

  return {
    generatedAt,
    workspace: {
      slug: workspace.slug,
      name: workspace.branding?.displayName ?? workspace.name,
      accentLabel: workspace.branding?.accentLabel ?? "Nicole's Relationship Workspace",
      readOnly: workspace.access.readOnlyByDefault,
    },
    user: { name: user.name ?? user.id },
    hero: {
      focus: copy.heroFocus,
      answer: heroAnswer,
    },
    reachability,
    resurfacingHighlights,
    nav: PERSONAL_NAV.map((item) => ({
      id: item.id,
      label: item.label,
      count: navCount(item.id, {
        priorityContacts,
        allContacts,
        followUps,
        insights,
        dormantOpportunities,
        missingInformation,
      }),
    })),
    summary: {
      totalContacts: allContacts.length,
      priorityCount: priorityContacts.length,
      followUpsDue,
      dormantCount,
      needsEnrichment,
      averageStrength: average(allContacts.map((c) => c.strength)),
    },
    priorityContacts,
    allContacts,
    followUps,
    insights,
    dormantOpportunities,
    missingInformation,
    importPath: workspaceImportPath(workspace),
    crmContactCount: crmContacts.length,
    copy,
    emptyByNav: {
      priority: copy.emptyPriority,
      all: copy.emptyContacts,
      "follow-ups": copy.emptyFollowUps,
      insights: copy.emptyInsights,
      dormant: copy.emptyDormant,
      missing: copy.emptyMissing,
    },
  };
}

function buildHeroAnswer(args: {
  priorityContacts: PersonalContactCard[];
  crmContactCount: number;
  phoneLight: boolean;
  resurfacingHighlights: PersonalResurfacingHighlight[];
  copy: ReturnType<typeof personalCopyForWorkspace>;
  importedOnlyCount: number;
}): string {
  const top = args.priorityContacts[0];
  if (top) {
    const channelHint =
      args.phoneLight && top.primaryChannel === "email"
        ? " — email-first resurfacing"
        : "";
    const enrichmentHint =
      args.importedOnlyCount === args.crmContactCount && args.crmContactCount > 0
        ? " (baseline import scores — not enriched yet)"
        : "";
    return `${top.name} at ${top.company} — ${top.scoreLabel}${channelHint}${enrichmentHint}`;
  }
  if (args.crmContactCount === 0) {
    return "Import contacts to start prioritizing your network.";
  }
  if (args.resurfacingHighlights[0]) {
    const h = args.resurfacingHighlights[0];
    return `${h.contactName}: ${h.whyNow}`;
  }
  return "Review priority contacts and schedule your next touchpoints.";
}

function buildResurfacingHighlights(buckets: ResurfacingBucket[]): PersonalResurfacingHighlight[] {
  const highlights: PersonalResurfacingHighlight[] = [];
  for (const bucket of buckets) {
    if (!RESURFACING_HIGHLIGHT_BUCKETS.has(bucket.id)) continue;
    for (const contact of bucket.contacts.slice(0, 2)) {
      highlights.push({
        bucketId: bucket.id,
        bucketLabel: bucket.label,
        contactId: contact.contactId,
        contactName: contact.name,
        whyNow: contact.whyNow,
        recommendedAction: contact.recommendedAction,
        recommendationWhy: contact.recommendationWhy,
        recommendationEvidence: contact.recommendationEvidence,
        recommendationMissing: contact.recommendationMissing,
        verificationStatusLabel: verificationStatusLabel(
          contact.verificationTier as VerificationTier,
        ),
        dataQualityLabel: contact.dataQualityLabel,
      });
    }
  }
  return highlights.slice(0, 5);
}

function prioritySortScore(contact: CrmContactRecord, phoneLight: boolean): number {
  const base = effectivePriorityScore(contact);
  const days = contact.lastInteractionAt
    ? ageDaysFromIso(contact.lastInteractionAt) ?? 0
    : 999;
  let boost = 0;
  if (days > 14 && days <= 60) boost += 8;
  if (days > 60) boost += 5;
  if (phoneLight && contactHasReachableEmail(contact) && !contactHasReachablePhone(contact)) {
    boost += 6;
  }
  return base + boost;
}

function navCount(
  id: PersonalNavId,
  queues: {
    priorityContacts: PersonalContactCard[];
    allContacts: PersonalContactCard[];
    followUps: PersonalContactCard[];
    insights: PersonalInsightRow[];
    dormantOpportunities: PersonalContactCard[];
    missingInformation: PersonalContactCard[];
  },
): number {
  if (id === "priority") return queues.priorityContacts.length;
  if (id === "all") return queues.allContacts.length;
  if (id === "follow-ups") return queues.followUps.length;
  if (id === "insights") return queues.insights.length;
  if (id === "dormant") return queues.dormantOpportunities.length;
  if (id === "missing") return queues.missingInformation.length;
  return 0;
}

function crmContactToCard(
  contact: CrmContactRecord,
  rank: number,
  ctx: { phoneLight: boolean; copy: ReturnType<typeof personalCopyForWorkspace>; workspaceSlug: string },
): PersonalContactCard {
  const score = scoreFromCrmContact(contact);
  const transparency = buildContactScoreTransparency(contact);
  const state = freshnessStateFor(ageDaysFromIso(contact.lastInteractionAt ?? contact.updatedAt));
  const trustWarnings = Object.entries(contact.dataTrust)
    .filter(([, datum]) => !datum.displayAsTrusted)
    .map(([field, datum]) => `${field}: ${datum.trustLevel}`);
  const missingFields = score.missingDataFlags.length + trustWarnings.length;

  const hasPhone = contactHasReachablePhone(contact);
  const hasEmail = contactHasReachableEmail(contact);
  const primaryChannel: PersonalPrimaryChannel =
    hasEmail && (!hasPhone || ctx.phoneLight) ? "email"
    : hasPhone ? "phone"
    : "none";

  let suggestedAction: PersonalContactCard["suggestedAction"] = "Review context";
  if (!hasPhone && !hasEmail) {
    suggestedAction = "Enrich first";
  } else if (missingFields >= 2 && !hasEmail) {
    suggestedAction = "Enrich first";
  } else if (score.factors.some((f) => f.factor === "dormant_opportunity_boost" && f.score >= 60)) {
    suggestedAction = "Send a note";
  } else if (
    contact.lastInteractionAt
    && (ageDaysFromIso(contact.lastInteractionAt) ?? 0) > 14
  ) {
    suggestedAction = "Follow up";
  } else if (hasPhone && !ctx.phoneLight) {
    suggestedAction = "Reach out";
  } else if (hasEmail) {
    suggestedAction = "Send a note";
  }

  const recommendation = buildRecommendationExplanation(contact, transparency, suggestedAction);
  const methods = transparency.contactMethods;
  // Deterministic opener — quotes the actual CRM evidence (notes / tag /
  // last-close date). When a specific extractor fires (HIGH / MED trust),
  // its line replaces the generic "Email X at Y — reference your last
  // interaction" template. Honest fallback only when the CRM has no
  // material.
  const suggestedOpener: SuggestedOpener = buildSuggestedOpenerFromContact(contact);
  const fallbackNextStep = buildNextStep(contact, suggestedAction, {
    hasPhone,
    hasEmail,
    phoneLight: ctx.phoneLight,
    phoneActionable: methods.phone.actionable,
    emailActionable: methods.email.actionable,
  });
  const nextStep = suggestedOpener.isSpecific ? suggestedOpener.opener : fallbackNextStep;
  const nextStepIsTemplate = !suggestedOpener.isSpecific
    && (isGenericRecommendation(nextStep)
      || transparency.enrichmentStatus === "imported_only"
      || transparency.verificationTier === "imported"
      || transparency.verificationTier === "confidence_low");

  const reachabilityNote =
    !hasPhone && hasEmail
      ? ctx.copy.noPhoneExplanation
      : !hasPhone && !hasEmail
        ? "No phone or email on file — enrich before outreach."
        : null;

  const stage =
    transparency.enrichmentStatus === "enriched" || transparency.enrichmentStatus === "verified"
      ? score.confidence === "high" ? "Strong signal" : "Needs review"
      : transparency.enrichmentStatus === "imported_only"
        ? "Imported only"
        : transparency.enrichmentStatus === "needs_review"
          ? "Needs review"
          : "Baseline import";

  return {
    id: `${ctx.workspaceSlug}-${contact.id}`,
    contactId: contact.id,
    rank,
    name: contact.name,
    company: contact.company,
    relationshipLabel: contact.sourceCrm ? `From ${contact.sourceCrm}` : "Imported contact",
    strength: effectivePriorityScore(contact, transparency.value),
    strengthRaw: transparency.value,
    timing: rank === 1 ? "Soon" : rank <= 3 ? "This week" : "When ready",
    stage,
    reasons: compact([
      transparency.scoreLabel,
      // Promote the opener evidence to the top reason when it's specific —
      // operator sees the exact CRM fragment that justified the next step.
      suggestedOpener.isSpecific ? suggestedOpener.supportingEvidence : transparency.explanation,
      contact.tags[0] ? `Tagged: ${contact.tags[0]}` : null,
      contact.lastInteractionAt
        ? `Last touch ${relativeDate(contact.lastInteractionAt)}`
        : "No recent interaction on file",
      primaryChannel === "email" && ctx.phoneLight ? ctx.copy.emailPrimaryBadge : null,
    ]),
    email: contact.email,
    phone: hasPhone ? contact.phone : null,
    primaryChannel,
    reachabilityNote,
    suggestedAction,
    suggestedActionLabel: honestSuggestedActionLabel(suggestedAction, transparency),
    nextStep,
    nextStepIsTemplate,
    angle: buildAngle(contact, primaryChannel, transparency, score),
    signals: buildSignals(contact, primaryChannel, transparency, score),
    history: compact([
      contact.notes ? contact.notes.slice(0, 140) : null,
      contact.lastInteractionAt ? `Last interaction ${relativeDate(contact.lastInteractionAt)}` : null,
    ]),
    activityMemory: buildActivityMemory(contact),
    trustNotes: compact([
      !contact.scoreMetadata ? "Legacy contact — score provenance not stored at import." : null,
      ...trustWarnings,
      trustWarnings.length === 0 && transparency.enrichmentStatus === "imported_only"
        ? "Imported fields only — not enriched or verified."
        : null,
      trustWarnings.length === 0
        && transparency.enrichmentStatus !== "imported_only"
        && contact.scoreMetadata
        ? "Contact fields meet minimum trust for display."
        : null,
    ]),
    source: {
      freshnessLabel: freshnessLabel(state, ageDaysFromIso(contact.lastInteractionAt ?? contact.updatedAt)),
      freshnessState: state,
      confidence: transparency.confidence,
      missingFields,
    },
    enrichmentStatus: transparency.enrichmentStatus,
    enrichmentLabel: enrichmentStatusLabel(transparency.enrichmentStatus),
    verificationTier: transparency.verificationTier,
    verificationStatusLabel: transparency.verificationStatusLabel,
    dataQualityTier: transparency.dataQualityTier,
    dataQualityLabel: transparency.dataQualityLabel,
    scoreLabel: transparency.scoreLabel,
    scoreExplanation: transparency.explanation,
    scoreProvenance: transparency.provenance,
    scoreReasonCodes: transparency.reasonCodes,
    scoreIsAuthoritative: transparency.isAuthoritative,
    recommendationWhy: recommendation.why,
    recommendationEvidence: recommendation.evidence,
    recommendationMissing: recommendation.missing,
    phoneActionable: methods.phone.actionable,
    emailActionable: methods.email.actionable,
    phoneDowngraded: methods.phone.downgraded,
    emailDowngraded: methods.email.downgraded,
    contactMethodNote: methods.phone.reason ?? methods.email.reason,
  };
}

function buildAngle(
  contact: CrmContactRecord,
  primaryChannel: PersonalPrimaryChannel,
  transparency: ContactScoreTransparency,
  score: ReturnType<typeof scoreFromCrmContact>,
): string {
  if (transparency.enrichmentStatus === "imported_only") {
    if (contact.notes?.trim()) {
      return `From import notes: ${contact.notes.trim().slice(0, 120)}${contact.notes.length > 120 ? "…" : ""}`;
    }
    return "No enrichment yet — use imported notes and last activity only.";
  }
  if (primaryChannel === "email") {
    return score.factors[0]?.explanation ?? "Reference your last email or meeting note — keep the ask small.";
  }
  return score.factors[0]?.explanation ?? "Lead with the clearest verified signal you have.";
}

function buildSignals(
  contact: CrmContactRecord,
  primaryChannel: PersonalPrimaryChannel,
  transparency: ContactScoreTransparency,
  score: ReturnType<typeof scoreFromCrmContact>,
): string[] {
  if (score.missingDataFlags.length > 0) {
    return score.missingDataFlags.slice(0, 3);
  }
  if (transparency.enrichmentStatus === "imported_only") {
    return compact([
      contact.sourceCrm ? `Imported from ${contact.sourceCrm}` : "Imported from CRM",
      primaryChannel === "email" ? "Email on file" : null,
      "Not enriched yet",
    ]);
  }
  return primaryChannel === "email"
    ? ["Email on file", "Baseline import score"]
    : ["Imported CRM", "Baseline import score"];
}

function buildNextStep(
  contact: CrmContactRecord,
  action: PersonalContactCard["suggestedAction"],
  reach: {
    hasPhone: boolean;
    hasEmail: boolean;
    phoneLight: boolean;
    phoneActionable: boolean;
    emailActionable: boolean;
  },
): string {
  if (action === "Reach out" && reach.hasPhone && !reach.phoneLight && reach.phoneActionable) {
    return `Call or message ${contact.name} at ${contact.phone}.`;
  }
  if (action === "Reach out" && reach.hasPhone && !reach.phoneActionable) {
    return `Review phone trust for ${contact.name} before calling — import-only path.`;
  }
  if (action === "Send a note" && reach.hasEmail && reach.emailActionable) {
    return `Email ${contact.name} at ${contact.email} — reference your last interaction and one clear next step.`;
  }
  if (action === "Send a note" && reach.hasEmail && !reach.emailActionable) {
    return `Review email trust for ${contact.name} before sending — weak or imported-only path.`;
  }
  if (action === "Follow up") {
    return `Close the loop on your last conversation with ${contact.name}${reach.hasEmail ? ` (${contact.email})` : ""}.`;
  }
  if (action === "Enrich first") {
    return reach.hasEmail
      ? `Optional: add a phone for ${contact.name}. Email is already on file for safe outreach.`
      : `Add phone or email for ${contact.name} before outreach.`;
  }
  return `Open context for ${contact.name} and confirm your angle.`;
}

function buildActivityMemory(contact: CrmContactRecord): string[] {
  const lines: string[] = [];
  if (contact.lastInteractionAt) {
    lines.push(`Last activity recorded ${relativeDate(contact.lastInteractionAt)}.`);
  }
  if (contact.notes?.trim()) {
    lines.push(contact.notes.trim().length > 200
      ? `${contact.notes.trim().slice(0, 200)}…`
      : contact.notes.trim());
  }
  if (contact.tags.length > 0) {
    lines.push(`Tags: ${contact.tags.slice(0, 4).join(", ")}.`);
  }
  if (contact.sourceCrm) {
    lines.push(`Source: ${contact.sourceCrm}.`);
  }
  if (lines.length === 0) {
    lines.push("No activity notes yet — import or add notes to strengthen memory-driven resurfacing.");
  }
  return lines;
}

function relativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compact(values: Array<string | null | undefined>): string[] {
  return values
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}
