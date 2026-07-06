// Meridian Command — durable review + feedback store (Neon-first, file fallback).
//
// Reuses the getNeonSql() client and the same durability posture as the operator
// store. Feedback is made durable here (previously file-only, which was ephemeral
// on Vercel) so the nightly review can actually read what happened today.

import { promises as fs } from "node:fs";
import path from "node:path";
import { getNeonSql } from "@/lib/db/neon";
import type { DailyReview, FeedbackEntry, WeeklyReview } from "./types";

function neonEnabled(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

let ready = false;
async function ensureTables(): Promise<void> {
  if (ready) return;
  const sql = getNeonSql();
  await sql`
    create table if not exists reality_feedback (
      id text primary key,
      owner_id text not null,
      subject_key text not null,
      subject_label text not null,
      feedback text not null,
      rank integer,
      recorded_at timestamptz not null
    )`;
  await sql`create index if not exists reality_feedback_owner_day_idx on reality_feedback (owner_id, recorded_at)`;
  await sql`
    create table if not exists daily_reviews (
      owner_id text not null,
      review_date date not null,
      generated_at timestamptz not null,
      payload jsonb not null,
      primary key (owner_id, review_date)
    )`;
  await sql`
    create table if not exists weekly_reviews (
      owner_id text not null,
      week_ending date not null,
      generated_at timestamptz not null,
      payload jsonb not null,
      primary key (owner_id, week_ending)
    )`;
  ready = true;
}

const FEEDBACK_FILE = path.join(process.cwd(), "data", "reality", "feedback.jsonl");
const REVIEW_DIR = path.join(process.cwd(), "data", "reality", "reviews");

async function appendSafe(file: string, line: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line, "utf8");
  } catch {
    await fs.appendFile(path.join("/tmp", path.basename(file)), line, "utf8").catch(() => {});
  }
}
async function writeSafe(file: string, body: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, "utf8");
  } catch {
    await fs.writeFile(path.join("/tmp", path.basename(file)), body, "utf8").catch(() => {});
  }
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export async function saveFeedback(entry: FeedbackEntry & { id: string }): Promise<void> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      await sql`
        insert into reality_feedback (id, owner_id, subject_key, subject_label, feedback, rank, recorded_at)
        values (${entry.id}, ${entry.ownerId}, ${entry.subjectKey}, ${entry.subjectLabel}, ${entry.feedback}, ${entry.rank}, ${entry.recordedAt})
        on conflict (id) do nothing`;
      return;
    } catch (err) {
      console.error("[review-store] neon feedback failed, file fallback", err);
    }
  }
  await appendSafe(FEEDBACK_FILE, `${JSON.stringify(entry)}\n`);
}

export async function getFeedbackForDate(ownerId: string, date: string): Promise<FeedbackEntry[]> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      const rows = (await sql`
        select owner_id, subject_key, subject_label, feedback, rank, recorded_at
        from reality_feedback
        where owner_id = ${ownerId} and recorded_at::date = ${date}`) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        ownerId: r.owner_id as string, subjectKey: r.subject_key as string, subjectLabel: r.subject_label as string,
        feedback: r.feedback as FeedbackEntry["feedback"], rank: (r.rank as number) ?? null,
        recordedAt: new Date(r.recorded_at as string).toISOString(),
      }));
    } catch (err) {
      console.error("[review-store] neon feedback read failed, file fallback", err);
    }
  }
  try {
    const lines = (await fs.readFile(FEEDBACK_FILE, "utf8")).trim().split("\n").filter(Boolean);
    return lines.map((l) => JSON.parse(l) as FeedbackEntry)
      .filter((e) => e.ownerId === ownerId && (e.recordedAt ?? "").slice(0, 10) === date);
  } catch {
    return [];
  }
}

// ── Reviews (immutable per day; never overwrite a PAST day) ──────────────────

export async function saveDailyReview(r: DailyReview): Promise<void> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      await sql`
        insert into daily_reviews (owner_id, review_date, generated_at, payload)
        values (${r.ownerId}, ${r.date}, ${r.generatedAt}, ${JSON.stringify(r)}::jsonb)
        on conflict (owner_id, review_date) do update set generated_at = excluded.generated_at, payload = excluded.payload`;
      return;
    } catch (err) {
      console.error("[review-store] neon daily review failed, file fallback", err);
    }
  }
  await writeSafe(path.join(REVIEW_DIR, `${r.ownerId}-${r.date}.json`), JSON.stringify(r));
}

export async function getRecentDailyReviews(ownerId: string, limit: number): Promise<DailyReview[]> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      const rows = (await sql`
        select payload from daily_reviews where owner_id = ${ownerId}
        order by review_date desc limit ${limit}`) as Array<{ payload: DailyReview }>;
      return rows.map((x) => x.payload);
    } catch (err) {
      console.error("[review-store] neon recent reviews failed, file fallback", err);
    }
  }
  try {
    const files = (await fs.readdir(REVIEW_DIR)).filter((f) => f.startsWith(`${ownerId}-`) && f.endsWith(".json")).sort().reverse().slice(0, limit);
    const out: DailyReview[] = [];
    for (const f of files) out.push(JSON.parse(await fs.readFile(path.join(REVIEW_DIR, f), "utf8")) as DailyReview);
    return out;
  } catch {
    return [];
  }
}

export async function getLatestDailyReview(ownerId: string): Promise<DailyReview | null> {
  return (await getRecentDailyReviews(ownerId, 1))[0] ?? null;
}

export async function saveWeeklyReview(w: WeeklyReview): Promise<void> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      await sql`
        insert into weekly_reviews (owner_id, week_ending, generated_at, payload)
        values (${w.ownerId}, ${w.weekEnding}, ${w.generatedAt}, ${JSON.stringify(w)}::jsonb)
        on conflict (owner_id, week_ending) do update set generated_at = excluded.generated_at, payload = excluded.payload`;
      return;
    } catch (err) {
      console.error("[review-store] neon weekly review failed, file fallback", err);
    }
  }
  await writeSafe(path.join(REVIEW_DIR, `${w.ownerId}-week-${w.weekEnding}.json`), JSON.stringify(w));
}

export async function getLatestWeeklyReview(ownerId: string): Promise<WeeklyReview | null> {
  if (neonEnabled()) {
    try {
      await ensureTables();
      const sql = getNeonSql();
      const rows = (await sql`
        select payload from weekly_reviews where owner_id = ${ownerId} order by week_ending desc limit 1`) as Array<{ payload: WeeklyReview }>;
      return rows[0]?.payload ?? null;
    } catch { /* fall through */ }
  }
  try {
    const files = (await fs.readdir(REVIEW_DIR)).filter((f) => f.startsWith(`${ownerId}-week-`)).sort().reverse();
    if (!files[0]) return null;
    return JSON.parse(await fs.readFile(path.join(REVIEW_DIR, files[0]), "utf8")) as WeeklyReview;
  } catch {
    return null;
  }
}
