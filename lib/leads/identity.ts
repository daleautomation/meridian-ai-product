import { companyKey } from "../mcp/types";

type LeadIdentityLike = {
  key?: string | number | null;
  id?: string | number | null;
  companyKey?: string | null;
  crmKey?: string | null;
  name?: string | null;
  companyName?: string | null;
  domain?: string | null;
  website?: string | null;
  resolvedBusinessUrl?: string | null;
  location?: string | null;
};

export function cleanIdentityValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function deriveLeadCompanyKey(lead: LeadIdentityLike | null | undefined): string | null {
  if (!lead) return null;
  const name = cleanIdentityValue(lead.name) ?? cleanIdentityValue(lead.companyName);
  if (!name) return null;
  const domain =
    cleanIdentityValue(lead.domain)
    ?? cleanIdentityValue(lead.website)
    ?? cleanIdentityValue(lead.resolvedBusinessUrl);
  try {
    return companyKey({
      name,
      ...(domain ? { domain, url: domain } : {}),
      ...(cleanIdentityValue(lead.location) ? { location: cleanIdentityValue(lead.location)! } : {}),
    });
  } catch {
    return null;
  }
}

export function leadIdentityCandidates(lead: LeadIdentityLike | null | undefined): string[] {
  if (!lead) return [];
  return [
    cleanIdentityValue(lead.companyKey),
    cleanIdentityValue(lead.crmKey),
    deriveLeadCompanyKey(lead),
    lead.id == null ? null : String(lead.id),
    lead.key == null ? null : String(lead.key),
  ].filter((key): key is string => !!key).filter((key, index, arr) => arr.indexOf(key) === index);
}

export function resolveByLeadIdentity<T>(
  lead: LeadIdentityLike | null | undefined,
  map: Record<string, T> | null | undefined,
): { key: string | null; value: T | null } {
  const candidates = leadIdentityCandidates(lead);
  for (const key of candidates) {
    if (map && Object.prototype.hasOwnProperty.call(map, key)) return { key, value: map[key] };
  }
  return { key: candidates[0] ?? null, value: null };
}
