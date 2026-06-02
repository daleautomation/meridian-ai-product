import type { PublicUser } from "@/config/tenants";
import { ROLE_LABELS, STAGE_LABELS } from "./labels";
import { buildNeedsDylanItems } from "./workspace";
import type {
  CareerBriefModel,
  CareerHealthSummary,
  JobOpportunity,
  NeedsDylanItem,
  PipelineStage,
  Priority,
  SuggestedNextMove,
  TopOpportunityItem,
  UpcomingItem,
  UpcomingItemKind,
  WaitingOnItem,
  WaitingOnReason,
} from "./types";

const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Higher rank = further along the pipeline (more career leverage). */
const STAGE_RANK: Record<PipelineStage, number> = {
  offer: 8,
  case_study: 7,
  interview: 6,
  hiring_manager: 5,
  recruiter_screen: 4,
  applied: 3,
  prospecting: 2,
  on_hold: 1,
  closed_lost: 0,
};

const WAITING_ON_LABELS: Record<WaitingOnReason, string> = {
  waiting_on_recruiter: "Waiting on recruiter",
  waiting_on_hiring_manager: "Waiting on hiring manager",
  waiting_on_interview_scheduling: "Waiting on interview scheduling",
  waiting_on_offer_decision: "Waiting on offer decision",
  waiting_on_reply: "Waiting on reply",
};

const UPCOMING_KIND_LABELS: Record<UpcomingItemKind, string> = {
  interview: "Interview",
  follow_up: "Follow-up",
  case_study_deadline: "Case study deadline",
  loom_deadline: "Loom deadline",
};

const ACTIONABLE_NEEDS_DYLAN = new Set(["loom_due", "follow_up_overdue", "prep_required"]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso.slice(0, 10)}T12:00:00`);
  const to = new Date(`${toIso.slice(0, 10)}T12:00:00`);
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

function isActive(opp: JobOpportunity): boolean {
  return opp.stage !== "closed_lost" && opp.stage !== "on_hold";
}

function isDueToday(isoDate: string | null): boolean {
  if (!isoDate) return false;
  return isoDate.slice(0, 10) <= todayIso();
}

function isDueThisWeek(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const date = isoDate.slice(0, 10);
  const today = todayIso();
  const weekEnd = addDays(today, 7);
  return date > today && date <= weekEnd;
}

function inferWaitingReason(opp: JobOpportunity): WaitingOnReason | null {
  if (opp.stage === "offer") return "waiting_on_offer_decision";
  if (opp.stage === "interview" && !opp.checklist.interview_scheduled) {
    return "waiting_on_interview_scheduling";
  }
  if (opp.stage === "hiring_manager" && !opp.checklist.interview_scheduled) {
    return "waiting_on_hiring_manager";
  }
  if (opp.waitingOnReply || opp.stage === "on_hold") {
    if (opp.checklist.recruiter_contacted && !opp.checklist.follow_up_sent) {
      return "waiting_on_recruiter";
    }
    return "waiting_on_reply";
  }
  return null;
}

function buildHealthSummary(opportunities: JobOpportunity[]): CareerHealthSummary {
  const today = todayIso();
  const byCategory = {} as CareerHealthSummary["byCategory"];
  for (const cat of Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]) {
    byCategory[cat] = opportunities.filter((o) => o.roleCategory === cat).length;
  }

  const active = opportunities.filter(isActive);

  return {
    total: opportunities.length,
    byCategory,
    activeInterviews: active.filter(
      (o) => o.stage === "interview" || o.checklist.interview_scheduled,
    ).length,
    caseStudiesInProgress: opportunities.filter((o) => o.stage === "case_study").length,
    waitingOnReplyCount: opportunities.filter((o) => o.waitingOnReply === true).length,
    followUpsDueCount: active.filter(
      (o) => o.followUpDate && o.followUpDate.slice(0, 10) <= today,
    ).length,
  };
}

function sortNeedsDylanToday(
  items: NeedsDylanItem[],
  oppById: Map<string, JobOpportunity>,
): NeedsDylanItem[] {
  return [...items].sort((a, b) => {
    const da = a.followUpDate ?? "9999-12-31";
    const db = b.followUpDate ?? "9999-12-31";
    if (da !== db) return da.localeCompare(db);

    const pa = PRIORITY_ORDER[a.priority];
    const pb = PRIORITY_ORDER[b.priority];
    if (pa !== pb) return pa - pb;

    const stageA = STAGE_RANK[oppById.get(a.opportunityId)?.stage ?? "prospecting"];
    const stageB = STAGE_RANK[oppById.get(b.opportunityId)?.stage ?? "prospecting"];
    if (stageA !== stageB) return stageB - stageA;

    const waitA = oppById.get(a.opportunityId)?.waitingOnReply ? 1 : 0;
    const waitB = oppById.get(b.opportunityId)?.waitingOnReply ? 1 : 0;
    return waitA - waitB;
  });
}

function buildNeedsDylanToday(
  opportunities: JobOpportunity[],
  allNeedsDylan: NeedsDylanItem[],
): NeedsDylanItem[] {
  const oppById = new Map(opportunities.map((o) => [o.id, o]));
  const actionable = allNeedsDylan.filter((item) => ACTIONABLE_NEEDS_DYLAN.has(item.category));
  return sortNeedsDylanToday(actionable, oppById);
}

function buildWaitingOn(opportunities: JobOpportunity[]): WaitingOnItem[] {
  const today = todayIso();
  const items: WaitingOnItem[] = [];

  for (const opp of opportunities) {
    if (opp.stage === "closed_lost") continue;
    const reason = inferWaitingReason(opp);
    if (!reason) continue;

    items.push({
      opportunityId: opp.id,
      company: opp.company,
      roleTitle: opp.roleTitle,
      reason,
      reasonLabel: WAITING_ON_LABELS[reason],
      lastTouchpoint: opp.lastTouchpoint,
      daysWaiting: daysBetween(opp.lastTouchpoint, today),
    });
  }

  return items.sort((a, b) => b.daysWaiting - a.daysWaiting);
}

function buildUpcoming(opportunities: JobOpportunity[]): UpcomingItem[] {
  const items: UpcomingItem[] = [];

  for (const opp of opportunities) {
    if (opp.stage === "closed_lost") continue;

    if (opp.checklist.interview_scheduled && opp.followUpDate && isDueThisWeek(opp.followUpDate)) {
      items.push({
        date: opp.followUpDate.slice(0, 10),
        company: opp.company,
        roleTitle: opp.roleTitle,
        actionRequired: opp.nextAction || "Prepare for interview",
        kind: "interview",
        kindLabel: UPCOMING_KIND_LABELS.interview,
        opportunityId: opp.id,
      });
    }

    if (
      opp.followUpDate &&
      isDueThisWeek(opp.followUpDate) &&
      !isDueToday(opp.followUpDate) &&
      isActive(opp)
    ) {
      items.push({
        date: opp.followUpDate.slice(0, 10),
        company: opp.company,
        roleTitle: opp.roleTitle,
        actionRequired: opp.nextAction,
        kind: "follow_up",
        kindLabel: UPCOMING_KIND_LABELS.follow_up,
        opportunityId: opp.id,
      });
    }

    if (opp.stage === "case_study" && opp.followUpDate) {
      const date = opp.followUpDate.slice(0, 10);
      const today = todayIso();
      const weekEnd = addDays(today, 7);
      if (date >= today && date <= weekEnd) {
        items.push({
          date,
          company: opp.company,
          roleTitle: opp.roleTitle,
          actionRequired: opp.nextAction,
          kind: "case_study_deadline",
          kindLabel: UPCOMING_KIND_LABELS.case_study_deadline,
          opportunityId: opp.id,
        });
      }
    }

    if (
      opp.checklist.case_study_required &&
      !opp.checklist.loom_recorded &&
      opp.stage === "case_study" &&
      opp.followUpDate
    ) {
      const date = opp.followUpDate.slice(0, 10);
      items.push({
        date,
        company: opp.company,
        roleTitle: opp.roleTitle,
        actionRequired: "Record and submit Loom",
        kind: "loom_deadline",
        kindLabel: UPCOMING_KIND_LABELS.loom_deadline,
        opportunityId: opp.id,
      });
    }
  }

  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.opportunityId}:${item.kind}:${item.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildTopOpportunities(opportunities: JobOpportunity[]): TopOpportunityItem[] {
  const ranked = opportunities
    .filter((o) => o.stage !== "closed_lost")
    .map((opp) => {
      const priorityScore = 3 - PRIORITY_ORDER[opp.priority];
      const stageScore = STAGE_RANK[opp.stage];
      const dueScore =
        opp.followUpDate && isDueToday(opp.followUpDate)
          ? 2
          : opp.followUpDate && isDueThisWeek(opp.followUpDate)
            ? 1
            : 0;
      const actionableScore =
        opp.prepRequired ||
        (opp.checklist.case_study_required && !opp.checklist.loom_recorded)
          ? 1
          : 0;
      const rank = priorityScore * 100 + stageScore * 10 + dueScore * 5 + actionableScore;
      return { opp, rank };
    })
    .sort((a, b) => b.rank - a.rank);

  return ranked.map(({ opp }, index) => ({
    opportunityId: opp.id,
    company: opp.company,
    roleTitle: opp.roleTitle,
    stage: opp.stage,
    stageLabel: STAGE_LABELS[opp.stage],
    priority: opp.priority,
    recommendedNextAction: opp.nextAction,
    rank: index + 1,
  }));
}

function buildSuggestedNextMove(
  needsDylanToday: NeedsDylanItem[],
  topOpportunities: TopOpportunityItem[],
): SuggestedNextMove {
  const top = needsDylanToday[0];
  if (top) {
    if (top.category === "loom_due") {
      const due = top.followUpDate && isDueToday(top.followUpDate) ? " before noon" : "";
      return {
        headline: `Record ${top.company} Loom${due}.`,
        explanation: `${top.company} is in case study — Loom not recorded. ${top.nextAction}`,
        opportunityId: top.opportunityId,
      };
    }
    if (top.category === "follow_up_overdue") {
      return {
        headline: `Send ${top.company} follow-up.`,
        explanation: `Follow-up was due ${top.followUpDate ?? "today"}. ${top.nextAction}`,
        opportunityId: top.opportunityId,
      };
    }
    if (top.category === "prep_required") {
      const dueNote =
        top.followUpDate && isDueToday(top.followUpDate) ? " due today" : "";
      return {
        headline: `Complete prep for ${top.company}${dueNote}.`,
        explanation: top.nextAction,
        opportunityId: top.opportunityId,
      };
    }
  }

  const lead = topOpportunities[0];
  if (lead) {
    return {
      headline: lead.recommendedNextAction,
      explanation: `${lead.company} · ${lead.stageLabel} · ${lead.priority} priority`,
      opportunityId: lead.opportunityId,
    };
  }

  return {
    headline: "Review pipeline and set next follow-up dates.",
    explanation: "No urgent actions flagged from current opportunity data.",
    opportunityId: null,
  };
}

export function buildCareerBriefModel(
  opportunities: JobOpportunity[],
  user: PublicUser,
): CareerBriefModel {
  const allNeedsDylan = buildNeedsDylanItems(opportunities);
  const needsDylanToday = buildNeedsDylanToday(opportunities, allNeedsDylan);
  const topOpportunities = buildTopOpportunities(opportunities);

  return {
    generatedAt: new Date().toISOString(),
    owner: { id: user.id, name: user.name },
    health: buildHealthSummary(opportunities),
    needsDylanToday,
    waitingOn: buildWaitingOn(opportunities),
    upcoming: buildUpcoming(opportunities),
    topOpportunities,
    suggestedNextMove: buildSuggestedNextMove(needsDylanToday, topOpportunities),
    roleLabels: ROLE_LABELS,
    stageLabels: STAGE_LABELS,
  };
}

export { WAITING_ON_LABELS, UPCOMING_KIND_LABELS };
