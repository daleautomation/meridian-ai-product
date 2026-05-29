// Meridian — Public-Record Intelligence Architecture v1, Commit B
//
// Deterministic resolver for contact ↔ parcel ↔ snapshot. Pure function;
// same input → same output; no I/O, no `Date.now()` calls except where
// `options.now` is unspecified.
//
// The confidence ladder (Architecture doc §4.3):
//
//   address strength | owner-name match | tier  | matchReason
//   ─────────────────┼──────────────────┼───────┼──────────────────
//   parcel_id        | exact            | HIGH  | exact
//   parcel_id        | surname          | MED   | surname
//   parcel_id        | trust_or_llc     | MED   | trust_or_llc
//   parcel_id        | no_match         | WEAK  | ownership_mismatch
//   address          | exact            | MED   | exact
//   address          | surname          | WEAK  | surname
//   address          | trust_or_llc     | WEAK  | trust_or_llc
//   address          | no_match         | WEAK  | ownership_mismatch
//   (no parcel)      | —                | NO_MATCH | null
//
// "WEAK + ownership_mismatch" is intentionally stored as a link — the
// audit surfaces it as a cautionary chip so operators see "we found
// this parcel at this address but the owner-on-record is not this
// contact." It is NEVER claimed as ownership downstream.
//
// Review-reason tagging is additive:
//   • trust_or_llc_owner   — owner_is_trust_or_llc match
//   • surname_only_match   — owner-name match was surname only
//   • ownership_mismatch   — name did not match at all
//   • stale_observation    — snapshot older than staleThresholdDays
//
// No fuzzy address matching. No first-name-only matching. No
// probabilistic owner-name guessing.

import type {
  LinkMatchConfidence,
  LinkMatchReason,
} from "@/lib/enrichment/public-records/canonicalStorage/types";
import { classifyOwnerNameMatch } from "@/lib/enrichment/property/propertyMatchRules";
import type {
  ContactParcelResolution,
  ResolutionReviewReason,
  ResolveContactParcelInput,
  ResolveContactParcelOptions,
} from "./types";

const DEFAULT_STALE_DAYS = 540;
const DAY_MS = 24 * 60 * 60 * 1000;

function ageInDays(observedAt: string, now: Date): number {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

function explain(parts: ReadonlyArray<string>): string {
  return parts.filter((s) => s.length > 0).join("; ");
}

export function resolveContactParcel(
  input: ResolveContactParcelInput,
  options?: ResolveContactParcelOptions,
): ContactParcelResolution {
  const now = options?.now ?? new Date();
  const staleDays = options?.staleThresholdDays ?? DEFAULT_STALE_DAYS;
  const matchedBy = input.matchedBy ?? "address";

  // ── No parcel → NO_MATCH (no link will be created). ────────────
  if (!input.parcel) {
    return {
      contactId: input.contact.contactId,
      parcelId: null,
      snapshotId: null,
      tier: "NO_MATCH",
      matchConfidence: null,
      matchReason: null,
      ownerNameMatch: null,
      ownerNameMatchReason: "no_parcel_provided",
      addressMatchStrength: null,
      reviewReasons: [],
      explanation: "No parcel match. Public-record substrate has no parcel for this contact's address.",
    };
  }

  // ── Snapshot is required to evaluate owner-name match. ─────────
  // A parcel without any snapshot means we have parcel identity but
  // no ownership facts — record nothing; caller treats as NO_MATCH for
  // link purposes (no owner to attribute to).
  if (!input.snapshot) {
    return {
      contactId: input.contact.contactId,
      parcelId: input.parcel.parcelId,
      snapshotId: null,
      tier: "NO_MATCH",
      matchConfidence: null,
      matchReason: null,
      ownerNameMatch: null,
      ownerNameMatchReason: "no_snapshot_for_parcel",
      addressMatchStrength: matchedBy,
      reviewReasons: [],
      explanation: "Parcel exists in substrate but no ownership snapshot has been ingested yet.",
    };
  }

  // ── Evaluate owner-name match (constitution §6 — no first-name). ─
  const nameMatch = classifyOwnerNameMatch({
    contactName: input.contact.contactName,
    ownerNameOnRecord: input.snapshot.ownerName,
  });

  // ── Apply the confidence ladder. ─────────────────────────────────
  let tier: ContactParcelResolution["tier"];
  let matchConfidence: LinkMatchConfidence;
  let matchReason: LinkMatchReason;

  if (nameMatch.match === "exact") {
    if (matchedBy === "parcel_id") {
      tier = "HIGH";
      matchConfidence = "HIGH";
    } else {
      tier = "MED";
      matchConfidence = "MED";
    }
    matchReason = "exact";
  } else if (nameMatch.match === "surname") {
    if (matchedBy === "parcel_id") {
      tier = "MED";
      matchConfidence = "MED";
    } else {
      tier = "WEAK";
      matchConfidence = "WEAK";
    }
    matchReason = "surname";
  } else if (nameMatch.match === "trust_or_llc") {
    if (matchedBy === "parcel_id") {
      tier = "MED";
      matchConfidence = "MED";
    } else {
      tier = "WEAK";
      matchConfidence = "WEAK";
    }
    matchReason = "trust_or_llc";
  } else {
    // no_match — store as ownership_mismatch link with WEAK confidence.
    // We DO persist the link (so the audit + UI can show a cautionary
    // chip), but it is never claimed as ownership.
    tier = "WEAK";
    matchConfidence = "WEAK";
    matchReason = "ownership_mismatch";
  }

  // ── Tag review reasons (additive). ───────────────────────────────
  const reviewReasons: ResolutionReviewReason[] = [];
  if (nameMatch.match === "trust_or_llc") reviewReasons.push("trust_or_llc_owner");
  if (nameMatch.match === "surname") reviewReasons.push("surname_only_match");
  if (matchReason === "ownership_mismatch") reviewReasons.push("ownership_mismatch");
  if (ageInDays(input.snapshot.observedAt, now) > staleDays) {
    reviewReasons.push("stale_observation");
  }

  // ── Compose the operator-readable explanation. ──────────────────
  const parts: string[] = [];
  if (matchReason === "exact") {
    parts.push(`Owner name on record matches contact name (${nameMatch.reason}).`);
  } else if (matchReason === "surname") {
    parts.push(`Surname-only match (${nameMatch.reason}). Likely spouse-on-title or married-name variant.`);
  } else if (matchReason === "trust_or_llc") {
    parts.push(`Owner is a trust or LLC containing the contact's surname (${nameMatch.reason}).`);
  } else {
    parts.push(`Owner of record does not align with the contact's name (${nameMatch.reason}).`);
  }
  parts.push(
    matchedBy === "parcel_id"
      ? "Parcel matched by verified parcel id."
      : "Parcel matched by canonical address.",
  );
  if (reviewReasons.includes("stale_observation")) {
    parts.push(`Snapshot is older than ${staleDays} days — verify with operator before acting.`);
  }
  const explanation = explain(parts);

  return {
    contactId: input.contact.contactId,
    parcelId: input.parcel.parcelId,
    snapshotId: input.snapshot.snapshotId,
    tier,
    matchConfidence,
    matchReason,
    ownerNameMatch: nameMatch.match,
    ownerNameMatchReason: nameMatch.reason,
    addressMatchStrength: matchedBy,
    reviewReasons,
    explanation,
  };
}
