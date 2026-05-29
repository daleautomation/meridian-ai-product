// Parse verified property-enrichment fields from CRM / batch CSV rows.
// Emits PropertyEnrichmentInput only when recorder-backed fields are present.

import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
  normalizeCityStateZip,
  type NormalizedAddress,
} from "@/lib/enrichment/address";
import type {
  EstimatedPropertyType,
  FieldProvenance,
  OwnershipRecord,
  PropertyEnrichmentInput,
  PropertyRecord,
} from "@/lib/enrichment/property/types";
import type { SignalConfidence } from "@/lib/recovery/signals/types";

type CsvRow = Record<string, string>;

function cell(row: CsvRow, ...headers: string[]): string {
  const norm = new Map(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), (v ?? "").trim()]),
  );
  for (const h of headers) {
    const v = norm.get(h.toLowerCase());
    if (v) return v;
  }
  return "";
}

function toIso8601(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseConfidence(value: string): SignalConfidence {
  const upper = value.trim().toUpperCase();
  if (upper === "HIGH" || upper === "MED" || upper === "WEAK") return upper;
  return "HIGH";
}

function parsePropertyType(value: string): EstimatedPropertyType {
  const norm = value.trim().toLowerCase().replace(/\s+/g, "_");
  const allowed: EstimatedPropertyType[] = [
    "single_family",
    "condo",
    "townhouse",
    "multi_family",
    "unknown",
  ];
  return allowed.includes(norm as EstimatedPropertyType)
    ? (norm as EstimatedPropertyType)
    : "unknown";
}

export function normalizedAddressFromRow(row: CsvRow): NormalizedAddress | null {
  const location = cell(row, "location", "address", "home address");
  if (location) {
    const addr = normalizeAddress(location);
    if (!detectWeakAddress(addr)) return addr;
  }

  const street = cell(row, "home street", "street", "address line 1");
  const city = cell(row, "home city", "city");
  const state = cell(row, "home state", "state");
  const zip = cell(row, "home postal code", "zip", "postal code");
  if (!street && !city) return null;

  const csz = normalizeCityStateZip({ city, state, postalCode: zip });
  const composed = [street, csz.city, csz.state, csz.postalCode].filter(Boolean).join(", ");
  const addr = normalizeAddress(composed);
  return detectWeakAddress(addr) ? null : addr;
}

function recorderProvenance(row: CsvRow): FieldProvenance | null {
  const observedAt = toIso8601(
    cell(
      row,
      "propertyOwnershipObservedAt",
      "property ownership observed at",
      "ownershipObservedAt",
    ),
  );
  const recordId = cell(
    row,
    "propertyOwnershipRecordId",
    "property ownership record id",
    "parcelId",
    "parcel id",
  );
  if (!observedAt || !recordId) return null;

  return {
    source: cell(row, "propertyOwnershipSource", "property ownership source") || "county_recorder:king_wa",
    recordId,
    observedAt,
    confidence: parseConfidence(
      cell(row, "propertyOwnershipConfidence", "property ownership confidence"),
    ),
    evidenceUrl: cell(row, "propertyOwnershipEvidenceUrl", "property ownership evidence url") || null,
    evidenceLabel: "County recorder ownership",
  };
}

/** Build enrichment input when at least ownership or permit/recorder evidence exists. */
export function parsePropertyEnrichmentFromRow(
  row: CsvRow,
  options?: { staleRelationshipObservedAt?: string | null; priorTransactionCount?: number | null },
): PropertyEnrichmentInput | null {
  const normalized = normalizedAddressFromRow(row);
  if (!normalized) return null;

  const propertyKey = canonicalPropertyKey(normalized);
  const prov = recorderProvenance(row);
  const parcelId = cell(row, "parcelId", "parcel id", "propertyParcelId", "property parcel id") || null;

  const ownershipStart = toIso8601(
    cell(row, "propertyOwnershipStartDate", "ownership start date", "ownershipStartDate"),
  );
  const lastTransfer = toIso8601(
    cell(row, "propertyLastTransferDate", "last transfer date", "lastTransferDate"),
  );

  const hasRecorderFacts =
    prov !== null ||
    Boolean(ownershipStart) ||
    Boolean(lastTransfer) ||
    Boolean(cell(row, "permitActivityRecordId", "permit record id")) ||
    Boolean(cell(row, "mortgageReleaseRecordId", "mortgage release record id"));

  if (!hasRecorderFacts) return null;

  const permitObservedForProv = toIso8601(
    cell(row, "permitActivityObservedAt", "permit observed at", "permitObservedAt"),
  );
  const anchorObservedAt = ownershipStart ?? lastTransfer ?? permitObservedForProv;
  if (!anchorObservedAt) return null;

  const propertyProv: FieldProvenance = prov ?? {
    source: permitObservedForProv ? "permit:shovels" : "county_recorder:king_wa",
    recordId:
      parcelId ??
      cell(row, "permitActivityRecordId", "permit record id") ??
      `parcel:${propertyKey}`,
    observedAt: anchorObservedAt,
    confidence: "HIGH",
    evidenceUrl: null,
    evidenceLabel: permitObservedForProv ? "Permit issued" : "Property parcel",
  };

  const property: PropertyRecord = {
    propertyKey,
    normalizedAddress: normalized,
    parcelId,
    provenance: propertyProv,
  };

  let ownership: OwnershipRecord | null = null;
  if (ownershipStart && prov) {
    const durationRaw = cell(row, "propertyOwnershipDurationYears", "ownership duration years");
    const durationParsed = durationRaw ? Number.parseFloat(durationRaw) : NaN;
    ownership = {
      propertyKey,
      ownerName: cell(row, "propertyOwnerName", "owner name") || null,
      ownershipStartDate: ownershipStart,
      ownershipDurationYears: Number.isFinite(durationParsed) ? durationParsed : null,
      lastTransferDate: lastTransfer,
      estimatedPropertyType: parsePropertyType(
        cell(row, "propertyType", "estimated property type"),
      ),
      estimatedOccupancy: "unknown",
      provenance: prov,
    };
  }

  const permits: NonNullable<PropertyEnrichmentInput["permits"]>[number][] = [];
  const permitRecordId = cell(row, "permitActivityRecordId", "permit record id", "permitRecordId");
  const permitObserved = toIso8601(
    cell(row, "permitActivityObservedAt", "permit observed at", "permitObservedAt"),
  );
  if (permitRecordId && permitObserved) {
    permits.push({
      recordId: permitRecordId,
      observedAt: permitObserved,
      evidenceUrl: cell(row, "permitActivityEvidenceUrl", "permit evidence url") || null,
    });
  }

  const mortgageReleases: NonNullable<PropertyEnrichmentInput["mortgageReleases"]>[number][] = [];
  const releaseId = cell(row, "mortgageReleaseRecordId", "mortgage release record id");
  const releaseObserved = toIso8601(
    cell(row, "mortgageReleaseObservedAt", "mortgage release observed at"),
  );
  if (releaseId && releaseObserved) {
    mortgageReleases.push({
      recordId: releaseId,
      observedAt: releaseObserved,
      evidenceUrl: cell(row, "mortgageReleaseEvidenceUrl", "mortgage release evidence url") || null,
    });
  }

  const nbCountRaw = cell(row, "neighborhoodTransferCount", "neighborhood transfer count");
  const nbCount = nbCountRaw ? Number.parseInt(nbCountRaw, 10) : NaN;
  const nbObserved = toIso8601(
    cell(row, "neighborhoodTransferObservedAt", "neighborhood transfer observed at"),
  );
  const neighborhoodTransfers =
    Number.isFinite(nbCount) && nbObserved
      ? {
          count: nbCount,
          windowDays: Number.parseInt(
            cell(row, "neighborhoodTransferWindowDays", "neighborhood window days") || "365",
            10,
          ),
          observedAt: nbObserved,
          recordId: cell(row, "neighborhoodTransferRecordId", "neighborhood transfer record id") || `nb:${propertyKey}`,
          evidenceUrl: null,
        }
      : null;

  const priorValueRaw = cell(row, "assessedValuePrior", "assessed value prior");
  const currentValueRaw = cell(row, "assessedValueCurrent", "assessed value current");
  const priorValue = priorValueRaw ? Number.parseFloat(priorValueRaw) : NaN;
  const currentValue = currentValueRaw ? Number.parseFloat(currentValueRaw) : NaN;
  const assessedObserved = toIso8601(cell(row, "assessedValueObservedAt", "assessed value observed at"));
  const assessedValueChange =
    Number.isFinite(priorValue) &&
    Number.isFinite(currentValue) &&
    assessedObserved
      ? {
          priorValue,
          currentValue,
          observedAt: assessedObserved,
          recordId: cell(row, "assessedValueRecordId", "assessed value record id") || `assess:${propertyKey}`,
          source: cell(row, "assessedValueSource", "assessed value source") || "tax_assessor:king_wa",
          evidenceUrl: null,
        }
      : null;

  const priorTxRaw = cell(row, "priorTransactionCount", "prior transaction count");
  const priorTransactionCount = options?.priorTransactionCount ?? (priorTxRaw ? Number.parseInt(priorTxRaw, 10) : null);

  return {
    property,
    ownership,
    permits: permits.length ? permits : undefined,
    mortgageReleases: mortgageReleases.length ? mortgageReleases : undefined,
    neighborhoodTransfers,
    assessedValueChange,
    priorTransactionCount: Number.isFinite(priorTransactionCount as number)
      ? (priorTransactionCount as number)
      : null,
    staleRelationshipObservedAt: options?.staleRelationshipObservedAt ?? null,
    priorClientClosedAt: toIso8601(cell(row, "priorClientClosedAt", "prior client closed at")),
  };
}
