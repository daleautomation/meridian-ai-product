// Meridian CRM import — centralized datum trust thresholds and display rules.

import { normalizePhoneForTrust } from "@/lib/contacts/trust";
import type { ContactDatumTrust, DatumTrustLevel } from "./types";

/** Minimum confidence (0–100) for each trust band. Single source of truth. */
export const TRUST_CONFIDENCE = {
  verified: 90,
  acceptable: 75,
  weak: 40,
} as const;

export type BuildDatumTrustOptions = {
  required?: boolean;
  /** True only when an operator or high-reliability provider verified the value. */
  operatorVerified?: boolean;
  enrichmentProvider?: string | null;
};

export function classifyTrustLevel(
  confidence: number,
  hasValue: boolean,
  opts: BuildDatumTrustOptions = {},
): DatumTrustLevel {
  if (!hasValue) return opts.required ? "missing" : "missing";
  if (opts.operatorVerified && confidence >= TRUST_CONFIDENCE.verified) return "verified";
  if (confidence >= TRUST_CONFIDENCE.acceptable) return "acceptable";
  if (confidence >= TRUST_CONFIDENCE.weak) return "weak";
  return "weak";
}

/**
 * Only operator-verified data may render with a "trusted" (verified) visual treatment.
 * Acceptable import data is usable but must not look verified.
 */
export function deriveDisplayAsTrusted(trustLevel: DatumTrustLevel): boolean {
  return trustLevel === "verified";
}

export function isTrustDisplayAligned(datum: ContactDatumTrust): boolean {
  if (datum.trustLevel === "weak" || datum.trustLevel === "missing" || datum.trustLevel === "conflicting") {
    return !datum.displayAsTrusted;
  }
  if (datum.trustLevel === "acceptable") {
    return !datum.displayAsTrusted;
  }
  if (datum.trustLevel === "verified") {
    return datum.displayAsTrusted && datum.confidence >= TRUST_CONFIDENCE.verified;
  }
  return datum.displayAsTrusted === deriveDisplayAsTrusted(datum.trustLevel);
}

export function computeImportDatumConfidence(
  value: string | null,
  opts: BuildDatumTrustOptions = {},
): number {
  const hasValue = Boolean(value && value.trim());
  if (!hasValue) return 0;
  if (opts.operatorVerified) return 92;
  const trimmed = value!.trim();
  if (trimmed.includes("@") || normalizePhoneForTrust(trimmed).length >= 10) return 78;
  return 55;
}

export function buildDatumTrust(
  value: string | null,
  source: string,
  opts: BuildDatumTrustOptions = {},
): ContactDatumTrust {
  const hasValue = Boolean(value && value.trim());
  const confidence = computeImportDatumConfidence(value, opts);
  const trustLevel = classifyTrustLevel(confidence, hasValue, opts);
  const displayAsTrusted = deriveDisplayAsTrusted(trustLevel);

  return {
    value: hasValue ? value : null,
    source,
    confidence,
    trustLevel,
    lastVerifiedAt: hasValue ? new Date().toISOString() : null,
    enrichmentProvider: opts.enrichmentProvider ?? null,
    conflictState: "none",
    displayAsTrusted,
  };
}

export type TrustChipDisplay = {
  label: string;
  trusted: boolean;
  title: string;
};

export function formatTrustChipDisplay(datum: ContactDatumTrust): TrustChipDisplay {
  const aligned = isTrustDisplayAligned(datum);
  const trusted = aligned && datum.displayAsTrusted;
  return {
    label: datum.trustLevel,
    trusted,
    title: aligned
      ? `${datum.trustLevel} · ${datum.confidence}% confidence · ${datum.source}`
      : `Display mismatch: level=${datum.trustLevel} displayAsTrusted=${datum.displayAsTrusted}`,
  };
}
