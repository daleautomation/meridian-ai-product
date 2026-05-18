// Meridian — canonical phone selection.
//
// One deterministic selector for operator-facing phone truth. GBP/Google
// contact paths win when available, then the ranked contact-path waterfall,
// then already-normalized lead contact fields.

import { canTrustPhoneForCallNow, classifyContactPathTrust } from "@/lib/contacts/trust";
import type { ContactTrustEvidence, ContactTrustLevel, ContactConflictStatus } from "@/lib/contacts/types";

type PhonePathLike = {
  method?: string | null;
  value?: string | null;
  source?: string | null;
  rank?: number | null;
  confidence?: string | null;
  verified?: boolean | null;
  lastVerifiedAt?: string | null;
  trustLevel?: ContactTrustLevel | null;
  conflictStatus?: ContactConflictStatus | null;
};

export type CanonicalPhoneLeadLike = {
  phone?: string | null;
  source?: string | null;
  confidence?: string | null;
  confidenceLabel?: string | null;
  phoneAuthority?: string | null;
  lastChecked?: string | null;
  contactResolutionCheckedAt?: string | null;
  contacts?: {
    primaryPhone?: string | null;
    source?: string | null;
    confidence?: string | null;
    lastVerifiedAt?: string | null;
    phoneTrust?: ContactTrustEvidence | null;
    contactTrust?: ContactTrustEvidence | null;
    [key: string]: unknown;
  } | null;
  contactPaths?: PhonePathLike[] | null;
};

export type DialablePhoneDetails = {
  phone: string;
  source: string | null;
  confidence: string | null;
  verified: boolean;
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

function phoneValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nanpNationalDigits(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length >= 11 && digits[0] === "1") return digits.slice(1, 11);
  return digits.slice(0, 10);
}

function isReservedFictional55501Phone(value: string | null | undefined): boolean {
  const raw = phoneValue(value);
  if (!raw) return false;
  const national = nanpNationalDigits(raw);
  return !!national && national.slice(3, 6) === "555" && national.slice(6, 8) === "01";
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

function isDialableShape(value: string | null | undefined): boolean {
  const raw = phoneValue(value);
  if (!raw) return false;
  if (isReservedFictional55501Phone(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function isTrustedDialablePath(path: PhonePathLike): boolean {
  const phone = phoneValue(path.value);
  if (!isDialableShape(phone)) return false;
  if (path.trustLevel) {
    return (path.trustLevel === "VERIFIED" || path.trustLevel === "ACCEPTABLE")
      && path.conflictStatus !== "phone_conflict"
      && path.conflictStatus !== "multiple_conflicts"
      && path.conflictStatus !== "ambiguous_ownership";
  }
  const trust = classifyContactPathTrust({
    method: "phone",
    value: phone ?? "",
    source: phoneValue(path.source) ?? "unknown",
    verified: path.verified === true,
    confidence: phoneValue(path.confidence) ?? "none",
    rank: typeof path.rank === "number" ? path.rank : 99,
    label: "Phone path",
  }, {
    lastVerifiedAt: path.lastVerifiedAt ?? null,
    conflictStatus: path.conflictStatus ?? "none",
  });
  if (!canTrustPhoneForCallNow(trust)) return false;
  if (path.verified === false) return false;
  const confidence = String(path.confidence ?? "").toLowerCase();
  if (confidence === "low" || confidence === "none") return false;
  if (path.verified === true || confidence === "high" || confidence === "medium") return true;
  const source = String(path.source ?? "").toLowerCase();
  return source === "google_places" || source === "gbp";
}

function isTrustedSource(source: string | null | undefined): boolean {
  const normalized = String(source ?? "").toLowerCase();
  return normalized === "google_places" || normalized === "gbp";
}

function isLowConfidence(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "low" || normalized === "none";
}

/**
 * Operational dial authority. Unlike getCanonicalPhone(), this never falls
 * back to raw lead.phone unless an upstream server task explicitly stamped
 * that value as dialable.
 */
export function getDialablePhoneDetails(
  lead: CanonicalPhoneLeadLike | null | undefined,
): DialablePhoneDetails | null {
  const paths = phonePaths(lead).filter(isTrustedDialablePath);
  const gbpPath = paths.find((path) => {
    const source = String(path.source ?? "").toLowerCase();
    return source === "google_places" || source === "gbp";
  });
  const bestPath = gbpPath ?? paths.slice().sort((a, b) => pathRank(a) - pathRank(b))[0];
  const pathPhone = phoneValue(bestPath?.value);
  if (pathPhone) {
    return {
      phone: pathPhone,
      source: phoneValue(bestPath?.source),
      confidence: phoneValue(bestPath?.confidence),
      verified: bestPath?.verified === true,
    };
  }

  if (lead?.phoneAuthority === "dialable" && isDialableShape(lead.phone)) {
    return {
      phone: phoneValue(lead.phone)!,
      source: "server",
      confidence: "high",
      verified: true,
    };
  }
  const fallbackSource = phoneValue(lead?.contacts?.source) ?? phoneValue(lead?.source);
  const fallbackConfidence =
    phoneValue(lead?.contacts?.confidence)
    ?? phoneValue(lead?.confidenceLabel)
    ?? phoneValue(lead?.confidence);
  const fallbackPhone = phoneValue(lead?.contacts?.primaryPhone) ?? phoneValue(lead?.phone);
  const fallbackTrust = lead?.contacts?.phoneTrust ?? lead?.contacts?.contactTrust ?? classifyContactPathTrust({
    method: "phone",
    value: fallbackPhone ?? "",
    source: fallbackSource ?? "",
    verified: isTrustedSource(fallbackSource),
    confidence: fallbackConfidence ?? "none",
    rank: SOURCE_RANK[String(fallbackSource ?? "").toLowerCase()] ?? 99,
    label: "Primary phone",
  }, {
    lastVerifiedAt: phoneValue(lead?.contacts?.lastVerifiedAt) ?? phoneValue(lead?.contactResolutionCheckedAt) ?? phoneValue(lead?.lastChecked) ?? null,
  });
  if (fallbackPhone && !canTrustPhoneForCallNow(fallbackTrust)) return null;
  if (isTrustedSource(fallbackSource) && !isLowConfidence(fallbackConfidence) && isDialableShape(fallbackPhone)) {
    return {
      phone: fallbackPhone!,
      source: fallbackSource,
      confidence: fallbackConfidence ?? "medium",
      verified: true,
    };
  }
  return null;
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
