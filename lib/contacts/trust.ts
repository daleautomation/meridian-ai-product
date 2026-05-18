import type { ContactConfidence, ContactPath } from "./types";

export type ContactTrustLevel =
  | "VERIFIED"
  | "ACCEPTABLE"
  | "WEAK"
  | "STALE"
  | "CONFLICTING"
  | "MISSING";

export type ContactConflictStatus =
  | "none"
  | "phone_conflict"
  | "email_conflict"
  | "name_conflict"
  | "ambiguous_ownership"
  | "stale_overwrite"
  | "multiple_conflicts";

export type ContactTrustEvidence = {
  trustLevel: ContactTrustLevel;
  source: string | null;
  lastVerifiedAt: string | null;
  freshnessAgeDays: number | null;
  confidenceReason: string;
  conflictStatus: ContactConflictStatus;
  conflictReasons: string[];
  verificationPresent: boolean;
  evidence: string[];
  rejectedAlternatives: string[];
  canCallNow: boolean;
};

type PathLike = Omit<Pick<ContactPath, "method" | "value" | "verified" | "confidence" | "label" | "rank">, "method" | "value" | "confidence"> & {
  method?: string | null;
  value?: string | null;
  source?: string | null;
  confidence?: ContactConfidence | string | null;
  providerConfidence?: number;
  lastVerifiedAt?: string | null;
};

export const CONTACT_STALE_AFTER_DAYS = 14;
const CONTACT_DECAY_AFTER_DAYS = 7;

const HIGH_RELIABILITY_SOURCES = new Set(["google_places", "gbp", "yelp", "operator", "manual"]);
const MEDIUM_RELIABILITY_SOURCES = new Set(["bbb", "hunter"]);
const LOW_RELIABILITY_SOURCES = new Set(["website", "scrape", "facebook", "bing", "angi", "inferred"]);

export function contactDaysSince(iso?: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 86_400_000));
}

export function normalizePhoneForTrust(value?: string | null): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function normalizeEmailForTrust(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeNameForTrust(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sourceReliability(source?: string | null): "high" | "medium" | "low" | "missing" {
  const s = String(source ?? "").toLowerCase();
  if (!s) return "missing";
  if (HIGH_RELIABILITY_SOURCES.has(s)) return "high";
  if (MEDIUM_RELIABILITY_SOURCES.has(s)) return "medium";
  if (LOW_RELIABILITY_SOURCES.has(s)) return "low";
  return "low";
}

function hasUsableValue(method: string | null | undefined, value: string | undefined): boolean {
  if (!value) return false;
  if (method === "phone") return normalizePhoneForTrust(value).length >= 10;
  if (method === "email") return normalizeEmailForTrust(value).includes("@");
  return value.trim().length > 0;
}

function confidenceIsWeak(confidence?: ContactConfidence | string | null): boolean {
  const c = String(confidence ?? "").toLowerCase();
  return c === "low" || c === "none";
}

function verifiedBySource(path: PathLike): boolean {
  const source = String(path.source ?? "").toLowerCase();
  if (path.verified === true) return true;
  return HIGH_RELIABILITY_SOURCES.has(source) || source === "bbb";
}

export function detectContactConflicts(input: {
  paths: PathLike[];
  contactNames?: Array<string | null | undefined>;
  matchType?: "exact" | "closest" | "unresolved";
}): {
  status: ContactConflictStatus;
  reasons: string[];
  rejectedAlternatives: string[];
} {
  const reasons: string[] = [];
  const rejectedAlternatives: string[] = [];

  const phoneValues = new Map<string, string[]>();
  const emailValues = new Map<string, string[]>();
  for (const path of input.paths) {
    if (path.method === "phone") {
      const key = normalizePhoneForTrust(path.value);
      if (key) phoneValues.set(key, [...(phoneValues.get(key) ?? []), path.label ?? String(path.source ?? "unknown")]);
    }
    if (path.method === "email") {
      const key = normalizeEmailForTrust(path.value);
      if (key) emailValues.set(key, [...(emailValues.get(key) ?? []), path.label ?? String(path.source ?? "unknown")]);
    }
  }

  if (phoneValues.size > 1) {
    reasons.push("multiple competing phone numbers");
    for (const [phone, sources] of phoneValues) rejectedAlternatives.push(`phone:${phone} via ${sources.join("+")}`);
  }
  if (emailValues.size > 1) {
    reasons.push("multiple competing email addresses");
    for (const [email, sources] of emailValues) rejectedAlternatives.push(`email:${email} via ${sources.join("+")}`);
  }

  const names = new Set(
    (input.contactNames ?? [])
      .map(normalizeNameForTrust)
      .filter((name) => name.length > 0),
  );
  if (names.size > 1) {
    reasons.push("multiple competing contact names");
    for (const name of names) rejectedAlternatives.push(`name:${name}`);
  }
  if (input.matchType === "closest" || input.matchType === "unresolved") {
    reasons.push(input.matchType === "closest" ? "ambiguous ownership match" : "unresolved business ownership");
  }

  const typedReasons = new Set<ContactConflictStatus>();
  if (phoneValues.size > 1) typedReasons.add("phone_conflict");
  if (emailValues.size > 1) typedReasons.add("email_conflict");
  if (names.size > 1) typedReasons.add("name_conflict");
  if (input.matchType === "closest" || input.matchType === "unresolved") typedReasons.add("ambiguous_ownership");

  const status =
    typedReasons.size === 0 ? "none"
    : typedReasons.size > 1 ? "multiple_conflicts"
    : Array.from(typedReasons)[0];

  return { status, reasons, rejectedAlternatives };
}

export function classifyContactPathTrust(
  path: PathLike | null | undefined,
  opts: {
    lastVerifiedAt?: string | null;
    now?: Date;
    conflictStatus?: ContactConflictStatus;
    conflictReasons?: string[];
    rejectedAlternatives?: string[];
  } = {},
): ContactTrustEvidence {
  const method = path?.method;
  const value = typeof path?.value === "string" ? path.value.trim() : "";
  const source = typeof path?.source === "string" ? path.source : null;
  const lastVerifiedAt = opts.lastVerifiedAt ?? path?.lastVerifiedAt ?? null;
  const age = contactDaysSince(lastVerifiedAt, opts.now ?? new Date());
  const conflictStatus = opts.conflictStatus ?? "none";
  const conflictReasons = opts.conflictReasons ?? [];
  const rejectedAlternatives = opts.rejectedAlternatives ?? [];
  const evidence: string[] = [];

  if (source) evidence.push(`source:${source}`);
  if (path?.label) evidence.push(`label:${path.label}`);
  if (typeof path?.rank === "number") evidence.push(`rank:${path.rank}`);
  if (path?.confidence) evidence.push(`confidence:${path.confidence}`);
  if (lastVerifiedAt) evidence.push(`lastVerifiedAt:${lastVerifiedAt}`);
  if (typeof path?.providerConfidence === "number") evidence.push(`providerConfidence:${path.providerConfidence}`);

  if (!path || !hasUsableValue(method, value)) {
    return {
      trustLevel: "MISSING",
      source,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: "No usable contact value is present.",
      conflictStatus,
      conflictReasons,
      verificationPresent: false,
      evidence,
      rejectedAlternatives,
      canCallNow: false,
    };
  }

  if (!source) {
    return {
      trustLevel: "MISSING",
      source: null,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: "Contact source is missing.",
      conflictStatus,
      conflictReasons,
      verificationPresent: false,
      evidence,
      rejectedAlternatives,
      canCallNow: false,
    };
  }

  const verificationPresent = verifiedBySource(path);
  const reliability = sourceReliability(source);

  if (conflictStatus !== "none") {
    return {
      trustLevel: "CONFLICTING",
      source,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: `Contact conflicts require operator review: ${conflictReasons.join("; ") || conflictStatus}.`,
      conflictStatus,
      conflictReasons,
      verificationPresent,
      evidence,
      rejectedAlternatives,
      canCallNow: false,
    };
  }

  if (age === null) {
    return {
      trustLevel: "WEAK",
      source,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: "Verification recency is missing.",
      conflictStatus,
      conflictReasons,
      verificationPresent,
      evidence,
      rejectedAlternatives,
      canCallNow: false,
    };
  }

  if (age > CONTACT_STALE_AFTER_DAYS) {
    return {
      trustLevel: "STALE",
      source,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: `Contact verification is ${age} days old; threshold is ${CONTACT_STALE_AFTER_DAYS} days.`,
      conflictStatus,
      conflictReasons,
      verificationPresent,
      evidence,
      rejectedAlternatives,
      canCallNow: false,
    };
  }

  if (method === "phone" && !verificationPresent) {
    return {
      trustLevel: "WEAK",
      source,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: "Phone is present but lacks deterministic verification.",
      conflictStatus,
      conflictReasons,
      verificationPresent,
      evidence,
      rejectedAlternatives,
      canCallNow: false,
    };
  }

  if (confidenceIsWeak(path.confidence) || reliability === "low") {
    return {
      trustLevel: "WEAK",
      source,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: `Source reliability is ${reliability} and confidence is ${path.confidence ?? "unknown"}.`,
      conflictStatus,
      conflictReasons,
      verificationPresent,
      evidence,
      rejectedAlternatives,
      canCallNow: false,
    };
  }

  if (age > CONTACT_DECAY_AFTER_DAYS || reliability === "medium" || path.confidence === "medium") {
    return {
      trustLevel: "ACCEPTABLE",
      source,
      lastVerifiedAt,
      freshnessAgeDays: age,
      confidenceReason: age > CONTACT_DECAY_AFTER_DAYS
        ? `Verified contact is aging (${age} days old) but still inside the freshness window.`
        : `Deterministic ${reliability}-reliability source with usable verification.`,
      conflictStatus,
      conflictReasons,
      verificationPresent,
      evidence,
      rejectedAlternatives,
      canCallNow: method === "phone" && verificationPresent,
    };
  }

  return {
    trustLevel: "VERIFIED",
    source,
    lastVerifiedAt,
    freshnessAgeDays: age,
    confidenceReason: "Fresh deterministic verification from a high-reliability source.",
    conflictStatus,
    conflictReasons,
    verificationPresent,
    evidence,
    rejectedAlternatives,
    canCallNow: method === "phone" && verificationPresent,
  };
}

export function canTrustPhoneForCallNow(trust?: ContactTrustEvidence | null): boolean {
  if (!trust) return false;
  return trust.canCallNow
    && trust.verificationPresent
    && (trust.trustLevel === "VERIFIED" || trust.trustLevel === "ACCEPTABLE")
    && trust.conflictStatus === "none"
    && trust.source !== null;
}

export function weakestTrustLevel(trusts: Array<ContactTrustEvidence | undefined | null>): ContactTrustLevel {
  const order: Record<ContactTrustLevel, number> = {
    VERIFIED: 0,
    ACCEPTABLE: 1,
    WEAK: 2,
    STALE: 3,
    CONFLICTING: 4,
    MISSING: 5,
  };
  const present = trusts.filter((t): t is ContactTrustEvidence => !!t);
  if (present.length === 0) return "MISSING";
  return present.sort((a, b) => order[b.trustLevel] - order[a.trustLevel])[0].trustLevel;
}
