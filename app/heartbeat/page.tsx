import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  BRIEF_SECTIONS,
  readHeartbeatBriefToday,
} from "@/lib/heartbeat/briefReader";
import { BriefSectionContent } from "@/components/heartbeat/BriefSectionContent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Morning Brief | Meridian Heartbeat",
  description: "Read-only CEO view of the Meridian Heartbeat morning brief.",
};

const ROLE_LABELS = [
  { role: "CEO", name: "Dylan" },
  { role: "Operator", name: "Meridian" },
  { role: "Observer", name: "Heartbeat" },
] as const;

function formatUpdatedAt(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default async function HeartbeatBriefPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/heartbeat");

  const result = await readHeartbeatBriefToday();

  return (
    <main className="heartbeat-page">
      <article className="heartbeat-shell" aria-label="Meridian Heartbeat morning brief">
        <header className="heartbeat-header">
          <div>
            <p className="heartbeat-kicker">Meridian Heartbeat</p>
            <h1>{result.found ? result.brief.title : "Morning Brief"}</h1>
            <p className="heartbeat-lede">
              Read-only observer summary for CEO review. No actions run from this page.
            </p>
          </div>

          <div className="heartbeat-meta">
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{result.found ? "Brief ready" : "Waiting for first run"}</dd>
              </div>
              {result.found ? (
                <div>
                  <dt>Last updated</dt>
                  <dd>{formatUpdatedAt(result.brief.lastUpdated)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </header>

        <div className="heartbeat-roles" aria-label="Role boundaries">
          {ROLE_LABELS.map(({ name, role }) => (
            <span key={role} className="heartbeat-role-pill">
              <strong>{name}</strong>
              <span>{role}</span>
            </span>
          ))}
        </div>

        {!result.found ? (
          <section className="heartbeat-empty">
            <h2>No heartbeat brief found yet</h2>
            <p>
              Run <code>npm run heartbeat:run</code> locally or wait for the scheduled observer
              pass. This page will show the morning brief once{" "}
              <code>generated/heartbeat/brief-today.md</code> exists.
            </p>
          </section>
        ) : (
          <div className="heartbeat-sections">
            {BRIEF_SECTIONS.map((title) => (
              <section key={title} className="heartbeat-section">
                <h2>{title}</h2>
                <BriefSectionContent content={result.brief.sections[title]} />
              </section>
            ))}
          </div>
        )}
      </article>

      <style>{`
        .heartbeat-page {
          min-height: 100dvh;
          padding: clamp(24px, 5vw, 56px) 16px 72px;
          color: #1e293b;
          background:
            radial-gradient(circle at 12% 0%, rgba(59, 130, 246, 0.08), transparent 32%),
            linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
        }

        .heartbeat-shell {
          width: min(760px, 100%);
          margin: 0 auto;
          border: 1px solid #dbe4ee;
          border-radius: 24px;
          background: #ffffff;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .heartbeat-header {
          display: grid;
          gap: 20px;
          padding: clamp(24px, 4vw, 36px);
          border-bottom: 1px solid #e2e8f0;
          background:
            radial-gradient(circle at 100% 0%, rgba(59, 130, 246, 0.06), transparent 40%),
            #ffffff;
        }

        @media (min-width: 640px) {
          .heartbeat-header {
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: start;
          }
        }

        .heartbeat-kicker {
          margin: 0;
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .heartbeat-header h1 {
          margin: 10px 0 8px;
          color: #0f172a;
          font-size: clamp(28px, 5vw, 40px);
          line-height: 1.05;
          letter-spacing: -0.04em;
        }

        .heartbeat-lede {
          margin: 0;
          max-width: 52ch;
          color: #64748b;
          font-size: 15px;
          line-height: 1.6;
        }

        .heartbeat-meta dl {
          display: grid;
          gap: 10px;
          margin: 0;
        }

        .heartbeat-meta div {
          min-width: 180px;
          padding: 12px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: #f8fafc;
        }

        .heartbeat-meta dt {
          margin: 0;
          color: #64748b;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .heartbeat-meta dd {
          margin: 6px 0 0;
          color: #0f172a;
          font-size: 13px;
          line-height: 1.4;
        }

        .heartbeat-roles {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 16px clamp(24px, 4vw, 36px);
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
        }

        .heartbeat-role-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border: 1px solid #dbe4ee;
          border-radius: 999px;
          background: #ffffff;
          font-size: 12px;
          color: #475569;
        }

        .heartbeat-role-pill strong {
          color: #0f172a;
          font-weight: 700;
        }

        .heartbeat-role-pill span {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .heartbeat-empty,
        .heartbeat-sections {
          padding: clamp(20px, 4vw, 32px);
        }

        .heartbeat-empty {
          border-top: 1px solid #e2e8f0;
          background: #fbfdff;
        }

        .heartbeat-empty h2 {
          margin: 0 0 10px;
          color: #0f172a;
          font-size: 20px;
          letter-spacing: -0.02em;
        }

        .heartbeat-empty p {
          margin: 0;
          color: #64748b;
          font-size: 15px;
          line-height: 1.65;
        }

        .heartbeat-empty code {
          padding: 2px 6px;
          border-radius: 6px;
          background: #eef2f7;
          color: #334155;
          font-size: 0.92em;
        }

        .heartbeat-sections {
          display: grid;
          gap: 14px;
        }

        .heartbeat-section {
          padding: 18px 20px;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #fbfdff;
        }

        .heartbeat-section h2 {
          margin: 0 0 12px;
          color: #334155;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .heartbeat-section-body {
          display: grid;
          gap: 10px;
        }

        .heartbeat-section-body p,
        .heartbeat-section-body li,
        .heartbeat-section-empty {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          line-height: 1.65;
        }

        .heartbeat-section-body ul {
          margin: 0;
          padding-left: 1.1rem;
        }

        .heartbeat-section-body li + li {
          margin-top: 6px;
        }

        .heartbeat-section-body strong {
          color: #0f172a;
          font-weight: 700;
        }

        .heartbeat-section-empty {
          color: #94a3b8;
          font-style: italic;
        }
      `}</style>
    </main>
  );
}
