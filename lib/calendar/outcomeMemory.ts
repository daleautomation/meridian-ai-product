// Meridian AI — Outcome Memory.
//
// Client-safe localStorage-backed store for OutcomeEvent[]. SSR-safe:
// every accessor checks `typeof window` before touching storage and
// returns a benign default otherwise. Bounded to the most recent 500
// events, sorted newest first, deduped by event id, and tolerant of
// corrupt JSON. No persistence of events tagged as mock/demo.
//
// This is the only file that talks to localStorage for the calendar
// learning layer. Everything else stays pure.

import type { OutcomeEvent } from "./outcomeLearning";
import {
  scopedOutcomeMemoryKey,
  scopeKey as makeScopeKey,
  LEGACY_OUTCOME_MEMORY_KEY,
  type IntelligenceScope,
} from "./intelligenceScope";

// Kept exported for backward compatibility — points at the legacy
// (unscoped) key. New callers should pass a scope and let the scoped
// helper derive the actual storage key.
export const OUTCOME_MEMORY_KEY = LEGACY_OUTCOME_MEMORY_KEY;
const MEMORY_CAP = 500;
// One-shot, in-memory guard so we only attempt the legacy → scoped
// migration once per scope per session. Avoids re-walking storage on
// every render.
const migratedScopes = new Set<string>();

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function isMockEvent(e: OutcomeEvent): boolean {
  // Heuristic: events the system explicitly tags as mock/demo. Today
  // none are so tagged, but the guard is here so we never persist them
  // if a future caller adds the flag.
  if (!e || !e.id) return true;
  if (e.source === "system") return false;
  if (typeof (e as unknown as { mock?: boolean }).mock === "boolean") {
    return Boolean((e as unknown as { mock?: boolean }).mock);
  }
  if (e.id.startsWith("mock-") || e.id.startsWith("demo-")) return true;
  return false;
}

function sortNewestFirst(events: OutcomeEvent[]): OutcomeEvent[] {
  return [...events].sort((a, b) => {
    const at = a.occurredAt || "";
    const bt = b.occurredAt || "";
    if (at === bt) return 0;
    return at < bt ? 1 : -1;
  });
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

function readKey(key: string): OutcomeEvent[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is OutcomeEvent =>
        !!e && typeof e === "object" && typeof (e as OutcomeEvent).id === "string",
    );
  } catch {
    return [];
  }
}

function writeKey(key: string, events: OutcomeEvent[]): void {
  if (!hasStorage()) return;
  try {
    const cleaned = sortNewestFirst(
      dedupeById(events.filter((e) => !isMockEvent(e))),
    ).slice(0, MEMORY_CAP);
    window.localStorage.setItem(key, JSON.stringify(cleaned));
  } catch {
    // Quota exceeded / storage disabled — silently no-op. Memory is a
    // best-effort enhancement, never required for correctness.
  }
}

// One-time copy of legacy unscoped events into the scoped key for the
// scope of the current session. Never deletes the legacy key — single-
// user / older builds keep working untouched.
function migrateLegacyIntoScopeOnce(scopedKey: string, scopeKeyStr: string): void {
  if (!hasStorage()) return;
  if (migratedScopes.has(scopeKeyStr)) return;
  migratedScopes.add(scopeKeyStr);
  try {
    const legacy = readKey(LEGACY_OUTCOME_MEMORY_KEY);
    if (legacy.length === 0) return;
    const scoped = readKey(scopedKey);
    if (scoped.length > 0) return; // scoped already populated, skip
    writeKey(scopedKey, legacy);
  } catch {
    // ignore migration errors
  }
}

export function loadOutcomeEvents(scope?: IntelligenceScope | null): OutcomeEvent[] {
  if (scope === undefined) {
    // Legacy call site (no arg): preserve old unscoped behavior so any
    // pre-existing caller continues to read the legacy key.
    return readKey(LEGACY_OUTCOME_MEMORY_KEY);
  }
  const key = scopedOutcomeMemoryKey(scope);
  migrateLegacyIntoScopeOnce(key, makeScopeKey(scope));
  return readKey(key);
}

export function saveOutcomeEvents(
  events: OutcomeEvent[],
  scope?: IntelligenceScope | null,
): void {
  const key = scope === undefined
    ? LEGACY_OUTCOME_MEMORY_KEY
    : scopedOutcomeMemoryKey(scope);
  writeKey(key, events);
}

export function mergeOutcomeEvents(
  existing: OutcomeEvent[],
  incoming: OutcomeEvent[],
): OutcomeEvent[] {
  const merged = dedupeById([...(incoming ?? []), ...(existing ?? [])]);
  return sortNewestFirst(merged).slice(0, MEMORY_CAP);
}

export function rememberOutcomeEvents(
  incoming: OutcomeEvent[],
  scope?: IntelligenceScope | null,
): OutcomeEvent[] {
  const filtered = (incoming ?? []).filter((e) => !isMockEvent(e));
  if (!hasStorage()) {
    return sortNewestFirst(dedupeById(filtered)).slice(0, MEMORY_CAP);
  }
  const key = scope === undefined
    ? LEGACY_OUTCOME_MEMORY_KEY
    : scopedOutcomeMemoryKey(scope);
  if (scope !== undefined) {
    migrateLegacyIntoScopeOnce(key, makeScopeKey(scope));
  }
  const stored = readKey(key);
  const merged = mergeOutcomeEvents(stored, filtered);
  writeKey(key, merged);
  return merged;
}

export function clearOutcomeMemory(scope?: IntelligenceScope | null): void {
  if (!hasStorage()) return;
  const key = scope === undefined
    ? LEGACY_OUTCOME_MEMORY_KEY
    : scopedOutcomeMemoryKey(scope);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
