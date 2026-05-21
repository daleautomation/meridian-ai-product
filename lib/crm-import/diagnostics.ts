// Meridian CRM import — mapping and reachability diagnostics for preview.

import type { ColumnMapping, ImportDiagnostics, NormalizedCrmContact } from "./types";

const PHONE_HEADER_RE = /phone|mobile|cell|tel|fax/i;
const EMAIL_HEADER_RE = /e-?mail|email address/i;

export function computeImportDiagnostics(args: {
  headers: string[];
  mapping: ColumnMapping;
  rows: NormalizedCrmContact[];
}): ImportDiagnostics {
  const { headers, mapping, rows } = args;
  const totalRows = rows.length;

  const mappedPhoneColumns = mapping.phone ? [mapping.phone] : [];
  const mappedEmailColumns = mapping.email ? [mapping.email] : [];

  const unmappedPhoneLikeHeaders = mapping.phone
    ? []
    : headers.filter((h) => PHONE_HEADER_RE.test(h));
  const unmappedEmailLikeHeaders = mapping.email
    ? []
    : headers.filter((h) => EMAIL_HEADER_RE.test(h));

  let rowsMissingPhone = 0;
  let rowsMissingEmail = 0;
  let rowsMissingBoth = 0;

  for (const row of rows) {
    const hasPhone = Boolean(row.normalizedPhone || row.phone?.trim());
    const hasEmail = Boolean(row.normalizedEmail || row.email?.trim());
    if (!hasPhone) rowsMissingPhone += 1;
    if (!hasEmail) rowsMissingEmail += 1;
    if (!hasPhone && !hasEmail) rowsMissingBoth += 1;
  }

  const phoneMissingPct = totalRows > 0 ? Math.round((rowsMissingPhone / totalRows) * 100) : 0;

  return {
    detectedHeaders: headers,
    columnMapping: mapping,
    mappedPhoneColumns,
    mappedEmailColumns,
    unmappedPhoneLikeHeaders,
    unmappedEmailLikeHeaders,
    rowsMissingPhone,
    rowsMissingEmail,
    rowsMissingBoth,
    totalRows,
    phoneMissingPct,
    highPhoneMissingRate: phoneMissingPct > 50,
  };
}
