"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { opportunityPipelineHref } from "@/lib/ae-jobs/career-brief";
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
  const { morningBrief, careerMomentum } = model;

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>AE Job Operating System</div>
          <h1 style={styles.title}>Career Brief</h1>
          <p style={styles.subtitle}>{model.owner.name}&apos;s daily operating surface</p>
          <p style={styles.timestamp}>
            Last generated: <strong>{formatDateTime(model.generatedAt)}</strong>
          </p>
        </div>
        <div style={styles.headerActions}>
          <Link href="/operator/jobs" style={styles.link}>
            Full pipeline
          </Link>
          <Link href="/workspace-select" style={styles.link}>
            Workspaces
          </Link>
        </div>
      </header>

      <section style={styles.morningHero} aria-label="Morning brief">
        <div style={styles.morningTop}>
          <div>
            <div style={styles.heroLabel}>Morning brief</div>
            <p style={styles.todayDate}>{morningBrief.todayLabel}</p>
          </div>
        </div>
        <div style={styles.heroMetrics}>
          <HeroMetric label="Active opportunities" value={morningBrief.activeOpportunities} />
          <HeroMetric label="Needs Dylan" value={morningBrief.needsDylanCount} accent="orange" />
          <HeroMetric label="Waiting on" value={morningBrief.waitingOnCount} accent="blue" />
          <HeroMetric label="Upcoming events" value={morningBrief.upcomingEventsCount} />
        </div>
      </section>

      <section style={styles.quickActions} aria-label="Quick actions">
        <h2 style={styles.inlineTitle}>Quick actions</h2>
        <div style={styles.quickActionRow}>
          {model.quickActions.map((action) => (
            <Link key={action.id} href={action.href} style={styles.quickActionButton}>
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      <BriefSection
        title="Execute now"
        count={model.executeNow.length}
        emptyMessage="No high-priority actions queued. Review Waiting On below."
      >
        <div style={styles.executeTableWrap}>
          <table style={styles.executeTable}>
            <thead>
              <tr>
                {["Opportunity", "Action", "Due", ""].map((heading) => (
                  <th key={heading} style={styles.executeTh}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.executeNow.map((item) => (
                <tr key={`${item.opportunityId}-${item.action}`}>
                  <td style={styles.executeTd}>
                    <strong>{item.company}</strong>
                    <span style={styles.cardRole}>{item.roleTitle}</span>
                  </td>
                  <td style={styles.executeTd}>{item.action}</td>
                  <td style={styles.executeTd}>
                    {item.dueDate ? (
                      <span style={isDueToday(item.dueDate) ? styles.dueToday : undefined}>
                        {isDueToday(item.dueDate) ? "Today" : formatDate(item.dueDate)}
                      </span>
                    ) : (
                      <span style={styles.muted}>—</span>
                    )}
                  </td>
                  <td style={styles.executeTd}>
                    <Link href={opportunityPipelineHref(item.opportunityId)} style={styles.rowLink}>
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BriefSection>

      <section style={styles.section} aria-labelledby="momentum-heading">
        <h2 id="momentum-heading" style={styles.sectionTitle}>
          Career momentum
        </h2>
        <div style={styles.metricsGrid}>
          <Metric label="Applications in progress" value={String(careerMomentum.applicationsInProgress)} />
          <Metric label="Interviews active" value={String(careerMomentum.interviewsActive)} />
          <Metric label="Follow-ups due" value={String(careerMomentum.followUpsDue)} />
          <Metric
            label="Waiting on response"
            value={String(careerMomentum.waitingOnResponse)}
          />
        </div>
        <p style={styles.momentumNote}>Deterministic counts only — no AI scoring.</p>
      </section>

      <BriefSection
        title="Needs Dylan today"
        count={model.needsDylanToday.length}
        emptyMessage="No actions need Dylan today."
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
            <Link href={opportunityPipelineHref(item.opportunityId)} style={styles.rowLink}>
              Open opportunity →
            </Link>
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
                    <Link href={opportunityPipelineHref(opp.opportunityId)} style={styles.tableLink}>
                      <strong>{opp.company}</strong>
                    </Link>
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
        <div style={styles.roleBreakdown}>
          <span style={styles.roleBreakdownLabel}>By role type</span>
          <div style={styles.rolePills}>
            {(Object.keys(ROLE_SHORT) as RoleCategory[]).map((cat) => (
              <span key={cat} style={styles.rolePill}>
                {ROLE_SHORT[cat]} <strong>{model.health.byCategory[cat]}</strong>
              </span>
            ))}
          </div>
        </div>
      </BriefSection>

      <footer style={styles.footer}>
        <Link href="/operator/jobs" style={styles.footerLink}>
          Open full pipeline →
        </Link>
      </footer>
    </main>
  );
}

function HeroMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "orange" | "blue";
}) {
  const accentStyle =
    accent === "orange"
      ? { borderColor: palette.orangeBorder, background: palette.orangePale }
      : accent === "blue"
        ? { borderColor: palette.blueBorder, background: palette.bluePale }
        : {};

  return (
    <div style={{ ...styles.heroMetric, ...accentStyle }}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.heroMetricValue}>{value}</div>
    </div>
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
      year: "numeric",
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
    maxWidth: "760px",
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
    marginBottom: "16px",
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
  timestamp: {
    margin: "8px 0 0",
    fontSize: "12px",
    color: palette.textTertiary,
  },
  headerActions: { display: "flex", gap: "12px", alignItems: "center" },
  link: {
    color: palette.blue,
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
  },
  morningHero: {
    padding: "18px 20px",
    borderRadius: "18px",
    border: `1px solid ${palette.blueBorder}`,
    background: palette.surface,
    marginBottom: "16px",
  },
  morningTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "14px",
  },
  heroLabel: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: palette.blue,
    marginBottom: "4px",
  },
  todayDate: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 800,
    letterSpacing: "-0.03em",
  },
  heroMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "8px",
  },
  heroMetric: {
    padding: "12px 14px",
    borderRadius: "14px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
  },
  heroMetricValue: {
    fontSize: "24px",
    fontWeight: 800,
    marginTop: "4px",
    letterSpacing: "-0.03em",
  },
  quickActions: { marginBottom: "20px" },
  inlineTitle: {
    margin: "0 0 10px",
    fontSize: "15px",
    fontWeight: 800,
    letterSpacing: "-0.02em",
  },
  quickActionRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "8px",
  },
  quickActionButton: {
    display: "block",
    padding: "12px 14px",
    borderRadius: "12px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    color: palette.textPrimary,
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
    textAlign: "center",
  },
  section: { marginBottom: "24px" },
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
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "8px",
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
  momentumNote: {
    margin: "10px 0 0",
    fontSize: "12px",
    color: palette.textTertiary,
  },
  executeTableWrap: {
    overflowX: "auto",
    borderRadius: "14px",
    border: `1px solid ${palette.orangeBorder}`,
    background: palette.surface,
  },
  executeTable: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  executeTh: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: `2px solid ${palette.border}`,
    color: palette.textSecondary,
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  executeTd: {
    padding: "12px",
    borderBottom: `1px solid ${palette.borderLight}`,
    verticalAlign: "top",
  },
  dueToday: { color: palette.orange, fontWeight: 800 },
  rowLink: {
    fontSize: "12px",
    fontWeight: 700,
    color: palette.blue,
    textDecoration: "none",
    display: "inline-block",
    marginTop: "6px",
  },
  tableLink: { color: palette.textPrimary, textDecoration: "none" },
  roleBreakdown: { marginTop: "12px" },
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
  footerLink: { fontSize: "13px", fontWeight: 700, color: palette.blue, textDecoration: "none" },
};
