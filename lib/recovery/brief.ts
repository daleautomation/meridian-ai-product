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
  const greeting = contactName ? `Hi ${contactName},` : "Hi,";
  return `${greeting} I had ${companyName} on my follow-up list and wanted to reconnect. ${whyNow}`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderRecoveryBriefHtml(brief: RecoveryBrief): string {
  const rows = brief.opportunities.map((item) => `    <tr>
      <td><strong>${escapeHtml(item.companyName)}</strong><br><span>${escapeHtml(item.contactName ?? item.location ?? "")}</span></td>
      <td>${escapeHtml(item.relationshipFreshness)}<br><span>${escapeHtml(item.staleness.daysSinceTouch ?? "No touch")} days since touch</span></td>
      <td>${escapeHtml(item.whyNow)}</td>
      <td>${escapeHtml(item.verifiedContactPath)}</td>
      <td>${escapeHtml(item.suggestedOpener)}</td>
      <td>${escapeHtml(item.priorityContext)}</td>
    </tr>
`).join("\n");

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
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 18px; border-bottom: 1px solid #ece5dc; text-align: left; vertical-align: top; font-size: 14px; line-height: 1.45; }
    th { color: #7c6f61; background: #faf6ee; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; }
    span { color: #7b8490; font-size: 12px; }
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
      <table>
        <thead>
          <tr>
            <th>Company / contact</th>
            <th>Freshness</th>
            <th>Why now</th>
            <th>Contact path</th>
            <th>Suggested opener</th>
            <th>Priority context</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}
