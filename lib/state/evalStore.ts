// Meridian AI — evaluation ledger persistence.
//
// JSON file at data/evals.json keyed by eval id. Same atomic-write pattern
// as the other *Store files. Purpose: let operators (and, later, an auto-
// evaluator) record verdicts on specific decision outputs so the engine
// can prove it's improving over time.
//
// Kinds are free strings so new rubrics can be added without schema change.
// Recommended set:
//   - "summary_grounding"         — did the summary cite real evidence?
//   - "weakness_identification"   — were real revenue leaks caught?
//   - "ranking_alignment"         — did ranking match operator priority?
//   - "action_consistency"        — recommended action appropriate?
//   - "pitch_relevance"           — was pitch tied to a real weakness?

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type EvalVerdict = "PASS" | "PARTIAL" | "FAIL";

export type EvalItem = {
  id: string;
  kind: string;                   // rubric name (free string)
  subjectKey: string;             // companyKey or other subject id
  subjectLabel: string;
  verdict: EvalVerdict;
  rubric?: string;                // the question being judged
  notes?: string;                 // free-form reviewer commentary
  evaluator: string;              // userId or "agent"
  createdAt: string;
};

const STORE_PATH = path.join(process.cwd(), "data", "evals.json");

async function readAll(): Promise<Record<string, EvalItem>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, EvalItem>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[evalStore] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, EvalItem>): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
}

export async function createEval(
  input: Omit<EvalItem, "id" | "createdAt">
): Promise<EvalItem> {
  const all = await readAll();
  const item: EvalItem = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  all[item.id] = item;
  await writeAll(all);
  return item;
}

export async function listEvals(opts?: {
  kind?: string;
  verdict?: EvalVerdict;
  subjectKey?: string;
  limit?: number;
}): Promise<EvalItem[]> {
  const all = await readAll();
  let arr = Object.values(all);
  if (opts?.kind) arr = arr.filter((e) => e.kind === opts.kind);
  if (opts?.verdict) arr = arr.filter((e) => e.verdict === opts.verdict);
  if (opts?.subjectKey) arr = arr.filter((e) => e.subjectKey === opts.subjectKey);
  arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (opts?.limit) arr = arr.slice(0, Math.max(1, Math.min(500, opts.limit)));
  return arr;
}

export type EvalRollup = {
  kind: string;
  total: number;
  pass: number;
  partial: number;
  fail: number;
  passRate: number;              // 0–1 — weighted: PASS=1, PARTIAL=0.5, FAIL=0
  lastEvalAt: string | null;
};

export async function evalRollup(): Promise<EvalRollup[]> {
  const all = Object.values(await readAll());
  const byKind = new Map<string, EvalItem[]>();
  for (const e of all) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  const out: EvalRollup[] = [];
  for (const [kind, items] of byKind) {
    const pass = items.filter((x) => x.verdict === "PASS").length;
    const partial = items.filter((x) => x.verdict === "PARTIAL").length;
    const fail = items.filter((x) => x.verdict === "FAIL").length;
    const total = items.length;
    const passRate = total === 0 ? 0 : (pass + partial * 0.5) / total;
    const lastEvalAt = items
      .map((x) => x.createdAt)
      .sort()
      .slice(-1)[0] ?? null;
    out.push({ kind, total, pass, partial, fail, passRate, lastEvalAt });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}
