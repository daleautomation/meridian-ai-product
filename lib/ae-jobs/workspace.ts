import type { PublicUser } from "@/config/tenants";
import { CHECKLIST_LABELS, ROLE_LABELS, STAGE_LABELS } from "./labels";
import { INGESTION_CONTRACT_VERSION } from "./ingestion";
import type {
  AeJobsWorkspaceModel,
  JobOpportunity,
  Priority,
  RoleCategory,
  TodayAction,
} from "./types";

const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function isDueToday(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return isoDate.slice(0, 10) <= today;
}

function buildTodayActions(opportunities: JobOpportunity[]): TodayAction[] {
  return opportunities
    .filter((o) => o.stage !== "closed_lost" && o.stage !== "on_hold")
    .filter((o) => o.priority === "high" || isDueToday(o.followUpDate))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority];
      const pb = PRIORITY_ORDER[b.priority];
      if (pa !== pb) return pa - pb;
      const da = a.followUpDate ?? "9999-12-31";
      const db = b.followUpDate ?? "9999-12-31";
      return da.localeCompare(db);
    })
    .map((o) => ({
      opportunityId: o.id,
      company: o.company,
      roleTitle: o.roleTitle,
      nextAction: o.nextAction,
      followUpDate: o.followUpDate,
      priority: o.priority,
      roleCategory: o.roleCategory,
    }));
}

export function buildAeJobsWorkspaceModel(
  opportunities: JobOpportunity[],
  user: PublicUser,
  lastIngestedAt: string | null,
): AeJobsWorkspaceModel {
  const byCategory = {} as Record<RoleCategory, number>;
  for (const cat of Object.keys(ROLE_LABELS) as RoleCategory[]) {
    byCategory[cat] = opportunities.filter((o) => o.roleCategory === cat).length;
  }

  const active = opportunities.filter(
    (o) => o.stage !== "closed_lost" && o.stage !== "on_hold",
  );

  return {
    generatedAt: new Date().toISOString(),
    owner: { id: user.id, name: user.name },
    opportunities: [...opportunities].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority];
      const pb = PRIORITY_ORDER[b.priority];
      if (pa !== pb) return pa - pb;
      return (a.followUpDate ?? "9999-12-31").localeCompare(b.followUpDate ?? "9999-12-31");
    }),
    todayActions: buildTodayActions(opportunities),
    summary: {
      total: opportunities.length,
      byCategory,
      highPriority: active.filter((o) => o.priority === "high").length,
      interviewsThisWeek: active.filter((o) =>
        o.stage === "interview" || o.checklist.interview_scheduled,
      ).length,
    },
    roleLabels: ROLE_LABELS,
    stageLabels: STAGE_LABELS,
    checklistLabels: CHECKLIST_LABELS,
    ingestion: {
      wired: false,
      contractVersion: INGESTION_CONTRACT_VERSION,
      lastIngestedAt,
    },
  };
}

export function groupByRoleCategory(
  opportunities: JobOpportunity[],
): { category: RoleCategory; label: string; items: JobOpportunity[] }[] {
  return (Object.keys(ROLE_LABELS) as RoleCategory[])
    .map((category) => ({
      category,
      label: ROLE_LABELS[category],
      items: opportunities.filter((o) => o.roleCategory === category),
    }))
    .filter((g) => g.items.length > 0);
}
