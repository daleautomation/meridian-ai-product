import { getBusinessTodayIso } from "../dates/businessDate";
import { loadAllExecutionOutcomes } from "./executionOutcome";

type PullForwardEntry = {
  leadKey?: string | null;
  companyName?: string | null;
};

type TriggerPullForwardOptions = {
  status: string | null | undefined;
  overflowEntries: PullForwardEntry[] | null | undefined;
  workspaceSlug: string;
  pulledKeys?: Set<string>;
  onPulled?: () => void;
};

const PULL_FORWARD_TRIGGER_STATUSES = new Set([
  "Called",
  "Interested",
  "Follow Up",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
  "Not Qualified",
]);

const inflight = new Set<string>();

export function shouldPullForwardForOutcome(status: string | null | undefined): boolean {
  return typeof status === "string" && PULL_FORWARD_TRIGGER_STATUSES.has(status);
}

export function selectPullForwardCandidate(
  overflowEntries: PullForwardEntry[] | null | undefined,
  pulledKeys?: Set<string>,
): PullForwardEntry | null {
  const outcomes = typeof window === "undefined" ? {} : loadAllExecutionOutcomes();
  return (overflowEntries ?? []).find(
    (entry) =>
      entry
      && typeof entry.leadKey === "string"
      && !pulledKeys?.has(entry.leadKey)
      && (!outcomes[entry.leadKey] || outcomes[entry.leadKey]?.status === "Not Contacted"),
  ) ?? null;
}

export function triggerPullForward({
  status,
  overflowEntries,
  workspaceSlug,
  pulledKeys,
  onPulled,
}: TriggerPullForwardOptions): void {
  if (!shouldPullForwardForOutcome(status)) return;
  if (!workspaceSlug || typeof fetch !== "function") return;
  const candidate = selectPullForwardCandidate(overflowEntries, pulledKeys);
  if (!candidate?.leadKey) return;

  const scheduledFor = getBusinessTodayIso();
  const key = `${workspaceSlug}:${candidate.leadKey}:${scheduledFor}`;
  if (inflight.has(key)) return;
  inflight.add(key);
  pulledKeys?.add(candidate.leadKey);

  fetch("/api/scheduling/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      leadId: candidate.leadKey,
      workspaceSlug,
      action: "move_to_date",
      scheduledFor,
      updatedBy: "system:pull_forward",
    }),
  })
    .then((res) => {
      if (!res.ok) {
        pulledKeys?.delete(candidate.leadKey!);
        return;
      }
      onPulled?.();
    })
    .catch(() => {
      pulledKeys?.delete(candidate.leadKey!);
    })
    .finally(() => {
      inflight.delete(key);
    });
}
