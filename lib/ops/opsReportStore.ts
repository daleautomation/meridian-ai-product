// Meridian Operations Center — report persistence (local file).
//
// The runner (scripts/ops-center.ts) writes a single JSON snapshot; the
// operator page reads it. Mirrors the weekly-state pattern: generator
// writes under data/, surface loads it, graceful null when absent.

import path from "node:path";
import { promises as fs } from "node:fs";
import { MERIDIAN_DATA_DIR } from "@/lib/meridianDataPaths";
import { safeReadJson } from "@/lib/utils/fsSafeWrite";
import type { OpsReport } from "./opsCenter";

export const OPS_REPORT_DIR = path.join(MERIDIAN_DATA_DIR, "ops");
export const OPS_REPORT_PATH = path.join(OPS_REPORT_DIR, "ops-report.json");

/** Read the latest ops snapshot. Null when none has been generated. */
export async function loadOpsReport(): Promise<OpsReport | null> {
  return safeReadJson<OpsReport>(OPS_REPORT_PATH);
}

/** Persist a snapshot (runner only). */
export async function saveOpsReport(report: OpsReport): Promise<string> {
  await fs.mkdir(OPS_REPORT_DIR, { recursive: true });
  await fs.writeFile(OPS_REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  return OPS_REPORT_PATH;
}
