// Meridian Command — memory validation (pure, no DB).
//
// Proves: memories emit observations; memory affects ranking ONLY with explanation;
// stale/pending memory is handled; reality-vs-memory conflict is surfaced; and no
// recommendation uses memory invisibly.

import type { Belief } from "../lib/beliefs/types";
import { recommendFromBeliefs } from "../lib/beliefs/recommend";
import { MEMORY_SEEDS } from "../lib/memory/seeds";
import { memoriesToObservations } from "../lib/memory/observations";
import type { Memory } from "../lib/memory/types";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok: ${label}`);
  else { console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); failed += 1; }
}

function belief(subjectKey: string, subjectLabel: string, company: string | null, momentum: Belief["momentum"]): Belief {
  return {
    subjectKey, subjectLabel, kind: "career", company, people: [], stage: "waiting_on_them", status: "waiting",
    momentum, momentumDelta: "flat", waitingOn: "them", confidence: "medium", engagement: "two_way",
    heat: "WARM", domain: null,
    firstActivityAt: "2026-07-01T00:00:00Z", lastActivityAt: "2026-07-06T00:00:00Z", observationCount: 3,
    latestInboundAt: null, latestOutboundAt: null, latestMeetingAt: null, nextAction: "", followUpDate: null,
    connectors: ["gmail"], claim: `${subjectLabel} active`, falsifier: "", changeLog: "",
    statusHistory: [], lastScanAt: "2026-07-06T00:00:00Z", evidence: [],
  };
}

const NOW = Date.parse("2026-07-07T00:00:00.000Z");

// ── Memory emits observations (as a sensor) ──────────────────────────────────
const staleMem: Memory = { id: "m-stale", type: "strategic_knowledge", subject: "OldCo", statement: "expired truth",
  confidence: "low", source: "manual", evidence: "x", status: "active", tags: [], impactAreas: ["revenue"],
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-02-01T00:00:00Z" };
const pendingMem: Memory = { id: "m-pending", type: "strategic_knowledge", subject: "Maybe", statement: "unconfirmed",
  confidence: "low", source: "daily_review", evidence: "proposed", status: "pending", tags: [], impactAreas: ["revenue"],
  createdAt: "2026-07-06T00:00:00Z", updatedAt: "2026-07-06T00:00:00Z" };

const obs = memoriesToObservations([...MEMORY_SEEDS, staleMem, pendingMem], NOW);
check("memories emit observations", obs.length > 0);
check("emits strategic_memory_active / preference_active / fact_active", ["strategic_memory_active", "preference_active", "fact_active"].every((t) => obs.some((o) => o.type === t)), obs.map((o) => o.type));
check("all memory observations carry no stage/score fields", obs.every((o) => !("stage" in o) && !("score" in o)));
check("expired-active memory emits memory_stale", obs.some((o) => o.type === "memory_stale" && o.entity === "oldco"));
check("pending memory does NOT emit (not accepted)", !obs.some((o) => o.evidence.nativeId === "m-pending"));

// ── Memory affects ranking ONLY with explanation ─────────────────────────────
const clueWarm = belief("clue insights", "Clue Insights", "getclue.com", "warm");
const acme = belief("acme corp", "Acme Corp", "acme.com", "warm"); // no matching memory

const withoutMemory = recommendFromBeliefs([clueWarm, acme], []);
const withMemory = recommendFromBeliefs([clueWarm, acme], MEMORY_SEEDS);

const clueBefore = withoutMemory.find((r) => r.subjectKey === "clue insights")!;
const clueAfter = withMemory.find((r) => r.subjectKey === "clue insights")!;
const acmeAfter = withMemory.find((r) => r.subjectKey === "acme corp")!;

check("without memory, Clue has no memory influence", clueBefore.memoryBoost === 0 && clueBefore.memoryUsed.length === 0);
check("memory raised Clue's leverage", clueAfter.leverage > clueBefore.leverage, { before: clueBefore.leverage, after: clueAfter.leverage });
check("memory moved Clue to rank #1", clueAfter.rank === 1, withMemory.map((r) => `${r.rank}:${r.subjectKey}`));
check("Clue ranking change is EXPLAINED (memoryUsed populated)", clueAfter.memoryUsed.length > 0 && clueAfter.memoryUsed.some((u) => /Clue/i.test(u)), clueAfter.memoryUsed);
check("unrelated Acme got NO memory boost (no invisible influence)", acmeAfter.memoryBoost === 0 && acmeAfter.memoryUsed.length === 0);
check("NO recommendation uses memory invisibly", withMemory.every((r) => r.memoryBoost === 0 ? r.memoryUsed.length === 0 || r.memoryUsed.every((u) => /context/.test(u)) : r.memoryUsed.length > 0));

// ── Reality-vs-memory conflict is surfaced, memory does not override ──────────
const clueCold = belief("clue insights", "Clue Insights", "getclue.com", "cold");
const cold = recommendFromBeliefs([clueCold], MEMORY_SEEDS)[0];
check("cold Clue + high strategic memory surfaces a conflict", cold.memoryConflict !== null && /momentum/.test(cold.memoryConflict ?? ""), cold.memoryConflict);
check("conflict reduces the memory boost (memory doesn't override reality)", cold.memoryBoost < clueAfter.memoryBoost, { cold: cold.memoryBoost, warm: clueAfter.memoryBoost });
check("conflict is still explained", cold.memoryUsed.length > 0);

// ── Determinism ──────────────────────────────────────────────────────────────
check("memory-influenced ranking is deterministic", JSON.stringify(recommendFromBeliefs([clueWarm, acme], MEMORY_SEEDS)) === JSON.stringify(withMemory));

if (failed > 0) { console.error(`\n[check-memory] ${failed} check(s) FAILED`); process.exitCode = 1; }
else console.log("\n[check-memory] all checks passed");
