import crypto from "node:crypto";
import { isTerminalStatusValue } from "@/lib/crm/statusTaxonomy";
import type { ExecutionOutcomeStatus } from "./executionOutcome";
import type {
  DurableExecutionOutcome,
  DurableOutcomeInput,
  DurableOutcomeStatus,
  ExecutionOutcomeMapValue,
} from "./serverOutcomeStore";

export const VALID_OUTCOMES: DurableOutcomeStatus[] = [
  "Not Contacted",
  "Called",
  "Interested",
  "Follow Up",
  "Qualified",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
  "Not Qualified",
];

export function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isDurableOutcomeStatusValue(value: unknown): value is ExecutionOutcomeStatus {
  return typeof value === "string" && VALID_OUTCOMES.includes(value as DurableOutcomeStatus);
}

export function deriveIdempotencyKey(input: DurableOutcomeInput): string {
  return clean(input.idempotencyKey)
    ?? `${input.workspace}:${clean(input.taskId) ?? clean(input.leadId) ?? crypto.randomUUID()}:${input.outcomeStatus}:${clean(input.occurredAt) ?? ""}`;
}

export function unscopedIdentityKeys(input: {
  companyKey?: string | null;
  crmKey?: string | null;
  leadId?: string | null;
  taskId?: string | null;
}): string[] {
  return Array.from(new Set([
    clean(input.taskId),
    clean(input.leadId),
    clean(input.companyKey),
    clean(input.crmKey),
    clean(input.leadId) ? `lead-${clean(input.leadId)}-call` : null,
    clean(input.leadId) ? `lead-${clean(input.leadId)}-followup` : null,
  ].filter((key): key is string => !!key)));
}

export function scopedIdentityKeys(input: {
  workspace: string;
  companyKey?: string | null;
  crmKey?: string | null;
  leadId?: string | null;
  taskId?: string | null;
}): string[] {
  return unscopedIdentityKeys(input).map((key) => `${input.workspace}:${key}`);
}

export function crmStatusForOutcome(status: DurableOutcomeStatus): string | null {
  switch (status) {
    case "Called":
      return "CONTACTED";
    case "Interested":
    case "Follow Up":
      return "FOLLOW_UP";
    case "Proposal Sent":
    case "Qualified":
      return "QUALIFIED";
    case "Closed Won":
      return "CLOSED_WON";
    case "Closed Lost":
      return "CLOSED_LOST";
    case "Not Qualified":
      return "NOT_QUALIFIED";
    case "Not Contacted":
    default:
      return null;
  }
}

export function isTerminalDurableOutcomeStatusValue(status: string | null | undefined): boolean {
  return status === "Closed Won" || status === "Closed Lost" || status === "Not Qualified";
}

export function isTerminalDurableOutcome(record: DurableExecutionOutcome): boolean {
  return isTerminalDurableOutcomeStatusValue(record.outcomeStatus)
    || isTerminalStatusValue(crmStatusForOutcome(record.outcomeStatus));
}

export function outcomeMapValue(record: DurableExecutionOutcome): ExecutionOutcomeMapValue {
  return {
    status: record.outcomeStatus,
    contacted: record.outcomeStatus !== "Not Contacted",
    interested: ["Interested", "Qualified", "Proposal Sent", "Closed Won"].includes(record.outcomeStatus),
    followupNeeded: record.outcomeStatus === "Follow Up",
    nextFollowupDate: record.nextActionDate,
    notes: typeof record.metadata.notes === "string" ? record.metadata.notes : "",
    estimatedValue: record.estimatedValue,
    lastActionAt: record.occurredAt,
    attributionSource: "Meridian",
  };
}

export function unscopedKey(workspace: string, key: string): string {
  return key.startsWith(`${workspace}:`) ? key.slice(workspace.length + 1) : key;
}
