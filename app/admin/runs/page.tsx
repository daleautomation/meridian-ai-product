import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { isAdminOperator } from "@/lib/workspaceAccess";
import { listWorkspacesForUser } from "@/config/workspaces";
import { getAllActivities } from "@/lib/state/crmStore";
import { getJobHistory } from "@/lib/pipeline/dailyJob";
import { listSnapshots } from "@/lib/state/companySnapshotStore";
import { listDurableOutcomes } from "@/lib/execution/serverOutcomeStore";
import { readRecentEvents } from "@/lib/tracking/eventLog";

export const dynamic = "force-dynamic";

type SearchParams = { workspace?: string | string[] };

type RawOperatorSnapshot = {
  generatedAt?: string;
  expiresAt?: string;
  props?: {
    teamWorkload?: {
      scheduled?: number;
      today?: number;
      overflow?: number;
      thisWeek?: number;
    };
    todaySuppression?: {
      companyKeys?: string[];
      leadKeys?: string[];
      latestActivityAt?: string | null;
      windowHours?: number;
    };
  };
};

export default async function AdminRunsPage(props: { searchParams?: Promise<SearchParams> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!isAdminOperator(user)) {
    return <AccessDenied />;
  }

  const params = (await props.searchParams) ?? {};
  const requested = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  const workspaces = listWorkspacesForUser(user.workspaces ?? []);
  const workspace = workspaces.find((ws) => ws.slug === requested) ?? workspaces.find((ws) => ws.slug === "labortech") ?? workspaces[0];
  if (!workspace) return <AccessDenied message="No admin workspace assigned." />;

  const now = new Date();
  const [operatorSnapshot, activities, jobs, currentSnapshots, outcomes, recentEvents] = await Promise.all([
    readRawOperatorSnapshot(workspace.slug),
    getAllActivities(),
    getJobHistory(),
    listSnapshots(),
    listDurableOutcomes(workspace.slug),
    readRecentEvents(50),
  ]);

  const generatedAt = operatorSnapshot?.generatedAt ?? null;
  const expiresAt = operatorSnapshot?.expiresAt ?? null;
  const snapshotFresh = expiresAt ? new Date(expiresAt).getTime() > now.getTime() : false;
  const latestActivity = activities[0] ?? null;
  const latestOutcome = outcomes[outcomes.length - 1] ?? null;
  const latestPersistenceEvent = [...recentEvents]
    .reverse()
    .find((event) => event.eventType === "outcome_recorded" || event.eventType === "call_completed" || event.eventType === "follow_up_needed");
  const teamWorkload = operatorSnapshot?.props?.teamWorkload ?? {};
  const suppression = operatorSnapshot?.props?.todaySuppression ?? {};

  return (
    <main style={styles.root}>
      <section style={styles.card}>
        <div style={styles.eyebrow}>Founder operations</div>
        <h1 style={styles.title}>Runs</h1>
        <p style={styles.copy}>Operational freshness and persistence checks for {workspace.name}.</p>
        <div style={styles.grid}>
          <Metric label="Server now" value={now.toISOString()} />
          <Metric label="Snapshot generated" value={generatedAt ?? "missing"} />
          <Metric label="Snapshot expires" value={expiresAt ?? "missing"} />
          <Metric label="Snapshot fresh" value={snapshotFresh ? "yes" : "no"} />
          <Metric label="Queue today" value={String(teamWorkload.today ?? 0)} />
          <Metric label="Queue scheduled" value={String(teamWorkload.scheduled ?? 0)} />
          <Metric label="Queue overflow" value={String(teamWorkload.overflow ?? 0)} />
          <Metric label="This week" value={String(teamWorkload.thisWeek ?? 0)} />
          <Metric label="Suppressed 24h" value={String((suppression.leadKeys ?? suppression.companyKeys ?? []).length)} />
          <Metric label="Latest suppression activity" value={suppression.latestActivityAt ?? "none"} />
          <Metric label="CRM activities" value={String(activities.length)} />
          <Metric label="Current snapshots" value={String(currentSnapshots.length)} />
          <Metric label="Durable outcomes" value={String(outcomes.length)} />
          <Metric label="Last pipeline job" value={jobs[0] ? `${jobs[0].completedAt} (${jobs[0].durationMs}ms, errors ${jobs[0].errors.length})` : "none"} />
          <Metric label="Latest CRM activity" value={latestActivity ? `${latestActivity.performedAt} · ${latestActivity.activityType} · ${latestActivity.companyName}` : "none"} />
          <Metric label="Latest durable outcome" value={latestOutcome ? `${latestOutcome.recordedAt} · ${latestOutcome.outcomeStatus}` : "none"} />
          <Metric label="Latest persistence event" value={latestPersistenceEvent ? `${latestPersistenceEvent.timestamp} · ${latestPersistenceEvent.eventType}` : "none"} />
        </div>
      </section>
    </main>
  );
}

async function readRawOperatorSnapshot(workspaceSlug: string): Promise<RawOperatorSnapshot | null> {
  const safe = workspaceSlug.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(process.cwd(), "data", "snapshots", `${safe}-operator.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as RawOperatorSnapshot : null;
  } catch {
    return null;
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function AccessDenied({ message = "Founder/admin access required." }: { message?: string }) {
  return (
    <main style={styles.root}>
      <section style={styles.card}>
        <div style={styles.eyebrow}>Admin</div>
        <h1 style={styles.title}>Access denied</h1>
        <p style={styles.copy}>{message}</p>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    minHeight: "100dvh",
    background: "#F8FAFC",
    color: "#0F172A",
    padding: "32px 20px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
  },
  card: {
    maxWidth: "980px",
    margin: "0 auto",
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: "14px",
    padding: "24px",
  },
  eyebrow: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#64748B",
  },
  title: {
    margin: "6px 0",
    fontSize: "28px",
    lineHeight: 1.1,
  },
  copy: {
    margin: "0 0 18px",
    color: "#64748B",
    fontSize: "13px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "10px",
  },
  metric: {
    border: "1px solid #E2E8F0",
    borderRadius: "10px",
    padding: "10px 12px",
    background: "#FAFBFC",
  },
  metricLabel: {
    fontSize: "10px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#94A3B8",
    marginBottom: "4px",
  },
  metricValue: {
    fontSize: "12px",
    lineHeight: 1.45,
    color: "#0F172A",
    overflowWrap: "anywhere",
  },
};
