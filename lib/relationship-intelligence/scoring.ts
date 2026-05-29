// Meridian — relationship intelligence scoring (explainable, no fake urgency).

import {
  contactHasReachableEmail,
  contactHasReachablePhone,
} from "@/lib/crm-import/reachability";
import type { ContactDatumTrust, CrmContactRecord, NormalizedCrmContact } from "@/lib/crm-import/types";

export type RelationshipScoreFactor =
  | "recency"
  | "frequency"
  | "response_history"
  | "referral_potential"
  | "revenue_potential"
  | "relationship_strength"
  | "missing_data_penalty"
  | "dormant_opportunity_boost";

export type ScoreFactorResult = {
  factor: RelationshipScoreFactor;
  label: string;
  score: number; // 0–100 contribution weight applied
  weight: number;
  contribution: number;
  explanation: string;
  confidence: "high" | "medium" | "low" | "unknown";
};

export type RelationshipIntelligenceScore = {
  total: number;
  confidence: "high" | "medium" | "low" | "unknown";
  factors: ScoreFactorResult[];
  missingDataFlags: string[];
  explanation: string;
};

const WEIGHTS: Record<RelationshipScoreFactor, number> = {
  recency: 0.18,
  frequency: 0.12,
  response_history: 0.14,
  referral_potential: 0.1,
  revenue_potential: 0.12,
  relationship_strength: 0.16,
  missing_data_penalty: -0.12,
  dormant_opportunity_boost: 0.1,
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isNaN(t)) return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
  return null;
}

function trustPenalty(trust: ContactDatumTrust | undefined): number {
  if (!trust || trust.trustLevel === "missing") return 25;
  if (trust.trustLevel === "weak" || trust.trustLevel === "conflicting") return 15;
  if (trust.trustLevel === "acceptable") return 5;
  return 0;
}

export function computeRelationshipScore(input: {
  lastInteractionAt: string | null;
  tags: string[];
  hasPhone: boolean;
  hasEmail: boolean;
  notesLength: number;
  touchpointCount?: number;
  positiveOutcomes?: number;
  dataTrust?: NormalizedCrmContact["dataTrust"];
}): RelationshipIntelligenceScore {
  const factors: ScoreFactorResult[] = [];
  const missingDataFlags: string[] = [];

  const recencyDays = daysSince(input.lastInteractionAt);
  let recencyScore = 40;
  if (recencyDays === null) {
    missingDataFlags.push("No last interaction date");
    recencyScore = 25;
  } else if (recencyDays <= 7) recencyScore = 95;
  else if (recencyDays <= 30) recencyScore = 78;
  else if (recencyDays <= 90) recencyScore = 55;
  else if (recencyDays <= 180) recencyScore = 35;
  else recencyScore = 20;

  factors.push(factor("recency", "Recency", recencyScore, recencyDays === null ? "low" : "high",
    recencyDays === null
      ? "Last interaction unknown — score stays conservative."
      : `Last touch ${recencyDays} days ago.`));

  const frequency = Math.min(100, (input.touchpointCount ?? 1) * 18);
  factors.push(factor("frequency", "Frequency", frequency, "medium",
    `Observed ${input.touchpointCount ?? 1} touchpoint(s) in available history.`));

  const responseScore = Math.min(100, (input.positiveOutcomes ?? 0) * 30 + 40);
  factors.push(factor("response_history", "Response history", responseScore,
    input.positiveOutcomes ? "medium" : "low",
    input.positiveOutcomes
      ? `${input.positiveOutcomes} positive outcome(s) recorded.`
      : "No positive response signal yet."));

  const referralTags = input.tags.filter((t) => /referr|partner|advocate/i.test(t));
  const referralScore = referralTags.length > 0 ? 82 : input.notesLength > 80 ? 55 : 35;
  factors.push(factor("referral_potential", "Referral potential", referralScore, "medium",
    referralTags.length > 0 ? "Tagged as referral-adjacent." : "No referral tags on file."));

  const revenueScore = input.tags.some((t) => /vip|enterprise|high.?value/i.test(t)) ? 88 : 52;
  factors.push(factor("revenue_potential", "Revenue potential", revenueScore, "low",
    "Revenue signal inferred from tags and notes only — not fabricated."));

  let strength = 50;
  if (input.hasPhone && input.hasEmail) strength = 85;
  else if (input.hasPhone || input.hasEmail) strength = 68;
  else {
    missingDataFlags.push("Missing phone and email");
    strength = 30;
  }
  const strengthExplanation =
    input.hasPhone && input.hasEmail
      ? "Reachable on phone and email."
      : input.hasEmail && !input.hasPhone
        ? "Email on file — relationship strength from history and notes, not phone."
        : input.hasPhone && !input.hasEmail
          ? "Phone on file without email — add email when available for continuity."
          : "Limited reachability reduces strength.";
  factors.push(factor("relationship_strength", "Relationship strength", strength,
    input.hasPhone && input.hasEmail ? "high" : "medium",
    strengthExplanation));

  const missingPenalty = Math.min(100,
    trustPenalty(input.dataTrust?.phone)
    + trustPenalty(input.dataTrust?.email)
    + trustPenalty(input.dataTrust?.name)
    + (input.hasPhone ? 0 : 12)
    + (input.hasEmail ? 0 : 10),
  );
  factors.push(factor("missing_data_penalty", "Missing data penalty", missingPenalty, "high",
    "Weak or missing fields lower confidence — never shown as verified."));

  const dormantBoost =
    recencyDays !== null && recencyDays > 90 && strength >= 60 ? 72 : 25;
  factors.push(factor("dormant_opportunity_boost", "Dormant opportunity", dormantBoost, "medium",
    dormantBoost > 50
      ? "Strong relationship went quiet — worth resurfacing."
      : "No dormant high-value signal."));

  let total = 0;
  for (const f of factors) {
    if (f.factor === "missing_data_penalty") {
      total -= Math.min(f.score * 0.12, 12);
    } else {
      total += f.contribution;
    }
  }

  const normalized = Math.round(Math.max(0, Math.min(100, total)));
  const confidence =
    missingDataFlags.length >= 3 ? "low"
    : missingDataFlags.length >= 1 ? "medium"
    : "high";

  return {
    total: normalized,
    confidence,
    factors,
    missingDataFlags,
    explanation: `Relationship score ${normalized}/100 (${confidence} confidence). ${missingDataFlags.length > 0 ? `Gaps: ${missingDataFlags.join("; ")}.` : "Core identity fields present."}`,
  };
}

function factor(
  key: RelationshipScoreFactor,
  label: string,
  score: number,
  confidence: ScoreFactorResult["confidence"],
  explanation: string,
): ScoreFactorResult {
  const weight = Math.abs(WEIGHTS[key]);
  const contribution = key === "missing_data_penalty"
    ? -Math.min(score * weight, 12)
    : Math.round(score * weight);
  return { factor: key, label, score, weight, contribution, explanation, confidence };
}

export function scoreFromCrmContact(
  contact: Pick<
    CrmContactRecord,
    | "lastInteractionAt"
    | "tags"
    | "phone"
    | "email"
    | "normalizedPhone"
    | "normalizedEmail"
    | "notes"
    | "dataTrust"
    | "relationshipScore"
    | "scoreMetadata"
    | "importJobId"
  >,
): RelationshipIntelligenceScore {
  if (typeof contact.relationshipScore === "number") {
    const hasEmail = contactHasReachableEmail(contact as CrmContactRecord);
    const hasPhone = contactHasReachablePhone(contact as CrmContactRecord);
    const channelNote =
      hasEmail && !hasPhone ? " Email-first contact — score reflects history, not call readiness."
      : "";
    const meta = contact.scoreMetadata;
    const provenance = meta?.provenance;
    const storedAtImport = meta?.storedAtImport ?? Boolean(contact.importJobId);

    let explanation: string;
    if (provenance === "imported") {
      explanation = `Score persisted from CRM import.${channelNote}`;
    } else if (provenance === "enriched") {
      explanation = `Enriched relationship score.${channelNote}`;
    } else if (storedAtImport || provenance === "inferred") {
      explanation = `Baseline import score — computed from CSV fields at import, not post-import enrichment.${channelNote}`;
    } else {
      explanation = `Relationship score on file — verify provenance before treating as authoritative.${channelNote}`;
    }

    const confidence = meta?.confidence ?? (storedAtImport ? "medium" : "low");

    return {
      total: contact.relationshipScore,
      confidence,
      factors: [],
      missingDataFlags: hasEmail && !hasPhone ? ["No phone on file — email is primary channel"] : [],
      explanation,
    };
  }
  return computeRelationshipScore({
    lastInteractionAt: contact.lastInteractionAt,
    tags: contact.tags,
    hasPhone: contactHasReachablePhone(contact as CrmContactRecord),
    hasEmail: contactHasReachableEmail(contact as CrmContactRecord),
    notesLength: contact.notes?.length ?? 0,
    dataTrust: contact.dataTrust,
  });
}
