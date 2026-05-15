import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { safeReadJson } from "@/lib/utils/fsSafeWrite";
import type { RecoveryBrief } from "@/lib/recovery/brief";

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
  if (days === null) return "No prior touch";
  if (days === 1) return "1 day since touch";
  return `${days} days since touch`;
}

export default async function RecoveryBriefPage({ params }: BriefPageProps) {
  const { customer, week } = await params;
  const brief = await loadBrief(customer, week);
  if (!brief) notFound();

  return (
    <main className="recovery-brief-page">
      <section className="recovery-brief-memo" aria-label="Recovery Brief memo">
        <header className="recovery-brief-header">
          <div>
            <p className="recovery-brief-kicker">Recovery Brief - {brief.week}</p>
            <h1>{brief.customer} relationship recovery memo</h1>
            <p className="recovery-brief-subtitle">
              {brief.summary.opportunities} prioritized opportunities from {brief.summary.inputRows} input rows.
              {" "}{brief.summary.recoveryCandidates} recovery candidates.
            </p>
          </div>
          <dl className="recovery-brief-stats">
            <div>
              <dt>Generated</dt>
              <dd>{new Date(brief.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{brief.sourceCsv}</dd>
            </div>
          </dl>
        </header>

        <div className="recovery-brief-table-wrap">
          <table className="recovery-brief-table">
            <thead>
              <tr>
                <th>Company / contact</th>
                <th>Freshness</th>
                <th>Why now</th>
                <th>Verified contact path</th>
                <th>Suggested opener</th>
                <th>Priority context</th>
              </tr>
            </thead>
            <tbody>
              {brief.opportunities.map((item) => (
                <tr key={`${item.rank}-${item.companyName}`}>
                  <td>
                    <strong>{item.rank}. {item.companyName}</strong>
                    <span>{item.contactName ?? item.location ?? "Contact not named"}</span>
                  </td>
                  <td>
                    <strong>{item.relationshipFreshness}</strong>
                    <span>{daysLabel(item.staleness.daysSinceTouch)}</span>
                  </td>
                  <td>{item.whyNow}</td>
                  <td>{item.verifiedContactPath}</td>
                  <td>{item.suggestedOpener}</td>
                  <td>{item.priorityContext}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        .recovery-brief-table th {
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
        .recovery-brief-table span {
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

        .recovery-brief-table-wrap {
          overflow-x: auto;
        }

        .recovery-brief-table {
          width: 100%;
          min-width: 1040px;
          border-collapse: collapse;
        }

        .recovery-brief-table th,
        .recovery-brief-table td {
          padding: 18px;
          border-bottom: 1px solid #ece5dc;
          text-align: left;
          vertical-align: top;
          font-size: 14px;
          line-height: 1.45;
        }

        .recovery-brief-table th {
          background: #faf6ee;
        }

        .recovery-brief-table strong {
          display: block;
          color: #18212c;
          font-weight: 750;
        }

        .recovery-brief-table span {
          display: block;
          margin-top: 6px;
          font-size: 12px;
        }

        @media (max-width: 760px) {
          .recovery-brief-header {
            display: grid;
          }

          .recovery-brief-stats {
            min-width: 0;
          }
        }
      `}</style>
    </main>
  );
}
