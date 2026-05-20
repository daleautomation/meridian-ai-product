// Meridian CRM import — column mapping and row normalization.

import { normalizePhoneForTrust } from "@/lib/contacts/trust";
import {
  CRM_IMPORT_FIELDS,
  type ColumnMapping,
  type ContactDatumTrust,
  type CrmImportField,
  type NormalizedCrmContact,
} from "./types";

export const COLUMN_ALIASES: Record<CrmImportField, string[]> = {
  name: [
    "name", "full name", "fullname", "contact name", "contact", "first name",
    "firstname", "last name", "lastname", "person",
  ],
  company: [
    "company", "organization", "org", "account", "account name", "business",
    "employer", "firm",
  ],
  phone: [
    "phone", "mobile", "cell", "telephone", "work phone", "primary phone",
    "phone number", "mobile phone",
  ],
  email: [
    "email", "e-mail", "email address", "work email", "primary email",
  ],
  address: [
    "address", "street", "location", "mailing address", "city state",
  ],
  notes: [
    "notes", "note", "description", "comments", "memo",
  ],
  tags: [
    "tags", "tag", "labels", "categories", "segment",
  ],
  lastInteraction: [
    "last interaction", "last contact", "last activity", "last touch",
    "last contacted", "last seen", "last modified", "updated at",
  ],
  sourceCrm: [
    "source", "crm", "source crm", "origin", "import source", "lead source",
  ],
};

export function detectColumnMapping(headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map((h) => ({
    raw: h,
    key: h.trim().toLowerCase(),
  }));
  const mapping: ColumnMapping = {};

  for (const field of CRM_IMPORT_FIELDS) {
    const aliases = COLUMN_ALIASES[field];
    const match = normalizedHeaders.find((header) =>
      aliases.some((alias) => header.key === alias || header.key.includes(alias)),
    );
    if (match) mapping[field] = match.raw;
  }

  return mapping;
}

export function getMappedValue(
  row: Record<string, string>,
  mapping: ColumnMapping,
  field: CrmImportField,
): string {
  const header = mapping[field];
  if (!header) return "";
  return (row[header] ?? row[header.toLowerCase()] ?? row[header.toUpperCase()] ?? "").trim();
}

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

function normalizeCompany(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePersonName(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function parseTags(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseLastInteraction(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildDatumTrust(
  value: string | null,
  source: string,
  opts: { required?: boolean; verified?: boolean } = {},
): ContactDatumTrust {
  const hasValue = Boolean(value && value.trim());
  const confidence = !hasValue
    ? 0
    : opts.verified
      ? 92
      : value!.includes("@") || normalizePhoneForTrust(value).length >= 10
        ? 78
        : 55;

  let trustLevel: ContactDatumTrust["trustLevel"] = "missing";
  if (hasValue) {
    if (opts.verified) trustLevel = "verified";
    else if (confidence >= 75) trustLevel = "acceptable";
    else trustLevel = "weak";
  } else if (opts.required) {
    trustLevel = "missing";
  }

  return {
    value: hasValue ? value : null,
    source,
    confidence,
    trustLevel,
    lastVerifiedAt: hasValue ? new Date().toISOString() : null,
    enrichmentProvider: null,
    conflictState: "none",
    displayAsTrusted: trustLevel === "verified" || trustLevel === "acceptable",
  };
}

export function normalizeCrmRow(
  row: Record<string, string>,
  rowIndex: number,
  mapping: ColumnMapping,
  sourceLabel: string,
): NormalizedCrmContact {
  const name = getMappedValue(row, mapping, "name");
  const company = getMappedValue(row, mapping, "company") || name;
  const phone = getMappedValue(row, mapping, "phone");
  const email = getMappedValue(row, mapping, "email");
  const address = getMappedValue(row, mapping, "address");
  const notes = getMappedValue(row, mapping, "notes");
  const tags = parseTags(getMappedValue(row, mapping, "tags"));
  const lastInteractionAt = parseLastInteraction(getMappedValue(row, mapping, "lastInteraction"));
  const sourceCrm = getMappedValue(row, mapping, "sourceCrm") || sourceLabel;

  const normalizedPhone = normalizePhoneForTrust(phone) || null;
  const normalizedEmail = normalizeEmail(email);
  const normalizedCompany = normalizeCompany(company);
  const normalizedName = normalizePersonName(name);

  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  if (!name.trim() && !company.trim()) {
    validationErrors.push("Row needs at least a name or company.");
  }
  if (!phone.trim() && !email.trim()) {
    validationWarnings.push("No phone or email — relationship reachability is limited.");
  }
  if (phone.trim() && !normalizedPhone) {
    validationWarnings.push("Phone could not be normalized to a usable format.");
  }
  if (email.trim() && !normalizedEmail) {
    validationWarnings.push("Email format looks invalid.");
  }

  const importSource = `crm_import:${sourceCrm}`;

  return {
    rowIndex,
    name: name.trim() || company.trim(),
    company: company.trim() || name.trim(),
    phone: phone.trim() || null,
    email: normalizedEmail,
    address: address.trim() || null,
    notes: notes.trim() || null,
    tags,
    lastInteractionAt,
    sourceCrm,
    normalizedPhone: normalizedPhone && normalizedPhone.length >= 10 ? normalizedPhone : null,
    normalizedEmail,
    normalizedCompany,
    normalizedName,
    dataTrust: {
      name: buildDatumTrust(name.trim() || null, importSource, { required: true }),
      company: buildDatumTrust(company.trim() || null, importSource, { required: true }),
      phone: buildDatumTrust(phone.trim() || null, importSource),
      email: buildDatumTrust(normalizedEmail, importSource),
      address: buildDatumTrust(address.trim() || null, importSource),
      lastInteraction: buildDatumTrust(
        lastInteractionAt,
        importSource,
        { verified: Boolean(lastInteractionAt) },
      ),
    },
    validationErrors,
    validationWarnings,
  };
}

export function normalizeCrmRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  sourceLabel: string,
): NormalizedCrmContact[] {
  return rows.map((row, index) => normalizeCrmRow(row, index, mapping, sourceLabel));
}
