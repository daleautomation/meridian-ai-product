// Meridian AI — Operator execution surface for LaborTech.
//
// Full CRM-integrated workflow: priorities, timeline, calendar,
// close recommendations, ROI tracking.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { callTool } from "../../lib/mcp/registry";
import { listSnapshots } from "../../lib/state/companySnapshotStore";
import { getAllActivities, getCalendarEvents } from "../../lib/state/crmStore";
import { getJobHistory } from "../../lib/pipeline/dailyJob";
import OperatorConsole from "../../components/OperatorConsole";
import type { CompanyDecision } from "../../lib/scoring/companyDecision";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  // Load ranked companies + reviews
  const [rankedRes, pendingRes] = await Promise.all([
    callTool("rank_companies", { limit: 100 }),
    callTool("list_pending_reviews", { status: "PENDING", limit: 20 }),
  ]);

  let ranked = ((rankedRes.data as { ranked: CompanyDecision[] } | null)?.ranked ?? []) as CompanyDecision[];
  const pendingReviews = (pendingRes.data as { reviews: unknown[] } | null)?.reviews ?? [];

  // ── First-render contact hydration ────────────────────────────────────
  // Batch-resolve contacts for the top visible leads whose persisted
  // snapshots don't yet carry a phone. Covers the first-load case when the
  // daily pipeline hasn't run. Reuses resolveContact via the batch tool.
  // Bounded (default top 20) so page render is not delayed on big pipelines.
  const TOP_HYDRATE = 20;
  const needsHydration = ranked
    .slice(0, TOP_HYDRATE)
    .filter((d) => !d.contacts?.primaryPhone && !d.blocked)
    .map((d) => d.key);

  if (needsHydration.length > 0) {
    try {
      await callTool("batch_resolve_contacts", {
        keys: needsHydration,
        limit: needsHydration.length,
        concurrency: 3,
        staleDays: 14,
        onlyMissing: true,
      });
      // Re-rank so tightened bucket rules see newly-populated contacts.
      const rerank = await callTool("rank_companies", { limit: 100 });
      ranked = ((rerank.data as { ranked: CompanyDecision[] } | null)?.ranked ?? []) as CompanyDecision[];
    } catch {
      // best-effort; fall back to the already-ranked list
    }
  }

  // Load snapshots for pipeline data
  const snapshots = await listSnapshots();
  const pipelineMap: Record<string, PipelineData> = {};
  for (const snap of snapshots) {
    pipelineMap[snap.key] = {
      status: snap.status ?? "NEW",
      lastAction: snap.lastAction ?? null,
      nextAction: snap.nextAction ?? null,
      nextActionDate: snap.nextActionDate ?? null,
      contactName: snap.contactName ?? null,
      contactPhone: snap.contactPhone ?? null,
      dealActionCount: snap.dealActions?.length ?? 0,
      callAttempts: snap.callAttempts ?? 0,
      consecutiveNoAnswers: snap.consecutiveNoAnswers ?? 0,
      escalationStage: snap.escalationStage ?? 0,
    };
  }

  // ROI
  const roi = { totalLeads: snapshots.length, contacted: 0, interested: 0, closedWon: 0, closedLost: 0 };
  for (const snap of snapshots) {
    const s = (snap.status ?? "").toUpperCase();
    if (["CONTACTED","CALLED","INTERESTED","QUALIFIED","PITCHED","CLOSED_WON","CLOSED_LOST"].includes(s)) roi.contacted++;
    if (["INTERESTED","QUALIFIED","PITCHED","CLOSED_WON"].includes(s)) roi.interested++;
    if (s === "CLOSED_WON") roi.closedWon++;
    if (s === "CLOSED_LOST") roi.closedLost++;
  }

  // Calendar events (14 day window)
  const today = new Date();
  const calStart = new Date(today); calStart.setDate(calStart.getDate() - 7);
  const calEnd = new Date(today); calEnd.setDate(calEnd.getDate() + 7);
  const calendarEvents = await getCalendarEvents(
    calStart.toISOString().split("T")[0],
    calEnd.toISOString().split("T")[0]
  );

  // Recent CRM activities (for activity feed)
  const recentActivities = await getAllActivities();

  // Pipeline job status
  const jobHistory = await getJobHistory();
  const lastJob = jobHistory[0] ?? null;

  // Priority tiers
  const top25 = ranked.slice(0, 25);

  return (
    <OperatorConsole
      user={{ name: user.name ?? user.id, id: user.id }}
      callTheseFirst={top25.slice(0, 3)}
      todayList={top25.slice(3, 8)}
      remaining={top25.slice(8, 25)}
      rest={ranked.slice(25)}
      pendingReviews={pendingReviews}
      totalPipeline={ranked.length}
      pipelineMap={pipelineMap}
      roi={roi}
      calendarEvents={calendarEvents}
      recentActivities={recentActivities.slice(0, 30)}
      lastPipelineJob={lastJob ? { completedAt: lastJob.completedAt, errors: lastJob.errors.length, enriched: lastJob.steps.enrich?.succeeded ?? 0 } : null}
    />
  );
}

type PipelineData = {
  status: string;
  lastAction: { type: string; outcome?: string; performedAt: string } | null;
  nextAction: string | null;
  nextActionDate: string | null;
  contactName: string | null;
  contactPhone: string | null;
  dealActionCount: number;
  callAttempts: number;
  consecutiveNoAnswers: number;
  escalationStage: number;
};
