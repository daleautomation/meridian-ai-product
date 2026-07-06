// Meridian Command — operator autonomy types (snapshots, change, health).
//
// No new product surface. These record what the morning operator did each day so
// Meridian remembers yesterday, detects what changed, and knows its own health.

import type { Belief } from "@/lib/beliefs/types";
import type { Recommendation } from "@/lib/beliefs/recommend";
import type { DailyBrief } from "@/lib/home/brief";

/** One immutable day. Never overwrites a prior day (keyed by date). */
export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  ownerId: string;
  generatedAt: string; // ISO
  observationCount: number;
  connectors: Array<{ id: string; state: string; observations: number }>;
  beliefs: Belief[];
  recommendations: Recommendation[];
  brief: DailyBrief;
}

export interface EnvPresence {
  cronSecret: boolean;
  notificationChannel: boolean;
  databaseUrl: boolean;
  baseUrl: boolean;
}

/** One run of the operator — the self-health record. */
export interface OperatorRun {
  runId: string;
  ownerId: string;
  runAt: string; // ISO
  trigger: "cron" | "manual";
  ok: boolean;
  connectors: Array<{ id: string; state: string; observations: number; healthy: boolean }>;
  notification: { sent: boolean; channel: string; detail: string };
  freshnessHours: number | null; // age of the newest inbox data
  stale: boolean;
  incompleteConnectors: string[];
  env: EnvPresence;
  storage: "neon" | "file" | "tmp";
  changeSummary: string;
}

/** Day-over-day change detection. */
export interface ChangeReport {
  date: string;
  comparedTo: string | null; // the prior snapshot date, or null on first run
  newBeliefs: string[]; // subjectLabels
  droppedBeliefs: string[];
  stageChanges: Array<{ label: string; from: string; to: string }>;
  strengthened: string[]; // momentum up
  cooled: string[]; // momentum down
  recommendationMoves: Array<{ label: string; from: number | "—"; to: number | "—" }>;
  headline: string;
}
