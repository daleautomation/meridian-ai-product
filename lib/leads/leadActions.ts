// Meridian AI — Lead action helpers.
//
// Pure functions only. Resolve the callable phone / email a lead
// already carries (Google Places + snapshot store). Never fabricate a
// number, never invent a domain. If the field is missing, callers
// should render the FIND NUMBER unblock state instead of a CALL button.

import { getDialablePhone } from "./phone";

export interface ActionableLeadLike {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  websiteUrl?: string | null;
  domain?: string | null;
  contacts?: {
    primaryPhone?: string | null;
    primaryEmail?: string | null;
  } | null;
  expectedValue?: number | null;
  revenueImpact?: number | null;
}

export interface ActionableContact {
  phone: string | null;
  phoneFormatted: string | null;
  email: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  /** Convenience flag: callable means we have a usable phone string. */
  callable: boolean;
  missing: ("phone" | "email")[];
}

const DIGITS_RE = /[^\d+]/g;

function digitsOnly(raw: string): string {
  return raw.replace(DIGITS_RE, "");
}

/** Strip extensions and pretty-print US-style 10-digit numbers; keep
 *  intl prefix if present. Falls back to digits if shape is unknown. */
export function formatPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = digitsOnly(trimmed);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11 && d.startsWith("1")) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (trimmed.startsWith("+")) return trimmed;
  return d || trimmed;
}

/** Phone in `tel:`-safe form. Returns null when unusable. */
export function formatTelHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = digitsOnly(trimmed);
  if (!d) return null;
  return `tel:${d.startsWith("+") ? d : d.length === 10 ? `+1${d}` : d}`;
}

export function formatSmsHref(raw: string | null | undefined, body?: string): string | null {
  const tel = formatTelHref(raw);
  if (!tel) return null;
  const number = tel.replace(/^tel:/, "");
  const suffix = body ? `?body=${encodeURIComponent(body)}` : "";
  return `sms:${number}${suffix}`;
}

export function formatMailtoHref(raw: string | null | undefined, params?: { subject?: string; body?: string }): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.includes("@")) return null;
  const q: string[] = [];
  if (params?.subject) q.push(`subject=${encodeURIComponent(params.subject)}`);
  if (params?.body) q.push(`body=${encodeURIComponent(params.body)}`);
  return `mailto:${trimmed}${q.length ? `?${q.join("&")}` : ""}`;
}

/** Resolve the callable contact for a lead. Reads only fields already
 *  on the snapshot — never fabricates. */
export function getActionableContact(lead: ActionableLeadLike | null | undefined): ActionableContact {
  if (!lead) {
    return { phone: null, phoneFormatted: null, email: null, hasPhone: false, hasEmail: false, callable: false, missing: ["phone", "email"] };
  }
  const phoneRaw = getDialablePhone(lead);
  const emailRaw = (typeof lead.email === "string" && lead.email.includes("@"))
    ? lead.email.trim()
    : (typeof lead.contacts?.primaryEmail === "string" && lead.contacts.primaryEmail.includes("@"))
      ? lead.contacts.primaryEmail.trim()
      : null;
  const missing: ("phone" | "email")[] = [];
  if (!phoneRaw) missing.push("phone");
  if (!emailRaw) missing.push("email");
  return {
    phone: phoneRaw,
    phoneFormatted: phoneRaw ? formatPhone(phoneRaw) : null,
    email: emailRaw,
    hasPhone: !!phoneRaw,
    hasEmail: !!emailRaw,
    callable: !!phoneRaw,
    missing,
  };
}

/** $4,200 / $1.2M / null. */
export function formatMoney(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Best monetary signal we can pull from the lead. Prefers expectedValue
 *  (probability-adjusted), falls back to revenueImpact. */
export function leadOpportunityValue(lead: ActionableLeadLike | null | undefined): number | null {
  if (!lead) return null;
  if (typeof lead.expectedValue === "number" && lead.expectedValue > 0) return lead.expectedValue;
  if (typeof lead.revenueImpact === "number" && lead.revenueImpact > 0) return lead.revenueImpact;
  return null;
}
