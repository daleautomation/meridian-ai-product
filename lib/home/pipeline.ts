// Meridian Command — the Reality Pipeline.
//
// Reality → Connectors → Observations → Beliefs → Recommendations → Daily Brief.
// One function runs the whole thing from whatever connector inputs are present.
// Adding a connector = one register() line; nothing else changes.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { safeReadJson, safeWriteJson } from "@/lib/utils/fsSafeWrite";
import { ConnectorRegistry } from "@/lib/connectors/registry";
import { GmailConnector } from "@/lib/connectors/gmail";
import { GoogleCalendarConnector, type CalendarBatch } from "@/lib/connectors/googleCalendar";
import { GoogleContactsConnector } from "@/lib/connectors/googleContacts";
import { LinkedInConnector, type LinkedInInput } from "@/lib/connectors/linkedin";
import { MemoryConnector } from "@/lib/connectors/memory";
import { getAllMemories } from "@/lib/memory/store";
import { isActive } from "@/lib/memory/types";
import type { Observation, SyncResult } from "@/lib/connectors/types";
import type { GmailThreadBatch } from "@/lib/gmail/types";
import { deriveBeliefs } from "@/lib/beliefs/engine";
import type { Belief, BeliefStore } from "@/lib/beliefs/types";
import { recommendFromBeliefs, type Recommendation } from "@/lib/beliefs/recommend";
import { buildDailyBrief, type DailyBrief } from "./brief";

export interface RealityInputs {
  gmail?: GmailThreadBatch;
  calendar?: CalendarBatch;
  contactsDir?: string;
  /** include the contacts connector even with no explicit dir (uses default). */
  contacts?: boolean;
  /** include the LinkedIn connector (reads data/linkedin/*). */
  linkedin?: boolean;
  linkedinInput?: LinkedInInput;
}

export interface RealityResult {
  observations: Observation[];
  results: SyncResult[];
  beliefs: Belief[];
  recommendations: Recommendation[];
  brief: DailyBrief;
}

export interface RunOptions {
  nowMs: number;
  owner?: string; // display name
  previousBeliefs?: Belief[];
}

export async function runRealityPipeline(inputs: RealityInputs, opts: RunOptions): Promise<RealityResult> {
  const owner = opts.owner ?? "Dylan";
  const registry = new ConnectorRegistry();

  if (inputs.gmail) registry.register(new GmailConnector(), inputs.gmail);
  if (inputs.calendar) registry.register(new GoogleCalendarConnector(), inputs.calendar);
  if (inputs.contacts || inputs.contactsDir) {
    registry.register(new GoogleContactsConnector(), { contactsDir: inputs.contactsDir });
  }
  if (inputs.linkedin || inputs.linkedinInput) {
    registry.register(new LinkedInConnector(), inputs.linkedinInput ?? {});
  }

  // Memory as a sensor: load once, feed the connector (visibility) AND the ranker
  // (transparent influence). Falls back to empty on any store error — never blocks.
  const allMemories = await getAllMemories("dylan").catch(() => []);
  const activeMemories = allMemories.filter((m) => isActive(m, opts.nowMs));
  registry.register(new MemoryConnector(), { memories: allMemories });

  const { observations, results } = await registry.runAll(opts.nowMs);
  const beliefs = deriveBeliefs(observations, { nowMs: opts.nowMs, previous: opts.previousBeliefs });
  const recommendations = recommendFromBeliefs(beliefs, activeMemories);
  const brief = buildDailyBrief(beliefs, recommendations, owner, new Date(opts.nowMs).toISOString());

  return { observations, results, beliefs, recommendations, brief };
}

// ── Persistence (file staging; mirrors the heartbeat/gmail store pattern) ─────

const OBSERVATIONS_PATH = path.join(process.cwd(), "data", "reality", "observations.json");
const BELIEFS_PATH = path.join(process.cwd(), "data", "reality", "beliefs.json");
const BRIEF_PATH = path.join(process.cwd(), "data", "reality", "brief-today.json");

export async function loadPreviousBeliefs(ownerId = "dylan"): Promise<Belief[]> {
  const store = await safeReadJson<BeliefStore>(BELIEFS_PATH);
  return store?.version === 1 && store.ownerId === ownerId ? store.beliefs : [];
}

export async function persistReality(result: RealityResult, ownerId = "dylan"): Promise<boolean> {
  const now = result.brief.generatedAt;
  const ok1 = await safeWriteJson(OBSERVATIONS_PATH, { version: 1, ownerId, syncedAt: now, observations: result.observations });
  const ok2 = await safeWriteJson(BELIEFS_PATH, { version: 1, ownerId, updatedAt: now, beliefs: result.beliefs } satisfies BeliefStore);
  const ok3 = await safeWriteJson(BRIEF_PATH, { version: 1, ownerId, brief: result.brief });
  return ok1 && ok2 && ok3;
}

export async function loadTodayBrief(): Promise<DailyBrief | null> {
  const store = await safeReadJson<{ brief: DailyBrief }>(BRIEF_PATH);
  return store?.brief ?? null;
}

// ── Live compute (works on read-only serverless FS — no persistence needed) ───

async function readJsonFile<T>(rel: string): Promise<T | null> {
  try { return JSON.parse(await fsp.readFile(path.join(process.cwd(), rel), "utf8")) as T; }
  catch { return null; }
}

/** Load the committed batch inputs (Gmail/Calendar) + Contacts + LinkedIn. */
export async function loadLiveRealityInputs(): Promise<RealityInputs> {
  const gmail = (await readJsonFile<RealityInputs["gmail"]>("data/gmail/inbox-batch.json")) ?? undefined;
  const calendar = (await readJsonFile<RealityInputs["calendar"]>("data/calendar/inbox-batch.json")) ?? undefined;
  return { gmail, calendar, contacts: true, linkedin: true };
}

/** Compute the brief live from committed batches. Read-only safe; always works. */
export async function computeLiveBrief(nowMs: number, owner = "Dylan"): Promise<RealityResult> {
  const inputs = await loadLiveRealityInputs();
  const previousBeliefs = await loadPreviousBeliefs();
  return runRealityPipeline(inputs, { nowMs, owner, previousBeliefs });
}

/** Freshness of the underlying inbox/calendar data (for the Last Updated line). */
export async function dataFreshness(): Promise<{ gmail: string | null; calendar: string | null }> {
  const g = await readJsonFile<{ fetchedAt?: string }>("data/gmail/inbox-batch.json");
  const c = await readJsonFile<{ fetchedAt?: string }>("data/calendar/inbox-batch.json");
  return { gmail: g?.fetchedAt ?? null, calendar: c?.fetchedAt ?? null };
}

export { BRIEF_PATH };
