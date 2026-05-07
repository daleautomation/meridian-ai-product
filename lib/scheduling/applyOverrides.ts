// Meridian — Apply schedule overrides at SSR.
//
// Takes the operator-page prop bag (callTheseFirst, todayList,
// remaining, rest) and a list of persisted overrides, and produces
// re-bucketed lists. Each lead carries its override metadata so the
// UI can render a "Moved" / "Follow-up" / "Skipped" tag.
//
// This is a pure function — never throws, never mutates inputs.
// The original snapshot props stay unchanged so the snapshot file
// itself remains canonical.

import type { ScheduleOverride } from "./overrideStore";

export interface OperatorBucketProps {
  callTheseFirst: unknown[];
  todayList: unknown[];
  remaining: unknown[];
  rest: unknown[];
  // The pipelineMap and other props pass through unchanged.
}

type BucketName = "callTheseFirst" | "todayList" | "remaining" | "rest";

function leadKey(l: unknown): string | null {
  if (!l || typeof l !== "object") return null;
  const lead = l as Record<string, unknown>;
  if (typeof lead.key === "string") return lead.key;
  if (typeof lead.id === "string") return lead.id;
  return null;
}

function tagLead(lead: unknown, override: ScheduleOverride): unknown {
  if (!lead || typeof lead !== "object") return lead;
  const next: Record<string, unknown> = { ...(lead as Record<string, unknown>) };
  next.scheduleOverride = {
    action: override.action,
    scheduledFor: override.scheduledFor,
    repId: override.repId,
    updatedAt: override.updatedAt,
    updatedBy: override.updatedBy,
  };
  if (override.scheduledFor) next.scheduledFor = override.scheduledFor;
  if (override.repId) next.assignedRepId = override.repId;
  return next;
}

/**
 * Apply overrides to bucketed lead lists. Returns a new prop bag.
 * Overrides routing:
 *   move_today      → callTheseFirst (front)
 *   move_tomorrow   → todayList
 *   move_next_week  → todayList
 *   follow_up       → rest
 *   skip            → rest
 *   assign_rep      → keep current bucket, attach repId
 *   clear           → keep current bucket (override is gone)
 */
export function applyScheduleOverrides<P extends OperatorBucketProps>(
  props: P,
  overrides: ScheduleOverride[],
): P {
  if (!overrides || overrides.length === 0) return props;

  const overrideMap = new Map<string, ScheduleOverride>();
  for (const ov of overrides) overrideMap.set(ov.leadId, ov);

  // Snapshot original placements so non-relocating overrides
  // (assign_rep, clear) keep their existing bucket.
  type Tagged = { lead: unknown; from: BucketName };
  const all: Tagged[] = [];
  for (const lead of props.callTheseFirst) all.push({ lead, from: "callTheseFirst" });
  for (const lead of props.todayList) all.push({ lead, from: "todayList" });
  for (const lead of props.remaining) all.push({ lead, from: "remaining" });
  for (const lead of props.rest) all.push({ lead, from: "rest" });

  const out: Record<BucketName, unknown[]> = {
    callTheseFirst: [],
    todayList: [],
    remaining: [],
    rest: [],
  };
  // Front-loaded leads from move_today need to land at the top of
  // callTheseFirst regardless of original order.
  const moveTodayPrepend: unknown[] = [];

  for (const { lead, from } of all) {
    const key = leadKey(lead);
    const ov = key ? overrideMap.get(key) : null;
    if (!ov) {
      out[from].push(lead);
      continue;
    }
    const tagged = tagLead(lead, ov);
    switch (ov.action) {
      case "move_today":
        moveTodayPrepend.push(tagged);
        continue;
      case "move_tomorrow":
      case "move_next_week":
        out.todayList.push(tagged);
        continue;
      case "follow_up":
      case "skip":
        out.rest.push(tagged);
        continue;
      case "assign_rep":
      case "clear":
      default:
        out[from].push(tagged);
        continue;
    }
  }

  return {
    ...props,
    callTheseFirst: [...moveTodayPrepend, ...out.callTheseFirst],
    todayList: out.todayList,
    remaining: out.remaining,
    rest: out.rest,
  };
}
