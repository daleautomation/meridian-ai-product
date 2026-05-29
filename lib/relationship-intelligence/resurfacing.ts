// Meridian — contact resurfacing engine (intelligent buckets, no silent promotion).

import {
  buildContactScoreTransparency,
  buildRecommendationExplanation,
  effectivePriorityScore,
  honestSuggestedActionLabel,
  qualifiesForHighValueResurfacing,
} from "@/lib/crm-import/scoreTransparency";
import {
  contactHasReachableEmail,
  contactHasReachablePhone,
} from "@/lib/crm-import/reachability";
import { scoreFromCrmContact } from "./scoring";
import type { RelationshipIntelligenceScore } from "./scoring";
import type { CrmContactRecord } from "@/lib/crm-import/types";

export type ResurfacingBucketId =
  | "forgotten_high_value"
  | "overdue_follow_ups"
  | "incomplete_relationships"
  | "stale_reengage"
  | "referral_opportunities"
  | "dormant_high_frequency";

export type ResurfacingBucket = {
  id: ResurfacingBucketId;
  label: string;
  description: string;
  contacts: ResurfacingContact[];
};

export type ResurfacingContact = {
  contactId: string;
  name: string;
  company: string;
  score: number;
  effectiveScore: number;
  whyNow: string;
  recommendedAction: string;
  recommendationWhy: string;
  recommendationEvidence: string[];
  recommendationMissing: string[];
  verificationTier: string;
  dataQualityLabel: string;
  trustWarnings: string[];
  relationshipScore: RelationshipIntelligenceScore;
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isNaN(t)) return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
  return null;
}

function resurfacingAction(contact: CrmContactRecord, fallback: string): string {
  const hasPhone = contactHasReachablePhone(contact);
  const hasEmail = contactHasReachableEmail(contact);
  if (!hasPhone && !hasEmail) return "Enrich contact paths before outreach.";
  if (!hasPhone && hasEmail) {
    return "Send a concise email — no phone on file and none will be invented.";
  }
  if (hasPhone && hasEmail) return fallback;
  if (hasPhone) return fallback;
  return "Send a concise re-engagement note.";
}

function trustWarnings(contact: CrmContactRecord): string[] {
  const warnings: string[] = [];
  for (const [field, datum] of Object.entries(contact.dataTrust)) {
    if (!datum.displayAsTrusted) {
      warnings.push(`${field}: ${datum.trustLevel} — not shown as verified`);
    }
  }
  return warnings;
}

export function buildResurfacingBuckets(contacts: CrmContactRecord[]): ResurfacingBucket[] {
  const buckets: Record<ResurfacingBucketId, ResurfacingContact[]> = {
    forgotten_high_value: [],
    overdue_follow_ups: [],
    incomplete_relationships: [],
    stale_reengage: [],
    referral_opportunities: [],
    dormant_high_frequency: [],
  };

  for (const contact of contacts) {
    const score = scoreFromCrmContact(contact);
    const transparency = buildContactScoreTransparency(contact);
    const recommendation = buildRecommendationExplanation(contact, transparency);
    const days = daysSince(contact.lastInteractionAt);
    const warnings = trustWarnings(contact);
    const effectiveScore = effectivePriorityScore(contact, score.total);
    const base = {
      contactId: contact.id,
      name: contact.name,
      company: contact.company,
      score: score.total,
      effectiveScore,
      recommendationWhy: recommendation.why,
      recommendationEvidence: recommendation.evidence,
      recommendationMissing: recommendation.missing,
      verificationTier: transparency.verificationTier,
      dataQualityLabel: transparency.dataQualityLabel,
      trustWarnings: warnings,
      relationshipScore: score,
    };

    const wrapAction = (action: string) =>
      honestSuggestedActionLabel(action, transparency);

    const hasPhone = contactHasReachablePhone(contact);
    const hasEmail = contactHasReachableEmail(contact);

    if (days !== null && qualifiesForHighValueResurfacing(contact, score.total, days)) {
      buckets.forgotten_high_value.push({
        ...base,
        whyNow: transparency.isAuthoritative
          ? `High relationship score (${score.total}) but quiet for ${days} days.`
          : `Import score ${score.total} — quiet ${days} days; verify before treating as high-value.`,
        recommendedAction: wrapAction(
          resurfacingAction(contact, "Reopen with a direct, low-friction ask."),
        ),
      });
    }

    if (days !== null && days > 14 && days <= 45) {
      buckets.overdue_follow_ups.push({
        ...base,
        whyNow: `Follow-up window overdue (${days} days since last touch).`,
        recommendedAction: wrapAction(
          resurfacingAction(contact, "Close the loop on the last promise or note."),
        ),
      });
    }

    if (!hasPhone && !hasEmail) {
      buckets.incomplete_relationships.push({
        ...base,
        whyNow: "Missing reachability — relationship cannot progress safely.",
        recommendedAction: wrapAction("Enrich contact paths before outreach."),
      });
    } else if (!hasPhone && hasEmail) {
      buckets.incomplete_relationships.push({
        ...base,
        whyNow: "Email on file without phone — enrichment optional; email resurfacing is viable.",
        recommendedAction: wrapAction(
          resurfacingAction(contact, "Send a note referencing your last interaction."),
        ),
      });
    } else if (warnings.length >= 2) {
      buckets.incomplete_relationships.push({
        ...base,
        whyNow: "Multiple fields lack trusted verification.",
        recommendedAction: wrapAction("Verify identity before high-stakes outreach."),
      });
    }

    if (days !== null && days > 90 && score.total >= 50 && score.total < 75) {
      buckets.stale_reengage.push({
        ...base,
        whyNow: `Stale but still viable (${days} days idle).`,
        recommendedAction: wrapAction(
          resurfacingAction(contact, "Send a concise re-engagement note."),
        ),
      });
    }

    if (contact.tags.some((t) => /referr|partner|advocate/i.test(t))) {
      buckets.referral_opportunities.push({
        ...base,
        whyNow: "Tagged for referral or partner potential.",
        recommendedAction: wrapAction(
          resurfacingAction(contact, "Ask for one warm introduction."),
        ),
      });
    }

    const dormantFactor = score.factors.find((f) => f.factor === "dormant_opportunity_boost");
    if (dormantFactor && dormantFactor.score >= 60) {
      buckets.dormant_high_frequency.push({
        ...base,
        whyNow: dormantFactor.explanation,
        recommendedAction: wrapAction(
          resurfacingAction(contact, "Restart rhythm before the relationship decays further."),
        ),
      });
    }
  }

  const sortDesc = (a: ResurfacingContact, b: ResurfacingContact) => b.effectiveScore - a.effectiveScore;

  return [
    {
      id: "forgotten_high_value",
      label: "Forgotten high-value",
      description: "Strong relationships that went quiet — worth intentional resurfacing.",
      contacts: buckets.forgotten_high_value.sort(sortDesc).slice(0, 12),
    },
    {
      id: "overdue_follow_ups",
      label: "Overdue follow-ups",
      description: "Promised or implied follow-ups that are aging without closure.",
      contacts: buckets.overdue_follow_ups.sort(sortDesc).slice(0, 12),
    },
    {
      id: "incomplete_relationships",
      label: "Incomplete relationships",
      description: "Missing or low-confidence data blocks safe execution.",
      contacts: buckets.incomplete_relationships.sort(sortDesc).slice(0, 12),
    },
    {
      id: "stale_reengage",
      label: "Stale, worth re-engaging",
      description: "Dormant contacts that still show relationship viability.",
      contacts: buckets.stale_reengage.sort(sortDesc).slice(0, 12),
    },
    {
      id: "referral_opportunities",
      label: "Referral opportunities",
      description: "Contacts tagged or noted for referral potential.",
      contacts: buckets.referral_opportunities.sort(sortDesc).slice(0, 12),
    },
    {
      id: "dormant_high_frequency",
      label: "Dormant high-frequency",
      description: "Previously active relationships cooling down.",
      contacts: buckets.dormant_high_frequency.sort(sortDesc).slice(0, 12),
    },
  ];
}
