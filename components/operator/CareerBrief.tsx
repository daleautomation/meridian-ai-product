"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { palette } from "@/lib/theme";
import type {
  CareerBriefModel,
  NeedsDylanCategory,
  Priority,
  RoleCategory,
} from "@/lib/ae-jobs/types";

interface CareerBriefProps {
  model: CareerBriefModel;
}

const ROLE_SHORT: Record<RoleCategory, string> = {
  account_executive: "AE",
  partner_account_manager: "PAM",
  sales_engineer: "SE",
  customer_success: "CS",
  other: "Other",
};

export function CareerBrief({ model }: CareerBriefProps) {
  const { health } = model;
  const generated = formatDateTime(model.generatedAt);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>AE Job Operating System</div>
          <h1 style={styles.title}>Career Brief</h1>
          <p style={styles.subtitle}>
            {model.owner.name}&apos;s morning pipeline memo — {generated}
          </p>
        </div>
        <div style={styles.headerActions}>
          <Link href="/operator/jobs" style={styles.link}>
            Pipeline OS
          </Link>
          <Link href="/workspace-select" style={styles.link}>
            Workspaces
          </Link>
        </div>
      </header>

      <section style={styles.heroCard} aria-label="Suggested next move">
        <div style={styles.heroLabel}>Suggested next move</div>
        <p style={styles.heroHeadline}>{model.suggestedNextMove.headline}</p>
        <p style={styles.heroExplanation}>{model.suggestedNextMove.explanation}</p>
      </section>

      <section style={styles.section} aria-labelledby="health-heading">
        <h2 id="health-heading" style={styles.sectionTitle}>
          Career health summary
        </h2>
        <div style={styles.metricsGrid}>
          <Metric label="Total opportunities" value={String(health.total)} />
          <Metric label="Active interviews" value={String(health.activeInterviews)} />
          <Metric label="Case studies in progress" value={String(health.caseStudiesInProgress)} />
          <Metric label="Waiting on reply" value={String(health.waitingOnReplyCount)} />
          <Metric label="Follow-ups due" value={String(health.followUpsDueCount)} />
        </div>
        <div style={styles.roleBreakdown}>
          <span style={styles.roleBreakdownLabel}>By role type</span>
          <div style={styles.rolePills}>
            {(Object.keys(ROLE_SHORT) as RoleCategory[]).map((cat) => (
              <span key={cat} style={styles.rolePill}>
                {ROLE_SHORT[cat]} <strong>{health.byCategory[cat]}</strong>
              </span>
            ))}
          </div>
        </div>
      </section>

      <BriefSection
        title="Needs Dylan today"
        count={model.needsDylanToday.length}
        emptyMessage="No actions need Dylan today. Check Waiting On and Upcoming."
      >
        {model.needsDylanToday.map((item) => (
          <article key={`${item.opportunityId}-${item.category}`} style={styles.actionCard}>
            <div style={styles.cardTop}>
              <NeedsDylanPill label={item.categoryLabel} category={item.category} />
              {item.followUpDate ? (
                <span style={styles.dueBadge}>
                  {isDueToday(item.followUpDate) ? "Due today" : `Due ${formatDate(item.followUpDate)}`}
                </span>
              ) : null}
            </div>
            <strong style={styles.cardCompany}>{item.company}</strong>
            <span style={styles.cardRole}>{item.roleTitle}</span>
            <p style={styles.cardAction}>{item.nextAction}</p>
          </article>
        ))}
      </BriefSection>

      <BriefSection
        title="Waiting on"
        count={model.waitingOn.length}
        emptyMessage="Nothing blocked — no one else is holding up the pipeline."
      >
        {model.waitingOn.map((item) => (
          <article key={item.opportunityId} style={styles.waitCard}>
            <div style={styles.cardTop}>
              <span style={styles.waitPill}>{item.reasonLabel}</span>
              <span style={styles.daysWaiting}>{item.daysWaiting}d waiting</span>
            </div>
            <strong style={styles.cardCompany}>{item.company}</strong>
            <span style={styles.cardRole}>{item.roleTitle}</span>
            <span style={styles.muted}>Last touch {formatDate(item.lastTouchpoint)}</span>
          </article>
        ))}
      </BriefSection>

      <BriefSection
        title="Upcoming"
        count={model.upcoming.length}
        emptyMessage="No interviews, follow-ups, or deadlines due this week."
      >
        {model.upcoming.map((item) => (
          <article
            key={`${item.opportunityId}-${item.kind}-${item.date}`}
            style={styles.upcomingCard}
          >
            <div style={styles.cardTop}>
              <span style={styles.dateBadge}>{formatDate(item.date)}</span>
              <span style={styles.kindPill}>{item.kindLabel}</span>
            </div>
            <strong style={styles.cardCompany}>{item.company}</strong>
            <p style={styles.cardAction}>{item.actionRequired}</p>
          </article>
        ))}
      </BriefSection>

      <BriefSection
        title="Top opportunities"
        count={model.topOpportunities.length}
        emptyMessage="No opportunities in pipeline."
      >
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["#", "Company", "Role", "Stage", "Priority", "Next action"].map((h) => (
                  <th key={h} style={styles.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.topOpportunities.map((opp) => (
                <tr key={opp.opportunityId}>
                  <td style={styles.td}>{opp.rank}</td>
                  <td style={styles.td}>
                    <strong>{opp.company}</strong>
                  </td>
                  <td style={styles.td}>{opp.roleTitle}</td>
                  <td style={styles.td}>{opp.stageLabel}</td>
                  <td style={styles.td}>
                    <PriorityPill priority={opp.priority} />
                  </td>
                  <td style={styles.td}>{opp.recommendedNextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BriefSection>

      <footer style={styles.footer}>
        <p style={styles.footerNote}>
          Rankings use priority, pipeline stage, and follow-up dates only — no AI scoring.
        </p>
        <Link href="/operator/jobs" style={styles.footerLink}>
          Open full pipeline →
        </Link>
      </footer>
    </main>
  );
}

function BriefSection({
  title,
  count,
  emptyMessage,
  children,
}: {
  title: string;
  count: number;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>
        {title}
        <span style={styles.sectionCount}>{count}</span>
      </h2>
      {count === 0 ? (
        <p style={styles.empty}>{emptyMessage}</p>
      ) : (
        <div style={styles.cardList}>{children}</div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function PriorityPill({ priority }: { priority: Priority }) {
  const colors = {
    high: { bg: palette.orangePale, color: palette.orange, border: palette.orangeBorder },
    medium: { bg: palette.bluePale, color: palette.blue, border: palette.blueBorder },
    low: { bg: palette.surfaceHover, color: palette.textSecondary, border: palette.border },
  }[priority];
  return (
    <span
      style={{
        ...styles.pill,
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.border}`,
      }}
    >
      {priority}
    </span>
  );
}

function NeedsDylanPill({ label, category }: { label: string; category: NeedsDylanCategory }) {
  const urgent = category === "loom_due" || category === "follow_up_overdue";
  const colors = urgent
    ? { bg: palette.orangePale, color: palette.orange, border: palette.orangeBorder }
    : { bg: palette.bluePale, color: palette.blue, border: palette.blueBorder };
  return (
    <span
      style={{
        ...styles.pill,
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.border}`,
      }}
    >
      {label}
    </span>
  );
}

function isDueToday(iso: string): boolean {
  return iso.slice(0, 10) <= new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso.includes("T") ? iso : `${iso}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    padding: "20px 20px 48px",
    maxWidth: "720px",
    margin: "0 auto",
    background:
      "radial-gradient(circle at 20% 0%, rgba(37,99,235,0.1), transparent 28%), linear-gradient(180deg, #FBFDFF 0%, #F4F7FC 100%)",
    color: palette.textPrimary,
    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "20px",
  },
  eyebrow: {
    color: palette.blue,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  title: {
    margin: "6px 0 4px",
    fontSize: "28px",
    letterSpacing: "-0.04em",
    lineHeight: 1.1,
  },
  subtitle: { color: palette.textSecondary, fontSize: "13px", margin: 0 },
  headerActions: { display: "flex", gap: "12px", alignItems: "center" },
  link: {
    color: palette.blue,
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
  },
  heroCard: {
    padding: "20px",
    borderRadius: "18px",
    border: `1px solid ${palette.orangeBorder}`,
    background: palette.orangePale,
    marginBottom: "24px",
  },
  heroLabel: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: palette.orange,
    marginBottom: "8px",
  },
  heroHeadline: {
    margin: "0 0 8px",
    fontSize: "20px",
    fontWeight: 800,
    letterSpacing: "-0.03em",
    lineHeight: 1.25,
  },
  heroExplanation: {
    margin: 0,
    fontSize: "14px",
    color: palette.textSecondary,
    lineHeight: 1.45,
  },
  section: { marginBottom: "28px" },
  sectionTitle: {
    margin: "0 0 12px",
    fontSize: "17px",
    fontWeight: 800,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  sectionCount: {
    fontSize: "12px",
    padding: "2px 8px",
    borderRadius: "999px",
    background: palette.surfaceHover,
    color: palette.textSecondary,
    fontWeight: 700,
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: "8px",
    marginBottom: "12px",
  },
  metric: {
    padding: "12px 14px",
    borderRadius: "14px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
  },
  metricLabel: {
    fontSize: "10px",
    color: palette.textSecondary,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  metricValue: {
    fontSize: "22px",
    fontWeight: 800,
    marginTop: "4px",
    letterSpacing: "-0.03em",
  },
  roleBreakdown: { marginTop: "4px" },
  roleBreakdownLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: palette.textSecondary,
    textTransform: "uppercase",
    display: "block",
    marginBottom: "8px",
  },
  rolePills: { display: "flex", flexWrap: "wrap", gap: "6px" },
  rolePill: {
    fontSize: "12px",
    padding: "6px 10px",
    borderRadius: "999px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    color: palette.textSecondary,
  },
  cardList: { display: "grid", gap: "10px" },
  actionCard: {
    padding: "14px 16px",
    borderRadius: "14px",
    border: `1px solid ${palette.orangeBorder}`,
    background: palette.surface,
  },
  waitCard: {
    padding: "14px 16px",
    borderRadius: "14px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
  },
  upcomingCard: {
    padding: "14px 16px",
    borderRadius: "14px",
    border: `1px solid ${palette.blueBorder}`,
    background: palette.bluePale,
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "6px",
  },
  cardCompany: { fontSize: "16px", display: "block" },
  cardRole: { fontSize: "13px", color: palette.textSecondary, display: "block" },
  cardAction: { margin: "8px 0 0", fontSize: "14px", lineHeight: 1.4 },
  dueBadge: {
    fontSize: "11px",
    fontWeight: 800,
    color: palette.orange,
    textTransform: "uppercase",
  },
  waitPill: {
    fontSize: "11px",
    fontWeight: 800,
    color: palette.blue,
    textTransform: "uppercase",
  },
  daysWaiting: { fontSize: "12px", fontWeight: 700, color: palette.textSecondary },
  dateBadge: { fontSize: "13px", fontWeight: 800 },
  kindPill: {
    fontSize: "11px",
    fontWeight: 700,
    color: palette.blue,
    textTransform: "uppercase",
  },
  muted: { fontSize: "12px", color: palette.textTertiary, display: "block", marginTop: "4px" },
  pill: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  empty: {
    margin: 0,
    padding: "16px",
    borderRadius: "12px",
    background: palette.surfaceHover,
    color: palette.textSecondary,
    fontSize: "14px",
  },
  tableWrap: { overflowX: "auto", borderRadius: "14px", border: `1px solid ${palette.border}` },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px", background: palette.surface },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: `2px solid ${palette.border}`,
    color: palette.textSecondary,
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px",
    borderBottom: `1px solid ${palette.borderLight}`,
    verticalAlign: "top",
  },
  footer: {
    marginTop: "8px",
    paddingTop: "16px",
    borderTop: `1px solid ${palette.borderLight}`,
  },
  footerNote: { margin: "0 0 8px", fontSize: "12px", color: palette.textTertiary },
  footerLink: { fontSize: "13px", fontWeight: 700, color: palette.blue, textDecoration: "none" },
};
