// Meridian — Public-Record Intelligence Architecture v1, Commit C
//
// Pure assembly of OpportunityScoringInput from CRM + canonical
// substrate. The script orchestrator loads from DB; this module
// builds the input record deterministically. Extracted as a pure
// function so the validator can exercise the assembly without a DB.
//
// Constitution alignment:
//   §1 (source-of-truth): contact tags + name come from CRM (T1–T3);
//   ownership facts come from canonical snapshot (T5). Nothing is
//   inferred.
//   §2 (provenance): publicRecordSource is the snapshot.source
//   string; contactPathSource records which channel was used.
//   §5 (deterministic): no Date.now(); now is injected.

import type {
  PublicOwnershipSnapshot,
  PublicParcel,
  WorkspaceContactParcelLink,
} from "@/lib/enrichment/public-records/canonicalStorage/types";
import { classifyRelationshipType } from "@/lib/enrichment/opportunity/relationshipType";
import type {
  OpportunityScoringInput,
  OwnerMatchConfidence,
} from "@/lib/enrichment/opportunity/types";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export interface PipelineContactView {
  contactId: string;
  contactName: string;
  tags: readonly string[];
  email: string | null;
  phone: string | null;
  lastInteractionAt: string | null;
}

export interface BuildScoringInputArgs {
  contact: PipelineContactView;
  /** The active workspace_contact_parcel_link for this contact, if any. */
  link: WorkspaceContactParcelLink | null;
  /** The parcel referenced by the link. Null when link is null. */
  parcel: PublicParcel | null;
  /** The snapshot the link points to. Null when link is null. */
  snapshot: PublicOwnershipSnapshot | null;
  /** Workspace seller-bias preference. Pass 0 when not configured. */
  operatorSellerBias: number;
  /** Logical "now" — injected for determinism. */
  now: Date;
}

function ownershipDurationYears(
  ownershipStartDate: string | null,
  now: Date,
): number | null {
  if (!ownershipStartDate) return null;
  const t = Date.parse(ownershipStartDate);
  if (!Number.isFinite(t)) return null;
  const years = (now.getTime() - t) / MS_PER_YEAR;
  if (!Number.isFinite(years) || years < 0) return null;
  return Math.floor(years);
}

function linkConfidenceToOwnerMatch(
  link: WorkspaceContactParcelLink | null,
): OwnerMatchConfidence {
  if (!link) return null;
  // ownership_mismatch links are stored at WEAK; the scorer caps tier
  // at REVIEW for WEAK owner-match. That is the intended behavior —
  // we surface the candidate but never claim ownership.
  return link.matchConfidence;
}

/**
 * Pure assembly of OpportunityScoringInput. No I/O. Same inputs →
 * same output. The caller does the DB load; this function turns that
 * load into a scorer-ready record.
 */
export function buildOpportunityScoringInput(
  args: BuildScoringInputArgs,
): OpportunityScoringInput {
  const rel = classifyRelationshipType(args.contact.tags);
  const hasEmail = !!args.contact.email;
  const hasPhone = !!args.contact.phone;
  const hasActionableChannel = hasEmail || hasPhone;
  const contactPathSource = hasEmail
    ? "crm:email"
    : hasPhone
      ? "crm:phone"
      : null;

  // Ownership facts only flow when (link AND snapshot) both exist.
  // The scorer's `ownership_duration_over_7yr` factor self-skips when
  // ownershipDurationYears is null, so absent public-record data
  // simply means that factor does not fire — never fabricated.
  const ownerName = args.snapshot?.ownerName ?? null;
  const ownerMatchConfidence = linkConfidenceToOwnerMatch(args.link);
  const ownershipStartDate = args.snapshot?.ownershipStartDate ?? null;
  const ownershipYears = ownershipDurationYears(ownershipStartDate, args.now);
  const lastSaleDate = args.snapshot?.lastTransferDate
    ?? args.snapshot?.ownershipStartDate
    ?? null;
  const publicRecordSource = args.snapshot?.source ?? null;
  const matchedPropertyAddress = args.parcel?.situsAddress ?? null;
  const parcelId = args.parcel?.id ?? null;

  return {
    contactId: args.contact.contactId,
    contactName: args.contact.contactName,
    relationshipType: rel.relationshipType,
    relationshipTypeSource: rel.relationshipTypeSource,
    operatorSellerBias: args.operatorSellerBias,
    matchedPropertyAddress,
    parcelId,
    ownerName,
    ownerMatchConfidence,
    ownershipDurationYears: ownershipYears,
    lastSaleDate,
    publicRecordSource,
    // MLS layer is not built yet — the listing fields are honest empties.
    currentListingStatus: "unknown",
    listingAgentName: null,
    listingAgentMatch: "unknown",
    listingSource: null,
    listingObservedAt: null,
    hasActionableChannel,
    contactPathSource,
    lastInteractionAt: args.contact.lastInteractionAt,
    now: args.now,
  };
}
