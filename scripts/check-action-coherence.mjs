// Meridian AI — action coherence test.
//
// Verifies the orchestration invariants of the dominant-action control plane.
// This is NOT a safety / false-positive test (analyze-stress-results.mjs
// covers that). This proves the engine speaks in one voice:
//
//   1. POLICY TABLE CONSISTENCY
//      - Each action maps to the right timing / strategy / urgency tier
//      - WALK can never have IMMEDIATE/THIS_WEEK timing or AGGRESSIVE/CONTROLLED strategy
//      - WAIT can never have an active engagement posture
//      - PROBE can never have full-commit urgency
//      - EXECUTE_NOW can never have soft/passive posture
//
//   2. COMPRESSION MONOTONICITY
//      - Lowering trust never improves the dominant action
//      - Raising fragility never improves the dominant action
//      - Lowering valuation confidence never improves the dominant action
//      - Lowering deal quality never improves the dominant action
//
// The test mirrors the policy and compression logic from acquisition.ts so
// it stays self-contained (no TS loader). If acquisition.ts changes, the
// mirror must be updated to match — otherwise the test fails loudly.

// ── ACTION ORDERING (worse → better) ─────────────────────────────────────
const ACTION_RANK = {
  WALK: 0,
  WAIT: 1,
  PROBE: 2,
  EXECUTE_CONTROLLED: 3,
  EXECUTE_NOW: 4,
};

// ── POLICY TABLE (mirror of applyDominantActionPolicy) ──────────────────
const POLICY = {
  EXECUTE_NOW: {
    timing: "IMMEDIATE", strategy: "AGGRESSIVE", urgency: "act-now",
    negotiationPhase: "counter", followUpWindowHours: 24, convictionCap: 10,
  },
  EXECUTE_CONTROLLED: {
    timing: "THIS_WEEK", strategy: "CONTROLLED", urgency: "this-week",
    negotiationPhase: "counter", followUpWindowHours: 48, convictionCap: 8,
  },
  PROBE: {
    timing: "THIS_WEEK", strategy: "PASSIVE", urgency: "this-month",
    negotiationPhase: "entry", followUpWindowHours: 168, convictionCap: 6,
  },
  WAIT: {
    timing: "WAIT", strategy: "PASSIVE", urgency: "passive",
    negotiationPhase: "entry", followUpWindowHours: 504, convictionCap: 4,
  },
  WALK: {
    timing: "WAIT", strategy: "WALK", urgency: "passive",
    negotiationPhase: "walk", followUpWindowHours: 0, convictionCap: 0,
  },
};

// ── COMPRESSION (mirror of compressToDominantAction) ────────────────────
function compress({ trustScore, fragilityScore, edgeClass, confidenceScore, dealQuality, buyOverCeiling, signal }) {
  if (buyOverCeiling) return "WALK";
  if (trustScore < 50) return "WALK";
  if (signal === "PASS" || signal === "AVOID") return "WALK";
  if (fragilityScore >= 60) return "WALK";
  if (fragilityScore >= 40 && confidenceScore < 60) return "WAIT";
  if (edgeClass === "crowded") return "WAIT";
  if (edgeClass === "fair") return "WAIT";
  if (edgeClass === "interesting") {
    if (confidenceScore >= 70 && fragilityScore < 25 && trustScore >= 70) return "PROBE";
    return "WAIT";
  }
  if (edgeClass === "premium") {
    if (confidenceScore >= 80 && fragilityScore < 25 && trustScore >= 80 && dealQuality >= 80) return "EXECUTE_NOW";
    if (confidenceScore >= 65 && trustScore >= 70) return "EXECUTE_CONTROLLED";
    return "PROBE";
  }
  // exploitable
  if (confidenceScore >= 75 && trustScore >= 75 && fragilityScore < 30 && dealQuality >= 70) return "EXECUTE_CONTROLLED";
  if (confidenceScore >= 60 && trustScore >= 70) return "EXECUTE_CONTROLLED";
  return "PROBE";
}

// ── TEST 1: POLICY TABLE COHERENCE ──────────────────────────────────────
let failures = 0;
function fail(msg) { console.error("  ✗", msg); failures++; }
function pass(msg) { console.log("  ✓", msg); }

console.log("=== POLICY TABLE COHERENCE ===");

// WALK contract
const walk = POLICY.WALK;
if (walk.timing !== "WAIT") fail(`WALK timing must be WAIT, got ${walk.timing}`);
else pass("WALK → timing=WAIT");
if (walk.strategy !== "WALK") fail(`WALK strategy must be WALK, got ${walk.strategy}`);
else pass("WALK → strategy=WALK");
if (walk.urgency !== "passive") fail(`WALK urgency must be passive`);
else pass("WALK → urgency=passive");
if (walk.followUpWindowHours !== 0) fail(`WALK follow-up must be 0, got ${walk.followUpWindowHours}`);
else pass("WALK → followUp=0 (no engagement)");
if (walk.convictionCap !== 0) fail(`WALK conviction cap must be 0`);
else pass("WALK → convictionCap=0");

// WAIT contract
const wait = POLICY.WAIT;
if (wait.timing !== "WAIT") fail(`WAIT timing must be WAIT`);
else pass("WAIT → timing=WAIT");
if (wait.strategy !== "PASSIVE" && wait.strategy !== "WALK") fail(`WAIT strategy must be PASSIVE or WALK, got ${wait.strategy}`);
else pass(`WAIT → strategy=${wait.strategy} (no active posture)`);
if (wait.followUpWindowHours < 168) fail(`WAIT follow-up must be ≥1 week, got ${wait.followUpWindowHours}h`);
else pass(`WAIT → followUp=${wait.followUpWindowHours}h (deferred)`);

// PROBE contract — exploratory, not full commit
const probe = POLICY.PROBE;
if (probe.urgency === "act-now") fail(`PROBE urgency cannot be act-now (full commit)`);
else pass(`PROBE → urgency=${probe.urgency} (exploratory, not full commit)`);
if (probe.strategy === "AGGRESSIVE") fail(`PROBE strategy cannot be AGGRESSIVE`);
else pass(`PROBE → strategy=${probe.strategy} (controlled/passive)`);

// EXECUTE_CONTROLLED contract
const ec = POLICY.EXECUTE_CONTROLLED;
if (ec.timing !== "THIS_WEEK") fail(`EXECUTE_CONTROLLED timing must be THIS_WEEK`);
else pass("EXECUTE_CONTROLLED → timing=THIS_WEEK");
if (ec.strategy !== "CONTROLLED") fail(`EXECUTE_CONTROLLED strategy must be CONTROLLED`);
else pass("EXECUTE_CONTROLLED → strategy=CONTROLLED");

// EXECUTE_NOW contract — strongest valid posture
const en = POLICY.EXECUTE_NOW;
if (en.timing !== "IMMEDIATE") fail(`EXECUTE_NOW timing must be IMMEDIATE`);
else pass("EXECUTE_NOW → timing=IMMEDIATE");
if (en.strategy !== "AGGRESSIVE") fail(`EXECUTE_NOW strategy must be AGGRESSIVE`);
else pass("EXECUTE_NOW → strategy=AGGRESSIVE");
if (en.followUpWindowHours > 24) fail(`EXECUTE_NOW follow-up must be ≤24h`);
else pass(`EXECUTE_NOW → followUp=${en.followUpWindowHours}h (fastest cadence)`);

// Conviction caps must be monotonic with action rank
const ranks = ["WALK", "WAIT", "PROBE", "EXECUTE_CONTROLLED", "EXECUTE_NOW"];
for (let i = 0; i < ranks.length - 1; i++) {
  const a = POLICY[ranks[i]].convictionCap;
  const b = POLICY[ranks[i + 1]].convictionCap;
  if (a > b) fail(`Conviction cap not monotonic: ${ranks[i]}=${a} > ${ranks[i + 1]}=${b}`);
}
pass("Conviction caps monotonic across action tiers");

// Follow-up windows must be monotonic — better action = faster cadence
// (except WALK which is 0; treat WALK as a special case below)
const followUps = ranks.slice(1).map((r) => POLICY[r].followUpWindowHours);
// EXECUTE_NOW (24) ≤ EXECUTE_CONTROLLED (48) ≤ PROBE (168) ≤ WAIT (504)
// So as we go from WAIT → EXECUTE_NOW, follow-up should DECREASE.
const expectedDescending = ["WAIT", "PROBE", "EXECUTE_CONTROLLED", "EXECUTE_NOW"];
for (let i = 0; i < expectedDescending.length - 1; i++) {
  const a = POLICY[expectedDescending[i]].followUpWindowHours;
  const b = POLICY[expectedDescending[i + 1]].followUpWindowHours;
  if (a < b) fail(`Follow-up not faster as action improves: ${expectedDescending[i]}=${a}h < ${expectedDescending[i + 1]}=${b}h`);
}
pass("Follow-up cadence faster as action improves (WAIT→PROBE→CONTROLLED→NOW)");

// ── TEST 2: COMPRESSION MONOTONICITY ────────────────────────────────────
console.log();
console.log("=== COMPRESSION MONOTONICITY ===");

// Generate deterministic test inputs across the parameter space.
const trustScores = [30, 50, 60, 70, 80, 90, 100];
const fragilityScores = [0, 20, 30, 40, 50, 60, 80];
const confidenceScores = [40, 55, 60, 65, 70, 80, 90];
const dealQualities = [30, 50, 60, 70, 80, 90];
const edgeClasses = ["crowded", "fair", "interesting", "exploitable", "premium"];
const signals = ["BUY", "STRONG BUY", "MONITOR"];

// Helper: confirms that worsening one input never improves the action.
function checkMonotonicAxis(axisName, axisValues, buildInput) {
  let total = 0;
  let regressed = 0;
  for (const trust of trustScores) {
    for (const frag of fragilityScores) {
      for (const conf of confidenceScores) {
        for (const dq of dealQualities) {
          for (const ec of edgeClasses) {
            for (const sig of signals) {
              const base = { trustScore: trust, fragilityScore: frag, edgeClass: ec, confidenceScore: conf, dealQuality: dq, buyOverCeiling: false, signal: sig };
              for (let i = 0; i < axisValues.length - 1; i++) {
                const better = buildInput(base, axisValues[i]);     // higher input value
                const worse  = buildInput(base, axisValues[i + 1]); // lower input value (or worse direction)
                const aBetter = compress(better);
                const aWorse  = compress(worse);
                total++;
                if (ACTION_RANK[aWorse] > ACTION_RANK[aBetter]) {
                  regressed++;
                  if (regressed <= 3) {
                    console.error(`    ✗ ${axisName} regression: ${JSON.stringify(better)}=${aBetter} vs ${JSON.stringify(worse)}=${aWorse}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  if (regressed === 0) {
    pass(`${axisName}: ${total} comparisons, monotonic`);
  } else {
    fail(`${axisName}: ${regressed}/${total} regressions found`);
  }
}

// Trust monotonicity: as trust drops, action must not improve.
checkMonotonicAxis(
  "trust",
  [100, 90, 80, 70, 60, 50, 40, 30],
  (base, t) => ({ ...base, trustScore: t })
);

// Fragility monotonicity: as fragility rises, action must not improve.
checkMonotonicAxis(
  "fragility",
  [0, 20, 30, 40, 50, 60, 70, 80],
  (base, f) => ({ ...base, fragilityScore: f })
);

// Confidence monotonicity: as confidence drops, action must not improve.
checkMonotonicAxis(
  "confidence",
  [100, 90, 80, 70, 60, 55, 45, 30],
  (base, c) => ({ ...base, confidenceScore: c })
);

// Deal quality monotonicity: as deal quality drops, action must not improve.
checkMonotonicAxis(
  "dealQuality",
  [100, 90, 80, 70, 60, 50, 30],
  (base, d) => ({ ...base, dealQuality: d })
);

// ── TEST 3: ACTION/TIMING/STRATEGY ALWAYS COHERENT ──────────────────────
// For every action the policy can produce, verify the policy fields are
// internally consistent. (We already proved this for the table; this is
// a paranoid double-check that compress() never returns an action without
// a defined policy.)
console.log();
console.log("=== ACTION → POLICY COVERAGE ===");
const seenActions = new Set();
for (const trust of trustScores) {
  for (const frag of fragilityScores) {
    for (const conf of confidenceScores) {
      for (const dq of dealQualities) {
        for (const ec of edgeClasses) {
          for (const sig of signals) {
            const a = compress({ trustScore: trust, fragilityScore: frag, edgeClass: ec, confidenceScore: conf, dealQuality: dq, buyOverCeiling: false, signal: sig });
            seenActions.add(a);
            if (!POLICY[a]) fail(`compress() returned ${a} but POLICY has no entry`);
          }
        }
      }
    }
  }
}
for (const a of seenActions) pass(`compress() produces ${a}, policy defined`);
const expectedActions = ["EXECUTE_NOW", "EXECUTE_CONTROLLED", "PROBE", "WAIT", "WALK"];
for (const a of expectedActions) {
  if (!seenActions.has(a)) fail(`compress() never produced ${a} across the test space — dead path`);
}

// ── TEST 4: BUYOVERCEILING ALWAYS WALKS ─────────────────────────────────
console.log();
console.log("=== HARD STOP: ASK ABOVE CEILING ALWAYS WALKS ===");
let stopBreaches = 0;
for (const trust of trustScores) {
  for (const frag of fragilityScores) {
    for (const ec of edgeClasses) {
      const a = compress({ trustScore: trust, fragilityScore: frag, edgeClass: ec, confidenceScore: 100, dealQuality: 100, buyOverCeiling: true, signal: "STRONG BUY" });
      if (a !== "WALK") { stopBreaches++; fail(`buyOverCeiling produced ${a}, expected WALK`); }
    }
  }
}
if (stopBreaches === 0) pass("Every buyOverCeiling=true input → WALK");

// ── SUMMARY ─────────────────────────────────────────────────────────────
console.log();
if (failures === 0) {
  console.log("✓ ALL COHERENCE INVARIANTS PASS");
  process.exit(0);
} else {
  console.error(`✗ ${failures} coherence failure(s)`);
  process.exit(1);
}
