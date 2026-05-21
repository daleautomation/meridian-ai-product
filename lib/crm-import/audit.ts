// CRM import audit — compare persisted contacts against import job rows / optional CSV.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "@/lib/ingestion/csvParser";
import { detectColumnMapping, normalizeCrmRows } from "@/lib/crm-import/normalize";
import {
  buildContactScoreTransparency,
  buildRecommendationExplanation,
  contactMethodActionability,
  deriveEnrichmentStatus,
  effectivePriorityScore,
  isGenericRecommendation,
  type ContactScoreTransparency,
} from "@/lib/crm-import/scoreTransparency";
import { contactHasReachableEmail, contactHasReachablePhone } from "@/lib/crm-import/reachability";
import { CRM_IMPORT_JOBS_PATH } from "@/lib/crm-import/storageConfig";
import { getImportJob, listContactsByWorkspace } from "@/lib/crm-import/store";
import type { CrmContactRecord, CrmImportJob, NormalizedCrmContact } from "@/lib/crm-import/types";
import { computeRelationshipScore } from "@/lib/relationship-intelligence/scoring";

export type CrmImportAuditWarning = {
  code: string;
  message: string;
  contactId?: string;
  contactName?: string;
};

export type CrmImportAuditReport = {
  workspaceId: string;
  generatedAt: string;
  jobId: string | null;
  sourceLabel: string | null;
  csvRowCount: number | null;
  persistedContactCount: number;
  importedFromJobCount: number;
  withEmail: number;
  withPhone: number;
  withLastActivity: number;
  withNotesOrHistory: number;
  weakIdentity: number;
  defaultOrBaselineScores: number;
  missingEmail: number;
  missingPhone: number;
  duplicateRowsInSource: number;
  droppedFields: string[];
  parsing: {
    nameMapped: boolean;
    emailMapped: boolean;
    phoneMapped: boolean;
    companyMapped: boolean;
    lastActivityMapped: boolean;
    tagsMapped: boolean;
    notesMapped: boolean;
  };
  fieldAccuracy: {
    nameMismatches: number;
    emailMismatches: number;
    phoneMismatches: number;
    companyMismatches: number;
  };
  topPriority: Array<{
    rank: number;
    contactId: string;
    name: string;
    score: number;
    effectiveScore: number;
    scoreLabel: string;
    reasonCodes: string[];
    provenance: string;
    enrichmentStatus: string;
    verificationTier: string;
    dataQualityTier: string;
  }>;
  auditCounts: {
    overPrioritized: number;
    unsupportedRecommendations: number;
    lowConfidenceContactMethods: number;
    missingProvenance: number;
  };
  warnings: CrmImportAuditWarning[];
};

export type CrmImportAuditOptions = {
  workspaceId: string;
  csvPath?: string;
  jobId?: string;
};

export async function runCrmImportAudit(opts: CrmImportAuditOptions): Promise<CrmImportAuditReport> {
  const contacts = await listContactsByWorkspace(opts.workspaceId);
  const job = await resolveAuditJob(opts);
  const sourceRows = await resolveSourceRows(job, opts.csvPath);
  const warnings: CrmImportAuditWarning[] = [];

  const parsing = job
    ? {
        nameMapped: Boolean(job.columnMapping.name),
        emailMapped: Boolean(job.columnMapping.email),
        phoneMapped: Boolean(job.columnMapping.phone),
        companyMapped: Boolean(job.columnMapping.company),
        lastActivityMapped: Boolean(job.columnMapping.lastInteraction),
        tagsMapped: Boolean(job.columnMapping.tags),
        notesMapped: Boolean(job.columnMapping.notes),
      }
    : {
        nameMapped: false,
        emailMapped: false,
        phoneMapped: false,
        companyMapped: false,
        lastActivityMapped: false,
        tagsMapped: false,
        notesMapped: false,
      };

  let nameMismatches = 0;
  let emailMismatches = 0;
  let phoneMismatches = 0;
  let companyMismatches = 0;

  if (sourceRows.length > 0) {
    const byEmail = indexByNormalizedEmail(contacts);
    const byNameCompany = indexByNameCompany(contacts);
    for (const row of sourceRows) {
      const match =
        (row.normalizedEmail && byEmail.get(row.normalizedEmail))
        ?? byNameCompany.get(`${row.normalizedName ?? row.name}|${row.normalizedCompany ?? row.company}`);
      if (!match) {
        warnings.push({
          code: "SOURCE_ROW_NOT_PERSISTED",
          message: `CSV row ${row.rowIndex + 1} (${row.name}) has no matching persisted contact`,
        });
        continue;
      }
      if (row.name && match.name && row.name.trim().toLowerCase() !== match.name.trim().toLowerCase()) {
        nameMismatches += 1;
      }
      if (row.normalizedEmail && match.normalizedEmail && row.normalizedEmail !== match.normalizedEmail) {
        emailMismatches += 1;
      }
      if (row.normalizedPhone && match.normalizedPhone && row.normalizedPhone !== match.normalizedPhone) {
        phoneMismatches += 1;
      }
      if (
        row.normalizedCompany
        && match.normalizedCompany
        && row.normalizedCompany !== match.normalizedCompany
      ) {
        companyMismatches += 1;
      }
    }
  }

  if (sourceRows.length > 0 && contacts.length !== sourceRows.length) {
    warnings.push({
      code: "ROW_COUNT_MISMATCH",
      message: `Source rows (${sourceRows.length}) vs persisted contacts (${contacts.length}) — duplicates skipped or prior imports merged`,
    });
  }

  const duplicateRowsInSource = countDuplicateSourceRows(sourceRows);
  const droppedFields = detectDroppedFields(job, sourceRows);

  let withEmail = 0;
  let withPhone = 0;
  let withLastActivity = 0;
  let withNotesOrHistory = 0;
  let weakIdentity = 0;
  let defaultOrBaselineScores = 0;
  let missingEmail = 0;
  let missingPhone = 0;
  let importedFromJobCount = 0;
  let overPrioritized = 0;
  let unsupportedRecommendations = 0;
  let lowConfidenceContactMethods = 0;
  let missingProvenance = 0;

  const scored: Array<{ contact: CrmContactRecord; transparency: ContactScoreTransparency; effectiveScore: number }> = [];

  for (const contact of contacts) {
    if (contact.importJobId) importedFromJobCount += 1;
    if (contactHasReachableEmail(contact)) withEmail += 1;
    else missingEmail += 1;
    if (contactHasReachablePhone(contact)) withPhone += 1;
    else missingPhone += 1;
    if (contact.lastInteractionAt) withLastActivity += 1;
    if (contact.notes?.trim() || contact.tags.length > 0) withNotesOrHistory += 1;

    const transparency = buildContactScoreTransparency(contact);
    const effectiveScore = effectivePriorityScore(contact);
    scored.push({ contact, transparency, effectiveScore });

    if (!contact.scoreMetadata?.provenance) {
      missingProvenance += 1;
      warnings.push({
        code: "MISSING_PROVENANCE_METADATA",
        message: "Contact has no score provenance metadata",
        contactId: contact.id,
        contactName: contact.name,
      });
    }

    const methods = contactMethodActionability(contact, transparency);
    if (
      (contact.phone && !methods.phone.actionable)
      || (contact.email && !methods.email.actionable)
    ) {
      lowConfidenceContactMethods += 1;
      warnings.push({
        code: "LOW_CONFIDENCE_CONTACT_METHOD",
        message: [
          methods.phone.reason,
          methods.email.reason,
        ].filter(Boolean).join(" · ") || "Contact method not actionable at current trust tier",
        contactId: contact.id,
        contactName: contact.name,
      });
    }

    if (deriveEnrichmentStatus(contact) === "needs_review") weakIdentity += 1;
    if (
      transparency.provenance === "default"
      || transparency.provenance === "inferred"
      || transparency.reasonCodes.includes("BASELINE_IMPORT_SCORE")
    ) {
      defaultOrBaselineScores += 1;
    }

    const recommendation = buildRecommendationExplanation(contact, transparency);
    if (
      isGenericRecommendation(buildGenericProbe(contact))
      || transparency.isGenericRecommendation
      || recommendation.evidence.length <= 1
    ) {
      unsupportedRecommendations += 1;
      warnings.push({
        code: "UNSUPPORTED_RECOMMENDATION",
        message: "Recommendation lacks evidence-backed enrichment or uses template copy",
        contactId: contact.id,
        contactName: contact.name,
      });
    }

    if (isGenericRecommendation(buildGenericProbe(contact))) {
      warnings.push({
        code: "GENERIC_RECOMMENDATION",
        message: "Follow-up copy is template-based, not evidence-backed enrichment",
        contactId: contact.id,
        contactName: contact.name,
      });
    }

    if (!transparency.isAuthoritative && transparency.value >= 80) {
      overPrioritized += 1;
      warnings.push({
        code: "OVER_PRIORITIZED_CONTACT",
        message: `Score ${transparency.value} ranks high but tier is ${transparency.verificationTier} (${transparency.scoreLabel}); effective ${effectiveScore}`,
        contactId: contact.id,
        contactName: contact.name,
      });
      warnings.push({
        code: "POSSIBLY_OVER_SCORED",
        message: `Score ${transparency.value} is high but provenance is ${transparency.provenance} (${transparency.scoreLabel})`,
        contactId: contact.id,
        contactName: contact.name,
      });
    }
  }

  scored.sort((a, b) => b.effectiveScore - a.effectiveScore);
  const topPriority = scored.slice(0, 10).map((entry, i) => ({
    rank: i + 1,
    contactId: entry.contact.id,
    name: entry.contact.name,
    score: entry.transparency.value,
    effectiveScore: entry.effectiveScore,
    scoreLabel: entry.transparency.scoreLabel,
    reasonCodes: entry.transparency.reasonCodes,
    provenance: entry.transparency.provenance,
    enrichmentStatus: entry.transparency.enrichmentStatus,
    verificationTier: entry.transparency.verificationTier,
    dataQualityTier: entry.transparency.dataQualityTier,
  }));

  return {
    workspaceId: opts.workspaceId,
    generatedAt: new Date().toISOString(),
    jobId: job?.id ?? null,
    sourceLabel: job?.sourceLabel ?? null,
    csvRowCount: sourceRows.length > 0 ? sourceRows.length : null,
    persistedContactCount: contacts.length,
    importedFromJobCount,
    withEmail,
    withPhone,
    withLastActivity,
    withNotesOrHistory,
    weakIdentity,
    defaultOrBaselineScores,
    missingEmail,
    missingPhone,
    duplicateRowsInSource,
    droppedFields,
    parsing,
    fieldAccuracy: {
      nameMismatches,
      emailMismatches,
      phoneMismatches,
      companyMismatches,
    },
    topPriority,
    auditCounts: {
      overPrioritized,
      unsupportedRecommendations,
      lowConfidenceContactMethods,
      missingProvenance,
    },
    warnings,
  };
}

function buildGenericProbe(contact: CrmContactRecord): string {
  const score = computeRelationshipScore({
    lastInteractionAt: contact.lastInteractionAt,
    tags: contact.tags,
    hasPhone: contactHasReachablePhone(contact),
    hasEmail: contactHasReachableEmail(contact),
    notesLength: contact.notes?.length ?? 0,
    dataTrust: contact.dataTrust,
  });
  return score.explanation;
}

async function resolveAuditJob(opts: CrmImportAuditOptions): Promise<CrmImportJob | null> {
  if (opts.jobId) return getImportJob(opts.jobId);
  try {
    const raw = await readFile(CRM_IMPORT_JOBS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { jobs?: CrmImportJob[] };
    const jobs = (parsed.jobs ?? []).filter((j) => j.workspaceId === opts.workspaceId);
    const completed = jobs
      .filter((j) => j.state === "completed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return completed[0] ?? jobs[0] ?? null;
  } catch {
    return null;
  }
}

async function resolveSourceRows(
  job: CrmImportJob | null,
  csvPath?: string,
): Promise<NormalizedCrmContact[]> {
  if (csvPath) {
    const text = await readFile(path.resolve(csvPath), "utf8");
    const parsed = parseCsv(text);
    const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
    const mapping = job?.columnMapping ?? detectColumnMapping(headers);
    return normalizeCrmRows(parsed, mapping, job?.sourceLabel ?? "audit_csv");
  }
  if (job?.normalizedRows?.length) return job.normalizedRows;
  if (job?.previewSample?.length) return job.previewSample;
  return [];
}

function indexByNormalizedEmail(contacts: CrmContactRecord[]): Map<string, CrmContactRecord> {
  const m = new Map<string, CrmContactRecord>();
  for (const c of contacts) {
    if (c.normalizedEmail) m.set(c.normalizedEmail, c);
  }
  return m;
}

function indexByNameCompany(contacts: CrmContactRecord[]): Map<string, CrmContactRecord> {
  const m = new Map<string, CrmContactRecord>();
  for (const c of contacts) {
    const key = `${(c.normalizedName ?? c.name).toLowerCase()}|${(c.normalizedCompany ?? c.company).toLowerCase()}`;
    m.set(key, c);
  }
  return m;
}

function countDuplicateSourceRows(rows: NormalizedCrmContact[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const row of rows) {
    const key = `${row.normalizedEmail ?? ""}|${row.normalizedPhone ?? ""}|${row.name}|${row.company}`;
    if (seen.has(key)) dupes += 1;
    else seen.add(key);
  }
  return dupes;
}

function detectDroppedFields(job: CrmImportJob | null, rows: NormalizedCrmContact[]): string[] {
  if (!job || rows.length === 0) return [];
  const dropped: string[] = [];
  const sample = rows[0];
  const mapped = new Set(Object.values(job.columnMapping).filter(Boolean));
  const headers = Array.isArray(job.headers) ? job.headers : [];
  for (const header of headers) {
    if (!mapped.has(header)) {
      const lower = header.toLowerCase();
      if (/phone|mobile|cell/.test(lower) && !job.columnMapping.phone) dropped.push(`unmapped phone-like: ${header}`);
      if (/email|e-mail/.test(lower) && !job.columnMapping.email) dropped.push(`unmapped email-like: ${header}`);
    }
  }
  if (!sample.address && job.columnMapping.address) dropped.push("address mapped but empty in sample");
  return [...new Set(dropped)];
}

export function formatCrmImportAuditReport(report: CrmImportAuditReport): string {
  const lines: string[] = [
    `CRM Import Audit — ${report.workspaceId}`,
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    `- Persisted contacts: ${report.persistedContactCount}`,
    `- Imported from job: ${report.importedFromJobCount}`,
    report.csvRowCount !== null ? `- Source CSV/job rows: ${report.csvRowCount}` : "- Source CSV/job rows: (no job or CSV provided)",
    `- With email: ${report.withEmail}`,
    `- With phone: ${report.withPhone}`,
    `- With last activity: ${report.withLastActivity}`,
    `- With notes/tags history: ${report.withNotesOrHistory}`,
    `- Weak identity: ${report.weakIdentity}`,
    `- Baseline/default scores: ${report.defaultOrBaselineScores}`,
    `- Over-prioritized (import-only high scores): ${report.auditCounts.overPrioritized}`,
    `- Unsupported recommendations: ${report.auditCounts.unsupportedRecommendations}`,
    `- Low-confidence contact methods: ${report.auditCounts.lowConfidenceContactMethods}`,
    `- Missing provenance metadata: ${report.auditCounts.missingProvenance}`,
    `- Missing email: ${report.missingEmail}`,
    `- Missing phone: ${report.missingPhone}`,
    `- Duplicate rows in source: ${report.duplicateRowsInSource}`,
    "",
    "## Parsing",
    `- Name mapped: ${report.parsing.nameMapped}`,
    `- Email mapped: ${report.parsing.emailMapped}`,
    `- Phone mapped: ${report.parsing.phoneMapped}`,
    `- Company mapped: ${report.parsing.companyMapped}`,
    `- Last activity mapped: ${report.parsing.lastActivityMapped}`,
    `- Tags mapped: ${report.parsing.tagsMapped}`,
    `- Notes mapped: ${report.parsing.notesMapped}`,
    "",
    "## Field accuracy (vs source)",
    `- Name mismatches: ${report.fieldAccuracy.nameMismatches}`,
    `- Email mismatches: ${report.fieldAccuracy.emailMismatches}`,
    `- Phone mismatches: ${report.fieldAccuracy.phoneMismatches}`,
    `- Company mismatches: ${report.fieldAccuracy.companyMismatches}`,
  ];

  if (report.droppedFields.length > 0) {
    lines.push("", "## Dropped / unmapped fields", ...report.droppedFields.map((d) => `- ${d}`));
  }

  lines.push("", "## Top 10 priority (trust-adjusted effective score)");
  for (const p of report.topPriority) {
    lines.push(
      `${p.rank}. ${p.name} — raw ${p.score}, effective ${p.effectiveScore} (${p.scoreLabel})`,
      `   [${p.verificationTier}, ${p.dataQualityTier}, ${p.provenance}, ${p.enrichmentStatus}]`,
      `   Reasons: ${p.reasonCodes.join(", ") || "(none)"}`,
    );
  }

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", ...report.warnings.slice(0, 50).map((w) => `- [${w.code}] ${w.message}${w.contactName ? ` (${w.contactName})` : ""}`));
    if (report.warnings.length > 50) {
      lines.push(`… and ${report.warnings.length - 50} more warnings`);
    }
  } else {
    lines.push("", "## Warnings", "- None");
  }

  return lines.join("\n");
}
