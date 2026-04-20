// Meridian AI — retrieval-ready knowledge base.
//
// JSON file at data/knowledge.json keyed by entry id. Same atomic-write
// pattern as the other *Store files. Intentionally minimal: a list of
// tagged text entries with a substring-match search. The public interface
// (query + tags + kind → ranked entries) is compatible with semantic
// retrieval so the backing implementation can later switch to a vector
// store without touching tool callers.
//
// Recommended kinds (free string):
//   "pitch_playbook" | "service_positioning" | "objection_handling"
//   | "case_study" | "outreach_template"

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type KnowledgeEntry = {
  id: string;
  kind: string;
  title: string;
  tags: string[];
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const STORE_PATH = path.join(process.cwd(), "data", "knowledge.json");

async function readAll(): Promise<Record<string, KnowledgeEntry>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, KnowledgeEntry>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[knowledgeStore] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, KnowledgeEntry>): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
}

export async function upsertEntry(
  input: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<KnowledgeEntry> {
  const all = await readAll();
  const now = new Date().toISOString();
  if (input.id && all[input.id]) {
    const existing = all[input.id];
    const next: KnowledgeEntry = {
      ...existing,
      kind: input.kind,
      title: input.title,
      tags: input.tags,
      body: input.body,
      updatedAt: now,
    };
    all[input.id] = next;
    await writeAll(all);
    return next;
  }
  const entry: KnowledgeEntry = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    title: input.title,
    tags: input.tags,
    body: input.body,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  all[entry.id] = entry;
  await writeAll(all);
  return entry;
}

export async function getEntry(id: string): Promise<KnowledgeEntry | null> {
  const all = await readAll();
  return all[id] ?? null;
}

export type KnowledgeHit = {
  entry: KnowledgeEntry;
  score: number;             // 0+ — higher is more relevant
  matchedOn: string[];        // which fields matched
};

// Minimal ranking: token overlap across title/tags/body, with title/tags
// weighted higher. This is intentionally primitive — it gives us a stable
// shape we can swap for semantic retrieval later.
export async function searchEntries(opts: {
  query?: string;
  kind?: string;
  tags?: string[];
  limit?: number;
}): Promise<KnowledgeHit[]> {
  const all = Object.values(await readAll());
  const tokens = (opts.query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const candidates = all.filter((e) => {
    if (opts.kind && e.kind !== opts.kind) return false;
    if (opts.tags && opts.tags.length > 0) {
      const lowerTags = e.tags.map((t) => t.toLowerCase());
      const needed = opts.tags.map((t) => t.toLowerCase());
      if (!needed.every((t) => lowerTags.includes(t))) return false;
    }
    return true;
  });

  const hits: KnowledgeHit[] = candidates.map((entry) => {
    const titleLower = entry.title.toLowerCase();
    const bodyLower = entry.body.toLowerCase();
    const tagSet = new Set(entry.tags.map((t) => t.toLowerCase()));
    let score = 0;
    const matched: string[] = [];

    for (const tok of tokens) {
      if (titleLower.includes(tok)) {
        score += 3;
        matched.push(`title:${tok}`);
      }
      if (tagSet.has(tok)) {
        score += 2;
        matched.push(`tag:${tok}`);
      }
      if (bodyLower.includes(tok)) {
        score += 1;
        matched.push(`body:${tok}`);
      }
    }

    if (tokens.length === 0) {
      // No query → rank by recency so callers still get sensible ordering.
      score = new Date(entry.updatedAt).getTime() / 1e10;
    }

    return { entry, score, matchedOn: matched };
  });

  hits.sort((a, b) => b.score - a.score);
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  return hits.slice(0, limit);
}
