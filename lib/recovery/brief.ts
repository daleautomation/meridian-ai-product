import type { ContactPath } from "@/lib/contacts/types";
import type { LeadDecision } from "@/lib/scoring/decision";
import type { StalenessResult } from "@/lib/recovery/staleness";

export type RecoveryBriefItem = {
  rank: number;
  companyName: string;
  contactName: string | null;
  location: string | null;
  relationshipFreshness: string;
  staleness: StalenessResult;
  whyNow: string;
  verifiedContactPath: string;
  suggestedOpener: string;
  priorityContext: string;
  recoveryScore: number;
  decision: Pick<LeadDecision, "bucket" | "score" | "primaryOpportunity">;
};

export type RecoveryBrief = {
  customer: string;
  week: string;
  generatedAt: string;
  sourceCsv: string;
  summary: {
    inputRows: number;
    opportunities: number;
    recoveryCandidates: number;
  };
  opportunities: RecoveryBriefItem[];
};

export function formatContactPath(path: ContactPath | undefined): string {
  if (!path) return "Manual verification needed";
  const label = path.label ?? `${path.method} path`;
  return `${path.value} — ${label}`;
}

export function humanWeekLabel(isoWeek: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) return isoWeek;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const target = new Date(week1Mon);
  target.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return `Week of ${target.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

export function sourceDisplayLabel(sourceCsv: string): string | null {
  if (!sourceCsv) return null;
  if (sourceCsv.startsWith("fixtures/") || sourceCsv.startsWith("./fixtures/")) return "Internal sample";
  return "Uploaded list";
}

export const FOUNDER_SIGNATURE =
  "— Dylan Dale, Meridian · briefs delivered Mondays · reply with questions.";

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function daysLabel(days: number | null): string {
  if (days === null) return "First outreach";
  if (days === 1) return "1 day since touch";
  return `${days} days since touch`;
}

function rankLabel(rank: number): string {
  return rank < 10 ? `0${rank}` : String(rank);
}

function summarySentence(brief: RecoveryBrief): string {
  const n = brief.summary.opportunities;
  if (n === 0) return "No relationships above the recovery threshold this week.";
  if (n === 1) return "One relationship worth reopening this week.";
  const word = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
  return `${word.charAt(0).toUpperCase() + word.slice(1)} relationships worth reopening this week.`;
}

export function renderRecoveryBriefHtml(brief: RecoveryBrief): string {
  const cards = brief.opportunities.map((item) => `        <article class="opportunity">
          <div class="opportunity__topline">
            <span class="rank">${escapeHtml(rankLabel(item.rank))}</span>
            <span class="score">Recovery ${escapeHtml(item.recoveryScore)} / 100</span>
          </div>
          <h2>${escapeHtml(item.companyName)}</h2>
          <p class="meta">${escapeHtml(item.contactName ?? "Contact not named")} · ${escapeHtml(item.location ?? "Location not provided")} · ${escapeHtml(daysLabel(item.staleness.daysSinceTouch))}</p>
          <div class="brief-grid">
            <section>
              <h3>Why now</h3>
              <p>${escapeHtml(item.whyNow)}</p>
            </section>
            <section>
              <h3>Suggested opener</h3>
              <p>${escapeHtml(item.suggestedOpener)}</p>
            </section>
            <section>
              <h3>Priority read</h3>
              <p>${escapeHtml(item.priorityContext)}</p>
            </section>
            <section>
              <h3>Contact path</h3>
              <p>${escapeHtml(item.verifiedContactPath)}</p>
            </section>
          </div>
        </article>`).join("\n");

  const weekLabel = humanWeekLabel(brief.week);
  const sourceLabel = sourceDisplayLabel(brief.sourceCsv);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recovery Brief | ${escapeHtml(brief.customer)} | ${escapeHtml(weekLabel)}</title>
  <style>
    body { margin: 0; background: #f6f3ee; color: #1f2933; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 56px 24px 72px; }
    .memo { border: 1px solid #ded7cc; border-radius: 28px; background: #fffdf8; box-shadow: 0 24px 70px rgba(31, 41, 51, 0.08); overflow: hidden; }
    header { padding: 34px 38px 28px; border-bottom: 1px solid #e7e0d6; }
    .eyebrow { color: #7c6f61; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 12px 0 10px; font-size: clamp(34px, 5vw, 56px); line-height: .98; letter-spacing: -.055em; }
    p { margin: 0; color: #5b6673; line-height: 1.6; }
    .deck { display: grid; gap: 16px; padding: 24px; }
    .opportunity { border: 1px solid #ece5dc; border-radius: 22px; background: #fffaf1; padding: 24px; }
    .opportunity__topline { display: flex; justify-content: space-between; gap: 12px; color: #7c6f61; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    h2 { margin: 12px 0 6px; color: #141b24; font-size: 26px; letter-spacing: -.03em; }
    .meta { color: #687381; font-size: 13px; }
    .brief-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
    .brief-grid section { border-top: 1px solid #ece5dc; padding-top: 14px; }
    h3 { margin: 0 0 7px; color: #7c6f61; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; }
    footer { padding: 22px 38px 30px; color: #7c6f61; font-size: 13px; line-height: 1.55; border-top: 1px solid #e7e0d6; }
    @media (max-width: 760px) { .brief-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <section class="memo">
      <header>
        <div class="eyebrow">Recovery Brief · ${escapeHtml(weekLabel)}</div>
        <h1>${escapeHtml(brief.customer)} — ${escapeHtml(weekLabel)}</h1>
        <p>${escapeHtml(summarySentence(brief))}${sourceLabel ? ` <span style="opacity:.7;"> · ${escapeHtml(sourceLabel)}</span>` : ""}</p>
      </header>
      <div class="deck">
${cards}
      </div>
      <footer>${escapeHtml(FOUNDER_SIGNATURE)}</footer>
    </section>
  </main>
</body>
</html>`;
}
