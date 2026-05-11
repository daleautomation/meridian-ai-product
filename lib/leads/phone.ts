// Meridian — canonical phone selection.
//
// One deterministic selector for operator-facing phone truth. GBP/Google
// contact paths win when available, then the ranked contact-path waterfall,
// then already-normalized lead contact fields.

type PhonePathLike = {
  method?: string | null;
  value?: string | null;
  source?: string | null;
  verified?: boolean | null;
  confidence?: string | null;
  rank?: number | null;
  checkedAt?: string | null;
};

export type CanonicalPhoneLeadLike = {
  phone?: string | null;
  lastChecked?: string | null;
  last_checked?: string | null;
  phoneSource?: string | null;
  phoneConfidence?: string | null;
  phoneVerified?: boolean | null;
  phoneCheckedAt?: string | null;
  matchType?: string | null;
  contactResolutionCheckedAt?: string | null;
  preferredUpdatedAt?: string | null;
  contacts?: {
    primaryPhone?: string | null;
    source?: string | null;
    confidence?: string | null;
    phoneConfidence?: string | null;
    lastVerifiedAt?: string | null;
    verified?: boolean | null;
    isManualOverride?: boolean | null;
    matchType?: string | null;
    [key: string]: unknown;
  } | null;
  contactPaths?: PhonePathLike[] | null;
};

export type DialablePhone = {
  phone: string;
  source: string;
  confidence: "high";
  verified: true;
  checkedAt?: string;
};

const SOURCE_RANK: Record<string, number> = {
  google_places: 1,
  gbp: 1,
  yelp: 2,
  bbb: 3,
  angi: 4,
  facebook: 5,
  bing: 6,
  scrape: 7,
  website: 10,
};

const TRUSTED_DIALABLE_SOURCES = new Set(["google_places", "gbp", "operator", "manual"]);
const MAX_DIALABLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function phoneValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pathRank(path: PhonePathLike): number {
  if (typeof path.rank === "number" && Number.isFinite(path.rank)) return path.rank;
  const source = String(path.source ?? "").toLowerCase();
  return SOURCE_RANK[source] ?? 99;
}

function phonePaths(lead: CanonicalPhoneLeadLike | null | undefined): PhonePathLike[] {
  if (!Array.isArray(lead?.contactPaths)) return [];
  return lead.contactPaths.filter((path) => path?.method === "phone" && !!phoneValue(path.value));
}

function normalizedSource(source: string | null | undefined): string {
  const raw = String(source ?? "").trim().toLowerCase();
  if (raw === "google" || raw === "google_places") return "google_places";
  if (raw === "gbp") return "gbp";
  if (raw === "operator" || raw === "manual") return raw;
  return raw;
}

function highConfidence(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "high";
}

function checkedAtOf(
  lead: CanonicalPhoneLeadLike | null | undefined,
  path?: PhonePathLike | null,
): string | undefined {
  const raw =
    path?.checkedAt
    ?? lead?.phoneCheckedAt
    ?? lead?.contacts?.lastVerifiedAt
    ?? lead?.contactResolutionCheckedAt
    ?? lead?.preferredUpdatedAt
    ?? lead?.lastChecked
    ?? lead?.last_checked
    ?? undefined;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
}

function freshEnough(checkedAt: string | undefined): boolean {
  if (!checkedAt) return false;
  const timestamp = new Date(checkedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= MAX_DIALABLE_AGE_MS;
}

function identityMatched(lead: CanonicalPhoneLeadLike | null | undefined): boolean {
  const matchType = String(lead?.contacts?.matchType ?? lead?.matchType ?? "").trim().toLowerCase();
  return !matchType || matchType === "exact";
}

function dialableFromPath(
  lead: CanonicalPhoneLeadLike | null | undefined,
  path: PhonePathLike,
): DialablePhone | null {
  const phone = phoneValue(path.value);
  const source = normalizedSource(path.source);
  const checkedAt = checkedAtOf(lead, path);
  if (!phone) return null;
  if (!identityMatched(lead)) return null;
  if (!TRUSTED_DIALABLE_SOURCES.has(source)) return null;
  if (path.verified !== true) return null;
  if (!highConfidence(path.confidence)) return null;
  if (!freshEnough(checkedAt)) return null;
  return { phone, source, confidence: "high", verified: true, checkedAt };
}

function dialableFromContact(lead: CanonicalPhoneLeadLike | null | undefined): DialablePhone | null {
  const phone = phoneValue(lead?.contacts?.primaryPhone) ?? phoneValue(lead?.phone);
  const source = normalizedSource(lead?.contacts?.source ?? lead?.phoneSource);
  const confidence = lead?.contacts?.phoneConfidence ?? lead?.contacts?.confidence ?? lead?.phoneConfidence;
  const checkedAt = checkedAtOf(lead);
  const verified =
    lead?.contacts?.verified === true
    || lead?.phoneVerified === true
    || ((source === "operator" || source === "manual") && lead?.contacts?.isManualOverride === true);
  if (!phone) return null;
  if (!identityMatched(lead)) return null;
  if (!TRUSTED_DIALABLE_SOURCES.has(source)) return null;
  if (!verified) return null;
  if (!highConfidence(confidence)) return null;
  if (!freshEnough(checkedAt)) return null;
  return { phone, source, confidence: "high", verified: true, checkedAt };
}

export function getCanonicalPhone(
  lead: CanonicalPhoneLeadLike | null | undefined,
): string | null {
  const paths = phonePaths(lead);
  const gbpPath = paths.find((path) => {
    const source = String(path.source ?? "").toLowerCase();
    return source === "google_places" || source === "gbp";
  });
  const gbpPhone = phoneValue(gbpPath?.value);
  if (gbpPhone) return gbpPhone;

  const bestPath = paths.slice().sort((a, b) => pathRank(a) - pathRank(b))[0];
  const pathPhone = phoneValue(bestPath?.value);
  if (pathPhone) return pathPhone;

  return phoneValue(lead?.contacts?.primaryPhone) ?? phoneValue(lead?.phone);
}

export function getDialablePhoneDetails(
  lead: CanonicalPhoneLeadLike | null | undefined,
): DialablePhone | null {
  const paths = phonePaths(lead)
    .map((path) => ({ path, dialable: dialableFromPath(lead, path) }))
    .filter((entry): entry is { path: PhonePathLike; dialable: DialablePhone } => !!entry.dialable)
    .sort((a, b) => pathRank(a.path) - pathRank(b.path));

  return paths[0]?.dialable ?? dialableFromContact(lead);
}

export function getDialablePhone(
  lead: CanonicalPhoneLeadLike | null | undefined,
): string | null {
  return getDialablePhoneDetails(lead)?.phone ?? null;
}

export function withCanonicalPhoneContact<T extends CanonicalPhoneLeadLike>(lead: T): T {
  const phone = getCanonicalPhone(lead);
  if (!phone) return lead;
  return {
    ...lead,
    phone,
    contacts: {
      ...(lead.contacts ?? {}),
      primaryPhone: phone,
    },
  };
}
