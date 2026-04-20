// Meridian AI — wide-funnel raw company pool.
//
// JSON file at data/rawCompanies.json. Holds the 150–400 (or more) raw
// records produced by ingestion before the prefilter + batch-inspect run.
// Kept separate from companySnapshotStore so the curated snapshot layer
// is not polluted by filtered-out entries.
//
// Same atomic-write pattern as the other *Store files. De-dupe on write.

import { promises as fs } from "node:fs";
import path from "node:path";

export type PrefilterVerdict = "PASSED" | "FILTERED";

export type RawCompany = {
  key: string;                     // stable dedupe key (domain → name+phone → name)
  name: string;
  city?: string;
  state?: string;
  zip?: string;
  website?: string;
  phone?: string;
  category?: string;
  source: string;                  // e.g. "google_places" | "manual_csv"
  sourceUrl?: string;
  collectedAt: string;             // ISO
  prefilter?: {
    verdict: PrefilterVerdict;
    reasons: string[];
    decidedAt: string;
  };
  inspected?: {
    startedAt: string;
    completedAt?: string;
    error?: string;
  };
};

const STORE_PATH = path.join(process.cwd(), "data", "rawCompanies.json");

// ── Key normalization ────────────────────────────────────────────────────

export function normalizeDomain(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : undefined;
}

export function rawKey(input: Partial<RawCompany>): string {
  const d = normalizeDomain(input.website);
  if (d) return `d:${d}`;
  const nm = (input.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const ph = normalizePhone(input.phone);
  if (nm && ph) return `np:${nm}|${ph}`;
  if (nm) return `n:${nm}`;
  return `?:${input.sourceUrl ?? Math.random().toString(36).slice(2)}`;
}

// ── IO ───────────────────────────────────────────────────────────────────

async function readAll(): Promise<Record<string, RawCompany>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, RawCompany>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[rawCompaniesStore] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, RawCompany>): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
}

// In-process serializer. batch_inspect runs multiple workers that can all
// try to mark progress at once; chained promises ensure read-modify-write
// pairs don't clobber each other's temp file during rename.
let writeQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

// ── Public API ───────────────────────────────────────────────────────────

export async function upsertRaw(records: Array<Omit<RawCompany, "key">>): Promise<{
  inserted: number;
  duplicates: number;
  total: number;
}> {
  return serialize(async () => {
    const all = await readAll();
    let inserted = 0;
    let duplicates = 0;
    for (const r of records) {
      const key = rawKey(r);
      if (all[key]) {
        all[key] = { ...all[key], ...r, key, collectedAt: all[key].collectedAt };
        duplicates++;
      } else {
        all[key] = { ...r, key };
        inserted++;
      }
    }
    await writeAll(all);
    return { inserted, duplicates, total: Object.keys(all).length };
  });
}

export async function listRaw(opts?: {
  verdict?: PrefilterVerdict;
  limit?: number;
}): Promise<RawCompany[]> {
  const all = await readAll();
  let arr = Object.values(all);
  if (opts?.verdict) arr = arr.filter((r) => r.prefilter?.verdict === opts.verdict);
  arr.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  if (opts?.limit) arr = arr.slice(0, Math.max(1, Math.min(5000, opts.limit)));
  return arr;
}

export async function setPrefilter(
  key: string,
  verdict: PrefilterVerdict,
  reasons: string[]
): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    if (!all[key]) return;
    all[key].prefilter = { verdict, reasons, decidedAt: new Date().toISOString() };
    await writeAll(all);
  });
}

export async function setInspected(
  key: string,
  payload: { startedAt?: string; completedAt?: string; error?: string }
): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    if (!all[key]) return;
    const existing = all[key].inspected ?? { startedAt: new Date().toISOString() };
    all[key].inspected = { ...existing, ...payload };
    await writeAll(all);
  });
}

export async function bulkSetPrefilter(
  decisions: Array<{ key: string; verdict: PrefilterVerdict; reasons: string[] }>
): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    const at = new Date().toISOString();
    for (const d of decisions) {
      if (!all[d.key]) continue;
      all[d.key].prefilter = { verdict: d.verdict, reasons: d.reasons, decidedAt: at };
    }
    await writeAll(all);
  });
}
