import type { ContactPath } from "@/lib/contacts/types";
import type { LeadDecision } from "@/lib/scoring/decision";
import type { StalenessResult } from "@/lib/recovery/staleness";
import type {
  ScoreBreakdown,
  SignalContribution,
} from "@/lib/recovery/signals/types";
import {
  buildSuggestedOpener as buildDeterministicOpener,
  type OpenerInput,
  type OpenerSource,
  type OpenerTrust,
  type SuggestedOpener,
} from "@/lib/personal-workspace/openerBuilder";

export type RecoveryBriefItem = {
  rank: number;
  /** Stable key aligned with brief continuity (`companyKey` on company name). */
  leadKey: string;
  companyName: string;
  contactName: string | null;
  location: string | null;
  relationshipFreshness: string;
  staleness: StalenessResult;
  whyNow: string;
  verifiedContactPath: string;
  suggestedOpener: string;
  /** Which deterministic extractor produced the opener (or "custom" when
   *  the operator supplied one via the CSV `suggestedOpener` column). */
  openerSource: OpenerSource;
  /** Verbatim CRM/operator-derived fragment that justified the opener.
   *  Always present so the brief never claims un-cited intelligence. */
  supportingEvidence: string;
  /** HIGH / MED / WEAK per the Intelligence System Constitution §4. */
  openerTrust: OpenerTrust;
  priorityContext: string;
  /** Decay-weighted signal total from the evaluator at `scoreBreakdown.evaluatedAt`. */
  score: number;
  weakOnly: boolean;
  headlineSignal: string | null;
  signalContributions: SignalContribution[];
  scoreBreakdown?: ScoreBreakdown;
  recoveryScore: number;
  decision: Pick<LeadDecision, "bucket" | "score" | "primaryOpportunity">;
};

/** Verbatim label for WEAK-only cards per SIGNAL_TRUST_RULES.md §3 and §6. */
export const WEAK_SIGNAL_JUDGMENT_LABEL = "Weak signal — judgment call";

export type FounderReviewSummary = {
  worked: string[];
  failed: string[];
  missingData: string[];
  beforeNicoleSees: string[];
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
    weakOnlyCount?: number;
    founderReview?: FounderReviewSummary;
  };
  opportunities: RecoveryBriefItem[];
};

export function formatContactPath(path: ContactPath | undefined): string {
  if (!path) return "Manual verification needed";
  const label = path.label ?? `${path.method} path`;
  // Per docs/copywriting-principles.md: anchor first (the dialable value),
  // provenance follows as a small label. No inline (medium) confidence.
  return `${path.value} — ${label}`;
}

// ── Brief opener — deterministic, voice-unified with the workspace ──
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §7 Safe Operator Language — calm, source-cited, confirmation-framed.
//   §6.5 Banned phrases — no "AI suggests", no "perfect time", etc.
//
// The brief used to render templated salesy prose (greeting + "I was
// reviewing open follow-ups..."). That broke voice consistency with
// /personal, which uses the deterministic extractor chain. This
// function delegates to the same extractor chain so brief and
// workspace produce identical opener text for identical input.
//
// An operator-supplied custom opener (CSV `suggestedOpener` column) is
// the highest tier of trust — operator-authored T1 content — and wins
// over any extractor.

export interface BriefOpenerInput {
  contactName: string | null;
  companyName: string;
  lastInteractionAt: string | null;
  /** Operator-supplied per-row override from the CSV. When present
   *  and non-empty, this wins. */
  customOpener?: string | null;
}

export interface BriefOpenerOptions {
  now?: Date;
}

/**
 * Produce a structured opener for a Recovery Brief item. Pure,
 * deterministic, same input → same output. Cites provenance.
 */
export function buildBriefOpener(
  input: BriefOpenerInput,
  options: BriefOpenerOptions = {},
): SuggestedOpener {
  const custom = input.customOpener?.trim();
  if (custom && custom.length > 0) {
    // Operator-authored override. Treated as T1 (operator-entered)
    // content under the constitution §1 hierarchy. Highest trust.
    return {
      opener: custom,
      openerSource: "notes:plain_quote",
      supportingEvidence: "operator-supplied opener (CSV row)",
      trustLevel: "HIGH",
      isSpecific: true,
    };
  }
  const workspaceInput: OpenerInput = {
    name: input.contactName ?? `the contact at ${input.companyName}`,
    notes: null,
    tags: [],
    lastInteractionAt: input.lastInteractionAt,
    sourceCrm: "recovery_brief",
    hunter: null,
  };
  return buildDeterministicOpener(workspaceInput, options);
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
              <p class="opener-provenance">${escapeHtml(item.supportingEvidence)} · ${escapeHtml(item.openerTrust)} trust · ${escapeHtml(item.openerSource)}</p>
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
