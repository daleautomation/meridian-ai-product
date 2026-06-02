// AE Job OS — email ingestion contract (Gmail + Claude parser, manual/demo mode).
//
// Flow: Claude reads job-related Gmail → emits ParsedEmailJobEvent[]
// → POST /api/ae-jobs/ingest → applyIngestionEvents() merges into store.

import { emptyChecklist } from "./labels";
import type { ChecklistKey, JobOpportunity, PipelineStage, RoleCategory } from "./types";
import { CHECKLIST_KEYS } from "./types";

export const INGESTION_CONTRACT_VERSION = "ae-job-email-v1";

export const INGESTION_STATUS_MESSAGE =
  "Gmail/Claude ingestion contract ready, manual/demo mode";

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
  /** Optional excerpt or full note from the parser. */
  notes?: string;
  notesExcerpt?: string;
  checklistUpdates?: Partial<Record<ChecklistKey, boolean>>;
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
  /** Events handled this batch (updated + unmatched), excluding skipped duplicates. */
  processed: number;
  skipped: number;
  updated: number;
  unmatched: number;
  errors: string[];
}

function normalizeCompany(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRoleTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

function resolveNotes(event: ParsedEmailJobEvent): string | undefined {
  const note = event.notes ?? event.notesExcerpt;
  return note?.trim() || undefined;
}

function clampConfidence(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function applyChecklistUpdates(
  opp: JobOpportunity,
  updates: Partial<Record<string, boolean>> | undefined,
): void {
  if (!updates) return;
  for (const key of CHECKLIST_KEYS) {
    const value = updates[key];
    if (typeof value === "boolean") {
      opp.checklist[key] = value;
    }
  }
}

function appendNotes(existing: string, incoming: string): string {
  const trimmed = incoming.trim();
  if (!trimmed) return existing;
  return existing.trim() ? `${existing.trim()}\n—\n${trimmed}` : trimmed;
}

/** Match an existing opportunity: id → company+role → unique company fallback. */
export function findMatchingOpportunity(
  opportunities: JobOpportunity[],
  event: ParsedEmailJobEvent,
): JobOpportunity | null {
  const byId = new Map(opportunities.map((o) => [o.id, o]));

  if (event.matchedOpportunityId) {
    const byExplicit = byId.get(event.matchedOpportunityId);
    if (byExplicit) return byExplicit;
  }

  const companyNorm = normalizeCompany(event.company);
  if (!companyNorm) return null;

  const roleNorm = event.roleTitle ? normalizeRoleTitle(event.roleTitle) : null;
  const companyMatches = opportunities.filter(
    (o) => normalizeCompany(o.company) === companyNorm,
  );

  if (roleNorm) {
    const exactRole = companyMatches.find(
      (o) => normalizeRoleTitle(o.roleTitle) === roleNorm,
    );
    if (exactRole) return exactRole;
  }

  if (companyMatches.length === 1) {
    return companyMatches[0];
  }

  return null;
}

function mergeEventIntoOpportunity(
  opp: JobOpportunity,
  event: ParsedEmailJobEvent,
  batch: IngestionBatch,
): void {
  const sourceSender = resolveSender(event);
  const sourceEmailSubject = resolveSubject(event);
  const stage = resolveStage(event);
  const confidence = clampConfidence(event.confidence);
  const notes = resolveNotes(event);

  if (event.roleTitle) opp.roleTitle = event.roleTitle;
  if (event.roleCategory) opp.roleCategory = event.roleCategory;
  opp.stage = stage;
  if (event.lastTouchpoint) opp.lastTouchpoint = event.lastTouchpoint;
  if (event.nextAction) opp.nextAction = event.nextAction;
  if (event.followUpDate !== undefined) opp.followUpDate = event.followUpDate;
  if (notes) opp.notes = appendNotes(opp.notes, notes);
  applyChecklistUpdates(opp, event.checklistUpdates);
  opp.updatedAt = batch.ingestedAt;
  opp.source = "email_ingestion";
  opp.sourceEmailSubject = sourceEmailSubject;
  opp.sourceSender = sourceSender;
  opp.confidence = confidence;
  if (event.waitingOnReply !== undefined) opp.waitingOnReply = event.waitingOnReply;
  if (event.prepRequired !== undefined) opp.prepRequired = event.prepRequired;
}

/**
 * Merge parsed email events into existing opportunities. Idempotent on eventId.
 * Unmatched events are counted but do not create new opportunities in v1.
 */
export function applyIngestionEvents(
  opportunities: JobOpportunity[],
  batch: IngestionBatch,
  seenEventIds: Set<string>,
): { opportunities: JobOpportunity[]; result: IngestionApplyResult } {
  const result: IngestionApplyResult = {
    processed: 0,
    skipped: 0,
    updated: 0,
    unmatched: 0,
    errors: [],
  };

  let nextOpportunities = [...opportunities];

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

    const match = findMatchingOpportunity(nextOpportunities, event);
    if (!match) {
      result.unmatched += 1;
      result.processed += 1;
      result.errors.push(`No match for ${event.company}${event.roleTitle ? ` / ${event.roleTitle}` : ""}`);
      continue;
    }

    const idx = nextOpportunities.findIndex((o) => o.id === match.id);
    if (idx < 0) {
      result.unmatched += 1;
      result.processed += 1;
      continue;
    }

    const updated = { ...nextOpportunities[idx], checklist: { ...nextOpportunities[idx].checklist } };
    mergeEventIntoOpportunity(updated, event, batch);
    nextOpportunities[idx] = updated;
    result.updated += 1;
    result.processed += 1;
  }

  return { opportunities: nextOpportunities, result };
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Sample parsed events for local demo / contract testing. */
export function buildDemoIngestionBatch(ingestedAt = new Date().toISOString()): IngestionBatch {
  return {
    parsedBy: "claude-gmail",
    ingestedAt,
    events: [
      {
        contractVersion: INGESTION_CONTRACT_VERSION,
        eventId: "demo-clipboard-case-study-001",
        receivedAt: ingestedAt,
        sourceSender: "recruiter@clipboard.com",
        sourceEmailSubject: "Re: Territory AE — case study next steps",
        company: "Clipboard",
        roleTitle: "Territory Account Executive",
        roleCategory: "account_executive",
        stage: "case_study",
        lastTouchpoint: daysAgo(0),
        nextAction: "Record and submit Loom case study (recruiter confirmed deadline)",
        followUpDate: daysFromNow(1),
        confidence: 0.94,
        prepRequired: true,
        notes: "Recruiter confirmed Loom is the next gate before panel review.",
        checklistUpdates: { case_study_required: true, loom_recorded: false },
      },
      {
        contractVersion: INGESTION_CONTRACT_VERSION,
        eventId: "demo-safetyculture-outreach-001",
        receivedAt: ingestedAt,
        sourceSender: "hiring@partners.safetyculture.com",
        sourceEmailSubject: "Partner Account Manager — follow-up on your outreach",
        company: "SafetyCulture",
        roleTitle: "Partner Account Manager",
        roleCategory: "partner_account_manager",
        stage: "prospecting",
        lastTouchpoint: daysAgo(0),
        nextAction: "Reply with partner ecosystem research and schedule intro call",
        followUpDate: daysFromNow(2),
        confidence: 0.88,
        prepRequired: true,
        waitingOnReply: false,
        notes: "They acknowledged outreach and asked for a short partner-motion summary.",
        checklistUpdates: { resume_tailored: true },
      },
      {
        contractVersion: INGESTION_CONTRACT_VERSION,
        eventId: "demo-ronco-waiting-reply-001",
        receivedAt: ingestedAt,
        sourceSender: "rachel@ronco.com",
        sourceEmailSubject: "Re: Project Engineer referral — checking in",
        company: "Ronco",
        roleTitle: "Project Engineer",
        roleCategory: "other",
        stage: "on_hold",
        lastTouchpoint: daysAgo(0),
        nextAction: "Wait for Rachel / operations response on referral",
        followUpDate: daysFromNow(5),
        confidence: 0.81,
        waitingOnReply: true,
        prepRequired: false,
        notes: "Rachel said ops is reviewing the referral; no interview scheduled yet.",
        checklistUpdates: { recruiter_contacted: true },
      },
    ],
  };
}

/** @deprecated use buildDemoIngestionBatch */
export const INGESTION_EXAMPLE_BATCH: IngestionBatch = buildDemoIngestionBatch();
