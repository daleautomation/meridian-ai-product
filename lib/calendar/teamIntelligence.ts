// Meridian AI — Team Intelligence aggregation.
//
// Pure aggregator that takes user-, client-, and tenant-scoped event
// streams and merges them into a single OutcomeEvent[] for downstream
// learning. No I/O, no scoring — weighting stays in patternLearning /
// outcomeLearning where it belongs. This file only decides which
// streams to combine and reports source counts back to the caller.

import type { OutcomeEvent } from "./outcomeLearning";

export type TeamIntelligenceMode =
  | "user_only"
  | "client"
  | "tenant"
  | "hybrid";

export interface TeamLearningInput {
  userEvents: OutcomeEvent[];
  clientEvents?: OutcomeEvent[];
  tenantEvents?: OutcomeEvent[];
  mode?: TeamIntelligenceMode;
}

export interface TeamLearningResult {
  events: OutcomeEvent[];
  sourceCounts: {
    user: number;
    client: number;
    tenant: number;
  };
  mode: TeamIntelligenceMode;
  reason: string;
}

const MAX_TEAM_EVENTS = 500;

function safeArr(a: OutcomeEvent[] | undefined | null): OutcomeEvent[] {
  return Array.isArray(a) ? a : [];
}

function dedupeById(events: OutcomeEvent[]): OutcomeEvent[] {
  const seen = new Set<string>();
  const out: OutcomeEvent[] = [];
  for (const e of events) {
    if (!e || !e.id) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function sortNewestFirst(events: OutcomeEvent[]): OutcomeEvent[] {
  return [...events].sort((a, b) => {
    const at = a.occurredAt || "";
    const bt = b.occurredAt || "";
    if (at === bt) return 0;
    return at < bt ? 1 : -1;
  });
}

export function buildTeamLearningInput(input: TeamLearningInput): TeamLearningResult {
  const userEvents = safeArr(input.userEvents);
  const clientEvents = safeArr(input.clientEvents);
  const tenantEvents = safeArr(input.tenantEvents);
  const mode: TeamIntelligenceMode = input.mode ?? "hybrid";

  let pool: OutcomeEvent[];
  let reason: string;

  switch (mode) {
    case "user_only":
      pool = userEvents;
      reason = "user_only: using only the operator's own outcomes.";
      break;
    case "client":
      // User events take priority on dedupe (same id wins from user pool).
      pool = [...userEvents, ...clientEvents];
      reason = "client: combining operator + client-level outcomes.";
      break;
    case "tenant":
      pool = [...userEvents, ...clientEvents, ...tenantEvents];
      reason = "tenant: combining operator + client + tenant outcomes.";
      break;
    case "hybrid":
    default:
      pool = [...userEvents, ...clientEvents, ...tenantEvents];
      reason = "hybrid: combining all available scopes; deduped by event id.";
      break;
  }

  const events = sortNewestFirst(dedupeById(pool)).slice(0, MAX_TEAM_EVENTS);

  return {
    events,
    sourceCounts: {
      user: userEvents.length,
      client: clientEvents.length,
      tenant: tenantEvents.length,
    },
    mode,
    reason,
  };
}
