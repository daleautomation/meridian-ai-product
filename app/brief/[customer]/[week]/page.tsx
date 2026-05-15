import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { safeReadJson } from "@/lib/utils/fsSafeWrite";
import type { RecoveryBrief } from "@/lib/recovery/brief";
import { humanWeekLabel, sourceDisplayLabel } from "@/lib/recovery/brief";

export const dynamic = "force-dynamic";

type BriefPageProps = {
  params: Promise<{
    customer: string;
    week: string;
  }>;
};

async function loadBrief(customer: string, week: string): Promise<RecoveryBrief | null> {
  const filePath = path.join(process.cwd(), "data", "recovery-briefs", customer, `${week}.json`);
  return safeReadJson<RecoveryBrief>(filePath);
}

export async function generateMetadata({ params }: BriefPageProps): Promise<Metadata> {
  const { customer, week } = await params;
  return {
    title: `Recovery Brief | ${customer} | ${week}`,
    description: "Founder-delivered relationship recovery memo.",
  };
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

const FOUNDER_SIGNATURE =
  "— Dylan Dale, Meridian · briefs delivered Mondays · reply with questions.";

export default async function RecoveryBriefPage({ params }: BriefPageProps) {
  const { customer, week } = await params;
  const brief = await loadBrief(customer, week);
  if (!brief) notFound();

  const weekLabel = humanWeekLabel(brief.week);
  const sourceLabel = sourceDisplayLabel(brief.sourceCsv);

  return (
    <main className="recovery-brief-page">
      <section className="recovery-brief-memo" aria-label="Recovery Brief memo">
        <header className="recovery-brief-header">
          <div>
            <p className="recovery-brief-kicker">Recovery Brief · {weekLabel}</p>
            <h1>{brief.customer} — {weekLabel}</h1>
            <p className="recovery-brief-subtitle">{summarySentence(brief)}</p>
          </div>
          <dl className="recovery-brief-stats">
            <div>
              <dt>Generated</dt>
              <dd>{new Date(brief.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
            </div>
            {sourceLabel ? (
              <div>
                <dt>Source</dt>
                <dd>{sourceLabel}</dd>
              </div>
            ) : null}
          </dl>
        </header>

        <div className="recovery-brief-deck">
          {brief.opportunities.map((item) => (
            <article className="recovery-brief-card" key={`${item.rank}-${item.companyName}`}>
              <div className="recovery-brief-card-topline">
                <span>{rankLabel(item.rank)}</span>
                <span>Recovery {item.recoveryScore} / 100</span>
              </div>
              <h2>{item.companyName}</h2>
              <p className="recovery-brief-card-meta">
                {item.contactName ?? "Contact not named"} · {item.location ?? "Location not provided"} · {daysLabel(item.staleness.daysSinceTouch)}
              </p>
              <div className="recovery-brief-card-grid">
                <section>
                  <h3>Why now</h3>
                  <p>{item.whyNow}</p>
                </section>
                <section>
                  <h3>Suggested opener</h3>
                  <p>{item.suggestedOpener}</p>
                </section>
                <section>
                  <h3>Priority read</h3>
                  <p>{item.priorityContext}</p>
                </section>
                <section>
                  <h3>Contact path</h3>
                  <p>{item.verifiedContactPath}</p>
                </section>
              </div>
            </article>
          ))}
        </div>

        <footer className="recovery-brief-footer">{FOUNDER_SIGNATURE}</footer>
      </section>

      <style>{`
        .recovery-brief-page {
          min-height: 100dvh;
          padding: clamp(28px, 5vw, 64px) 20px 80px;
          color: #1f2933;
          background:
            radial-gradient(circle at 10% 0%, rgba(124, 111, 97, 0.10), transparent 30%),
            linear-gradient(180deg, #f8f5ef 0%, #efe9df 100%);
        }

        .recovery-brief-memo {
          width: min(1180px, 100%);
          margin: 0 auto;
          overflow: hidden;
          border: 1px solid #ded7cc;
          border-radius: 28px;
          background: #fffdf8;
          box-shadow: 0 24px 70px rgba(31, 41, 51, 0.08);
        }

        .recovery-brief-header {
          display: flex;
          justify-content: space-between;
          gap: 28px;
          padding: clamp(28px, 4vw, 42px);
          border-bottom: 1px solid #e7e0d6;
        }

        .recovery-brief-kicker,
        .recovery-brief-stats dt,
        .recovery-brief-card-topline,
        .recovery-brief-card h3 {
          color: #7c6f61;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.11em;
          text-transform: uppercase;
        }

        .recovery-brief-header h1 {
          max-width: 760px;
          margin: 10px 0 12px;
          color: #141b24;
          font-size: clamp(36px, 5vw, 60px);
          line-height: 0.98;
          letter-spacing: -0.055em;
        }

        .recovery-brief-subtitle,
        .recovery-brief-stats dd,
        .recovery-brief-card-meta {
          color: #687381;
        }

        .recovery-brief-subtitle {
          max-width: 720px;
          margin: 0;
          font-size: 16px;
          line-height: 1.6;
        }

        .recovery-brief-stats {
          display: grid;
          min-width: 220px;
          gap: 14px;
          margin: 0;
          align-content: start;
        }

        .recovery-brief-stats div {
          padding: 14px;
          border: 1px solid #ebe4da;
          border-radius: 18px;
          background: #faf7f0;
        }

        .recovery-brief-stats dd {
          margin: 7px 0 0;
          font-size: 13px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .recovery-brief-deck {
          display: grid;
          gap: 18px;
          padding: clamp(18px, 3vw, 30px);
        }

        .recovery-brief-card {
          padding: clamp(22px, 3vw, 30px);
          border: 1px solid #ece5dc;
          border-radius: 24px;
          background: #fffaf1;
          box-shadow: 0 12px 34px rgba(31, 41, 51, 0.05);
        }

        .recovery-brief-card-topline {
          display: flex;
          justify-content: space-between;
          gap: 14px;
        }

        .recovery-brief-card h2 {
          margin: 12px 0 6px;
          color: #141b24;
          font-size: clamp(25px, 3vw, 34px);
          line-height: 1.05;
          letter-spacing: -0.035em;
        }

        .recovery-brief-card-meta {
          margin: 0;
          font-size: 13px;
          line-height: 1.45;
        }

        .recovery-brief-card-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px 22px;
          margin-top: 22px;
        }

        .recovery-brief-card section {
          padding-top: 15px;
          border-top: 1px solid #ece5dc;
        }

        .recovery-brief-card h3 {
          margin: 0 0 7px;
        }

        .recovery-brief-card p {
          margin: 0;
          color: #2f3a46;
          font-size: 14px;
          line-height: 1.55;
        }

        .recovery-brief-footer {
          padding: 22px clamp(28px, 4vw, 42px) 30px;
          border-top: 1px solid #e7e0d6;
          color: #7c6f61;
          font-size: 13px;
          line-height: 1.55;
        }

        @media (max-width: 760px) {
          .recovery-brief-header {
            display: grid;
          }

          .recovery-brief-stats {
            min-width: 0;
          }

          .recovery-brief-card-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
