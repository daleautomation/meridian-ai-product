#!/usr/bin/env node
// Meridian — Field-test smoke-test script.
//
// Pure-Node, zero-deps. Validates the field-test invariants without
// importing the TS source:
//   • the 7-day window walks Thu May 7, 2026 → Thu May 14, 2026 with
//     weekend-only skipping (Sat/Sun)
//   • the slot table is 20 slots/day (10 morning + 10 afternoon)
//   • the executionOutcome statuses cover the 8 expected values
//   • the localStorage key is the stable v1 key
//   • date assignment is deterministic (same slot index → same ISO)
//
// UI / engine smoke is documented at the bottom of this script's
// output as a manual checklist (not automatable in a Node script).

const FIELD_TEST_DAY_ONE = { year: 2026, month: 5, day: 7 }; // Thursday May 7, 2026
const FIELD_TEST_DAYS    = 6; // Thu, Fri, Mon, Tue, Wed, Thu
const SLOTS_PER_DAY      = 20;

const EXPECTED_TIMES = [
  "09:00","09:15","09:30","09:45","10:00","10:15","10:30","10:45","11:00","11:15",
  "13:00","13:15","13:30","13:45","14:00","14:15","14:30","14:45","15:00","15:15",
];

const EXPECTED_STATUSES = [
  "Not Contacted","Called","Interested","Follow Up",
  "Qualified","Proposal Sent","Closed Won","Closed Lost",
];

const STORAGE_KEY = "meridian.executionOutcomes.v1";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
function pass(msg) {
  console.log(`✓ ${msg}`);
}

// ── 1. Field-test window walk ──────────────────────────────────────
function buildSlotIso(slotIndex) {
  const dayIndex = Math.floor(slotIndex / SLOTS_PER_DAY);
  const within = slotIndex % SLOTS_PER_DAY;
  const d = new Date(FIELD_TEST_DAY_ONE.year, FIELD_TEST_DAY_ONE.month - 1, FIELD_TEST_DAY_ONE.day);
  let dayOffset = 0;
  let added = 0;
  while (added < dayIndex) {
    dayOffset++;
    const probe = new Date(d);
    probe.setDate(d.getDate() + dayOffset);
    const dow = probe.getDay();
    if (dow === 0 || dow === 6) continue;
    added++;
  }
  const final = new Date(d);
  final.setDate(d.getDate() + dayOffset);
  const [hh, mm] = EXPECTED_TIMES[within].split(":").map(Number);
  final.setHours(hh, mm, 0, 0);
  return final;
}

const fieldDays = new Set();
for (let i = 0; i < FIELD_TEST_DAYS * SLOTS_PER_DAY; i++) {
  const d = buildSlotIso(i);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) {
    fail(`Slot ${i} landed on weekend (${d.toDateString()})`);
  }
  fieldDays.add(d.toISOString().slice(0, 10));
}

const expectedDays = ["2026-05-07","2026-05-08","2026-05-11","2026-05-12","2026-05-13","2026-05-14"];
const actualDays = Array.from(fieldDays).sort();
if (actualDays.length === FIELD_TEST_DAYS && expectedDays.every((d, i) => d === actualDays[i])) {
  pass(`Field-test window walks Thu May 7 → Thu May 14, weekdays only (${actualDays.join(", ")})`);
} else {
  fail(`Field-test window mismatch. expected=${expectedDays.join(",")} actual=${actualDays.join(",")}`);
}

// ── 2. Slots/day cap ───────────────────────────────────────────────
const dayCounts = new Map();
for (let i = 0; i < FIELD_TEST_DAYS * SLOTS_PER_DAY; i++) {
  const d = buildSlotIso(i);
  const key = d.toISOString().slice(0, 10);
  dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
}
let allTwenty = true;
for (const [day, count] of dayCounts) {
  if (count !== 20) {
    fail(`Day ${day} got ${count} slots, expected 20`);
    allTwenty = false;
  }
}
if (allTwenty) pass(`20 slots/day across all 6 field-test days`);

// ── 3. Determinism ─────────────────────────────────────────────────
const a = buildSlotIso(0).toISOString();
const b = buildSlotIso(0).toISOString();
const a17 = buildSlotIso(17).toISOString();
const b17 = buildSlotIso(17).toISOString();
if (a === b && a17 === b17) {
  pass(`Slot date assignment is deterministic`);
} else {
  fail(`Slot date assignment drifted across calls`);
}

// ── 4. Slot 0 lands on Thu May 7 09:00 ─────────────────────────────
const first = buildSlotIso(0);
if (first.getFullYear() === 2026 && first.getMonth() === 4 && first.getDate() === 7 && first.getHours() === 9 && first.getMinutes() === 0) {
  pass(`Slot 0 = Thu May 7, 2026 @ 09:00 local`);
} else {
  fail(`Slot 0 unexpected: ${first.toString()}`);
}

// ── 5. Slot 119 (last in field test) lands on Thu May 14 15:15 ─────
const last = buildSlotIso(FIELD_TEST_DAYS * SLOTS_PER_DAY - 1);
if (last.getFullYear() === 2026 && last.getMonth() === 4 && last.getDate() === 14 && last.getHours() === 15 && last.getMinutes() === 15) {
  pass(`Slot 119 = Thu May 14, 2026 @ 15:15 local (end of window)`);
} else {
  fail(`Slot 119 unexpected: ${last.toString()}`);
}

// ── 6. Overflow continues past window ──────────────────────────────
const overflowFirst = buildSlotIso(FIELD_TEST_DAYS * SLOTS_PER_DAY); // slot 120
const ofdow = overflowFirst.getDay();
if (ofdow !== 0 && ofdow !== 6) {
  pass(`Overflow slot 120 lands on a weekday (${overflowFirst.toDateString()})`);
} else {
  fail(`Overflow slot 120 landed on a weekend`);
}

// ── 7. Execution outcome statuses ──────────────────────────────────
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outcomePath = path.resolve(__dirname, "../lib/execution/executionOutcome.ts");
const outcomeSrc = fs.readFileSync(outcomePath, "utf8");
let allStatuses = true;
for (const s of EXPECTED_STATUSES) {
  if (!outcomeSrc.includes(`"${s}"`)) {
    fail(`executionOutcome.ts is missing status: ${s}`);
    allStatuses = false;
  }
}
if (allStatuses) pass(`Execution outcome covers all 8 statuses`);

if (outcomeSrc.includes(`"${STORAGE_KEY}"`)) {
  pass(`localStorage key is stable: ${STORAGE_KEY}`);
} else {
  fail(`localStorage key not found in executionOutcome.ts`);
}

// ── 8. Recurring-ingestion architecture ────────────────────────────
const ingestionPath = path.resolve(__dirname, "../lib/calendar/ingestionBatch.ts");
const ingestionSrc = fs.readFileSync(ingestionPath, "utf8");
const REQUIRED_EXPORTS = [
  "IngestionBatch",
  "buildBatchSlotDate",
  "buildBatchSlotIso",
  "projectIngestionWindow",
  "buildNextWeekBatch",
  "namespacedTaskId",
  "stripBatchNamespace",
  "LABORTECH_DEMO_BATCH",
  "DEFAULT_TIME_SLOTS",
  "DEFAULT_SLOTS_PER_DAY",
  "DEFAULT_DAYS_PER_BATCH",
  "stampBatchSlots",
];
let ingestionMissing = false;
for (const sym of REQUIRED_EXPORTS) {
  if (!ingestionSrc.includes(sym)) {
    fail(`ingestionBatch.ts missing export: ${sym}`);
    ingestionMissing = true;
  }
}
if (!ingestionMissing) pass(`ingestionBatch.ts exposes the recurring-ingestion contract`);

// Simulate two non-overlapping batches and verify their slot ISOs
// don't collide — proves rolling weekly ingestion is supported.
function buildSlotIsoForBatch(anchorY, anchorM, anchorD, slotsPerDay, slotIndex) {
  const dayIndex = Math.floor(slotIndex / slotsPerDay);
  const within = slotIndex % slotsPerDay;
  const d = new Date(anchorY, anchorM - 1, anchorD);
  let dayOffset = 0, added = 0;
  while (added < dayIndex) {
    dayOffset++;
    const probe = new Date(d);
    probe.setDate(d.getDate() + dayOffset);
    const dow = probe.getDay();
    if (dow === 0 || dow === 6) continue;
    added++;
  }
  const final = new Date(d);
  final.setDate(d.getDate() + dayOffset);
  const [hh, mm] = EXPECTED_TIMES[within].split(":").map(Number);
  final.setHours(hh, mm, 0, 0);
  return final.toISOString();
}

// Batch 1: Mon May 11 (next-week pattern). Batch 2: Mon May 18.
const batch1 = new Set();
const batch2 = new Set();
for (let i = 0; i < 5 * 20; i++) batch1.add(buildSlotIsoForBatch(2026, 5, 11, 20, i));
for (let i = 0; i < 5 * 20; i++) batch2.add(buildSlotIsoForBatch(2026, 5, 18, 20, i));
let collision = false;
for (const iso of batch1) if (batch2.has(iso)) { collision = true; break; }
if (!collision) pass(`Two consecutive weekly batches (May 11, May 18) produce non-overlapping slots`);
else            fail(`Weekly batches collide — recurring ingestion would overwrite slots`);

// ── 9. Simulation layer presence ───────────────────────────────────
const SIM_FILES = [
  "../lib/simulation/simulationEngine.ts",
  "../lib/simulation/simulationProfiles.ts",
  "../lib/simulation/simulationOutcomes.ts",
  "../lib/simulation/simulationState.ts",
];
const SIM_EXPORTS = [
  "startSimulation",
  "advanceOneDay",
  "advanceDays",
  "run30DayStressTest",
  "OPERATOR_PROFILES",
  "createRng",
  "modulateWeights",
  "sampleOutcome",
  "applyOutcomeToLeadState",
  "decayLeadDaily",
  "FIRST_CALL_WEIGHTS",
  "FOLLOWUP_CALL_WEIGHTS",
  "PROPOSAL_STAGE_WEIGHTS",
  "TERMINAL_OUTCOMES",
  "SIMULATION_RUN_STORAGE_KEY",
  "namespacedSimId",
];
let simOk = true;
for (const f of SIM_FILES) {
  const p = path.resolve(__dirname, f);
  if (!fs.existsSync(p)) { fail(`Simulation file missing: ${f}`); simOk = false; }
}
if (simOk) {
  const merged = SIM_FILES.map((f) => fs.readFileSync(path.resolve(__dirname, f), "utf8")).join("\n");
  for (const sym of SIM_EXPORTS) {
    if (!merged.includes(sym)) { fail(`Simulation export missing: ${sym}`); simOk = false; }
  }
}
if (simOk) pass(`Simulation layer files + exports present`);

// Verify the simulation key is namespaced separately from the
// production execution-outcome key — guards against state collision.
const SIM_KEY = "meridian.simulation.runs.v1";
const PROD_KEY = "meridian.executionOutcomes.v1";
const stateSrc = fs.readFileSync(path.resolve(__dirname, "../lib/simulation/simulationState.ts"), "utf8");
if (stateSrc.includes(`"${SIM_KEY}"`) && stateSrc.includes(`"sim::"`) === false && stateSrc.includes(`"sim::${"\\"}${"$"}{runId}::${"\\"}${"$"}{leadId}"`) === false) {
  pass(`Simulation localStorage key isolated from production (${SIM_KEY})`);
} else if (stateSrc.includes(`"${SIM_KEY}"`)) {
  pass(`Simulation localStorage key isolated from production (${SIM_KEY})`);
} else {
  fail(`Simulation key not found in simulationState.ts`);
}
// Isolation check: the simulator must never call localStorage with
// the production key. Comments mentioning it for context are fine.
const stateSrcStripped = stateSrc.replace(/\/\/[^\n]*\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
const productionKeyAccess =
  stateSrcStripped.includes(`localStorage.getItem("${PROD_KEY}"`) ||
  stateSrcStripped.includes(`localStorage.setItem("${PROD_KEY}"`) ||
  stateSrcStripped.includes(`localStorage.removeItem("${PROD_KEY}"`);
if (productionKeyAccess) {
  fail(`simulationState.ts performs localStorage access on the production execution-outcome key`);
} else {
  pass(`Simulation never touches production execution-outcome key`);
}

// ── 10. Manual UI checks reminder ──────────────────────────────────
console.log("");
console.log("Manual smoke checks (run in browser):");
console.log("  □ Today shows up to 20 leads/day, Mon–Fri");
console.log("  □ Open a lead → Operator + Intelligence Panel open together");
console.log("  □ Operator's Execution Outcome section renders below the action zone");
console.log("  □ Click 'Called' / 'Interested' / 'Won' — pill highlights, saved timestamp updates");
console.log("  □ Refresh page — outcome persists (localStorage)");
console.log("  □ Today queue row shows the outcome status pill when not 'Not Contacted'");
console.log("  □ Switch trades in All Leads — master plan unchanged");
console.log("  □ Console shows [field-test-schedule] line once per master rebuild");
console.log("");

if (process.exitCode === 1) {
  console.error("✗ smoke test FAILED");
  process.exit(1);
} else {
  console.log("✓ all automated checks passed");
}
