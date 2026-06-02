// AE Job OS — email ingestion contract (Gmail + Claude parser, not wired yet).
//
// Future flow: Claude reads job-related Gmail → emits ParsedEmailJobEvent[]
// → POST /api/ae-jobs/ingest → applyIngestionEvents() merges into store.

import type { JobOpportunity, PipelineStage, RoleCategory } from "./types";

export const INGESTION_CONTRACT_VERSION = "ae-job-email-v1";

/** One parsed signal from a job-related email thread. */
export interface ParsedEmailJobEvent {
  contractVersion: typeof INGESTION_CONTRACT_VERSION;
  /** Stable idempotency key: message-id or thread-id + event type */
  eventId: string;
  receivedAt: string;
  from: string;
  subject: string;
  company: string;
  roleTitle?: string;
  roleCategory?: RoleCategory;
  stageHint?: PipelineStage;
  lastTouchpoint?: string;
  nextAction?: string;
  followUpDate?: string | null;
  notesExcerpt?: string;
  checklistUpdates?: Partial<Record<string, boolean>>;
  matchedOpportunityId?: string;
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

/**
 * Merge parsed email events into opportunities. Idempotent on eventId.
 * Not called in production until Gmail/Claude pipeline exists.
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
  const byCompany = new Map(
    opportunities.map((o) => [o.company.toLowerCase(), o]),
  );

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
        stage: event.stageHint ?? "applied",
        lastTouchpoint: event.lastTouchpoint ?? event.receivedAt.slice(0, 10),
        nextAction: event.nextAction ?? "Review parsed email and confirm stage",
        followUpDate: event.followUpDate ?? null,
        priority: "medium",
        notes: event.notesExcerpt ?? `Ingested from: ${event.subject}`,
        checklist: {
          resume_tailored: false,
          applied: false,
          recruiter_contacted: false,
          follow_up_sent: false,
          interview_scheduled: false,
          case_study_required: false,
          case_study_drafted: false,
          loom_recorded: false,
          thank_you_sent: false,
        },
        updatedAt: batch.ingestedAt,
        source: "email_ingestion",
      };
      opportunities = [...opportunities, opp];
      byId.set(opp.id, opp);
      byCompany.set(opp.company.toLowerCase(), opp);
      result.created += 1;
    } else {
      if (event.roleTitle) opp.roleTitle = event.roleTitle;
      if (event.roleCategory) opp.roleCategory = event.roleCategory;
      if (event.stageHint) opp.stage = event.stageHint;
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
      result.updated += 1;
    }
    result.applied += 1;
  }

  return { opportunities, result };
}
