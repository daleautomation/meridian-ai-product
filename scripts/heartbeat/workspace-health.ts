/**
 * Meridian Heartbeat — Workspace Health (Phase 1, evidence-first).
 *
 * Observer-only · Read-only.
 *   Reads:  data/crm-contacts/*.json, data/snapshots/*.json
 *   Writes: generated/heartbeat/history/workspace-health-<date>.json (baseline snapshots only)
 *
 * Operating rules (enforced here):
 *   - Facts before verdicts. No verdict word (healthy / unhealthy / pilot-ready /
 *     not-pilot-ready) is emitted unless generated/heartbeat/thresholds.json defines
 *     the deterministic mapping. No thresholds → no verdicts.
 *   - A metric that cannot be measured outputs exactly: "Insufficient data for determination."
 *   - A metric with no prior baseline outputs exactly: "Missing baseline."
 *
 * Forbidden (and absent here): scoring changes, CRM import logic changes, operator
 * workflow changes, customer-data writes, production write paths, secrets, network.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const INSUFFICIENT = "Insufficient data for determination.";
export const MISSING_BASELINE = "Missing baseline.";

/** Observed import default. NOT a computed signal — used only to count non-default scores. */
const DEFAULT_RELATIONSHIP_SCORE = 50;

export interface WorkspaceCoverage {
  withEmail: number;
  withPhone: number;
  withLastInteraction: number;
  withNonDefaultScore: number;
}

export interface WorkspaceMetrics {
  workspace: string;
  source: "crm-contacts" | "snapshots";
  /** false → this source is not a contact store; contact-level metrics are INSUFFICIENT. */
  measurable: boolean;
  recordCount: number | null;
  duplicateCount: number | null;
  duplicateKey: string;
  trustConflictCount: number | null;
  flatTrustDiscrepancyCount: number | null;
  coverage: WorkspaceCoverage | null;
  importActivity: { distinctJobs: number; latestUpdate: string | null } | null;
  recordDelta: number | null;
  baselineMissing: boolean;
  notes: string[];
}

export interface WorkspaceHealthReport {
  generatedAt: string;
  thresholdsDefined: boolean;
  priorSnapshotDate: string | null;
  workspaces: WorkspaceMetrics[];
}

/** Loose, read-only views of existing JSON. We consume, we never mutate. */
interface ContactDatum {
  value?: string | null;
  conflictState?: string;
}
interface ContactRecord {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  lastInteractionAt?: string | null;
  normalizedEmail?: string | null;
  normalizedPhone?: string | null;
  importJobId?: string | null;
  updatedAt?: string | null;
  relationshipScore?: number | null;
  dataTrust?: Record<string, ContactDatum>;
}

interface PriorSnapshot {
  date: string;
  recordCounts: Record<string, number>;
}

const DUPLICATE_KEY_DESC = "exact match on normalizedEmail or normalizedPhone";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function countDuplicates(records: ContactRecord[]): number {
  if (records.length < 2) return 0;
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  let dups = 0;
  for (const r of records) {
    const email = (r.normalizedEmail ?? "").trim().toLowerCase();
    const phone = (r.normalizedPhone ?? "").trim();
    const isDup = (email && seenEmail.has(email)) || (phone && seenPhone.has(phone));
    if (isDup) dups += 1;
    if (email) seenEmail.add(email);
    if (phone) seenPhone.add(phone);
  }
  return dups;
}

function countTrustConflicts(records: ContactRecord[]): number {
  let n = 0;
  for (const r of records) {
    const data = r.dataTrust ?? {};
    const conflicted = Object.values(data).some(
      (d) => d && typeof d.conflictState === "string" && d.conflictState !== "none",
    );
    if (conflicted) n += 1;
  }
  return n;
}

function countFlatTrustDiscrepancies(records: ContactRecord[]): number {
  let n = 0;
  for (const r of records) {
    const data = r.dataTrust ?? {};
    const pairs: Array<[unknown, ContactDatum | undefined]> = [
      [r.name, data.name],
      [r.email, data.email],
      [r.lastInteractionAt, data.lastInteraction],
    ];
    const hasDiscrepancy = pairs.some(
      ([flat, datum]) =>
        datum && datum.value != null && String(flat ?? "") !== String(datum.value),
    );
    if (hasDiscrepancy) n += 1;
  }
  return n;
}

function computeCoverage(records: ContactRecord[]): WorkspaceCoverage {
  return {
    withEmail: records.filter((r) => (r.email ?? "").trim()).length,
    withPhone: records.filter((r) => (r.phone ?? "").trim()).length,
    withLastInteraction: records.filter(
      (r) => r.lastInteractionAt != null && String(r.lastInteractionAt).trim(),
    ).length,
    withNonDefaultScore: records.filter(
      (r) =>
        typeof r.relationshipScore === "number" &&
        r.relationshipScore !== DEFAULT_RELATIONSHIP_SCORE,
    ).length,
  };
}

function computeImportActivity(records: ContactRecord[]): {
  distinctJobs: number;
  latestUpdate: string | null;
} {
  const jobs = new Set<string>();
  let latest: string | null = null;
  for (const r of records) {
    if (r.importJobId) jobs.add(r.importJobId);
    if (r.updatedAt && (latest === null || r.updatedAt > latest)) latest = r.updatedAt;
  }
  return { distinctJobs: jobs.size, latestUpdate: latest };
}

function measureCrmContactsFile(
  fileName: string,
  parsed: unknown,
  prior: PriorSnapshot | null,
): WorkspaceMetrics {
  const workspace = fileName.replace(/\.json$/, "");
  const base: WorkspaceMetrics = {
    workspace,
    source: "crm-contacts",
    measurable: false,
    recordCount: null,
    duplicateCount: null,
    duplicateKey: DUPLICATE_KEY_DESC,
    trustConflictCount: null,
    flatTrustDiscrepancyCount: null,
    coverage: null,
    importActivity: null,
    recordDelta: null,
    baselineMissing: prior === null,
    notes: [],
  };

  const contacts =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { contacts?: unknown }).contacts)
      ? ((parsed as { contacts: ContactRecord[] }).contacts)
      : null;

  if (!contacts) {
    base.notes.push(`${INSUFFICIENT} File is not a { contacts: [] } store.`);
    return base;
  }

  const recordCount = contacts.length;
  const priorCount = prior ? prior.recordCounts[workspace] : undefined;

  return {
    ...base,
    measurable: true,
    recordCount,
    duplicateCount: countDuplicates(contacts),
    trustConflictCount: countTrustConflicts(contacts),
    flatTrustDiscrepancyCount: countFlatTrustDiscrepancies(contacts),
    coverage: computeCoverage(contacts),
    importActivity: computeImportActivity(contacts),
    recordDelta: typeof priorCount === "number" ? recordCount - priorCount : null,
    baselineMissing: typeof priorCount !== "number",
  };
}

function measureSnapshotFile(fileName: string, parsed: unknown): WorkspaceMetrics {
  const slug =
    parsed && typeof parsed === "object" && typeof (parsed as { workspaceSlug?: unknown }).workspaceSlug === "string"
      ? (parsed as { workspaceSlug: string }).workspaceSlug
      : fileName.replace(/\.json$/, "");

  return {
    workspace: slug,
    source: "snapshots",
    measurable: false,
    recordCount: null,
    duplicateCount: null,
    duplicateKey: DUPLICATE_KEY_DESC,
    trustConflictCount: null,
    flatTrustDiscrepancyCount: null,
    coverage: null,
    importActivity: null,
    recordDelta: null,
    baselineMissing: true,
    notes: [
      `${INSUFFICIENT} Snapshot is an operator-UI projection, not a contact store; contact-level metrics are not derivable.`,
    ],
  };
}

async function loadPriorSnapshot(
  historyDir: string,
  today: string,
): Promise<PriorSnapshot | null> {
  const files = (await listJsonFiles(historyDir))
    .filter((f) => f.startsWith("workspace-health-") && f.slice(17, 27) < today)
    .sort()
    .reverse();
  for (const file of files) {
    const parsed = await readJson<PriorSnapshot>(path.join(historyDir, file));
    if (parsed && parsed.recordCounts) return parsed;
  }
  return null;
}

async function writeSnapshot(
  historyDir: string,
  date: string,
  report: WorkspaceHealthReport,
): Promise<void> {
  const recordCounts: Record<string, number> = {};
  for (const ws of report.workspaces) {
    if (ws.source === "crm-contacts" && typeof ws.recordCount === "number") {
      recordCounts[ws.workspace] = ws.recordCount;
    }
  }
  const snapshot: PriorSnapshot = { date, recordCounts };
  await fs.writeFile(
    path.join(historyDir, `workspace-health-${date}.json`),
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
}

/**
 * Collect evidence-first workspace metrics. Reads data/**; writes only the
 * baseline snapshot under generated/heartbeat/history/.
 */
export async function collectWorkspaceHealth(root: string): Promise<WorkspaceHealthReport> {
  const date = todayDate();
  const contactsDir = path.join(root, "data/crm-contacts");
  const snapshotsDir = path.join(root, "data/snapshots");
  const historyDir = path.join(root, "generated/heartbeat/history");

  await fs.mkdir(historyDir, { recursive: true });

  const thresholdsDefined =
    (await readJson<unknown>(path.join(root, "generated/heartbeat/thresholds.json"))) !== null;

  const prior = await loadPriorSnapshot(historyDir, date);

  const workspaces: WorkspaceMetrics[] = [];

  for (const file of await listJsonFiles(contactsDir)) {
    const parsed = await readJson<unknown>(path.join(contactsDir, file));
    workspaces.push(measureCrmContactsFile(file, parsed, prior));
  }

  for (const file of await listJsonFiles(snapshotsDir)) {
    const parsed = await readJson<unknown>(path.join(snapshotsDir, file));
    workspaces.push(measureSnapshotFile(file, parsed));
  }

  const report: WorkspaceHealthReport = {
    generatedAt: new Date().toISOString(),
    thresholdsDefined,
    priorSnapshotDate: prior ? prior.date : null,
    workspaces,
  };

  await writeSnapshot(historyDir, date, report);
  return report;
}
