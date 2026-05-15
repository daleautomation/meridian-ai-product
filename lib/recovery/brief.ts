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
  const status = path.verified ? "verified" : path.confidence;
  return `${label} (${status}): ${path.value}`;
}

export function buildSuggestedOpener(companyName: string, contactName: string | null, whyNow: string): string {
  const firstName = contactName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const context = whyNow.replace(/^Last note:\s*/i, "I still have this note: ");
  return `${greeting} I was reviewing open follow-ups for ${companyName} and this one looked worth closing the loop on. ${context} Worth a quick revisit this week?`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function daysLabel(days: number | null): string {
  if (days === null) return "No prior touch";
  if (days === 1) return "1 day since touch";
  return `${days} days since touch`;
}

export function renderRecoveryBriefHtml(brief: RecoveryBrief): string {
  const cards = brief.opportunities.map((item) => `        <article class="opportunity">
          <div class="opportunity__topline">
            <span class="rank">No. ${escapeHtml(item.rank)}</span>
            <span class="score">${escapeHtml(item.recoveryScore)} recovery score</span>
          </div>
          <h2>${escapeHtml(item.companyName)}</h2>
          <p class="meta">${escapeHtml(item.contactName ?? "Contact not named")} · ${escapeHtml(item.location ?? "Location not provided")} · ${escapeHtml(item.relationshipFreshness)} · ${escapeHtml(daysLabel(item.staleness.daysSinceTouch))}</p>
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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recovery Brief | ${escapeHtml(brief.customer)} | ${escapeHtml(brief.week)}</title>
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
    @media (max-width: 760px) { .brief-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <section class="memo">
      <header>
        <div class="eyebrow">Recovery Brief - ${escapeHtml(brief.week)}</div>
        <h1>${escapeHtml(brief.customer)} relationship recovery memo</h1>
        <p>${brief.summary.opportunities} prioritized opportunities from ${brief.summary.inputRows} input rows. ${brief.summary.recoveryCandidates} recovery candidates.</p>
      </header>
      <div class="deck">
${cards}
      </div>
    </section>
  </main>
</body>
</html>`;
}
