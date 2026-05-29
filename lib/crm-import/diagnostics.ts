// Meridian CRM import — mapping and reachability diagnostics for preview.

import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import type { ColumnMapping, ImportDiagnostics, NormalizedCrmContact } from "./types";

const PHONE_HEADER_RE = /phone|mobile|cell|tel|fax/i;
const EMAIL_HEADER_RE = /e-?mail|email address/i;

function hasSurname(name: string | null): boolean {
  if (!name) return false;
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  let i = tokens.length - 1;
  while (i >= 0 && tokens[i].replace(/[.,]/g, "").length <= 1) i--;
  return i > 0;
}

function isWeakAddress(address: string | null): boolean {
  if (!address || !address.trim()) return false; // missing != weak
  try {
    const normalized = normalizeAddress(address);
    return detectWeakAddress(normalized) !== null;
  } catch {
    return true;
  }
}

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
  let rowsMissingSurname = 0;
  let rowsWithWeakAddress = 0;

  for (const row of rows) {
    const hasPhone = Boolean(row.normalizedPhone || row.phone?.trim());
    const hasEmail = Boolean(row.normalizedEmail || row.email?.trim());
    if (!hasPhone) rowsMissingPhone += 1;
    if (!hasEmail) rowsMissingEmail += 1;
    if (!hasPhone && !hasEmail) rowsMissingBoth += 1;
    if (!hasSurname(row.name)) rowsMissingSurname += 1;
    if (isWeakAddress(row.address)) rowsWithWeakAddress += 1;
  }

  const phoneMissingPct = totalRows > 0 ? Math.round((rowsMissingPhone / totalRows) * 100) : 0;
  const emailReachablePct =
    totalRows > 0 ? Math.round(((totalRows - rowsMissingEmail) / totalRows) * 100) : 0;
  const highPhoneMissingRate = phoneMissingPct > 50;
  const isEmailFirstExport =
    highPhoneMissingRate && mappedEmailColumns.length > 0 && rowsMissingEmail < totalRows;

  // ── Assembly diagnostics ─────────────────────────────────────────
  // A split-name CSV is one where the mapping has no `name` column but
  // has firstName + lastName. Same idea for address vs. street+city+
  // state+postalCode.
  const detectsSplitName =
    !mapping.name && Boolean(mapping.firstName) && Boolean(mapping.lastName);
  const detectsSplitAddress =
    !mapping.address &&
    Boolean(mapping.street) &&
    Boolean(mapping.city) &&
    Boolean(mapping.state || mapping.postalCode);

  // Rows whose name has two or more tokens AND the CSV was split-name
  // shaped → the assembly path produced this row.
  let rowsAssembledFromComponents = 0;
  let rowsAddressAssembledFromComponents = 0;
  for (const row of rows) {
    if (detectsSplitName && row.name && row.name.trim().split(/\s+/).length >= 2) {
      rowsAssembledFromComponents += 1;
    }
    if (detectsSplitAddress && row.address && /,/.test(row.address)) {
      rowsAddressAssembledFromComponents += 1;
    }
  }

  // Up to 3 sample rows so operator can sanity-check before clicking
  // Import. Picks rows that produced both a multi-token name AND a
  // comma-bearing address (the strongest evidence of successful
  // assembly).
  const assemblySamples: ImportDiagnostics["assemblySamples"] = [];
  for (const row of rows) {
    if (assemblySamples.length >= 3) break;
    const nameTokens = row.name?.trim().split(/\s+/).length ?? 0;
    const addressLooksFull = row.address ? /,/.test(row.address) : false;
    if (nameTokens >= 2 && addressLooksFull) {
      assemblySamples.push({
        fromName: row.name,
        fromAddress: row.address ?? "",
      });
    }
  }

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
    emailReachablePct,
    highPhoneMissingRate,
    isEmailFirstExport,
    detectsSplitName,
    rowsAssembledFromComponents,
    detectsSplitAddress,
    rowsAddressAssembledFromComponents,
    rowsMissingSurname,
    rowsWithWeakAddress,
    assemblySamples,
  };
}

/** Pure utility: canonical address key for downstream identity tools. */
export function debugCanonicalAddressKey(address: string | null): string | null {
  if (!address || !address.trim()) return null;
  try {
    const normalized = normalizeAddress(address);
    if (detectWeakAddress(normalized)) return null;
    return canonicalPropertyKey(normalized);
  } catch {
    return null;
  }
}
