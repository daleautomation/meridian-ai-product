// Meridian — canonical phone selection.
//
// One deterministic selector for operator-facing phone truth. GBP/Google
// contact paths win when available, then the ranked contact-path waterfall,
// then already-normalized lead contact fields.

type PhonePathLike = {
  method?: string | null;
  value?: string | null;
  source?: string | null;
  rank?: number | null;
};

export type CanonicalPhoneLeadLike = {
  phone?: string | null;
  contacts?: {
    primaryPhone?: string | null;
    [key: string]: unknown;
  } | null;
  contactPaths?: PhonePathLike[] | null;
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
