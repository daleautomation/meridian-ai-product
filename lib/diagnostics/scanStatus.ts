// Meridian — scan readiness model.
//
// Pure helper. Reads what's actually on the lead and returns a
// structured scan-status block the calendar can render verbatim.
// Never invents scan results, never adds placeholder copy.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";

export type ScanRunStatus = "not_started" | "running" | "completed" | "failed" | "blocked";
export type ScanReadiness = "ready_for_outreach" | "needs_scan" | "blocked_missing_data";

export type ScanStatus = {
  status: ScanRunStatus;
  readiness: ScanReadiness;
  scannedSources: string[];
  missingSources: string[];
  topIssues: string[];
  nextAction: string;
};

// Loose lead shape — accepts either the NormalizedLead or the legacy
// LeadLike used in lib/calendar/tasks.ts. Everything optional and
// nullable so the helper never crashes on partial data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeadInput = any;

function pickPhone(l: LeadInput): string | null {
  return l.phone || l.contacts?.primaryPhone || null;
}

function pickWebsite(l: LeadInput): string | null {
  return l.website || l.resolvedBusinessUrl || l.domain || null;
}

export function computeScanStatus(lead: LeadInput | null | undefined): ScanStatus {
  if (!lead) {
    return {
      status: "blocked",
      readiness: "blocked_missing_data",
      scannedSources: [],
      missingSources: ["lead"],
      topIssues: [],
      nextAction: "No lead data on file. Cannot scan.",
    };
  }

  const findings = lead.diagnostics?.findings ?? [];
  const topFinding = lead.diagnostics?.topFinding ?? null;
  const primaryAngle = lead.salesStrategy?.primaryAngle ?? null;
  const phone = pickPhone(lead);
  const website = pickWebsite(lead);
  const websiteScanOk = !!lead.websiteProof?.homepage_fetch_ok;
  const sourceStatus = (lead.sourceStatus ?? "").toString();
  const sourceName = (lead.source ?? "").toString();

  const scannedSources: string[] = [];
  if (sourceName === "google_places" && (sourceStatus === "connected" || sourceStatus === "available")) {
    scannedSources.push("google_places");
  }
  if (websiteScanOk) scannedSources.push("website_scan");
  if (findings.length > 0) scannedSources.push("diagnostics");

  const missingSources: string[] = [];
  if (sourceStatus === "error") missingSources.push("google_places (error)");
  if (sourceStatus === "missing") missingSources.push("google_places (no match)");
  if (website && !websiteScanOk) missingSources.push("website_scan");
  if (!website) missingSources.push("website");
  if (!phone) missingSources.push("phone");

  const topIssues = (findings as Array<{ issue?: string; evidence?: string }>)
    .slice(0, 3)
    .map((f) => f.issue && f.evidence ? `${f.issue} — ${f.evidence}` : (f.issue ?? ""))
    .filter(Boolean) as string[];

  // ── Blocked: no website AND no phone, or no usable source signal ──
  const noUsableSourceSignal =
    findings.length === 0 && !primaryAngle && !topFinding && scannedSources.length === 0;

  if ((!website && !phone) || noUsableSourceSignal) {
    const reasons: string[] = [];
    if (!website) reasons.push("no website");
    if (!phone) reasons.push("no phone");
    if (sourceStatus === "error") reasons.push("source returned an error");
    if (noUsableSourceSignal && reasons.length === 0) reasons.push("no usable source evidence");
    return {
      status: "blocked",
      readiness: "blocked_missing_data",
      scannedSources,
      missingSources: missingSources.length > 0 ? missingSources : reasons,
      topIssues,
      nextAction: `Blocked: ${reasons.join(" · ")}. Find contact info before outreach.`,
    };
  }

  // ── Failed: source error and no fallback evidence ──
  if (sourceStatus === "error" && scannedSources.length === 0) {
    return {
      status: "failed",
      readiness: "needs_scan",
      scannedSources,
      missingSources,
      topIssues,
      nextAction: "Scan failed: retry website scan or fall back to Google profile evidence only.",
    };
  }

  // ── Completed: diagnostics + primary angle present ──
  const completed = findings.length > 0 && (primaryAngle || topFinding);
  if (completed) {
    const lead_with =
      primaryAngle && primaryAngle.label && primaryAngle.evidence
        ? `${primaryAngle.label} — ${primaryAngle.evidence}`
        : (topFinding && topFinding.issue && topFinding.evidence
          ? `${topFinding.issue} — ${topFinding.evidence}`
          : "the strongest observable gap on this lead");
    return {
      status: "completed",
      readiness: "ready_for_outreach",
      scannedSources,
      missingSources,
      topIssues,
      nextAction: `Scan complete: lead with ${lead_with}.`,
    };
  }

  // ── Needs scan: website exists but no website-derived findings ──
  if (website && !websiteScanOk) {
    return {
      status: "not_started",
      readiness: "needs_scan",
      scannedSources,
      missingSources,
      topIssues,
      nextAction: "Scan needed: website exists but no conversion / CTA findings are attached yet.",
    };
  }

  // Default fallback — partial signal, not yet ready.
  return {
    status: "not_started",
    readiness: "needs_scan",
    scannedSources,
    missingSources,
    topIssues,
    nextAction: scannedSources.length > 0
      ? `Scan partial: ${scannedSources.join(", ")} on file; run remaining sources before outreach.`
      : "Scan needed: no source evidence on file yet.",
  };
}

// UI helper: pick a card title that describes what the operator
// actually has to do, never a generic "Complete diagnostic scan".
export function diagnosticTaskTitle(company: string, scan: ScanStatus): string {
  const c = company || "lead";
  if (scan.status === "completed") return `Scan complete — ${c}`;
  if (scan.status === "blocked") {
    if (scan.missingSources.some((s) => s.startsWith("phone")) || scan.missingSources.some((s) => s.startsWith("website"))) {
      return `Fix missing contact — ${c}`;
    }
    return `Blocked — ${c}`;
  }
  if (scan.status === "failed") return `Retry scan — ${c}`;
  if (scan.readiness === "needs_scan") {
    return scan.missingSources.includes("website_scan") ? `Run website scan — ${c}` : `Run scan — ${c}`;
  }
  return `Run scan — ${c}`;
}
