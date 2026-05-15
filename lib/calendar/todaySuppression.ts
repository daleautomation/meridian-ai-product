// Meridian — Today-queue suppression helpers.
//
// Extracted from app/operator/page.tsx without behavior change. These
// helpers compute the set of company/lead keys that should be hidden
// from the operator's Today queue because a recent activity, status
// change, or durable outcome has already cleared them.
//
// Behavioral contract preserved exactly:
//   • 24-hour suppression window (RECENT_CALL_SUPPRESSION_MS)
//   • Activity types: "call", "voicemail"
//   • Activity kinds: "follow_up_created", "follow_up_completed"
//   • Status values: CONTACTED, CALLED, VOICEMAIL, FOLLOW_UP
//   • Outcome values: "Called", "Follow Up"
//   • Output shape: TodaySuppressionInfo { companyKeys, leadKeys, ... }
//
// The route file (app/operator/page.tsx) re-exports the same names so
// no caller had to change. Tests should target this module directly.

import type { CrmActivity } from "@/lib/state/crmStore";
import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";
import type { ExecutionOutcomeMapValue } from "@/lib/execution/serverOutcomeStore";
import { leadIdentityCandidates } from "@/lib/leads/identity";

export const RECENT_CALL_SUPPRESSION_MS = 24 * 60 * 60 * 1000;
export const RECENT_ACTIVITY_TYPES = new Set(["call", "voicemail"]);
export const RECENT_ACTIVITY_KINDS = new Set(["follow_up_created", "follow_up_completed"]);
export const RECENT_STATUS_VALUES = new Set(["CONTACTED", "CALLED", "VOICEMAIL", "FOLLOW_UP"]);
export const RECENT_OUTCOME_VALUES = new Set(["Called", "Follow Up"]);

export type TodaySuppressionInfo = {
  generatedAt: string;
  windowHours: number;
  companyKeys: string[];
  leadKeys: string[];
  latestActivityAt: string | null;
};

export function recentEnough(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && nowMs - ms >= 0 && nowMs - ms < RECENT_CALL_SUPPRESSION_MS;
}

export function normalizeRecentStatus(status: string | null | undefined): string {
  return (status ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

export function buildRecentTodaySuppression({
  activities,
  snapshots,
  durableOutcomeMap,
}: {
  activities: CrmActivity[];
  snapshots: CompanySnapshot[];
  durableOutcomeMap: Record<string, ExecutionOutcomeMapValue>;
}): TodaySuppressionInfo {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const companyKeys = new Set<string>();
  let latestActivityAt: string | null = null;

  const remember = (key: string | null | undefined, at: string | null | undefined) => {
    if (!key || !recentEnough(at, now)) return;
    companyKeys.add(key);
    if (!latestActivityAt || (at && at > latestActivityAt)) latestActivityAt = at ?? latestActivityAt;
  };

  for (const activity of activities) {
    const kind = typeof activity.metadata?.kind === "string" ? activity.metadata.kind : "";
    const suppresses =
      RECENT_ACTIVITY_TYPES.has(activity.activityType)
      || activity.outcome === "follow_up_needed"
      || RECENT_ACTIVITY_KINDS.has(kind);
    if (suppresses) remember(activity.companyKey, activity.performedAt);
  }

  for (const snap of snapshots) {
    for (const change of snap.statusHistory ?? []) {
      if (RECENT_STATUS_VALUES.has(normalizeRecentStatus(change.status))) {
        remember(snap.key, change.changedAt);
      }
    }
    const lastActionType = normalizeRecentStatus(snap.lastAction?.type);
    if (RECENT_STATUS_VALUES.has(lastActionType) || RECENT_ACTIVITY_TYPES.has((snap.lastAction?.type ?? "").toLowerCase())) {
      remember(snap.key, snap.lastAction?.performedAt);
    }
  }

  for (const [key, outcome] of Object.entries(durableOutcomeMap)) {
    if (RECENT_OUTCOME_VALUES.has(outcome.status)) remember(key, outcome.lastActionAt);
  }

  return {
    generatedAt,
    windowHours: 24,
    companyKeys: Array.from(companyKeys),
    leadKeys: [],
    latestActivityAt,
  };
}

export function withRecentTodaySuppression<T extends Record<string, unknown>>(
  props: T,
  suppression: TodaySuppressionInfo,
): T {
  if (suppression.companyKeys.length === 0) {
    return { ...props, todaySuppression: suppression } as T;
  }
  const suppressed = new Set(suppression.companyKeys);
  const leadKeys = new Set<string>();
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const candidates = leadIdentityCandidates(item as Parameters<typeof leadIdentityCandidates>[0]);
      if (!candidates.some((key) => suppressed.has(key))) continue;
      candidates.forEach((key) => leadKeys.add(key));
    }
  };
  collect(props.callTheseFirst);
  collect(props.todayList);
  collect(props.remaining);
  collect(props.rest);

  return {
    ...props,
    todaySuppression: {
      ...suppression,
      leadKeys: Array.from(leadKeys),
    },
  } as T;
}
