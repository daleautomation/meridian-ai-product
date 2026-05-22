// Deterministic seller-timing signal builders — evidence required, no invented claims.

import type {
  PropertyEnrichmentInput,
  SellerTimingSignal,
  SellerTimingSignalKind,
} from "./types";

const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isIso8601(value: string): boolean {
  return ISO_RE.test(value);
}

function yearsBetween(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

function baseSignal(
  kind: SellerTimingSignalKind,
  input: PropertyEnrichmentInput,
  fields: Omit<SellerTimingSignal, "kind" | "propertyKey">,
): SellerTimingSignal {
  return {
    kind,
    propertyKey: input.property.propertyKey,
    ...fields,
  };
}

/** Owner on title ≥ 7 years per recorded ownership start date. */
export function buildLongTermOwner(input: PropertyEnrichmentInput, nowIso: string): SellerTimingSignal | null {
  const ownership = input.ownership;
  if (!ownership?.ownershipStartDate || !isIso8601(ownership.ownershipStartDate)) return null;

  const years = ownership.ownershipDurationYears ?? yearsBetween(ownership.ownershipStartDate, nowIso);
  if (years === null || years < 7) return null;

  const prov = ownership.provenance;
  return baseSignal("long_term_owner", input, {
    observedAt: prov.observedAt,
    recordId: prov.recordId,
    source: prov.source,
    confidence: prov.confidence,
    evidenceUrl: prov.evidenceUrl ?? null,
    evidenceLabel: "Ownership duration",
    explanation: `Recorded ownership began on ${ownership.ownershipStartDate} (${Math.floor(years)} years on title).`,
    evidence: {
      ownershipStartDate: ownership.ownershipStartDate,
      ownershipDurationYears: Math.floor(years * 10) / 10,
      ownerName: ownership.ownerName,
      parcelId: input.property.parcelId,
    },
  });
}

/** Multiple prior CRM closings — pattern only, WEAK tier. */
export function buildLikelyRepeatSeller(input: PropertyEnrichmentInput): SellerTimingSignal | null {
  const count = input.priorTransactionCount;
  if (typeof count !== "number" || count < 2) return null;

  const prov = input.property.provenance;
  return baseSignal("likely_repeat_seller", input, {
    observedAt: prov.observedAt,
    recordId: `crm-prior-tx:${count}`,
    source: "crm:hubspot",
    confidence: "WEAK",
    evidenceUrl: null,
    evidenceLabel: "Repeat client history",
    explanation: `${count} prior closed transactions on file with this contact.`,
    evidence: { priorTransactionCount: count },
  });
}

/** Mortgage satisfaction / release recorded on the parcel. */
export function buildRefinancingActivity(input: PropertyEnrichmentInput): SellerTimingSignal | null {
  const releases = input.mortgageReleases;
  if (!releases?.length) return null;

  const latest = [...releases].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  )[0];
  if (!isIso8601(latest.observedAt)) return null;

  return baseSignal("refinancing_activity", input, {
    observedAt: latest.observedAt,
    recordId: latest.recordId,
    source: "county_recorder:king_wa",
    confidence: "HIGH",
    evidenceUrl: latest.evidenceUrl ?? null,
    evidenceLabel: "Mortgage release",
    explanation: `Mortgage satisfaction or release recorded on ${latest.observedAt} (instrument ${latest.recordId}).`,
    evidence: { instrumentId: latest.recordId },
  });
}

/** Building permit issued for the normalized address. */
export function buildPermitActivity(input: PropertyEnrichmentInput): SellerTimingSignal | null {
  const permits = input.permits;
  if (!permits?.length) return null;

  const latest = [...permits].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  )[0];
  if (!isIso8601(latest.observedAt)) return null;

  return baseSignal("permit_activity", input, {
    observedAt: latest.observedAt,
    recordId: latest.recordId,
    source: "permit:shovels",
    confidence: "HIGH",
    evidenceUrl: latest.evidenceUrl ?? null,
    evidenceLabel: "Permit issued",
    explanation: `Building permit issued on ${latest.observedAt} (permit ${latest.recordId}).`,
    evidence: { permitId: latest.recordId },
  });
}

/** Documented nearby transfers exceed threshold in lookback window. */
export function buildNeighborhoodTurnover(input: PropertyEnrichmentInput): SellerTimingSignal | null {
  const nb = input.neighborhoodTransfers;
  if (!nb || !isIso8601(nb.observedAt) || nb.count < 3) return null;

  return baseSignal("neighborhood_turnover", input, {
    observedAt: nb.observedAt,
    recordId: nb.recordId,
    source: "county_recorder:king_wa",
    confidence: "MED",
    evidenceUrl: nb.evidenceUrl ?? null,
    evidenceLabel: "Neighborhood transfer activity",
    explanation: `${nb.count} parcel transfers within ${nb.windowDays} days near this address (as of ${nb.observedAt}).`,
    evidence: {
      transferCount: nb.count,
      windowDays: nb.windowDays,
    },
  });
}

/** Assessor-documented value increase — both values required. */
export function buildEquityGrowthWindow(input: PropertyEnrichmentInput): SellerTimingSignal | null {
  const change = input.assessedValueChange;
  if (!change || !isIso8601(change.observedAt)) return null;
  if (change.currentValue <= change.priorValue) return null;

  const pct = Math.round(
    ((change.currentValue - change.priorValue) / change.priorValue) * 100,
  );
  if (pct < 15) return null;

  return baseSignal("equity_growth_window", input, {
    observedAt: change.observedAt,
    recordId: change.recordId,
    source: change.source,
    confidence: "MED",
    evidenceUrl: change.evidenceUrl ?? null,
    evidenceLabel: "Assessed value change",
    explanation: `Assessed value increased ${pct}% between recorded assessments (observed ${change.observedAt}).`,
    evidence: {
      priorValue: change.priorValue,
      currentValue: change.currentValue,
      percentChange: pct,
    },
  });
}

/**
 * Long ownership + smaller-unit property type on file — timing context only.
 * Does not assert intent to sell or downsize.
 */
export function buildDownsizingIndicator(
  input: PropertyEnrichmentInput,
  nowIso: string,
): SellerTimingSignal | null {
  const ownership = input.ownership;
  if (!ownership?.ownershipStartDate || !isIso8601(ownership.ownershipStartDate)) return null;

  const years = ownership.ownershipDurationYears ?? yearsBetween(ownership.ownershipStartDate, nowIso);
  if (years === null || years < 15) return null;

  const type = ownership.estimatedPropertyType;
  if (type !== "single_family" && type !== "townhouse") return null;

  const prov = ownership.provenance;
  return baseSignal("downsizing_indicator", input, {
    observedAt: prov.observedAt,
    recordId: prov.recordId,
    source: prov.source,
    confidence: "WEAK",
    evidenceUrl: prov.evidenceUrl ?? null,
    evidenceLabel: "Ownership tenure pattern",
    explanation: `${Math.floor(years)} years on title with ${type.replace(/_/g, " ")} property type on record — tenure context only.`,
    evidence: {
      ownershipDurationYears: Math.floor(years),
      estimatedPropertyType: type,
    },
  });
}

/** CRM dormancy paired with verified property match on canonical key. */
export function buildStaleRelationshipPropertyMatch(
  input: PropertyEnrichmentInput,
  nowIso: string,
): SellerTimingSignal | null {
  const touch = input.staleRelationshipObservedAt;
  if (!touch || !isIso8601(touch)) return null;
  if (!input.property.propertyKey) return null;

  const days = Math.floor(
    (Date.parse(nowIso) - Date.parse(touch)) / (24 * 60 * 60 * 1000),
  );
  if (days < 180) return null;

  return baseSignal("stale_relationship_plus_property_match", input, {
    observedAt: touch,
    recordId: `property-match:${input.property.propertyKey}`,
    source: "crm:hubspot",
    confidence: "HIGH",
    evidenceUrl: null,
    evidenceLabel: "Stale relationship + property match",
    explanation: `No meaningful CRM touch since ${touch}; property address matches recorder-backed parcel.`,
    evidence: {
      propertyKey: input.property.propertyKey,
      daysSinceTouch: days,
      parcelId: input.property.parcelId,
    },
  });
}

/** Ownership duration as a first-class signal when start date is verified. */
export function buildOwnershipDuration(
  input: PropertyEnrichmentInput,
  nowIso: string,
): SellerTimingSignal | null {
  const ownership = input.ownership;
  if (!ownership?.ownershipStartDate || !isIso8601(ownership.ownershipStartDate)) return null;

  const years = ownership.ownershipDurationYears ?? yearsBetween(ownership.ownershipStartDate, nowIso);
  if (years === null || years < 1) return null;

  const prov = ownership.provenance;
  return baseSignal("ownership_duration", input, {
    observedAt: prov.observedAt,
    recordId: prov.recordId,
    source: prov.source,
    confidence: prov.confidence,
    evidenceUrl: prov.evidenceUrl ?? null,
    evidenceLabel: "Ownership duration",
    explanation: `Ownership duration ${Math.floor(years)} years from recorded start date ${ownership.ownershipStartDate}.`,
    evidence: {
      ownershipStartDate: ownership.ownershipStartDate,
      ownershipDurationYears: Math.floor(years * 10) / 10,
    },
  });
}

const BUILDERS: ((input: PropertyEnrichmentInput, nowIso: string) => SellerTimingSignal | null)[] = [
  (input, now) => buildLongTermOwner(input, now),
  (input, now) => buildOwnershipDuration(input, now),
  (input) => buildLikelyRepeatSeller(input),
  (input) => buildRefinancingActivity(input),
  (input) => buildPermitActivity(input),
  (input) => buildNeighborhoodTurnover(input),
  (input) => buildEquityGrowthWindow(input),
  (input, now) => buildDownsizingIndicator(input, now),
  (input, now) => buildStaleRelationshipPropertyMatch(input, now),
];

/** Run all builders; dedupe by kind, keep highest-confidence per kind. */
export function buildSellerTimingSignals(
  input: PropertyEnrichmentInput,
  nowIso: string,
): SellerTimingSignal[] {
  const byKind = new Map<SellerTimingSignalKind, SellerTimingSignal>();

  for (const run of BUILDERS) {
    const built = run(input, nowIso);
    if (!built) continue;
    const signal = built as SellerTimingSignal;
    const existing = byKind.get(signal.kind);
    if (!existing) {
      byKind.set(signal.kind, signal);
      continue;
    }
    const rank = { HIGH: 3, MED: 2, WEAK: 1 };
    if (rank[signal.confidence] > rank[existing.confidence]) {
      byKind.set(signal.kind, signal);
    }
  }

  return [...byKind.values()];
}
