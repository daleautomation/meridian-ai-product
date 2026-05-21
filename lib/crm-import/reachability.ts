// Meridian CRM — reachability helpers (normalized fields, no synthetic contact data).

import type { CrmContactRecord, NormalizedCrmContact } from "./types";

export type WorkspaceReachabilityMode = "unknown" | "phone_light" | "balanced" | "phone_complete";

export type WorkspaceReachabilityProfile = {
  mode: WorkspaceReachabilityMode;
  totalContacts: number;
  phoneMissingPct: number;
  emailReachablePct: number;
  /** True when most contacts lack a mapped/normalized phone — email + history drive resurfacing. */
  phoneLight: boolean;
  summary: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function rowHasReachablePhone(row: {
  normalizedPhone?: string | null;
  phone?: string | null;
}): boolean {
  if (row.normalizedPhone) return true;
  const raw = row.phone?.trim();
  if (!raw) return false;
  return digitsOnly(raw).length >= 10;
}

export function rowHasReachableEmail(row: {
  normalizedEmail?: string | null;
  email?: string | null;
}): boolean {
  if (row.normalizedEmail) return true;
  const raw = row.email?.trim();
  if (!raw) return false;
  return EMAIL_RE.test(raw);
}

export function contactHasReachablePhone(contact: CrmContactRecord): boolean {
  return rowHasReachablePhone(contact);
}

export function contactHasReachableEmail(contact: CrmContactRecord): boolean {
  return rowHasReachableEmail(contact);
}

export function computeWorkspaceReachability(
  contacts: CrmContactRecord[],
): WorkspaceReachabilityProfile {
  if (contacts.length === 0) {
    return {
      mode: "unknown",
      totalContacts: 0,
      phoneMissingPct: 0,
      emailReachablePct: 0,
      phoneLight: false,
      summary: "",
    };
  }

  let missingPhone = 0;
  let withEmail = 0;
  for (const contact of contacts) {
    if (!contactHasReachablePhone(contact)) missingPhone += 1;
    if (contactHasReachableEmail(contact)) withEmail += 1;
  }

  const totalContacts = contacts.length;
  const phoneMissingPct = Math.round((missingPhone / totalContacts) * 100);
  const emailReachablePct = Math.round((withEmail / totalContacts) * 100);
  const phoneLight = phoneMissingPct > 50;
  const mode: WorkspaceReachabilityMode =
    phoneMissingPct === 0 ? "phone_complete"
    : phoneLight ? "phone_light"
    : "balanced";

  const summary = phoneLight
    ? `This network is mostly email-first (${phoneMissingPct}% without a usable phone). Prioritize notes, follow-ups, and last-activity memory — not call queues.`
    : phoneMissingPct > 0
      ? `${phoneMissingPct}% of contacts lack a verified phone. Email and interaction history remain the safest resurfacing paths.`
      : "Phones and emails are available for most contacts.";

  return {
    mode,
    totalContacts,
    phoneMissingPct,
    emailReachablePct,
    phoneLight,
    summary,
  };
}

export function reachabilityFromNormalizedRows(
  rows: NormalizedCrmContact[],
): Pick<WorkspaceReachabilityProfile, "phoneMissingPct" | "emailReachablePct" | "phoneLight"> {
  if (rows.length === 0) {
    return { phoneMissingPct: 0, emailReachablePct: 0, phoneLight: false };
  }
  let missingPhone = 0;
  let withEmail = 0;
  for (const row of rows) {
    if (!rowHasReachablePhone(row)) missingPhone += 1;
    if (rowHasReachableEmail(row)) withEmail += 1;
  }
  const phoneMissingPct = Math.round((missingPhone / rows.length) * 100);
  const emailReachablePct = Math.round((withEmail / rows.length) * 100);
  return { phoneMissingPct, emailReachablePct, phoneLight: phoneMissingPct > 50 };
}
