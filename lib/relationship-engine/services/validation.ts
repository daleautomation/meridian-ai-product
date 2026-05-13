// Meridian Relationship Engine — service diagnostics helpers.

import type { ConfidenceLevel, IsoDateString } from "../primitives";
import type { RelationshipProjectionEvidencePointer, RelationshipProjectionMissingData } from "../projections/dto";
import type { RelationshipReadModelIssue, RelationshipReadModelValidationResult } from "../projections/operatorReadModels";
import type { RelationshipSummaryProjectionIssue, RelationshipSummaryProjectionValidationResult } from "../projections/dto";
import type {
  RelationshipPageCollector,
  RelationshipServiceIssue,
  RelationshipServiceReadResult,
  RelationshipServiceValidationResult,
} from "./types";

export const DEFAULT_SERVICE_PAGE_SIZE = 500;
export const DEFAULT_SERVICE_MAX_PAGES = 20;
export const DEFAULT_FOLLOW_UP_LOOKAHEAD_DAYS = 365;

export function serviceResult<T>(input: {
  data: T;
  generatedAt: IsoDateString;
  issues?: RelationshipServiceIssue[];
  warnings?: RelationshipServiceIssue[];
  confidence?: ConfidenceLevel;
  evidence?: RelationshipProjectionEvidencePointer[];
  missingDataEffects?: RelationshipProjectionMissingData[];
}): RelationshipServiceReadResult<T> {
  const issues = input.issues ?? [];
  const warnings = [...(input.warnings ?? []), ...issues.filter((issue) => issue.severity === "warning")];
  return {
    data: input.data,
    generatedAt: input.generatedAt,
    validation: validationResult(issues),
    warnings,
    confidence: input.confidence ?? "unknown",
    evidence: input.evidence ?? [],
    missingDataEffects: input.missingDataEffects ?? [],
  };
}

export function validationResult(issues: RelationshipServiceIssue[]): RelationshipServiceValidationResult {
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

export function serviceWarning(
  code: string,
  message: string,
  context: Partial<RelationshipServiceIssue> = {},
): RelationshipServiceIssue {
  return { severity: "warning", code, message, ...context };
}

export function serviceError(
  code: string,
  message: string,
  context: Partial<RelationshipServiceIssue> = {},
): RelationshipServiceIssue {
  return { severity: "error", code, message, ...context };
}

export function summaryValidationIssues(
  validation: RelationshipSummaryProjectionValidationResult,
): RelationshipServiceIssue[] {
  return validation.issues.map((issue: RelationshipSummaryProjectionIssue) => ({
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
  }));
}

export function readModelValidationIssues(
  validation: RelationshipReadModelValidationResult,
): RelationshipServiceIssue[] {
  return validation.issues.map((issue: RelationshipReadModelIssue) => ({
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    ...(issue.relationshipId ? { relationshipId: issue.relationshipId } : {}),
    ...(issue.timelineEventId ? { timelineEventId: issue.timelineEventId } : {}),
    ...(issue.queueKind ? { source: issue.queueKind } : {}),
  }));
}

export async function collectPages<TQuery extends { page?: { limit: number; cursor?: string } }, TItem>(
  collect: RelationshipPageCollector<TQuery, TItem>,
  baseQuery: Omit<TQuery, "page">,
  options: { page?: { limit: number; cursor?: string }; pageSize?: number; maxPages?: number } = {},
): Promise<TItem[]> {
  if (options.page) {
    return (await collect({ ...baseQuery, page: options.page } as TQuery)).items;
  }

  const pageSize = options.pageSize ?? DEFAULT_SERVICE_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_SERVICE_MAX_PAGES;
  const items: TItem[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await collect({ ...baseQuery, page: { limit: pageSize, ...(cursor ? { cursor } : {}) } } as TQuery);
    items.push(...page.items);
    if (!page.nextCursor) return items;
    cursor = page.nextCursor;
  }
  return items;
}

export function addDays(value: IsoDateString, days: number): IsoDateString {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed + days * 24 * 60 * 60 * 1000).toISOString() as IsoDateString;
}

export function combineServiceConfidence(values: ConfidenceLevel[]): ConfidenceLevel {
  if (values.length === 0) return "unknown";
  return values.reduce((lowest, value) => (
    confidenceRank(value) > confidenceRank(lowest) ? value : lowest
  ), "high");
}

function confidenceRank(value: ConfidenceLevel): number {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unknown":
      return 3;
  }
}
