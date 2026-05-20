import type { PublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import type { CrmContactRecord } from "@/lib/crm-import/types";
import {
  ageDaysFromIso,
  freshnessLabel,
  freshnessStateFor,
  type FreshnessState,
} from "@/lib/display/trustVisibility";
import type { ResurfacingBucket } from "@/lib/relationship-intelligence/resurfacing";
import { scoreFromCrmContact } from "@/lib/relationship-intelligence/scoring";
import { workspaceImportPath } from "@/lib/workspaceRouting";
import { personalCopyForWorkspace, PERSONAL_NAV, type PersonalNavId } from "./config";

export interface PersonalContactCard {
  id: string;
  contactId: string;
  rank: number;
  name: string;
  company: string;
  relationshipLabel: string;
  strength: number;
  timing: "Soon" | "This week" | "When ready";
  stage: string;
  reasons: string[];
  email: string | null;
  phone: string | null;
  suggestedAction: "Reach out" | "Send a note" | "Follow up" | "Review context" | "Enrich first";
  nextStep: string;
  angle: string;
  signals: string[];
  history: string[];
  trustNotes: string[];
  source: {
    freshnessLabel: string;
    freshnessState: FreshnessState;
    confidence: string;
    missingFields: number;
  };
}

export interface PersonalInsightRow {
  id: string;
  contactId: string;
  name: string;
  company: string;
  insight: string;
  strength: number;
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
}

const DORMANT_BUCKET_IDS = new Set([
  "forgotten_high_value",
  "stale_reengage",
  "dormant_high_frequency",
]);

const MISSING_BUCKET_IDS = new Set(["incomplete_relationships"]);

export function buildPersonalWorkspaceModel(args: {
  workspace: WorkspaceConfig;
  user: PublicUser;
  crmContacts: CrmContactRecord[];
  resurfacingBuckets: ResurfacingBucket[];
  generatedAt?: string;
}): PersonalWorkspaceModel {
  const { workspace, user, crmContacts, resurfacingBuckets } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const allContacts = crmContacts
    .slice()
    .sort((a, b) => (b.relationshipScore ?? 0) - (a.relationshipScore ?? 0))
    .map((contact, index) => crmContactToCard(contact, index + 1));

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
  const missingInformation = allContacts.filter(
    (card) =>
      missingIds.has(card.contactId)
      || card.suggestedAction === "Enrich first"
      || card.source.missingFields > 0,
  );

  const insights: PersonalInsightRow[] = crmContacts.slice(0, 12).map((contact) => {
    const score = scoreFromCrmContact(contact);
    return {
      id: `insight-${contact.id}`,
      contactId: contact.id,
      name: contact.name,
      company: contact.company,
      insight: score.explanation,
      strength: contact.relationshipScore ?? score.total,
    };
  });

  const followUpsDue = followUps.length;
  const dormantCount = dormantOpportunities.length;
  const needsEnrichment = missingInformation.length;
  const copy = personalCopyForWorkspace(workspace.branding);

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
      answer: priorityContacts[0]
        ? `${priorityContacts[0].name} at ${priorityContacts[0].company} — ${priorityContacts[0].reasons[0] ?? "strongest relationship signal right now"}`
        : crmContacts.length === 0
          ? "Import contacts to start prioritizing your network."
          : "Review priority contacts and schedule your next touchpoints.",
    },
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
  };
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

function crmContactToCard(contact: CrmContactRecord, rank: number): PersonalContactCard {
  const score = scoreFromCrmContact(contact);
  const state = freshnessStateFor(ageDaysFromIso(contact.lastInteractionAt ?? contact.updatedAt));
  const trustWarnings = Object.entries(contact.dataTrust)
    .filter(([, datum]) => !datum.displayAsTrusted)
    .map(([field, datum]) => `${field}: ${datum.trustLevel}`);
  const missingFields = score.missingDataFlags.length + trustWarnings.length;

  let suggestedAction: PersonalContactCard["suggestedAction"] = "Review context";
  if (!contact.phone && !contact.email) {
    suggestedAction = "Enrich first";
  } else if (missingFields >= 2) {
    suggestedAction = "Enrich first";
  } else if (score.factors.some((f) => f.factor === "dormant_opportunity_boost" && f.score >= 60)) {
    suggestedAction = "Send a note";
  } else if (
    contact.lastInteractionAt
    && (ageDaysFromIso(contact.lastInteractionAt) ?? 0) > 14
  ) {
    suggestedAction = "Follow up";
  } else if (contact.phone) {
    suggestedAction = "Reach out";
  } else if (contact.email) {
    suggestedAction = "Send a note";
  }

  const nextStep =
    suggestedAction === "Reach out" && contact.phone
      ? `Call or message ${contact.name} at ${contact.phone}.`
      : suggestedAction === "Send a note" && contact.email
        ? `Send ${contact.name} a concise note at ${contact.email}.`
        : suggestedAction === "Follow up"
          ? `Close the loop on your last conversation with ${contact.name}.`
          : suggestedAction === "Enrich first"
            ? `Add phone or email for ${contact.name} before outreach.`
            : `Open context for ${contact.name} and confirm your angle.`;

  return {
    id: `nicole-${contact.id}`,
    contactId: contact.id,
    rank,
    name: contact.name,
    company: contact.company,
    relationshipLabel: contact.sourceCrm ? `From ${contact.sourceCrm}` : "Imported contact",
    strength: contact.relationshipScore ?? score.total,
    timing: rank === 1 ? "Soon" : rank <= 3 ? "This week" : "When ready",
    stage: score.confidence === "high" ? "Strong signal" : "Needs review",
    reasons: compact([
      score.explanation,
      contact.tags[0] ? `Tagged: ${contact.tags[0]}` : null,
      contact.lastInteractionAt
        ? `Last touch ${relativeDate(contact.lastInteractionAt)}`
        : "No recent interaction on file",
    ]),
    email: contact.email,
    phone: contact.phone,
    suggestedAction,
    nextStep,
    angle: score.factors[0]?.explanation ?? "Lead with the clearest verified signal you have.",
    signals: score.missingDataFlags.length > 0
      ? score.missingDataFlags.slice(0, 3)
      : ["Imported CRM", "Relationship scored"],
    history: compact([
      contact.notes ? contact.notes.slice(0, 140) : null,
      contact.lastInteractionAt ? `Last interaction ${relativeDate(contact.lastInteractionAt)}` : null,
    ]),
    trustNotes: trustWarnings.length > 0
      ? trustWarnings
      : ["Contact fields meet minimum trust for display."],
    source: {
      freshnessLabel: freshnessLabel(state, ageDaysFromIso(contact.lastInteractionAt ?? contact.updatedAt)),
      freshnessState: state,
      confidence: score.confidence,
      missingFields,
    },
  };
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
