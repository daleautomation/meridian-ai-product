// Meridian AI — Workflow Feedback Memory.
//
// Client-safe localStorage store for WorkflowFeedbackEvent[]. Mirrors
// outcomeMemory's safety contract (SSR-safe, JSON-corrupt-tolerant,
// dedupe by id, capped at 300 events) but uses a separate key so
// feedback never collides with outcome events.

import type { WorkflowFeedbackEvent } from "./workflowFeedback";
import {
  scopeKey as makeScopeKey,
  type IntelligenceScope,
} from "./intelligenceScope";

const BASE_KEY = "meridian.calendar.workflowFeedback.v1";
const MEMORY_CAP = 300;

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function scopedKey(scope?: IntelligenceScope | null): string {
  return `${BASE_KEY}::${makeScopeKey(scope)}`;
}

function dedupeById(events: WorkflowFeedbackEvent[]): WorkflowFeedbackEvent[] {
  const seen = new Set<string>();
  const out: WorkflowFeedbackEvent[] = [];
  for (const e of events) {
    if (!e || !e.id) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function sortNewestFirst(events: WorkflowFeedbackEvent[]): WorkflowFeedbackEvent[] {
  return [...events].sort((a, b) => {
    const at = a.occurredAt || "";
    const bt = b.occurredAt || "";
    if (at === bt) return 0;
    return at < bt ? 1 : -1;
  });
}

function readKey(key: string): WorkflowFeedbackEvent[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is WorkflowFeedbackEvent =>
        !!e &&
        typeof e === "object" &&
        typeof (e as WorkflowFeedbackEvent).id === "string" &&
        typeof (e as WorkflowFeedbackEvent).taskId === "string",
    );
  } catch {
    return [];
  }
}

function writeKey(key: string, events: WorkflowFeedbackEvent[]): void {
  if (!hasStorage()) return;
  try {
    const cleaned = sortNewestFirst(dedupeById(events)).slice(0, MEMORY_CAP);
    window.localStorage.setItem(key, JSON.stringify(cleaned));
  } catch {
    // Quota / disabled storage — silent. Memory is best-effort.
  }
}

export function loadWorkflowFeedback(
  scope?: IntelligenceScope | null,
): WorkflowFeedbackEvent[] {
  return readKey(scopedKey(scope));
}

export function saveWorkflowFeedback(
  events: WorkflowFeedbackEvent[],
  scope?: IntelligenceScope | null,
): void {
  writeKey(scopedKey(scope), events);
}

export function rememberWorkflowFeedback(
  event: WorkflowFeedbackEvent,
  scope?: IntelligenceScope | null,
): WorkflowFeedbackEvent[] {
  if (!event || !event.id) {
    return loadWorkflowFeedback(scope);
  }
  if (!hasStorage()) {
    return sortNewestFirst(dedupeById([event])).slice(0, MEMORY_CAP);
  }
  const key = scopedKey(scope);
  const stored = readKey(key);
  const merged = sortNewestFirst(dedupeById([event, ...stored])).slice(0, MEMORY_CAP);
  writeKey(key, merged);
  return merged;
}

export function clearWorkflowFeedback(scope?: IntelligenceScope | null): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(scopedKey(scope));
  } catch {
    // ignore
  }
}
