// Meridian Command — durable operator store (Neon-first, file fallback).
//
// Autonomy needs memory that survives serverless cold starts. When DATABASE_URL
// is present we use Neon (auto-creating the tables on first write — no manual
// migration), which is durable across Vercel invocations. Locally (no DB) we use
// dated files, with a /tmp fallback so a read-only FS never loses a snapshot
// silently. Reuses the existing getNeonSql() client — no new dependency.

import { promises as fs } from "node:fs";
import path from "node:path";
import { getNeonSql } from "@/lib/db/neon";
import type { DailySnapshot, OperatorRun } from "./types";

export type StorageMode = "neon" | "file" | "tmp";

function neonEnabled(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

let tablesReady = false;
async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  const sql = getNeonSql();
  await sql`
    create table if not exists operator_snapshots (
      owner_id text not null,
      snapshot_date date not null,
      generated_at timestamptz not null,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      primary key (owner_id, snapshot_date)
    )`;
  await sql`
    create table if not exists operator_runs (
      run_id text primary key,
      owner_id text not null,
      run_at timestamptz not null,
      ok boolean not null,
      health jsonb not null
    )`;
  await sql`create index if not exists operator_runs_owner_idx on operator_runs (owner_id, run_at desc)`;
  tablesReady = true;
}

// ── File fallback helpers ────────────────────────────────────────────────────

const DIR = path.join(process.cwd(), "data", "reality", "snapshots");
const RUNS = path.join(process.cwd(), "data", "reality", "operator-runs.jsonl");

async function writeFileSafe(file: string, body: string): Promise<StorageMode> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, "utf8");
    return "file";
  } catch {
    const tmp = path.join("/tmp", path.basename(file));
    await fs.writeFile(tmp, body, "utf8").catch(() => {});
    return "tmp";
  }
}

async function appendFileSafe(file: string, line: string): Promise<StorageMode> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line, "utf8");
    return "file";
  } catch {
    await fs.appendFile(path.join("/tmp", "meridian-operator-runs.jsonl"), line, "utf8").catch(() => {});
    return "tmp";
  }
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export async function saveSnapshot(s: DailySnapshot): Promise<StorageMode> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      await sql`
        insert into operator_snapshots (owner_id, snapshot_date, generated_at, payload)
        values (${s.ownerId}, ${s.date}, ${s.generatedAt}, ${JSON.stringify(s)}::jsonb)
        on conflict (owner_id, snapshot_date) do update set
          generated_at = excluded.generated_at, payload = excluded.payload`;
      return "neon";
    } catch (err) {
      console.error("[operator-store] neon snapshot failed, falling back to file", err);
    }
  }
  return writeFileSafe(path.join(DIR, `${s.ownerId}-${s.date}.json`), JSON.stringify(s));
}

/** The single most recent snapshot on record (any date) — i.e. "the last scan".
 *  Used for the intraday "what changed since last scan" diff, which day-keyed
 *  getPreviousSnapshot can't answer (8am and 1pm share today's date row). Read
 *  this BEFORE saving the current scan so it returns the prior run. */
export async function getLatestSnapshot(ownerId: string): Promise<DailySnapshot | null> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      const rows = (await sql`
        select payload from operator_snapshots
        where owner_id = ${ownerId}
        order by generated_at desc limit 1`) as Array<{ payload: DailySnapshot }>;
      return rows[0]?.payload ?? null;
    } catch (err) {
      console.error("[operator-store] neon latest-snapshot failed, trying file", err);
    }
  }
  try {
    const files = (await fs.readdir(DIR)).filter((f) => f.startsWith(`${ownerId}-`) && f.endsWith(".json"));
    const dates = files.map((f) => f.slice(ownerId.length + 1, -5)).sort();
    const latest = dates[dates.length - 1];
    if (!latest) return null;
    return JSON.parse(await fs.readFile(path.join(DIR, `${ownerId}-${latest}.json`), "utf8")) as DailySnapshot;
  } catch {
    return null;
  }
}

/** Most recent snapshot strictly BEFORE `date` — i.e. "yesterday", for the diff. */
export async function getPreviousSnapshot(ownerId: string, date: string): Promise<DailySnapshot | null> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      const rows = (await sql`
        select payload from operator_snapshots
        where owner_id = ${ownerId} and snapshot_date < ${date}
        order by snapshot_date desc limit 1`) as Array<{ payload: DailySnapshot }>;
      return rows[0]?.payload ?? null;
    } catch (err) {
      console.error("[operator-store] neon read failed, trying file", err);
    }
  }
  // File fallback: scan the snapshots dir for the latest earlier date.
  try {
    const files = (await fs.readdir(DIR)).filter((f) => f.startsWith(`${ownerId}-`) && f.endsWith(".json"));
    const dates = files.map((f) => f.slice(ownerId.length + 1, -5)).filter((d) => d < date).sort();
    const prev = dates[dates.length - 1];
    if (!prev) return null;
    return JSON.parse(await fs.readFile(path.join(DIR, `${ownerId}-${prev}.json`), "utf8")) as DailySnapshot;
  } catch {
    return null;
  }
}

// ── Runs (self-health log) ───────────────────────────────────────────────────

export async function saveRun(run: OperatorRun): Promise<StorageMode> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      await sql`
        insert into operator_runs (run_id, owner_id, run_at, ok, health)
        values (${run.runId}, ${run.ownerId}, ${run.runAt}, ${run.ok}, ${JSON.stringify(run)}::jsonb)
        on conflict (run_id) do nothing`;
      return "neon";
    } catch (err) {
      console.error("[operator-store] neon run save failed, falling back to file", err);
    }
  }
  return appendFileSafe(RUNS, `${JSON.stringify(run)}\n`);
}

export async function getLatestRun(ownerId: string): Promise<OperatorRun | null> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      const rows = (await sql`
        select health from operator_runs where owner_id = ${ownerId}
        order by run_at desc limit 1`) as Array<{ health: OperatorRun }>;
      return rows[0]?.health ?? null;
    } catch (err) {
      console.error("[operator-store] neon latest-run failed, trying file", err);
    }
  }
  try {
    const lines = (await fs.readFile(RUNS, "utf8")).trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const r = JSON.parse(lines[i]) as OperatorRun;
      if (r.ownerId === ownerId) return r;
    }
  } catch { /* no runs yet */ }
  return null;
}
