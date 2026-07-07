// Meridian Command — durable memory store (Neon-first, file fallback).
//
// Reuses the getNeonSql() client + the same durability posture as the other stores.
// Auto-seeds Dylan's initial strategic memories on first read. Proposed memories
// (from the nightly review) are saved as `pending` and never influence ranking
// until promoted to `active`.

import { promises as fs } from "node:fs";
import path from "node:path";
import { getNeonSql } from "@/lib/db/neon";
import { MEMORY_SEEDS } from "./seeds";
import { isActive, type Memory } from "./types";

function neonEnabled(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

let ready = false;
async function ensureTable(): Promise<void> {
  if (ready) return;
  const sql = getNeonSql();
  await sql`
    create table if not exists memory_entries (
      id text primary key,
      owner_id text not null,
      type text not null,
      subject text not null,
      statement text not null,
      confidence text not null,
      source text not null,
      evidence text not null default '',
      status text not null default 'active',
      tags jsonb not null default '[]'::jsonb,
      impact_areas jsonb not null default '[]'::jsonb,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      expires_at timestamptz
    )`;
  await sql`create index if not exists memory_entries_owner_status_idx on memory_entries (owner_id, status)`;
  ready = true;
}

const FILE = path.join(process.cwd(), "data", "memory", "memories.json");

async function readFile(ownerId: string): Promise<Memory[] | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as { ownerId: string; memories: Memory[] };
    return parsed.memories ?? [];
  } catch {
    return null;
  }
}
async function writeFile(ownerId: string, memories: Memory[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify({ version: 1, ownerId, memories }, null, 2), "utf8");
  } catch {
    await fs.writeFile(path.join("/tmp", "meridian-memories.json"), JSON.stringify({ version: 1, ownerId, memories }), "utf8").catch(() => {});
  }
}

function rowToMemory(r: Record<string, unknown>): Memory {
  return {
    id: r.id as string, type: r.type as Memory["type"], subject: r.subject as string,
    statement: r.statement as string, confidence: r.confidence as Memory["confidence"],
    source: r.source as string, evidence: (r.evidence as string) ?? "",
    status: r.status as Memory["status"], tags: (r.tags as string[]) ?? [],
    impactAreas: (r.impact_areas as Memory["impactAreas"]) ?? [],
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    expiresAt: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
  };
}

/** Seed on first use so memory is never empty. */
async function seedIfEmpty(ownerId: string): Promise<void> {
  for (const m of MEMORY_SEEDS) await upsertMemory(ownerId, m);
}

export async function upsertMemory(ownerId: string, m: Memory): Promise<void> {
  if (neonEnabled()) {
    try {
      await ensureTable();
      const sql = getNeonSql();
      await sql`
        insert into memory_entries (id, owner_id, type, subject, statement, confidence, source, evidence, status, tags, impact_areas, created_at, updated_at, expires_at)
        values (${m.id}, ${ownerId}, ${m.type}, ${m.subject}, ${m.statement}, ${m.confidence}, ${m.source}, ${m.evidence},
                ${m.status}, ${JSON.stringify(m.tags)}::jsonb, ${JSON.stringify(m.impactAreas)}::jsonb, ${m.createdAt}, ${m.updatedAt}, ${m.expiresAt ?? null})
        on conflict (id) do nothing`;
      return;
    } catch (err) {
      console.error("[memory-store] neon upsert failed, file fallback", err);
    }
  }
  const all = (await readFile(ownerId)) ?? [];
  if (!all.some((x) => x.id === m.id)) { all.push(m); await writeFile(ownerId, all); }
}

/** Proposed memory from a review — saved as pending (never auto-active). */
export async function proposeMemory(ownerId: string, m: Omit<Memory, "status">): Promise<void> {
  await upsertMemory(ownerId, { ...m, status: "pending" });
}

export async function getAllMemories(ownerId: string): Promise<Memory[]> {
  if (neonEnabled()) {
    try {
      await ensureTable();
      const sql = getNeonSql();
      let rows = (await sql`select * from memory_entries where owner_id = ${ownerId}`) as Array<Record<string, unknown>>;
      if (rows.length === 0) { await seedIfEmpty(ownerId); rows = (await sql`select * from memory_entries where owner_id = ${ownerId}`) as Array<Record<string, unknown>>; }
      return rows.map(rowToMemory);
    } catch (err) {
      console.error("[memory-store] neon read failed, file/seed fallback", err);
    }
  }
  let all = await readFile(ownerId);
  if (!all || all.length === 0) { await seedIfEmpty(ownerId); all = (await readFile(ownerId)) ?? MEMORY_SEEDS; }
  return all;
}

/** Active, non-expired memories — the ones allowed to influence ranking. */
export async function getActiveMemories(ownerId = "dylan", nowMs = Date.now()): Promise<Memory[]> {
  const all = await getAllMemories(ownerId);
  return all.filter((m) => isActive(m, nowMs));
}
