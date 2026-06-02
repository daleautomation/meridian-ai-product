// AE Job OS — email ingestion contract (Gmail + Claude parser, not wired yet).
//
// Future flow: Claude reads job-related Gmail → emits ParsedEmailJobEvent[]
// → POST /api/ae-jobs/ingest → applyIngestionEvents() merges into store.

import { emptyChecklist } from "./labels";
import type { JobOpportunity, PipelineStage, RoleCategory } from "./types";

export const INGESTION_CONTRACT_VERSION = "ae-job-email-v1";

/** One parsed signal from a job-related email thread. */
export interface ParsedEmailJobEvent {
  contractVersion: typeof INGESTION_CONTRACT_VERSION;
  /** Stable idempotency key: message-id or thread-id + event type */
  eventId: string;
  receivedAt: string;
  /** Sender address or display name from the source email. */
  sourceSender: string;
  /** Subject line from the source email. */
  sourceEmailSubject: string;
  company: string;
  roleTitle: string;
  roleCategory: RoleCategory;
  stage: PipelineStage;
  lastTouchpoint: string;
  nextAction: string;
  followUpDate?: string | null;
  /** Parser confidence 0–1. */
  confidence: number;
  notesExcerpt?: string;
  checklistUpdates?: Partial<Record<string, boolean>>;
  matchedOpportunityId?: string;
  waitingOnReply?: boolean;
  prepRequired?: boolean;
  /** @deprecated use sourceSender */
  from?: string;
  /** @deprecated use sourceEmailSubject */
  subject?: string;
  /** @deprecated use stage */
  stageHint?: PipelineStage;
}

export interface IngestionBatch {
  events: ParsedEmailJobEvent[];
  parsedBy: "claude-gmail" | "manual-import";
  ingestedAt: string;
}

export interface IngestionApplyResult {
  applied: number;
  skipped: number;
  created: number;
  updated: number;
  errors: string[];
}

function resolveSender(event: ParsedEmailJobEvent): string {
  return event.sourceSender || event.from || "unknown";
}

function resolveSubject(event: ParsedEmailJobEvent): string {
  return event.sourceEmailSubject || event.subject || "(no subject)";
}

function resolveStage(event: ParsedEmailJobEvent): PipelineStage {
  return event.stage ?? event.stageHint ?? "applied";
}

function clampConfidence(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Merge parsed email events into opportunities. Idempotent on eventId.
 * Gmail/Claude pipeline is not connected — this is the merge contract only.
 */
export function applyIngestionEvents(
  opportunities: JobOpportunity[],
  batch: IngestionBatch,
  seenEventIds: Set<string>,
): { opportunities: JobOpportunity[]; result: IngestionApplyResult } {
  const result: IngestionApplyResult = {
    applied: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  const byId = new Map(opportunities.map((o) => [o.id, o]));
  const byCompany = new Map(opportunities.map((o) => [o.company.toLowerCase(), o]));

  for (const event of batch.events) {
    if (event.contractVersion !== INGESTION_CONTRACT_VERSION) {
      result.errors.push(`Unsupported contract: ${event.contractVersion}`);
      continue;
    }
    if (seenEventIds.has(event.eventId)) {
      result.skipped += 1;
      continue;
    }
    seenEventIds.add(event.eventId);

    const sourceSender = resolveSender(event);
    const sourceEmailSubject = resolveSubject(event);
    const stage = resolveStage(event);
    const confidence = clampConfidence(event.confidence);

    let opp =
      (event.matchedOpportunityId ? byId.get(event.matchedOpportunityId) : null) ??
      byCompany.get(event.company.toLowerCase()) ??
      null;

    if (!opp) {
      opp = {
        id: `opp-ingest-${event.eventId.slice(0, 12)}`,
        company: event.company,
        roleTitle: event.roleTitle ?? "Role TBD",
        roleCategory: event.roleCategory ?? "other",
        stage,
        lastTouchpoint: event.lastTouchpoint ?? event.receivedAt.slice(0, 10),
        nextAction: event.nextAction ?? "Review parsed email and confirm stage",
        followUpDate: event.followUpDate ?? null,
        priority: "medium",
        notes: event.notesExcerpt ?? `Ingested from: ${sourceEmailSubject}`,
        checklist: { ...emptyChecklist(), ...(event.checklistUpdates ?? {}) },
        updatedAt: batch.ingestedAt,
        source: "email_ingestion",
        sourceEmailSubject,
        sourceSender,
        confidence,
        waitingOnReply: event.waitingOnReply,
        prepRequired: event.prepRequired,
      };
      opportunities = [...opportunities, opp];
      byId.set(opp.id, opp);
      byCompany.set(opp.company.toLowerCase(), opp);
      result.created += 1;
    } else {
      if (event.roleTitle) opp.roleTitle = event.roleTitle;
      if (event.roleCategory) opp.roleCategory = event.roleCategory;
      opp.stage = stage;
      if (event.lastTouchpoint) opp.lastTouchpoint = event.lastTouchpoint;
      if (event.nextAction) opp.nextAction = event.nextAction;
      if (event.followUpDate !== undefined) opp.followUpDate = event.followUpDate;
      if (event.notesExcerpt) {
        opp.notes = opp.notes ? `${opp.notes}\n—\n${event.notesExcerpt}` : event.notesExcerpt;
      }
      if (event.checklistUpdates) {
        for (const [key, value] of Object.entries(event.checklistUpdates)) {
          if (key in opp.checklist && typeof value === "boolean") {
            (opp.checklist as Record<string, boolean>)[key] = value;
          }
        }
      }
      opp.updatedAt = batch.ingestedAt;
      opp.source = "email_ingestion";
      opp.sourceEmailSubject = sourceEmailSubject;
      opp.sourceSender = sourceSender;
      opp.confidence = confidence;
      if (event.waitingOnReply !== undefined) opp.waitingOnReply = event.waitingOnReply;
      if (event.prepRequired !== undefined) opp.prepRequired = event.prepRequired;
      result.updated += 1;
    }
    result.applied += 1;
  }

  return { opportunities, result };
}

/** Example payload for Claude/Gmail integration testing. */
export const INGESTION_EXAMPLE_BATCH: IngestionBatch = {
  parsedBy: "claude-gmail",
  ingestedAt: new Date().toISOString(),
  events: [
    {
      contractVersion: INGESTION_CONTRACT_VERSION,
      eventId: "example-msg-001",
      receivedAt: new Date().toISOString(),
      sourceSender: "recruiter@clipboard.com",
      sourceEmailSubject: "Re: Territory AE — case study next steps",
      company: "Clipboard",
      roleTitle: "Territory Account Executive",
      roleCategory: "account_executive",
      stage: "case_study",
      lastTouchpoint: new Date().toISOString().slice(0, 10),
      nextAction: "Record and submit Loom case study",
      followUpDate: new Date().toISOString().slice(0, 10),
      confidence: 0.92,
      prepRequired: true,
      checklistUpdates: { case_study_required: true, loom_recorded: false },
      matchedOpportunityId: "opp-clipboard-ae",
    },
  ],
};
