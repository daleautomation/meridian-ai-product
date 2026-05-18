export type FreshnessState = "fresh" | "aging" | "stale" | "unknown";
export type TrustTone = "good" | "watch" | "muted" | "danger";

export type TrustChip = {
  label: string;
  tone: TrustTone;
  title?: string;
};

type ContactMethod = "phone" | "email" | "form" | "website" | "social";

type ContactTrustLike = {
  trustLevel?: string | null;
  source?: string | null;
  lastVerifiedAt?: string | null;
  freshnessAgeDays?: number | null;
  confidenceReason?: string | null;
  conflictStatus?: string | null;
  conflictReasons?: string[] | null;
  verificationPresent?: boolean | null;
  evidence?: string[] | null;
  canCallNow?: boolean | null;
};

type ContactPathLike = {
  method?: string | null;
  source?: string | null;
  label?: string | null;
  rank?: number | null;
  confidence?: string | null;
  providerConfidence?: number | null;
  verified?: boolean | null;
  lastVerifiedAt?: string | null;
  trustLevel?: string | null;
  trustSource?: string | null;
  trustLastVerifiedAt?: string | null;
  freshnessAgeDays?: number | null;
  confidenceReason?: string | null;
  conflictStatus?: string | null;
  conflictReasons?: string[] | null;
  lastChecked?: string | null;
  lastCheckedAt?: string | null;
  checkedAt?: string | null;
};

type LeadLike = {
  source?: string | null;
  confidence?: string | null;
  confidenceLabel?: string | null;
  lastChecked?: string | null;
  last_checked?: string | null;
  emailSource?: string | null;
  emailVerifiedAt?: string | null;
  emailConfidence?: string | null;
  phoneTrust?: ContactTrustLike | null;
  emailTrust?: ContactTrustLike | null;
  contactTrust?: ContactTrustLike | null;
  contactPaths?: ContactPathLike[] | null;
  contacts?: {
    source?: string | null;
    lastVerifiedAt?: string | null;
    phoneTrust?: ContactTrustLike | null;
    emailTrust?: ContactTrustLike | null;
    contactTrust?: ContactTrustLike | null;
    phoneConfidence?: string | null;
    emailConfidence?: string | null;
  } | null;
  decision?: {
    score?: number | null;
    bucket?: string | null;
    reason?: string | null;
    primaryOpportunity?: {
      label?: string | null;
      reason?: string | null;
      services?: Array<{ id?: string | null; label?: string | null }> | null;
    } | null;
  } | null;
  nextAction?: {
    confidence?: string | null;
    reason?: string | null;
    supportDetail?: string | null;
    action?: string | null;
  } | null;
  opportunityEstimate?: {
    opportunityEstimateConfidence?: string | null;
    opportunityEstimateReason?: string | null;
    revenueImpactSummary?: string[] | null;
  } | null;
  evidence?: unknown[] | null;
  reasons?: string[] | null;
  websiteProof?: {
    last_checked?: string | null;
    issues?: unknown[] | null;
  } | null;
};

export type ContactTrustDisplay = {
  source: string;
  trustLevel: string;
  trustLabel: string;
  confidence: string | null;
  lastVerifiedLabel: string;
  freshnessLabel: string;
  freshnessState: FreshnessState;
  conflict: boolean;
  conflictLabel: string | null;
  conflictDetail: string | null;
  reason: string | null;
  chips: TrustChip[];
  isAuthoritative: boolean;
};

export type RecommendationTrustDisplay = {
  source: string;
  confidence: string;
  freshnessLabel: string;
  freshnessState: FreshnessState;
  evidenceLabel: string;
  conflict: boolean;
  chips: TrustChip[];
};

export function normalizeTrustSource(value?: string | null): string | null {
  const raw = cleanToken(value);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[_-]+/g, " ");
  if (key.includes("google") || key === "gbp") return "Google Business Profile";
  if (key.includes("yelp")) return "Yelp";
  if (key.includes("bbb")) return "BBB";
  if (key.includes("hunter")) return "Hunter";
  if (key.includes("website") || key.includes("site")) return "Website";
  if (key.includes("manual")) return "Manual";
  if (key.includes("decision")) return "Deterministic decision engine";
  if (key.includes("relationship engine")) return "Relationship engine";
  return raw;
}

export function ageDaysFromIso(iso?: string | null, now: Date = new Date()): number | null {
  const raw = cleanToken(iso);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

export function freshnessStateFor(ageDays?: number | null, trustLevel?: string | null): FreshnessState {
  const level = String(trustLevel ?? "").toUpperCase();
  if (level === "STALE" || level === "CONFLICTING") return level === "STALE" ? "stale" : "unknown";
  if (typeof ageDays !== "number" || Number.isNaN(ageDays)) return "unknown";
  if (ageDays <= 7) return "fresh";
  if (ageDays <= 14) return "aging";
  return "stale";
}

export function freshnessLabel(state: FreshnessState, ageDays?: number | null): string {
  if (state === "unknown") return "Freshness unknown";
  const suffix = typeof ageDays === "number" ? ` ${ageDays}d` : "";
  if (state === "fresh") return `Fresh${suffix}`;
  if (state === "aging") return `Aging${suffix}`;
  return `Stale${suffix}`;
}

export function formatLastVerified(iso?: string | null): string {
  const raw = cleanToken(iso);
  if (!raw) return "Last verified unknown";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "Last verified unknown";
  return `Last verified ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export function buildContactTrustDisplay(
  lead: LeadLike | null | undefined,
  method: ContactMethod,
  extra?: Partial<LeadLike> | null,
): ContactTrustDisplay {
  const merged = mergeLeadLike(lead, extra);
  const path = bestContactPath(merged.contactPaths, method);
  const trust = trustForMethod(merged, method);
  const source = normalizeTrustSource(
    trust?.source
      ?? path?.trustSource
      ?? path?.source
      ?? path?.label
      ?? (method === "email" ? merged.emailSource : merged.contacts?.source)
      ?? merged.source
      ?? null,
  ) ?? "Source unknown";
  const lastVerifiedAt =
    trust?.lastVerifiedAt
    ?? path?.trustLastVerifiedAt
    ?? path?.lastVerifiedAt
    ?? path?.lastChecked
    ?? path?.lastCheckedAt
    ?? path?.checkedAt
    ?? (method === "email" ? merged.emailVerifiedAt : merged.contacts?.lastVerifiedAt)
    ?? merged.lastChecked
    ?? merged.last_checked
    ?? merged.websiteProof?.last_checked
    ?? null;
  const ageDays =
    typeof trust?.freshnessAgeDays === "number"
      ? trust.freshnessAgeDays
      : typeof path?.freshnessAgeDays === "number"
        ? path.freshnessAgeDays
        : ageDaysFromIso(lastVerifiedAt);
  const inferredLevel = inferTrustLevel(trust, path, source);
  const trustLevel = String(trust?.trustLevel ?? path?.trustLevel ?? inferredLevel).toUpperCase();
  const state = freshnessStateFor(ageDays, trustLevel);
  const conflictStatus = String(trust?.conflictStatus ?? path?.conflictStatus ?? "none");
  const conflict = conflictStatus !== "none";
  const conflictReasons = trust?.conflictReasons ?? path?.conflictReasons ?? [];
  const confidence = cleanToken(
    path?.confidence
      ?? (method === "email" ? merged.emailConfidence ?? merged.contacts?.emailConfidence : merged.contacts?.phoneConfidence)
      ?? null,
  );
  const trustLabel = titleCaseTrustLevel(trustLevel);
  const lastLabel = formatLastVerified(lastVerifiedAt);
  const freshLabel = freshnessLabel(state, ageDays);
  const reason = cleanToken(trust?.confidenceReason ?? path?.confidenceReason ?? null);
  const conflictLabel = conflict ? "Conflict" : null;
  const conflictDetail = conflict
    ? (Array.isArray(conflictReasons) && conflictReasons.length > 0 ? conflictReasons.join("; ") : conflictStatus.replace(/_/g, " "))
    : null;
  const isAuthoritative =
    (trustLevel === "VERIFIED" || trustLevel === "ACCEPTABLE")
    && state !== "stale"
    && !conflict;

  const chips: TrustChip[] = [
    { label: `Source: ${source}`, tone: "muted", title: "Contact provenance" },
    { label: `Trust: ${trustLabel}`, tone: trustTone(trustLevel, state, conflict), title: reason ?? undefined },
    { label: lastLabel, tone: state === "unknown" ? "muted" : "watch" },
    { label: freshLabel, tone: freshnessTone(state, conflict) },
  ];
  if (confidence) {
    chips.push({ label: `Confidence: ${confidence.toUpperCase()}`, tone: confidenceTone(confidence) });
  }
  if (conflict) {
    chips.push({ label: "Conflict", tone: "danger", title: conflictDetail ?? undefined });
  }

  return {
    source,
    trustLevel,
    trustLabel,
    confidence: confidence ? confidence.toUpperCase() : null,
    lastVerifiedLabel: lastLabel,
    freshnessLabel: freshLabel,
    freshnessState: state,
    conflict,
    conflictLabel,
    conflictDetail,
    reason,
    chips,
    isAuthoritative,
  };
}

export function buildRecommendationTrustDisplay(
  lead: LeadLike | null | undefined,
  sourceLabel = "Deterministic decision engine",
): RecommendationTrustDisplay {
  const trust = lead?.contacts?.contactTrust ?? lead?.contactTrust ?? lead?.contacts?.phoneTrust ?? lead?.phoneTrust ?? null;
  const lastChecked =
    lead?.lastChecked
    ?? lead?.last_checked
    ?? trust?.lastVerifiedAt
    ?? lead?.websiteProof?.last_checked
    ?? null;
  const ageDays = typeof trust?.freshnessAgeDays === "number"
    ? trust.freshnessAgeDays
    : ageDaysFromIso(lastChecked);
  const state = freshnessStateFor(ageDays, trust?.trustLevel);
  const confidence = recommendationConfidence(lead);
  const evidenceCount = recommendationEvidenceCount(lead);
  const conflict = String(trust?.conflictStatus ?? "none") !== "none";
  const source = normalizeTrustSource(sourceLabel) ?? sourceLabel;
  const chips: TrustChip[] = [
    { label: `Source: ${source}`, tone: "muted" },
    { label: `Confidence: ${confidence}`, tone: confidenceTone(confidence) },
    { label: freshnessLabel(state, ageDays), tone: freshnessTone(state, conflict) },
    { label: evidenceCount > 0 ? `Evidence: ${evidenceCount} signals` : "Evidence: limited", tone: evidenceCount > 0 ? "watch" : "muted" },
  ];
  if (conflict) {
    chips.push({ label: "Conflict", tone: "danger", title: trust?.conflictReasons?.join("; ") || "Conflicting contact intelligence" });
  }
  return {
    source,
    confidence,
    freshnessLabel: freshnessLabel(state, ageDays),
    freshnessState: state,
    evidenceLabel: evidenceCount > 0 ? `${evidenceCount} signals` : "limited evidence",
    conflict,
    chips,
  };
}

function cleanToken(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^(unknown|none|n\/a)$/i.test(trimmed)) return null;
  return trimmed;
}

function bestContactPath(paths: ContactPathLike[] | null | undefined, method: ContactMethod): ContactPathLike | null {
  if (!Array.isArray(paths)) return null;
  return paths
    .filter((path) => path && path.method === method)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0] ?? null;
}

function trustForMethod(lead: LeadLike, method: ContactMethod): ContactTrustLike | null {
  const contacts = lead.contacts ?? {};
  if (method === "phone") return lead.phoneTrust ?? contacts.phoneTrust ?? lead.contactTrust ?? contacts.contactTrust ?? null;
  if (method === "email") return lead.emailTrust ?? contacts.emailTrust ?? lead.contactTrust ?? contacts.contactTrust ?? null;
  return lead.contactTrust ?? contacts.contactTrust ?? null;
}

function inferTrustLevel(
  trust: ContactTrustLike | null,
  path: ContactPathLike | null,
  source: string,
): string {
  if (trust?.conflictStatus && trust.conflictStatus !== "none") return "CONFLICTING";
  if (path?.verified || trust?.verificationPresent) return "VERIFIED";
  if (path || source !== "Source unknown") return "WEAK";
  return "MISSING";
}

function trustTone(trustLevel: string, freshness: FreshnessState, conflict: boolean): TrustTone {
  if (conflict || trustLevel === "CONFLICTING" || trustLevel === "STALE" || freshness === "stale") return "danger";
  if (trustLevel === "VERIFIED" || trustLevel === "ACCEPTABLE") return "good";
  if (trustLevel === "WEAK") return "watch";
  return "muted";
}

function freshnessTone(state: FreshnessState, conflict: boolean): TrustTone {
  if (conflict || state === "stale") return "danger";
  if (state === "fresh") return "good";
  if (state === "aging") return "watch";
  return "muted";
}

function confidenceTone(confidence: string): TrustTone {
  const c = confidence.toLowerCase();
  if (c === "high" || c === "verified") return "good";
  if (c === "medium" || c === "acceptable") return "watch";
  if (c === "low" || c === "weak") return "muted";
  const n = Number(c.replace("%", ""));
  if (!Number.isNaN(n)) return n >= 75 ? "good" : n >= 50 ? "watch" : "muted";
  return "muted";
}

function titleCaseTrustLevel(level: string): string {
  return level.toLowerCase().replace(/(^|_|\s)\w/g, (match) => match.toUpperCase()).replace(/_/g, " ");
}

function recommendationConfidence(lead: LeadLike | null | undefined): string {
  const next = cleanToken(lead?.nextAction?.confidence ?? null);
  if (next) return next.toUpperCase();
  const estimate = cleanToken(lead?.opportunityEstimate?.opportunityEstimateConfidence ?? null);
  if (estimate) return estimate.toUpperCase();
  const score = lead?.decision?.score;
  if (typeof score === "number" && Number.isFinite(score)) return `${Math.round(score)}%`;
  const label = cleanToken(lead?.confidenceLabel ?? lead?.confidence ?? null);
  return label ? label.toUpperCase() : "UNKNOWN";
}

function recommendationEvidenceCount(lead: LeadLike | null | undefined): number {
  const counts = [
    Array.isArray(lead?.evidence) ? lead?.evidence.length ?? 0 : 0,
    Array.isArray(lead?.reasons) ? lead?.reasons.length ?? 0 : 0,
    Array.isArray(lead?.websiteProof?.issues) ? lead?.websiteProof?.issues.length ?? 0 : 0,
    Array.isArray(lead?.opportunityEstimate?.revenueImpactSummary) ? lead?.opportunityEstimate?.revenueImpactSummary?.length ?? 0 : 0,
    lead?.decision?.reason ? 1 : 0,
    lead?.decision?.primaryOpportunity?.reason ? 1 : 0,
    lead?.nextAction?.reason ? 1 : 0,
  ];
  return counts.reduce((sum, count) => sum + count, 0);
}

function mergeLeadLike(lead: LeadLike | null | undefined, extra?: Partial<LeadLike> | null): LeadLike {
  if (!extra) return lead ?? {};
  return {
    ...(lead ?? {}),
    ...extra,
    contacts: {
      ...(lead?.contacts ?? {}),
      ...(extra.contacts ?? {}),
    },
    contactPaths: lead?.contactPaths ?? extra.contactPaths,
  };
}
