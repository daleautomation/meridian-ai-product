// Meridian — dual-write observability.
//
// Emits a single structured log line per dual-mode write so the migration
// soak in staging/production is observable with one grep:
//
//   grep '\[truth-store\] dual_write' <log>
//
// Pure observability. No control flow. No retries. No state.

export type DualWriteOutcome = "ok" | "fail" | "skip";

export type DualWriteReport = {
  surface: string;        // e.g. "execution_outcome", "company_snapshot", "event_log"
  neon: DualWriteOutcome;
  file: DualWriteOutcome;
  neonMs?: number | null;
  fileMs?: number | null;
  neonError?: string | null;
  fileError?: string | null;
  workspace?: string | null;
  identityKey?: string | null;
};

function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const str = String(value);
  if (!/[\s"=]/.test(str)) return str;
  return JSON.stringify(str);
}

export function logDualWrite(report: DualWriteReport): void {
  if (typeof process === "undefined") return;
  const parts = [
    `surface=${escape(report.surface)}`,
    `neon=${report.neon}`,
    `file=${report.file}`,
  ];
  if (report.neonMs !== undefined) parts.push(`neon_ms=${escape(report.neonMs)}`);
  if (report.fileMs !== undefined) parts.push(`file_ms=${escape(report.fileMs)}`);
  if (report.workspace) parts.push(`workspace=${escape(report.workspace)}`);
  if (report.identityKey) parts.push(`id=${escape(report.identityKey)}`);
  if (report.neonError) parts.push(`neon_err=${escape(report.neonError)}`);
  if (report.fileError) parts.push(`file_err=${escape(report.fileError)}`);
  // eslint-disable-next-line no-console
  console.log(`[truth-store] dual_write ${parts.join(" ")}`);
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}
