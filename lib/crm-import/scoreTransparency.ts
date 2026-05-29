// CRM import — honest score provenance, verification tiers, and enrichment status.

import {
  contactHasReachableEmail,
  contactHasReachablePhone,
} from "@/lib/crm-import/reachability";
import type {
  ContactScoreMetadata,
  CrmContactRecord,
  VerificationTier,
} from "@/lib/crm-import/types";
import {
  computeRelationshipScore,
  scoreFromCrmContact,
  type RelationshipIntelligenceScore,
} from "@/lib/relationship-intelligence/scoring";

export type { VerificationTier };

export type EnrichmentStatus =
  | "imported_only"
  | "normalized"
  | "enriched"
  | "verified"
  | "stale"
  | "needs_review";

export type ScoreProvenance = "imported" | "inferred" | "enriched" | "default";

export type DataQualityTier = "strong" | "fair" | "weak" | "incomplete";

export type RecommendationExplanation = {
  why: string;
  evidence: string[];
  missing: string[];
};

export type ContactMethodActionability = {
  phone: { actionable: boolean; downgraded: boolean; reason: string | null };
  email: { actionable: boolean; downgraded: boolean; reason: string | null };
};

export type ContactScoreTransparency = {
  value: number;
  provenance: ScoreProvenance;
  verificationTier: VerificationTier;
  verificationStatusLabel: string;
  dataQualityTier: DataQualityTier;
  dataQualityLabel: string;
  reasonCodes: string[];
  sourceFieldsUsed: string[];
  confidence: RelationshipIntelligenceScore["confidence"];
  missingDataPenalties: string[];
  enrichmentStatus: EnrichmentStatus;
  scoreLabel: string;
  explanation: string;
  isAuthoritative: boolean;
  isGenericRecommendation: boolean;
  recommendation: RecommendationExplanation;
  contactMethods: ContactMethodActionability;
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
  if (hasVerifiedDatum(contact.dataTrust)) return "verified";

  const provider = opts?.enrichmentProvider ?? enrichmentProviderFromTrust(contact.dataTrust);
  if (provider) return "enriched";

  const weakIdentity = identityWeak(contact);
  if (weakIdentity) return "needs_review";

  const days = daysSince(contact.lastInteractionAt ?? contact.updatedAt);
  if (days !== null && days > 180) return "stale";

  if (contact.importJobId) return "imported_only";

  return "normalized";
}

export function deriveVerificationTier(
  contact: CrmContactRecord,
  opts?: {
    enrichmentStatus?: EnrichmentStatus;
    confidence?: RelationshipIntelligenceScore["confidence"];
    provenance?: ScoreProvenance;
  },
): VerificationTier {
  const stored = contact.scoreMetadata?.verificationTier;
  if (stored) return stored;

  if (hasVerifiedDatum(contact.dataTrust)) return "verified";

  const enrichmentStatus = opts?.enrichmentStatus ?? deriveEnrichmentStatus(contact);
  if (enrichmentStatus === "enriched" || enrichmentStatus === "verified") {
    return enrichmentStatus === "verified" ? "verified" : "enriched";
  }

  const confidence = opts?.confidence ?? scoreFromCrmContact(contact).confidence;
  const provenance = opts?.provenance
    ?? contact.scoreMetadata?.provenance
    ?? (contact.importJobId ? "imported" : "default");

  if (
    confidence === "low"
    || enrichmentStatus === "needs_review"
    || identityWeak(contact)
  ) {
    return "confidence_low";
  }

  if (
    contact.importJobId
    || provenance === "imported"
    || provenance === "inferred"
    || enrichmentStatus === "imported_only"
  ) {
    return "imported";
  }

  return "imported";
}

export function deriveDataQualityTier(
  contact: CrmContactRecord,
  transparency: Pick<
    ContactScoreTransparency,
    "confidence" | "isAuthoritative" | "verificationTier" | "missingDataPenalties"
  >,
): DataQualityTier {
  const hasEmail = contactHasReachableEmail(contact);
  const hasPhone = contactHasReachablePhone(contact);
  if (!hasEmail && !hasPhone) return "incomplete";
  if (transparency.verificationTier === "confidence_low") return "weak";
  if (!transparency.isAuthoritative && transparency.confidence !== "high") return "weak";
  if (transparency.isAuthoritative && transparency.confidence === "high") return "strong";
  if (transparency.confidence === "medium") return "fair";
  if (transparency.missingDataPenalties.length >= 2) return "weak";
  return "fair";
}

export function verificationStatusLabel(tier: VerificationTier): string {
  const labels: Record<VerificationTier, string> = {
    imported: "Imported",
    verified: "Verified",
    enriched: "Enriched",
    confidence_low: "Confidence Low",
  };
  return labels[tier];
}

export function dataQualityLabel(tier: DataQualityTier): string {
  const labels: Record<DataQualityTier, string> = {
    strong: "Data Quality: Strong",
    fair: "Data Quality: Fair",
    weak: "Data Quality: Weak",
    incomplete: "Data Quality: Incomplete",
  };
  return labels[tier];
}

export function effectivePriorityScore(
  contact: CrmContactRecord,
  rawScore?: number,
): number {
  const transparency = buildContactScoreTransparency(contact);
  const base = rawScore ?? transparency.value;
  let penalty = 0;
  if (transparency.verificationTier === "imported") penalty += 12;
  if (transparency.verificationTier === "confidence_low") penalty += 20;
  if (!transparency.isAuthoritative && base >= 70) penalty += 8;
  return Math.max(0, Math.round(base - penalty));
}

export function contactMethodActionability(
  contact: CrmContactRecord,
  transparency: Pick<ContactScoreTransparency, "verificationTier" | "confidence" | "isAuthoritative">,
): ContactMethodActionability {
  const phoneTrust = contact.dataTrust?.phone;
  const emailTrust = contact.dataTrust?.email;
  const hasPhone = contactHasReachablePhone(contact);
  const hasEmail = contactHasReachableEmail(contact);

  const phoneWeak =
    !hasPhone
    || phoneTrust?.trustLevel === "weak"
    || phoneTrust?.trustLevel === "missing"
    || phoneTrust?.trustLevel === "conflicting"
    || transparency.verificationTier === "confidence_low"
    || (!transparency.isAuthoritative && transparency.confidence === "low");

  const emailWeak =
    !hasEmail
    || emailTrust?.trustLevel === "weak"
    || emailTrust?.trustLevel === "missing"
    || emailTrust?.trustLevel === "conflicting"
    || transparency.verificationTier === "confidence_low";

  const phoneDowngraded =
    hasPhone
    && (transparency.verificationTier === "imported" || transparency.verificationTier === "confidence_low")
    && !phoneTrust?.displayAsTrusted;

  const emailDowngraded =
    hasEmail
    && (transparency.verificationTier === "imported" || transparency.verificationTier === "confidence_low")
    && !emailTrust?.displayAsTrusted;

  return {
    phone: {
      actionable: hasPhone && !phoneWeak,
      downgraded: Boolean(phoneDowngraded),
      reason: !hasPhone
        ? "No phone on file"
        : phoneWeak
          ? "Phone not trusted enough for one-click outreach"
          : phoneDowngraded
            ? "Imported-only phone — verify before calling"
            : null,
    },
    email: {
      actionable: hasEmail && !emailWeak,
      downgraded: Boolean(emailDowngraded),
      reason: !hasEmail
        ? "No email on file"
        : emailWeak
          ? "Email not trusted enough for one-click outreach"
          : emailDowngraded
            ? "Imported-only email — review before sending"
            : null,
    },
  };
}

export function buildRecommendationExplanation(
  contact: CrmContactRecord,
  transparency: ContactScoreTransparency,
  suggestedAction?: string,
): RecommendationExplanation {
  const evidence: string[] = [];
  const missing: string[] = [];

  if (transparency.sourceFieldsUsed.length > 0) {
    evidence.push(`Fields used: ${transparency.sourceFieldsUsed.join(", ")}`);
  }
  if (contact.lastInteractionAt) {
    evidence.push(`Last interaction on file (${contact.lastInteractionAt.slice(0, 10)})`);
  }
  if (contact.notes?.trim()) {
    evidence.push(`Import notes: ${contact.notes.trim().slice(0, 100)}${contact.notes.length > 100 ? "…" : ""}`);
  }
  if (contact.tags.length > 0) {
    evidence.push(`Tags: ${contact.tags.slice(0, 3).join(", ")}`);
  }
  if (transparency.reasonCodes.length > 0) {
    evidence.push(`Reason codes: ${transparency.reasonCodes.slice(0, 4).join(", ")}`);
  }
  if (transparency.verificationTier === "enriched" || transparency.verificationTier === "verified") {
    evidence.push(`Verification tier: ${verificationStatusLabel(transparency.verificationTier)}`);
  }

  for (const flag of transparency.missingDataPenalties) {
    missing.push(flag);
  }
  if (!contactHasReachablePhone(contact)) missing.push("No verified phone path");
  if (!contactHasReachableEmail(contact)) missing.push("No verified email path");
  if (transparency.verificationTier === "imported") {
    missing.push("Post-import enrichment not applied");
  }
  if (!transparency.isAuthoritative) {
    missing.push("Score is not authoritative — treat priority as provisional");
  }
  if (transparency.provenance === "default" || !contact.scoreMetadata) {
    missing.push("Missing provenance metadata on score");
  }

  const actionHint = suggestedAction ? ` Suggested: ${suggestedAction}.` : "";
  const why = transparency.verificationTier === "confidence_low"
    ? `Low-confidence resurfacing — review data before outreach.${actionHint}`
    : transparency.verificationTier === "imported"
      ? `Imported CRM signal only — not verified or enriched.${actionHint}`
      : `${transparency.explanation}${actionHint}`;

  return {
    why: why.trim(),
    evidence: evidence.length > 0 ? evidence : ["No supporting evidence beyond import fields"],
    missing,
  };
}

function hasVerifiedDatum(trust: CrmContactRecord["dataTrust"] | undefined): boolean {
  if (!trust) return false;
  return Object.values(trust).some((datum) => datum.trustLevel === "verified");
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
    ?? (contact.importJobId ? "imported" : typeof contact.relationshipScore === "number" ? "inferred" : "default");

  const value = contact.relationshipScore ?? computed.total;
  const score = scoreFromCrmContact(contact);
  const reasonCodes = stored.reasonCodes.length > 0
    ? stored.reasonCodes
    : buildReasonCodes(contact, computed, provenance);
  const sourceFieldsUsed = stored.sourceFields.length > 0
    ? stored.sourceFields
    : sourceFieldsUsedForContact(contact);
  const missingDataPenalties = computed.missingDataFlags;

  const verificationTier = deriveVerificationTier(contact, {
    enrichmentStatus,
    confidence: score.confidence,
    provenance,
  });

  const scoreLabel = scoreLabelFor(provenance, enrichmentStatus, stored.scoreStoredAtImport, verificationTier);
  const isAuthoritative =
    provenance === "enriched"
    || verificationTier === "verified"
    || verificationTier === "enriched"
    || enrichmentStatus === "verified";
  const explanation = explanationFor(score, provenance, enrichmentStatus, stored.scoreStoredAtImport, verificationTier);

  const partial: ContactScoreTransparency = {
    value,
    provenance,
    verificationTier,
    verificationStatusLabel: verificationStatusLabel(verificationTier),
    dataQualityTier: "fair",
    dataQualityLabel: "",
    reasonCodes,
    sourceFieldsUsed,
    confidence: score.confidence,
    missingDataPenalties,
    enrichmentStatus,
    scoreLabel,
    explanation,
    isAuthoritative,
    isGenericRecommendation: false,
    recommendation: { why: "", evidence: [], missing: [] },
    contactMethods: {
      phone: { actionable: false, downgraded: false, reason: null },
      email: { actionable: false, downgraded: false, reason: null },
    },
  };

  partial.dataQualityTier = deriveDataQualityTier(contact, partial);
  partial.dataQualityLabel = dataQualityLabel(partial.dataQualityTier);
  partial.contactMethods = contactMethodActionability(contact, partial);
  partial.recommendation = buildRecommendationExplanation(contact, partial);
  partial.isGenericRecommendation = isGenericRecommendation(partial.recommendation.why);

  return partial;
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
  const provenance = meta.provenance === "inferred" && meta.storedAtImport
    ? "imported"
    : meta.provenance ?? null;
  return {
    provenance,
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
  if ((provenance === "inferred" || provenance === "imported") && contact.importJobId) {
    codes.push("BASELINE_IMPORT_SCORE");
  }
  if (!contact.lastInteractionAt) codes.push("NO_LAST_ACTIVITY");
  if (!contactHasReachablePhone(contact)) codes.push("NO_PHONE");
  if (!contactHasReachableEmail(contact)) codes.push("NO_EMAIL");
  if (computed.confidence === "low") codes.push("LOW_CONFIDENCE");
  if (computed.missingDataFlags.length >= 2) codes.push("MULTIPLE_DATA_GAPS");
  if (!contact.scoreMetadata) codes.push("MISSING_PROVENANCE_METADATA");
  for (const f of computed.factors) {
    if (f.factor === "missing_data_penalty" && f.score >= 20) codes.push("MISSING_DATA_PENALTY");
  }
  return codes;
}

function scoreLabelFor(
  provenance: ScoreProvenance,
  enrichmentStatus: EnrichmentStatus,
  storedAtImport: boolean,
  verificationTier: VerificationTier,
): string {
  if (verificationTier === "confidence_low") return "Low-confidence import score";
  if (enrichmentStatus === "enriched" || enrichmentStatus === "verified" || verificationTier === "enriched") {
    return "Enriched relationship score";
  }
  if (verificationTier === "verified") return "Verified relationship score";
  if (provenance === "imported" || storedAtImport || provenance === "inferred") {
    return "Baseline import score";
  }
  if (provenance === "default") return "Default baseline score";
  return "Relationship score";
}

function explanationFor(
  score: RelationshipIntelligenceScore,
  provenance: ScoreProvenance,
  enrichmentStatus: EnrichmentStatus,
  storedAtImport: boolean,
  verificationTier: VerificationTier,
): string {
  if (verificationTier === "confidence_low") {
    return `Low-confidence signal (${score.total}/100) — imported fields only; verify before high-stakes outreach.`;
  }
  if (enrichmentStatus === "enriched" || enrichmentStatus === "verified" || provenance === "enriched") {
    return score.explanation;
  }
  if (provenance === "imported") {
    return `Baseline import score ${score.total}/100 — persisted from CRM import, not post-import enrichment.`;
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
  if (
    transparency.verificationTier === "imported"
    || transparency.verificationTier === "confidence_low"
    || transparency.enrichmentStatus === "imported_only"
    || transparency.enrichmentStatus === "needs_review"
  ) {
    if (action === "Reach out") return "Review before call — import only";
    if (action === "Call") return "Review before call — import only";
  }
  const map: Record<string, string> = {
    "Reach out": "Reach out",
    "Send a note": "Send a note",
    "Follow up": "Follow up",
    "Review context": "Review context",
    "Enrich first": "Enrich first",
    Call: "Call",
    Email: "Email",
  };
  return map[action] ?? action;
}

export function scoreMetadataForImport(score: RelationshipIntelligenceScore): ContactScoreMetadata {
  const verificationTier: VerificationTier =
    score.confidence === "low" ? "confidence_low" : "imported";
  return {
    provenance: "imported",
    verificationTier,
    reasonCodes: [
      "BASELINE_IMPORT_SCORE",
      ...(score.confidence === "low" ? ["LOW_CONFIDENCE"] : []),
      ...score.missingDataFlags.map((f) => `GAP_${f.replace(/\s+/g, "_").toUpperCase().slice(0, 40)}`),
    ],
    sourceFieldsUsed: [],
    storedAtImport: true,
    confidence: score.confidence,
    computedAt: new Date().toISOString(),
  };
}

export function qualifiesForHighValueResurfacing(
  contact: CrmContactRecord,
  rawScore: number,
  daysIdle: number,
): boolean {
  if (daysIdle <= 60) return false;
  const transparency = buildContactScoreTransparency(contact);
  if (transparency.verificationTier === "confidence_low") return false;
  if (transparency.isAuthoritative) return rawScore >= 75;
  return rawScore >= 88;
}
