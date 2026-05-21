// CRM import — honest score provenance and enrichment status for contacts.

import {
  contactHasReachableEmail,
  contactHasReachablePhone,
} from "@/lib/crm-import/reachability";
import type { ContactScoreMetadata, CrmContactRecord } from "@/lib/crm-import/types";
import {
  computeRelationshipScore,
  scoreFromCrmContact,
  type RelationshipIntelligenceScore,
} from "@/lib/relationship-intelligence/scoring";

export type EnrichmentStatus =
  | "imported_only"
  | "normalized"
  | "enriched"
  | "verified"
  | "stale"
  | "needs_review";

export type ScoreProvenance = "imported" | "inferred" | "enriched" | "default";

export type ContactScoreTransparency = {
  value: number;
  provenance: ScoreProvenance;
  reasonCodes: string[];
  sourceFieldsUsed: string[];
  confidence: RelationshipIntelligenceScore["confidence"];
  missingDataPenalties: string[];
  enrichmentStatus: EnrichmentStatus;
  scoreLabel: string;
  explanation: string;
  isAuthoritative: boolean;
  isGenericRecommendation: boolean;
};

const GENERIC_ACTION_PATTERNS = [
  /^close the loop/i,
  /^open context for/i,
  /^email .+ — reference your last interaction/i,
  /^send a concise re-engagement note/i,
  /^reopen with a direct/i,
];

export function deriveEnrichmentStatus(
  contact: Pick<
    CrmContactRecord,
    | "importJobId"
    | "name"
    | "lastInteractionAt"
    | "notes"
    | "phone"
    | "email"
    | "normalizedPhone"
    | "normalizedEmail"
    | "dataTrust"
    | "updatedAt"
  >,
  opts?: { enrichmentProvider?: string | null },
): EnrichmentStatus {
  const provider = opts?.enrichmentProvider ?? enrichmentProviderFromTrust(contact.dataTrust);
  if (provider) return "enriched";

  const weakIdentity = identityWeak(contact);
  if (weakIdentity) return "needs_review";

  const days = daysSince(contact.lastInteractionAt ?? contact.updatedAt);
  if (days !== null && days > 180) return "stale";

  if (contact.importJobId) return "imported_only";

  return "normalized";
}

function enrichmentProviderFromTrust(
  trust: CrmContactRecord["dataTrust"] | undefined,
): string | null {
  if (!trust) return null;
  for (const datum of Object.values(trust)) {
    if (datum.enrichmentProvider) return datum.enrichmentProvider;
  }
  return null;
}

function identityWeak(
  contact: Pick<CrmContactRecord, "name" | "email" | "phone" | "normalizedEmail" | "normalizedPhone" | "dataTrust">,
): boolean {
  const hasEmail = contactHasReachableEmail(contact as CrmContactRecord);
  const hasPhone = contactHasReachablePhone(contact as CrmContactRecord);
  if (!hasEmail && !hasPhone) return true;
  if (!contact.name?.trim()) return true;
  const nameTrust = contact.dataTrust?.name;
  if (nameTrust && (nameTrust.trustLevel === "weak" || nameTrust.trustLevel === "missing")) return true;
  return false;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

export function sourceFieldsUsedForContact(contact: CrmContactRecord): string[] {
  const fields: string[] = [];
  if (contact.lastInteractionAt) fields.push("lastInteractionAt");
  if (contact.tags.length > 0) fields.push("tags");
  if (contact.notes?.trim()) fields.push("notes");
  if (contactHasReachablePhone(contact)) fields.push("phone");
  if (contactHasReachableEmail(contact)) fields.push("email");
  if (contact.company?.trim()) fields.push("company");
  if (contact.name?.trim()) fields.push("name");
  return fields;
}

export function buildContactScoreTransparency(contact: CrmContactRecord): ContactScoreTransparency {
  const enrichmentStatus = deriveEnrichmentStatus(contact);
  const stored = readStoredScoreMeta(contact);
  const computed = computeRelationshipScore({
    lastInteractionAt: contact.lastInteractionAt,
    tags: contact.tags,
    hasPhone: contactHasReachablePhone(contact),
    hasEmail: contactHasReachableEmail(contact),
    notesLength: contact.notes?.length ?? 0,
    dataTrust: contact.dataTrust,
  });

  const provenance: ScoreProvenance = stored.provenance
    ?? (typeof contact.relationshipScore === "number" ? "inferred" : "default");

  const value = contact.relationshipScore ?? computed.total;
  const score = scoreFromCrmContact(contact);
  const reasonCodes = stored.reasonCodes.length > 0
    ? stored.reasonCodes
    : buildReasonCodes(contact, computed, provenance);
  const sourceFieldsUsed = stored.sourceFields.length > 0
    ? stored.sourceFields
    : sourceFieldsUsedForContact(contact);
  const missingDataPenalties = computed.missingDataFlags;

  const scoreLabel = scoreLabelFor(provenance, enrichmentStatus, stored.scoreStoredAtImport);
  const isAuthoritative = provenance === "imported" || provenance === "enriched" || enrichmentStatus === "verified";
  const explanation = explanationFor(score, provenance, enrichmentStatus, stored.scoreStoredAtImport);

  return {
    value,
    provenance,
    reasonCodes,
    sourceFieldsUsed,
    confidence: score.confidence,
    missingDataPenalties,
    enrichmentStatus,
    scoreLabel,
    explanation,
    isAuthoritative,
    isGenericRecommendation: false,
  };
}

function readStoredScoreMeta(contact: CrmContactRecord): {
  provenance: ScoreProvenance | null;
  reasonCodes: string[];
  sourceFields: string[];
  scoreStoredAtImport: boolean;
} {
  const meta = contact.scoreMetadata;
  if (!meta) {
    return { provenance: null, reasonCodes: [], sourceFields: [], scoreStoredAtImport: Boolean(contact.importJobId) };
  }
  return {
    provenance: meta.provenance ?? null,
    reasonCodes: meta.reasonCodes ?? [],
    sourceFields: meta.sourceFieldsUsed ?? [],
    scoreStoredAtImport: meta.storedAtImport ?? Boolean(contact.importJobId),
  };
}

function buildReasonCodes(
  contact: CrmContactRecord,
  computed: RelationshipIntelligenceScore,
  provenance: ScoreProvenance,
): string[] {
  const codes: string[] = [];
  if (provenance === "inferred" && contact.importJobId) codes.push("BASELINE_IMPORT_SCORE");
  if (!contact.lastInteractionAt) codes.push("NO_LAST_ACTIVITY");
  if (!contactHasReachablePhone(contact)) codes.push("NO_PHONE");
  if (!contactHasReachableEmail(contact)) codes.push("NO_EMAIL");
  if (computed.confidence === "low") codes.push("LOW_CONFIDENCE");
  if (computed.missingDataFlags.length >= 2) codes.push("MULTIPLE_DATA_GAPS");
  for (const f of computed.factors) {
    if (f.factor === "missing_data_penalty" && f.score >= 20) codes.push("MISSING_DATA_PENALTY");
  }
  return codes;
}

function scoreLabelFor(
  provenance: ScoreProvenance,
  enrichmentStatus: EnrichmentStatus,
  storedAtImport: boolean,
): string {
  if (enrichmentStatus === "enriched" || enrichmentStatus === "verified") {
    return provenance === "imported" ? "Score from CRM import" : "Enriched relationship score";
  }
  if (provenance === "imported") return "Score persisted from CRM import";
  if (storedAtImport || provenance === "inferred") return "Baseline import score";
  if (provenance === "default") return "Default baseline score";
  return "Relationship score";
}

function explanationFor(
  score: RelationshipIntelligenceScore,
  provenance: ScoreProvenance,
  enrichmentStatus: EnrichmentStatus,
  storedAtImport: boolean,
): string {
  if (enrichmentStatus === "enriched" || enrichmentStatus === "verified") {
    return score.explanation;
  }
  if (provenance === "imported") {
    return score.explanation;
  }
  if (storedAtImport || provenance === "inferred") {
    return `Baseline import score ${score.total}/100 — computed from CSV fields at import, not post-import enrichment. ${score.missingDataFlags.length > 0 ? `Gaps: ${score.missingDataFlags.join("; ")}.` : ""}`.trim();
  }
  return score.explanation;
}

export function enrichmentStatusLabel(status: EnrichmentStatus): string {
  const labels: Record<EnrichmentStatus, string> = {
    imported_only: "Imported only — not enriched yet",
    normalized: "Normalized from import",
    enriched: "Enriched",
    verified: "Verified",
    stale: "Stale — review before outreach",
    needs_review: "Needs review — weak identity data",
  };
  return labels[status];
}

export function isGenericRecommendation(text: string): boolean {
  const t = text.trim();
  return GENERIC_ACTION_PATTERNS.some((re) => re.test(t));
}

export function honestSuggestedActionLabel(
  action: string,
  transparency: ContactScoreTransparency,
): string {
  if (isGenericRecommendation(action) || transparency.isGenericRecommendation) {
    return "Suggested follow-up template";
  }
  if (transparency.enrichmentStatus === "imported_only" || transparency.enrichmentStatus === "needs_review") {
    if (action === "Reach out") return "Review before call — import only";
  }
  const map: Record<string, string> = {
    "Reach out": "Reach out",
    "Send a note": "Send a note",
    "Follow up": "Follow up",
    "Review context": "Review context",
    "Enrich first": "Enrich first",
  };
  return map[action] ?? action;
}

export function scoreMetadataForImport(score: RelationshipIntelligenceScore): ContactScoreMetadata {
  return {
    provenance: "inferred",
    reasonCodes: [
      "BASELINE_IMPORT_SCORE",
      ...score.missingDataFlags.map((f) => `GAP_${f.replace(/\s+/g, "_").toUpperCase().slice(0, 40)}`),
    ],
    sourceFieldsUsed: [],
    storedAtImport: true,
    confidence: score.confidence,
    computedAt: new Date().toISOString(),
  };
}
