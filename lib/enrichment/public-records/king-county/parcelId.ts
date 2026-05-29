// Meridian — King County PIN normalization.
//
// King County Parcel Identification Numbers (PINs) are 10-digit values
// emitted in several historical formats:
//
//   • XXXXXX-XXXX (hyphenated)
//   • XXXX-XX-XXXX (alternative hyphenation)
//   • XXXXXXXXXX (raw 10 digits)
//   • Sometimes padded with leading spaces or zeros
//
// We strip all non-digit characters and require exactly 10 digits. Any
// other input is rejected — no fuzzy fallback, no truncation, no padding.

/**
 * Normalize a raw parcel identifier to the canonical 10-digit form, or
 * return `null` if the value cannot be reduced to exactly 10 digits.
 */
export function normalizeKingCountyParcelId(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.trim().replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return digits;
}

/** True when the raw value normalizes to a valid King County PIN. */
export function isValidKingCountyParcelId(
  raw: string | null | undefined,
): boolean {
  return normalizeKingCountyParcelId(raw) !== null;
}
