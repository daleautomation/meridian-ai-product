// Meridian — Normalized Lead shape.
//
// One ingestion-ready shape every future source must produce. The
// engine reads from this; the UI reads decision.* off this. Sources
// MUST emit evidence (label + value + source + confidence), not
// silently overwrite UI fields.
//
// Missing data stays undefined. Do not invent values. Do not write
// directly to UI-only fields. New buckets require new evidence.

import type { LeadDecision } from "@/lib/scoring/decision";
import type { LeadDiagnostics } from "@/lib/diagnostics/leadDiagnostics";
import type { SalesStrategy } from "@/lib/sales/salesStrategy";
import type { LaborTechScan } from "@/lib/scan/laborTechScan";
import type { ContactTrustEvidence } from "@/lib/contacts/types";

export type ModuleId =
  | "roofing"
  | "hvac"
  | "carpentry"
  | "painting"
  | "plumbing"
  | "electrical"
  | "remodeling";

export type SourceName =
  | "seed"
  | "google_places"
  | "site_scan"
  | "serp"
  | "storm_weather"
  | "yelp"
  | "bbb"
  | "hunter"
  | "manual";

export type SourceStatus =
  | "connected"
  | "not_connected"
  | "available"
  | "missing"
  | "stale"
  | "error";

export type EvidenceItem = {
  label: string;
  value?: string | number | boolean;
  source: SourceName;
  confidence: "high" | "medium" | "low";
};

export type LeadSignals = {
  hasWebsite?: boolean;
  websiteWeak?: boolean;
  reviewCount?: number;
  rating?: number;
  localVisibilityWeak?: boolean;
  recentActivity?: boolean;
  stormArea?: boolean;
  emergencyServiceGap?: boolean;
  portfolioMissing?: boolean;
};

export type LeadCrm = {
  status?: string;
  lastAction?: string;
  notes?: string;
};

/**
 * Verified-email enrichment status. Drives "No verified email yet"
 * UI hints + future Hunter / Apollo / Clay / scrape pipelines. Source
 * stays untouched until a real provider returns a verified address —
 * never invent emails.
 */
export type EmailEnrichmentStatus =
  | "not_searched"
  | "searching"
  | "verified"
  | "not_found"
  | "needs_manual_review";

export type EmailEnrichmentSource =
  | "hunter"
  | "apollo"
  | "clay"
  | "manual_upload"
  | "site_scrape"
  | "google_places"
  | "unknown";

export type NormalizedLead = {
  id: string;
  workspaceSlug: string;
  moduleId: ModuleId;
  companyName: string;
  location?: string;
  website?: string;
  phone?: string;
  email?: string;
  /**
   * Email enrichment metadata. Present even when no verified email has
   * been found — `emailStatus` always carries one of the documented
   * states so the UI can render "No verified email yet" honestly.
   */
  emailStatus?: EmailEnrichmentStatus;
  verifiedEmail?: string;
  emailSource?: EmailEnrichmentSource;
  emailVerifiedAt?: string;
  emailConfidence?: "high" | "medium" | "low";
  phoneTrust?: ContactTrustEvidence;
  emailTrust?: ContactTrustEvidence;
  contactTrust?: ContactTrustEvidence;
  source: SourceName;
  sourceStatus: SourceStatus;
  lastChecked?: string;
  signals: LeadSignals;
  crm: LeadCrm;
  evidence: EvidenceItem[];
  decision?: LeadDecision;
  diagnostics?: LeadDiagnostics;
  salesStrategy?: SalesStrategy;
  /**
   * Premium LaborTech scan attached during ingestion. Drives the lead-
   * admission gate: leads where `laborTechScan.qualified !== true` are
   * filtered out before they enter the operator workflow. Drives the
   * View Scan report and the headline copy on every card.
   */
  laborTechScan?: LaborTechScan;
};

const VALID_MODULES: ModuleId[] = ["roofing", "hvac", "plumbing", "remodeling"];
const VALID_SOURCES: SourceName[] = [
  "seed", "google_places", "site_scan", "serp",
  "storm_weather", "yelp", "bbb", "hunter", "manual",
];

function asString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function pickModule(v: unknown, fallback: ModuleId): ModuleId {
  const s = asString(v)?.toLowerCase();
  if (s && (VALID_MODULES as string[]).includes(s)) return s as ModuleId;
  return fallback;
}

function pickSource(v: unknown): SourceName {
  const s = asString(v)?.toLowerCase();
  if (s && (VALID_SOURCES as string[]).includes(s)) return s as SourceName;
  return "seed";
}

function pickSourceStatus(v: unknown): SourceStatus {
  const s = asString(v)?.toLowerCase();
  const ok: SourceStatus[] = ["connected", "not_connected", "available", "missing", "stale", "error"];
  if (s && (ok as string[]).includes(s)) return s as SourceStatus;
  return "available";
}

function pickEmailStatus(v: unknown): EmailEnrichmentStatus | undefined {
  const s = asString(v)?.toLowerCase();
  const ok: EmailEnrichmentStatus[] = ["not_searched", "searching", "verified", "not_found", "needs_manual_review"];
  if (s && (ok as string[]).includes(s)) return s as EmailEnrichmentStatus;
  return undefined;
}

function pickEmailSource(v: unknown): EmailEnrichmentSource | undefined {
  const s = asString(v)?.toLowerCase();
  const ok: EmailEnrichmentSource[] = ["hunter", "apollo", "clay", "manual_upload", "site_scrape", "google_places", "unknown"];
  if (s && (ok as string[]).includes(s)) return s as EmailEnrichmentSource;
  return undefined;
}

function pickEmailConfidence(v: unknown): NormalizedLead["emailConfidence"] | undefined {
  const s = asString(v)?.toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return undefined;
}

// Adapt an arbitrary in-flight lead-shaped object into NormalizedLead.
// Missing data stays undefined. Decision is preserved when present.
export function normalizeLead(
  input: Record<string, unknown> | null | undefined,
  context: { workspaceSlug: string; moduleId: ModuleId | string },
): NormalizedLead {
  const src = (input ?? {}) as Record<string, unknown>;
  const fallbackModule: ModuleId = pickModule(context.moduleId, "roofing");

  // Best-effort lift from legacy shapes (CompanyDecision-style + already-normalized).
  const id = asString(src.id) ?? asString(src.key) ?? "";
  const companyName =
    asString(src.companyName) ?? asString(src.name) ?? "(unknown)";
  const location = asString(src.location);
  const website =
    asString(src.website) ??
    asString(src.resolvedBusinessUrl) ??
    asString(src.domain) ??
    asString((src.websiteProof as Record<string, unknown> | undefined)?.homepage_url);
  const contacts = (src.contacts ?? {}) as Record<string, unknown>;
  const phone = asString(src.phone) ?? asString(contacts.primaryPhone);
  const email = asString(src.email) ?? asString(contacts.primaryEmail);
  const lastChecked = asString(src.lastChecked) ?? asString((src.websiteProof as Record<string, unknown> | undefined)?.last_checked);

  const signalsIn = (src.signals ?? {}) as Record<string, unknown>;
  const proof = (src.websiteProof ?? {}) as Record<string, unknown>;
  const cr = (src.contactResolution ?? {}) as Record<string, unknown>;

  const signals: LeadSignals = {
    hasWebsite: asBool(signalsIn.hasWebsite) ?? asBool(proof.homepage_fetch_ok) ?? (website ? true : undefined),
    websiteWeak: asBool(signalsIn.websiteWeak),
    reviewCount: asNumber(signalsIn.reviewCount) ?? asNumber(cr.reviewCount),
    rating: asNumber(signalsIn.rating) ?? asNumber(cr.rating),
    localVisibilityWeak: asBool(signalsIn.localVisibilityWeak),
    recentActivity: asBool(signalsIn.recentActivity),
    stormArea: asBool(signalsIn.stormArea),
    emergencyServiceGap: asBool(signalsIn.emergencyServiceGap),
    portfolioMissing: asBool(signalsIn.portfolioMissing),
  };

  const crmIn = (src.crm ?? {}) as Record<string, unknown>;
  const acct = (src.accountSnapshot ?? {}) as Record<string, unknown>;
  const crm: LeadCrm = {
    status: asString(crmIn.status) ?? asString(acct.status),
    lastAction: asString(crmIn.lastAction) ?? asString(acct.lastOutcome),
    notes: asString(crmIn.notes),
  };

  const evidenceRaw = Array.isArray(src.evidence) ? (src.evidence as unknown[]) : [];
  const evidence: EvidenceItem[] = [];
  for (const e of evidenceRaw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const label = asString(r.label);
    if (!label) continue;
    const conf = asString(r.confidence);
    const confidence: EvidenceItem["confidence"] =
      conf === "high" || conf === "medium" || conf === "low" ? conf : "low";
    evidence.push({
      label,
      value: typeof r.value === "string" || typeof r.value === "number" || typeof r.value === "boolean" ? r.value : undefined,
      source: pickSource(r.source),
      confidence,
    });
  }

  const decision = (src.decision && typeof src.decision === "object")
    ? (src.decision as LeadDecision)
    : undefined;
  const phoneTrust = (src.phoneTrust && typeof src.phoneTrust === "object")
    ? (src.phoneTrust as ContactTrustEvidence)
    : (contacts.phoneTrust && typeof contacts.phoneTrust === "object")
      ? (contacts.phoneTrust as ContactTrustEvidence)
      : undefined;
  const emailTrust = (src.emailTrust && typeof src.emailTrust === "object")
    ? (src.emailTrust as ContactTrustEvidence)
    : (contacts.emailTrust && typeof contacts.emailTrust === "object")
      ? (contacts.emailTrust as ContactTrustEvidence)
      : undefined;
  const contactTrust = (src.contactTrust && typeof src.contactTrust === "object")
    ? (src.contactTrust as ContactTrustEvidence)
    : (contacts.contactTrust && typeof contacts.contactTrust === "object")
      ? (contacts.contactTrust as ContactTrustEvidence)
      : phoneTrust ?? emailTrust;

  return {
    id,
    workspaceSlug: context.workspaceSlug,
    moduleId: fallbackModule,
    companyName,
    location,
    website,
    phone,
    email,
    emailStatus: pickEmailStatus(src.emailStatus),
    verifiedEmail: asString(src.verifiedEmail),
    emailSource: pickEmailSource(src.emailSource),
    emailVerifiedAt: asString(src.emailVerifiedAt),
    emailConfidence: pickEmailConfidence(src.emailConfidence),
    phoneTrust,
    emailTrust,
    contactTrust,
    source: pickSource(src.source),
    sourceStatus: pickSourceStatus(src.sourceStatus),
    lastChecked,
    signals,
    crm,
    evidence,
    decision,
  };
}
