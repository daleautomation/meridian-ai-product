"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { palette } from "@/lib/theme";
import { fetchApiJson } from "@/lib/crm-import/fetchJson";
import { formatTrustChipDisplay } from "@/lib/crm-import/trust";
import type {
  ContactDatumTrust,
  CrmImportJob,
  ImportDiagnostics,
  ImportExecuteResult,
  ImportPreviewResult,
} from "@/lib/crm-import/types";

type Step = "upload" | "mapping" | "preview" | "importing" | "done";

type ImportDraft = {
  jobId: string;
  step: Step;
  sourceLabel: string;
  updatedAt: string;
};

type Props = {
  workspaceId: string;
  workspaceName: string;
  /** Post-import and back navigation — defaults to relationship-priority desk. */
  returnPath?: string;
  backLabel?: string;
  doneLabel?: string;
};

function draftStorageKey(workspaceId: string): string {
  return `crm-import-draft:${workspaceId}`;
}

function readDraft(workspaceId: string): ImportDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(draftStorageKey(workspaceId));
    if (!raw) return null;
    return JSON.parse(raw) as ImportDraft;
  } catch {
    return null;
  }
}

function writeDraft(workspaceId: string, draft: ImportDraft): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(draftStorageKey(workspaceId), JSON.stringify(draft));
}

function clearDraft(workspaceId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(draftStorageKey(workspaceId));
}

export default function CrmImportWizard({
  workspaceId,
  workspaceName,
  returnPath = `/operator/relationship-priority?workspace=${workspaceId}`,
  backLabel = "Back to desk",
  doneLabel = "Open relationship desk",
}: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("manual_csv");
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    duplicates: number;
    rollbackSnapshotId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const persistDraft = useCallback(
    (next: Partial<ImportDraft> & { jobId: string }) => {
      writeDraft(workspaceId, {
        jobId: next.jobId,
        step: next.step ?? step,
        sourceLabel: next.sourceLabel ?? sourceLabel,
        updatedAt: new Date().toISOString(),
      });
    },
    [workspaceId, step, sourceLabel],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const draft = readDraft(workspaceId);
      if (!draft?.jobId) {
        if (!cancelled) setHydrating(false);
        return;
      }

      // ── No stale preview reuse ────────────────────────────────────
      // Saved drafts never restore preview state. Every page load starts
      // at the upload step. The user must upload their CSV again to
      // generate a fresh preview from the current importer. This is the
      // simplest possible guarantee that what the UI shows is what the
      // CURRENT importer produces — no replay of previously-persisted
      // normalized rows.
      clearDraft(workspaceId);
      if (!cancelled) {
        setStep("upload");
        setPreview(null);
        setJobId(null);
        setCsvText("");
        setHydrating(false);
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const onFile = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // ── Force-fresh-import contract ─────────────────────────────────
      // Every new file upload completely invalidates any prior session
      // for this workspace: stored job draft, in-memory preview, in-memory
      // job id, error banners. The next "Map columns & preview" click
      // creates a brand-new preview from the freshly uploaded CSV. There
      // is no path through which a stale snapshot can render after a
      // new upload.
      clearDraft(workspaceId);
      setPreview(null);
      setJobId(null);
      setError(null);
      setCsvText(String(reader.result ?? ""));
      setStep("mapping");
    };
    reader.readAsText(file);
  }, [workspaceId]);

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const result = await fetchApiJson<{ preview: ImportPreviewResult }>("/api/crm-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, sourceLabel, csv: csvText }),
      });
      if (!result.ok) throw new Error(result.error);
      setPreview(result.data.preview);
      setJobId(result.data.preview.jobId);
      setStep("preview");
      persistDraft({
        jobId: result.data.preview.jobId,
        step: "preview",
        sourceLabel,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function ensureJobReady(currentJobId: string): Promise<string | null> {
    const status = await fetchApiJson<{ preview?: ImportPreviewResult }>(
      `/api/crm-import/status?jobId=${encodeURIComponent(currentJobId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    if (status.ok && status.data.preview) return currentJobId;

    if (csvText.trim()) {
      const preview = await fetchApiJson<{ preview: ImportPreviewResult }>("/api/crm-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, sourceLabel, csv: csvText }),
      });
      if (preview.ok && preview.data.preview?.jobId) {
        setPreview(preview.data.preview);
        setJobId(preview.data.preview.jobId);
        persistDraft({ jobId: preview.data.preview.jobId, step: "preview", sourceLabel });
        return preview.data.preview.jobId;
      }
      if (!preview.ok) {
        setError(preview.error);
      }
    }

    setError("Import session expired. Upload your CSV and run preview again.");
    setStep("upload");
    clearDraft(workspaceId);
    return null;
  }

  async function runImport() {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    setStep("importing");
    persistDraft({ jobId, step: "importing", sourceLabel });
    try {
      const activeJobId = await ensureJobReady(jobId);
      if (!activeJobId) return;

      const executed = await fetchApiJson<{ result: ImportExecuteResult }>("/api/crm-import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId, skipDuplicateRows: true }),
      });
      if (!executed.ok) throw new Error(executed.error);
      setImportResult(executed.data.result);
      setStep("done");
      clearDraft(workspaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("preview");
      persistDraft({ jobId, step: "preview", sourceLabel });
    } finally {
      setBusy(false);
    }
  }

  async function runRollback() {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const rolledBack = await fetchApiJson<{ result: { restored: number; state: string } }>(
        "/api/crm-import/rollback",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        },
      );
      if (!rolledBack.ok) throw new Error(rolledBack.error);
      setImportResult(null);
      setStep("upload");
      setPreview(null);
      setJobId(null);
      clearDraft(workspaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (hydrating) {
    return (
      <main style={styles.shell}>
        <div style={styles.container}>
          <p style={styles.copy}>Restoring import preview…</p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.shell}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Meridian contact import</div>
            <h1 style={styles.title}>Import your relationships</h1>
            <p style={styles.subtitle}>
              Upload a messy CRM export for {workspaceName}. Map columns, preview trust signals,
              review duplicates, then import — nothing merges without your review.
            </p>
          </div>
          <Link href={returnPath} style={styles.backLink}>
            {backLabel}
          </Link>
        </header>

        <ProgressRail step={step} />

        {error ? <div style={styles.error}>{error}</div> : null}

        {step === "upload" && (
          <section style={styles.card}>
            <label style={styles.label}>Source label</label>
            <input
              style={styles.input}
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. hubspot_export, salesforce_contacts"
            />
            <label style={styles.label}>CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <p style={styles.hint}>
              Supported fields: name, company, phone, email, address, notes, tags, last interaction, source CRM.
            </p>
          </section>
        )}

        {step === "mapping" && (
          <section style={styles.card}>
            <p style={styles.copy}>{csvText.split("\n").length - 1} data rows detected (approx).</p>
            <button type="button" style={styles.primaryButton} disabled={busy} onClick={runPreview}>
              {busy ? "Analyzing…" : "Map columns & preview"}
            </button>
          </section>
        )}

        {step === "preview" && preview && (
          <section style={styles.grid}>
            <ImportDiagnosticsPanel diagnostics={preview.diagnostics} />
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Validation</h2>
              <MetricRow label="Valid rows" value={String(preview.validationSummary.valid)} />
              <MetricRow label="Warnings" value={String(preview.validationSummary.warnings)} />
              <MetricRow label="Errors" value={String(preview.validationSummary.errors)} />
            </div>
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Duplicates (never silent merge)</h2>
              <MetricRow label="Unique" value={String(preview.dedupeSummary.unique)} />
              <MetricRow label="Safe merge candidates" value={String(preview.dedupeSummary.safeMerge)} />
              <MetricRow label="Likely duplicates" value={String(preview.dedupeSummary.likelyDuplicate)} />
              <MetricRow label="Manual review" value={String(preview.dedupeSummary.manualReview)} />
            </div>
            <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
              <h2 style={styles.cardTitle}>Preview (first rows)</h2>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Phone trust</th>
                      <th>Email trust</th>
                      <th>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 8).map((row) => (
                      <tr key={row.rowIndex}>
                        <td>{row.name}</td>
                        <td>{row.company}</td>
                        <td>
                          <TrustChip datum={row.dataTrust.phone} />
                        </td>
                        <td>
                          <TrustChip datum={row.dataTrust.email} />
                        </td>
                        <td style={styles.muted}>
                          {[...row.validationErrors, ...row.validationWarnings].join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.mergeRecommendations.length > 0 ? (
                <div style={styles.mergeList}>
                  <strong>Merge recommendations</strong>
                  {preview.mergeRecommendations.slice(0, 5).map((rec) => (
                    <div key={rec.pairId} style={styles.mergeItem}>
                      {rec.verdict.replace(/_/g, " ")} — {rec.suggestedAction}
                    </div>
                  ))}
                </div>
              ) : null}
              <button type="button" style={styles.primaryButton} disabled={busy} onClick={runImport}>
                Import {preview.validationSummary.valid} contacts
              </button>
            </div>
          </section>
        )}

        {step === "importing" && (
          <section style={styles.card}>
            <p style={styles.copy}>Importing contacts with rollback snapshot…</p>
          </section>
        )}

        {step === "done" && importResult && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Import complete</h2>
            <MetricRow label="Imported" value={String(importResult.imported)} />
            <MetricRow label="Skipped" value={String(importResult.skipped)} />
            <MetricRow label="Duplicates surfaced" value={String(importResult.duplicates)} />
            <p style={styles.hint}>Rollback ID: {importResult.rollbackSnapshotId}</p>
            <div style={styles.actions}>
              <Link href={returnPath} style={styles.primaryButton}>
                {doneLabel}
              </Link>
              <button type="button" style={styles.secondaryButton} disabled={busy} onClick={runRollback}>
                Roll back this import
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ImportDiagnosticsPanel({ diagnostics }: { diagnostics: ImportDiagnostics }) {
  const mappingEntries = Object.entries(diagnostics.columnMapping) as [string, string][];
  return (
    <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
      <h2 style={styles.cardTitle}>Import diagnostics</h2>
      <p style={styles.hint}>
        Detected CSV headers ({diagnostics.detectedHeaders.length}):{" "}
        {diagnostics.detectedHeaders.join(", ") || "—"}
      </p>
      <div style={styles.diagGrid}>
        <div>
          <strong style={styles.diagLabel}>Mapped phone column</strong>
          <p style={styles.muted}>
            {diagnostics.mappedPhoneColumns.length > 0
              ? diagnostics.mappedPhoneColumns.join(", ")
              : "None — phone trust will show MISSING"}
          </p>
        </div>
        <div>
          <strong style={styles.diagLabel}>Mapped email column</strong>
          <p style={styles.muted}>
            {diagnostics.mappedEmailColumns.length > 0
              ? diagnostics.mappedEmailColumns.join(", ")
              : "None"}
          </p>
        </div>
        <div>
          <strong style={styles.diagLabel}>Field mapping</strong>
          <p style={styles.muted}>
            {mappingEntries.length > 0
              ? mappingEntries.map(([field, col]) => `${field} → ${col}`).join(" · ")
              : "No columns auto-mapped"}
          </p>
        </div>
      </div>
      <MetricRow
        label="Rows missing phone"
        value={`${diagnostics.rowsMissingPhone} / ${diagnostics.totalRows}`}
      />
      <MetricRow
        label="Rows missing email"
        value={`${diagnostics.rowsMissingEmail} / ${diagnostics.totalRows}`}
      />
      <MetricRow
        label="Rows missing both"
        value={`${diagnostics.rowsMissingBoth} / ${diagnostics.totalRows}`}
      />
      {diagnostics.unmappedPhoneLikeHeaders.length > 0 ? (
        <p style={styles.warnBox}>
          Phone-like columns were not mapped: {diagnostics.unmappedPhoneLikeHeaders.join(", ")}.
          Rename headers or add aliases if this export uses non-standard labels.
        </p>
      ) : null}
      {diagnostics.isEmailFirstExport ? (
        <p style={styles.infoBox}>
          Email-first export detected ({diagnostics.emailReachablePct}% reachable by email,{" "}
          {diagnostics.phoneMissingPct}% without phone). Your relationship workspace will prioritize
          follow-ups, dormant recovery, and activity memory — not call queues. Import is fully supported.
        </p>
      ) : diagnostics.highPhoneMissingRate ? (
        <p style={styles.warnBox}>
          {diagnostics.phoneMissingPct}% of rows have no usable phone ({diagnostics.rowsMissingPhone} of{" "}
          {diagnostics.totalRows}). Relationship resurfacing will rely more heavily on email and
          interaction history. Import is allowed, but call-first resurfacing will be limited.
        </p>
      ) : null}
      {diagnostics.mappedPhoneColumns.length === 0 ? (
        <p style={styles.warnBox}>
          No phone column was detected. Phone trust shows MISSING because there is no mapped source —
          not because data was enriched or guessed.
        </p>
      ) : null}
    </div>
  );
}

function ProgressRail({ step }: { step: Step }) {
  const steps: Step[] = ["upload", "mapping", "preview", "importing", "done"];
  const labels = ["Upload", "Map", "Preview", "Import", "Done"];
  return (
    <div style={styles.rail}>
      {steps.map((s, i) => (
        <div
          key={s}
          style={{
            ...styles.railStep,
            ...(steps.indexOf(step) >= i ? styles.railStepActive : null),
          }}
        >
          {labels[i]}
        </div>
      ))}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metricRow}>
      <span style={styles.muted}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TrustChip({ datum }: { datum: ContactDatumTrust }) {
  const display = formatTrustChipDisplay(datum);
  return (
    <span
      title={display.title}
      style={{
        ...styles.chip,
        background: display.trusted ? palette.successBg : palette.warningBg,
        color: display.trusted ? palette.success : palette.orange,
      }}
    >
      {display.label}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    background: "linear-gradient(180deg, #FBFDFF 0%, #F4F7FC 100%)",
    color: palette.textPrimary,
    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    padding: "24px 16px 48px",
  },
  container: {
    maxWidth: "920px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    marginBottom: "24px",
  },
  eyebrow: {
    color: palette.blue,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  title: {
    margin: "6px 0 8px",
    fontSize: "32px",
    letterSpacing: "-0.03em",
  },
  subtitle: {
    color: palette.textSecondary,
    fontSize: "15px",
    lineHeight: 1.5,
    maxWidth: "52ch",
  },
  backLink: {
    color: palette.textSecondary,
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  rail: {
    display: "flex",
    gap: "8px",
    marginBottom: "20px",
    flexWrap: "wrap",
  },
  railStep: {
    padding: "6px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    color: palette.textTertiary,
  },
  railStepActive: {
    background: palette.bluePale,
    borderColor: palette.blueBorder,
    color: palette.blue,
  },
  card: {
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: "20px",
    padding: "20px",
    boxShadow: "0 12px 40px rgba(15,23,42,0.06)",
  },
  grid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  },
  cardTitle: {
    margin: "0 0 12px",
    fontSize: "18px",
  },
  label: {
    display: "block",
    fontSize: "12px",
    fontWeight: 700,
    marginBottom: "6px",
    color: palette.textSecondary,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "12px",
    border: `1px solid ${palette.border}`,
    marginBottom: "14px",
  },
  hint: {
    color: palette.textTertiary,
    fontSize: "13px",
    marginTop: "8px",
  },
  copy: {
    color: palette.textSecondary,
    marginBottom: "14px",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 18px",
    borderRadius: "12px",
    border: "none",
    background: palette.blue,
    color: "#fff",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    textDecoration: "none",
  },
  secondaryButton: {
    padding: "10px 18px",
    borderRadius: "12px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    fontWeight: 700,
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "16px",
  },
  error: {
    padding: "12px",
    borderRadius: "12px",
    background: "#FEF2F2",
    color: "#B91C1C",
    marginBottom: "16px",
  },
  warnBox: {
    marginTop: "10px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: palette.warningBg,
    color: palette.orange,
    fontSize: "13px",
    lineHeight: 1.45,
  },
  infoBox: {
    marginTop: "10px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: palette.successBg,
    color: palette.success,
    fontSize: "13px",
    lineHeight: 1.45,
  },
  metricRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
  },
  muted: {
    color: palette.textSecondary,
    fontSize: "13px",
  },
  diagGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    marginBottom: "8px",
  },
  diagLabel: {
    fontSize: "12px",
    display: "block",
    marginBottom: "4px",
  },
  tableWrap: {
    overflowX: "auto",
    marginBottom: "14px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
  },
  chip: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  mergeList: {
    marginTop: "12px",
    display: "grid",
    gap: "6px",
  },
  mergeItem: {
    fontSize: "13px",
    color: palette.textSecondary,
  },
};
