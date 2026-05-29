// CRM import audit CLI — compare workspace contacts vs import job / optional CSV.

import { formatCrmImportAuditReport, runCrmImportAudit } from "../lib/crm-import/audit";

function parseArgs(argv: string[]): { workspaceId: string; csvPath?: string; jobId?: string } {
  let workspaceId = process.env.CRM_AUDIT_WORKSPACE?.trim() ?? "nicole-lonergan";
  let csvPath: string | undefined;
  let jobId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace" || arg.startsWith("--workspace=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (value) workspaceId = value.trim();
      if (!arg.includes("=")) i += 1;
    } else if (arg === "--csv" || arg.startsWith("--csv=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (value) csvPath = value.trim();
      if (!arg.includes("=")) i += 1;
    } else if (arg === "--job" || arg.startsWith("--job=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[i + 1];
      if (value) jobId = value.trim();
      if (!arg.includes("=")) i += 1;
    }
  }

  return { workspaceId, csvPath, jobId };
}

async function main() {
  const { workspaceId, csvPath, jobId } = parseArgs(process.argv.slice(2));
  const report = await runCrmImportAudit({ workspaceId, csvPath, jobId });
  console.log(formatCrmImportAuditReport(report));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
