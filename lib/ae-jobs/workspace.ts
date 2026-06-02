import type { PublicUser } from "@/config/tenants";
import { CHECKLIST_LABELS, ROLE_LABELS, STAGE_LABELS } from "./labels";
import { INGESTION_CONTRACT_VERSION, INGESTION_STATUS_MESSAGE } from "./ingestion";
import type {
  AeJobsWorkspaceModel,
  JobOpportunity,
  NeedsDylanCategory,
  NeedsDylanItem,
  Priority,
  RoleCategory,
  TodayAction,
} from "./types";

const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export const NEEDS_DYLAN_LABELS: Record<NeedsDylanCategory, string> = {
  loom_due: "Loom due",
  follow_up_overdue: "Follow-up overdue",
  waiting_on_reply: "Waiting on reply",
  prep_required: "Prep required",
};

const INGESTION_STATUS = INGESTION_STATUS_MESSAGE;

function isDueToday(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return isoDate.slice(0, 10) <= today;
}

function isActive(opp: JobOpportunity): boolean {
  return opp.stage !== "closed_lost" && opp.stage !== "on_hold";
}

function buildTodayActions(opportunities: JobOpportunity[]): TodayAction[] {
  return opportunities
    .filter(isActive)
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

export function buildNeedsDylanItems(opportunities: JobOpportunity[]): NeedsDylanItem[] {
  const items: NeedsDylanItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const opp of opportunities) {
    if (opp.stage === "closed_lost") continue;

    const base = {
      opportunityId: opp.id,
      company: opp.company,
      roleTitle: opp.roleTitle,
      nextAction: opp.nextAction,
      followUpDate: opp.followUpDate,
      priority: opp.priority,
      roleCategory: opp.roleCategory,
    };

    if (
      opp.checklist.case_study_required &&
      !opp.checklist.loom_recorded &&
      opp.stage === "case_study"
    ) {
      items.push({
        ...base,
        category: "loom_due",
        categoryLabel: NEEDS_DYLAN_LABELS.loom_due,
      });
    }

    if (opp.followUpDate && opp.followUpDate.slice(0, 10) <= today && isActive(opp)) {
      items.push({
        ...base,
        category: "follow_up_overdue",
        categoryLabel: NEEDS_DYLAN_LABELS.follow_up_overdue,
      });
    }

    if (opp.waitingOnReply) {
      items.push({
        ...base,
        category: "waiting_on_reply",
        categoryLabel: NEEDS_DYLAN_LABELS.waiting_on_reply,
      });
    }

    if (
      opp.prepRequired ||
      ((opp.stage === "interview" || opp.stage === "hiring_manager") &&
        !opp.checklist.interview_scheduled)
    ) {
      if (!opp.waitingOnReply) {
        items.push({
          ...base,
          category: "prep_required",
          categoryLabel: NEEDS_DYLAN_LABELS.prep_required,
        });
      }
    }
  }

  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.opportunityId}:${item.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority];
      const pb = PRIORITY_ORDER[b.priority];
      if (pa !== pb) return pa - pb;
      return (a.followUpDate ?? "9999-12-31").localeCompare(b.followUpDate ?? "9999-12-31");
    });
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
    needsDylan: buildNeedsDylanItems(opportunities),
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
    needsDylanLabels: NEEDS_DYLAN_LABELS,
    ingestion: {
      wired: false,
      contractVersion: INGESTION_CONTRACT_VERSION,
      lastIngestedAt,
      statusMessage: INGESTION_STATUS,
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
