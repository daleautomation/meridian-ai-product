/**
 * T7 — Deterministic signal evaluation verification.
 *
 * Runs fixed fixture signals through the evaluator multiple times and asserts
 * byte-stable outputs. No brief generation, no I/O, no Date.now().
 */

import assert from "node:assert/strict";
import brooksideConfig from "@/config/signals/nicole-lonergan";
import labortechConfig from "@/config/signals/labortech";
import {
  classifySignalFreshness,
  clampScore,
  isSignalUsableForScoring,
} from "@/lib/recovery/signals/decay";
import {
  evaluateLead,
  hasOnlyWeakSignals,
  rankLeads,
  selectHeadlineSignal,
  sortContributions,
} from "@/lib/recovery/signals/evaluator";
import type {
  RankedCard,
  RecoverySignal,
  SignalDefinition,
  WorkspaceSignalConfig,
} from "@/lib/recovery/signals/types";

const FIXED_NOW = "2025-05-22T12:00:00.000Z";
const REPEAT_RUNS = 5;

const WORKSPACES: readonly {
  label: string;
  config: WorkspaceSignalConfig;
}[] = [
  { label: "brookside", config: brooksideConfig },
  { label: "labortech", config: labortechConfig },
];

type FixtureScenario = {
  id: string;
  leadKey: string;
  config: WorkspaceSignalConfig;
  buildSignals: () => RecoverySignal[];
};

const failures: string[] = [];

function fail(message: string): never {
  failures.push(message);
  throw new Error(message);
}

function lookupDef(config: WorkspaceSignalConfig, name: string): SignalDefinition {
  const def = config.signals.find((s) => s.name === name);
  if (!def) fail(`missing signal definition ${name} in ${config.slug}`);
  return def;
}

function defaultConfidence(def: SignalDefinition): RecoverySignal["confidence"] {
  if (def.sourceTier === "WEAK") return "WEAK";
  if (def.sourceTier === "MED") return "MED";
  return "HIGH";
}

function makeSignal(
  config: WorkspaceSignalConfig,
  name: string,
  overrides: Partial<RecoverySignal> & { id: string; recordId: string; observedAt: string },
): RecoverySignal {
  const def = lookupDef(config, name);
  const leadKey =
    typeof overrides.payload?.leadKey === "string"
      ? overrides.payload.leadKey
      : undefined;

  return {
    id: overrides.id,
    name: def.name,
    category: overrides.category ?? def.category,
    source: overrides.source ?? def.source,
    sourceTier: overrides.sourceTier ?? def.sourceTier,
    recordId: overrides.recordId,
    observedAt: overrides.observedAt,
    confidence: overrides.confidence ?? defaultConfidence(def),
    halfLifeDays: overrides.halfLifeDays ?? def.defaultHalfLifeDays,
    weight: overrides.weight ?? def.defaultWeight,
    evidenceUrl:
      overrides.evidenceUrl !== undefined
        ? overrides.evidenceUrl
        : `https://fixtures.meridian.local/${config.slug}/${overrides.recordId}`,
    payload: overrides.payload ?? (leadKey ? { leadKey } : null),
    workspaceSlug: overrides.workspaceSlug ?? config.slug,
    status: overrides.status ?? "active",
    explanation: overrides.explanation ?? null,
    evidenceLabel: overrides.evidenceLabel ?? null,
    sourceUrl: overrides.sourceUrl ?? null,
  };
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(value);
}

function assertDeterministic<T>(label: string, fn: () => T, runs = REPEAT_RUNS): T {
  let baseline: string | null = null;
  let first: T | undefined;
  for (let run = 0; run < runs; run += 1) {
    const result = fn();
    const serialized = stableSerialize(result);
    if (baseline === null) {
      baseline = serialized;
      first = result;
    } else if (serialized !== baseline) {
      fail(`${label}: run ${run + 1} differed from run 1`);
    }
  }
  return first as T;
}

function assertScoreInBounds(score: number, label: string): void {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    fail(`${label}: score ${score} outside [0, 100]`);
  }
}

function assertContributionOrderStable(
  contributions: RankedCard["contributions"],
  label: string,
): void {
  const once = sortContributions(contributions);
  const twice = sortContributions(contributions);
  assert.deepEqual(
    twice.map((c) => [c.name, c.contribution, c.confidence]),
    once.map((c) => [c.name, c.contribution, c.confidence]),
    `${label}: sortContributions unstable across invocations`,
  );
}

function evaluateScenario(
  scenario: FixtureScenario,
  now: string,
): RankedCard {
  const signals = scenario.buildSignals();
  return evaluateLead(signals, scenario.config, now, scenario.leadKey);
}

function buildScenarios(): FixtureScenario[] {
  const scenarios: FixtureScenario[] = [];

  scenarios.push({
    id: "brookside-high-stack",
    leadKey: "lead-brookside-001",
    config: brooksideConfig,
    buildSignals: () => [
      makeSignal(brooksideConfig, "permit_pulled", {
        id: "sig-b-001",
        recordId: "permit-001",
        observedAt: "2025-04-01T00:00:00Z",
        payload: { leadKey: "lead-brookside-001" },
      }),
      makeSignal(brooksideConfig, "mortgage_release", {
        id: "sig-b-002",
        recordId: "deed-002",
        observedAt: "2025-03-15T00:00:00Z",
        payload: { leadKey: "lead-brookside-001" },
      }),
    ],
  });

  scenarios.push({
    id: "brookside-weak-only",
    leadKey: "lead-brookside-weak",
    config: brooksideConfig,
    buildSignals: () => [
      makeSignal(brooksideConfig, "investor_indicator", {
        id: "sig-b-w1",
        recordId: "inv-001",
        observedAt: "2024-12-01T00:00:00Z",
        confidence: "WEAK",
        payload: { leadKey: "lead-brookside-weak" },
      }),
      makeSignal(brooksideConfig, "repeat_client_probability", {
        id: "sig-b-w2",
        recordId: "crm-repeat-001",
        observedAt: "2024-11-01T00:00:00Z",
        confidence: "WEAK",
        payload: { leadKey: "lead-brookside-weak" },
      }),
    ],
  });

  scenarios.push({
    id: "brookside-inverse-ramp",
    leadKey: "lead-brookside-ramp",
    config: brooksideConfig,
    buildSignals: () => [
      makeSignal(brooksideConfig, "stale_relationship", {
        id: "sig-b-ramp",
        recordId: "touch-001",
        observedAt: "2024-01-01T00:00:00Z",
        payload: { leadKey: "lead-brookside-ramp" },
      }),
    ],
  });

  scenarios.push({
    id: "labortech-high-stack",
    leadKey: "lead-lab-001",
    config: labortechConfig,
    buildSignals: () => [
      makeSignal(labortechConfig, "permit_pulled", {
        id: "sig-l-001",
        recordId: "roof-permit-001",
        observedAt: "2025-04-10T00:00:00Z",
        payload: { leadKey: "lead-lab-001" },
      }),
      makeSignal(labortechConfig, "storm_event", {
        id: "sig-l-002",
        recordId: "noaa-2025-0410",
        observedAt: "2025-04-10T06:00:00Z",
        payload: { leadKey: "lead-lab-001" },
      }),
    ],
  });

  scenarios.push({
    id: "labortech-med-without-high",
    leadKey: "lead-lab-med-only",
    config: labortechConfig,
    buildSignals: () => [
      makeSignal(labortechConfig, "service_area_match", {
        id: "sig-l-med1",
        recordId: "geo-001",
        observedAt: "2025-02-01T00:00:00Z",
        confidence: "MED",
        sourceTier: "MED",
        payload: { leadKey: "lead-lab-med-only" },
      }),
      makeSignal(labortechConfig, "website_quality_gap", {
        id: "sig-l-med2",
        recordId: "scan-001",
        observedAt: "2025-01-20T00:00:00Z",
        confidence: "MED",
        sourceTier: "MED",
        payload: { leadKey: "lead-lab-med-only" },
      }),
    ],
  });

  scenarios.push({
    id: "labortech-med-with-high",
    leadKey: "lead-lab-med-high",
    config: labortechConfig,
    buildSignals: () => [
      makeSignal(labortechConfig, "permit_pulled", {
        id: "sig-l-mh1",
        recordId: "permit-mh-001",
        observedAt: "2025-04-01T00:00:00Z",
        payload: { leadKey: "lead-lab-med-high" },
      }),
      makeSignal(labortechConfig, "website_quality_gap", {
        id: "sig-l-mh2",
        recordId: "scan-mh-001",
        observedAt: "2025-03-01T00:00:00Z",
        confidence: "MED",
        sourceTier: "MED",
        payload: { leadKey: "lead-lab-med-high" },
      }),
    ],
  });

  scenarios.push({
    id: "exclusion-future-banned-stale",
    leadKey: "lead-exclusions",
    config: labortechConfig,
    buildSignals: () => [
      makeSignal(labortechConfig, "permit_pulled", {
        id: "sig-ex-active",
        recordId: "permit-active",
        observedAt: "2025-04-01T00:00:00Z",
        payload: { leadKey: "lead-exclusions" },
      }),
      makeSignal(labortechConfig, "storm_event", {
        id: "sig-ex-future",
        recordId: "future-storm",
        observedAt: "2026-01-01T00:00:00Z",
        payload: { leadKey: "lead-exclusions" },
      }),
      makeSignal(labortechConfig, "active_google_ads", {
        id: "sig-ex-banned",
        recordId: "ads-banned",
        observedAt: "2025-03-01T00:00:00Z",
        status: "banned",
        payload: { leadKey: "lead-exclusions" },
      }),
      makeSignal(labortechConfig, "recent_business_filing", {
        id: "sig-ex-excluded",
        recordId: "sos-excluded",
        observedAt: "2025-02-01T00:00:00Z",
        status: "excluded",
        payload: { leadKey: "lead-exclusions" },
      }),
      makeSignal(labortechConfig, "license_recently_issued", {
        id: "sig-ex-stale",
        recordId: "lic-stale",
        observedAt: "2020-01-01T00:00:00Z",
        status: "stale",
        weight: 40,
        halfLifeDays: 30,
        payload: { leadKey: "lead-exclusions" },
      }),
    ],
  });

  scenarios.push({
    id: "contribution-sort-tiebreak",
    leadKey: "lead-tiebreak",
    config: labortechConfig,
    buildSignals: () => [
      makeSignal(labortechConfig, "weak_google_rating", {
        id: "sig-tie-a",
        recordId: "place-a",
        observedAt: "2025-04-01T00:00:00Z",
        weight: 50,
        payload: { leadKey: "lead-tiebreak" },
      }),
      makeSignal(labortechConfig, "high_review_count", {
        id: "sig-tie-b",
        recordId: "place-b",
        observedAt: "2025-04-01T00:00:00Z",
        weight: 50,
        payload: { leadKey: "lead-tiebreak" },
      }),
    ],
  });

  return scenarios;
}

function verifyScenario(scenario: FixtureScenario): void {
  const label = `${scenario.config.slug}/${scenario.id}`;

  const card = assertDeterministic(label, () => evaluateScenario(scenario, FIXED_NOW));

  assertDeterministic(`${label}/score`, () => evaluateScenario(scenario, FIXED_NOW).score);
  assertDeterministic(`${label}/headline`, () => evaluateScenario(scenario, FIXED_NOW).headlineSignal);
  assertDeterministic(`${label}/weakOnly`, () => evaluateScenario(scenario, FIXED_NOW).weakOnly);
  assertDeterministic(`${label}/contributions`, () =>
    evaluateScenario(scenario, FIXED_NOW).contributions.map((c) => ({
      name: c.name,
      contribution: c.contribution,
      weight: c.weight,
      decayApplied: c.decayApplied,
      confidence: c.confidence,
      observedAt: c.observedAt,
      recordId: c.recordId,
      source: c.source,
    })),
  );

  assertScoreInBounds(card.score, label);
  for (const contrib of card.contributions) {
    assertScoreInBounds(contrib.contribution, `${label}/${contrib.name}/contribution`);
    assertScoreInBounds(contrib.weight, `${label}/${contrib.name}/weight`);
    assert.equal(clampScore(contrib.contribution), contrib.contribution, `${label}: contribution not clamped`);
  }

  assertContributionOrderStable(card.contributions, label);

  const signals = scenario.buildSignals();
  const weakOnlyA = hasOnlyWeakSignals(signals, FIXED_NOW, scenario.config);
  const weakOnlyB = hasOnlyWeakSignals(signals, FIXED_NOW, scenario.config);
  assert.equal(weakOnlyA, weakOnlyB, `${label}: weakOnly flag unstable`);
  assert.equal(card.weakOnly, weakOnlyA, `${label}: card.weakOnly mismatch`);

  const headlineFromContribs = selectHeadlineSignal(card.contributions);
  assert.equal(
    card.headlineSignal,
    headlineFromContribs,
    `${label}: headlineSignal inconsistent with selectHeadlineSignal`,
  );

  if (headlineFromContribs) {
    const headlineContrib = card.contributions.find((c) => c.name === headlineFromContribs);
    assert.ok(headlineContrib, `${label}: headline names missing contribution`);
    assert.notEqual(headlineContrib.confidence, "WEAK", `${label}: WEAK signal headlined`);
  }

  for (const contrib of card.contributions) {
    if (contrib.confidence === "WEAK") {
      assert.notEqual(
        contrib.name,
        card.headlineSignal,
        `${label}: WEAK contribution ${contrib.name} must not headline`,
      );
    }
  }

  if (scenario.id === "brookside-weak-only") {
    assert.equal(card.weakOnly, true, `${label}: expected weakOnly`);
    assert.equal(card.headlineSignal, null, `${label}: expected no headline`);
  }

  if (scenario.id === "labortech-med-without-high") {
    assert.equal(card.weakOnly, false, `${label}: MED signals are not weakOnly`);
    assert.equal(card.headlineSignal, null, `${label}: MED cannot headline without HIGH`);
  }

  if (scenario.id === "labortech-med-with-high") {
    assert.equal(card.weakOnly, false, `${label}: expected not weakOnly`);
    assert.ok(card.headlineSignal, `${label}: expected headline with HIGH present`);
    const headlineContrib = card.contributions.find((c) => c.name === card.headlineSignal);
    assert.ok(headlineContrib, `${label}: headline contribution missing`);
    if (headlineContrib.confidence === "MED") {
      assert.ok(
        card.contributions.some((c) => c.confidence === "HIGH" && c.contribution > 0),
        `${label}: MED headline requires HIGH on card`,
      );
    }
  }

  if (scenario.id === "exclusion-future-banned-stale") {
    const built = scenario.buildSignals();
    const future = built.find((s) => s.id === "sig-ex-future");
    const banned = built.find((s) => s.id === "sig-ex-banned");
    const excluded = built.find((s) => s.id === "sig-ex-excluded");
    assert.ok(future && banned && excluded);

    assertDeterministic(`${label}/freshness-future`, () =>
      classifySignalFreshness(future, FIXED_NOW),
    );
    assertDeterministic(`${label}/freshness-banned`, () =>
      classifySignalFreshness(banned, FIXED_NOW),
    );
    assertDeterministic(`${label}/usable-future`, () =>
      isSignalUsableForScoring(future, FIXED_NOW),
    );
    assert.equal(classifySignalFreshness(future, FIXED_NOW), "excluded");
    assert.equal(isSignalUsableForScoring(future, FIXED_NOW), false);
    assert.equal(classifySignalFreshness(banned, FIXED_NOW), "banned");
    assert.equal(isSignalUsableForScoring(banned, FIXED_NOW), false);
    assert.equal(classifySignalFreshness(excluded, FIXED_NOW), "excluded");

    assert.ok(
      !card.contributions.some((c) => c.recordId === "future-storm"),
      `${label}: future-dated signal must not contribute`,
    );
    assert.ok(
      !card.contributions.some((c) => c.recordId === "ads-banned"),
      `${label}: banned signal must not contribute`,
    );
    assert.ok(
      !card.contributions.some((c) => c.recordId === "sos-excluded"),
      `${label}: excluded signal must not contribute`,
    );
  }
}

function verifyRankLeadsDeterminism(): void {
  const scenarios = buildScenarios().filter((s) => s.config.slug === "labortech");
  const byLead: Record<string, readonly RecoverySignal[]> = {};
  for (const scenario of scenarios) {
    byLead[scenario.leadKey] = scenario.buildSignals();
  }

  const rankedA = assertDeterministic("labortech/rankLeads", () =>
    rankLeads(byLead, labortechConfig, FIXED_NOW),
  );

  const insertionOrders: Record<string, readonly RecoverySignal[]>[] = [
    byLead,
    Object.fromEntries(Object.entries(byLead).reverse()),
    Object.fromEntries(
      ["lead-lab-001", "lead-lab-med-high", "lead-lab-med-only", "lead-exclusions", "lead-tiebreak"]
        .filter((k) => k in byLead)
        .map((k) => [k, byLead[k]]),
    ),
  ];

  for (const variant of insertionOrders) {
    const ranked = rankLeads(variant, labortechConfig, FIXED_NOW);
    assert.deepEqual(
      ranked.map((c) => ({
        leadKey: c.leadKey,
        score: c.score,
        headlineSignal: c.headlineSignal,
        weakOnly: c.weakOnly,
      })),
      rankedA.map((c) => ({
        leadKey: c.leadKey,
        score: c.score,
        headlineSignal: c.headlineSignal,
        weakOnly: c.weakOnly,
      })),
      "rankLeads order must not depend on object key insertion order",
    );
  }

  for (const card of rankedA) {
    assertScoreInBounds(card.score, `rankLeads/${card.leadKey}`);
  }

  const scores = rankedA.map((c) => c.score);
  const sortedScores = [...scores].sort((a, b) => b - a);
  assert.deepEqual(
    scores,
    sortedScores,
    "rankLeads must return cards sorted by score descending",
  );
}

function verifyWorkspaceConfigs(): void {
  for (const { label, config } of WORKSPACES) {
    assert.ok(config.slug, `${label}: config slug required`);
    assert.ok(config.signals.length > 0, `${label}: config must declare signals`);
  }
}

// ── Brief opener determinism + voice unification ───────────────────
//
// Asserts the brief's suggested opener is produced by the same
// deterministic extractor chain the workspace uses. Catches three
// classes of regression:
//   1. A future commit accidentally re-templates the opener
//      (returns "Hi <name>, I was reviewing open follow-ups…").
//   2. A new banned phrase ("AI suggests", "perfect time", "leverage")
//      lands in an opener variant.
//   3. The opener becomes non-deterministic (Date.now() leaked,
//      Math.random() introduced).

const BRIEF_BANNED_PHRASES = [
  /perfect time/i,
  /great opportunity/i,
  /\bleverage\b/i,
  /personalize/i,
  /AI[-\s]?(?:powered|driven|suggests|recommends|believes)/i,
  /likely to (?:close|sell|buy)/i,
  /act now/i,
  /don't miss/i,
  /\boverdue\b/i,
  // Legacy templated salesy phrasing that this commit fixes — the
  // exact strings that used to appear in the old buildSuggestedOpener.
  /I was reviewing open follow-ups/i,
  /worth a quick revisit/i,
] as const;

function verifyBriefOpener(): void {
  // Import inside the function so the script's existing T7 evaluation
  // path doesn't pull the workspace opener builder unless we need it.
  // (Top-level imports would still work; this is documentation.)

  const { buildBriefOpener } = require("@/lib/recovery/brief") as typeof import("@/lib/recovery/brief");
  const fixedNow = new Date("2026-05-26T12:00:00.000Z");

  type Fixture = {
    label: string;
    input: Parameters<typeof buildBriefOpener>[0];
    expectSourcePrefix?: string;
    expectTrust?: "HIGH" | "MED" | "WEAK";
  };

  const fixtures: Fixture[] = [
    {
      label: "operator custom opener wins",
      input: {
        contactName: "John Smith",
        companyName: "Acme Roofing",
        lastInteractionAt: "2025-02-01T00:00:00.000Z",
        customOpener: "We discussed the warehouse roof — circling back as promised.",
      },
      expectSourcePrefix: "notes:plain_quote",
      expectTrust: "HIGH",
    },
    {
      label: "last_close path (last touch 8 months ago)",
      input: {
        contactName: "John Smith",
        companyName: "Acme Roofing",
        lastInteractionAt: "2025-09-26T00:00:00.000Z",
      },
      expectSourcePrefix: "last_close",
      expectTrust: "MED",
    },
    {
      label: "no contact name + no last touch → no_context fallback",
      input: {
        contactName: null,
        companyName: "Acme Roofing",
        lastInteractionAt: null,
      },
      expectSourcePrefix: "fallback:no_context",
      expectTrust: "WEAK",
    },
    {
      label: "stale years path (4 years ago)",
      input: {
        contactName: "Jane Doe",
        companyName: "Beta Co",
        lastInteractionAt: "2022-05-01T00:00:00.000Z",
      },
      expectSourcePrefix: "stale_relationship:years",
      expectTrust: "WEAK",
    },
  ];

  for (const fx of fixtures) {
    const a = buildBriefOpener(fx.input, { now: fixedNow });
    const b = buildBriefOpener(fx.input, { now: fixedNow });
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`brief opener determinism failed: ${fx.label}`);
      continue;
    }
    if (fx.expectSourcePrefix && !a.openerSource.startsWith(fx.expectSourcePrefix)) {
      failures.push(
        `brief opener source mismatch (${fx.label}): expected prefix ${fx.expectSourcePrefix}, got ${a.openerSource}`,
      );
    }
    if (fx.expectTrust && a.trustLevel !== fx.expectTrust) {
      failures.push(
        `brief opener trust mismatch (${fx.label}): expected ${fx.expectTrust}, got ${a.trustLevel}`,
      );
    }
    if (!a.opener.trim()) {
      failures.push(`brief opener empty (${fx.label})`);
    }
    if (!a.supportingEvidence.trim()) {
      failures.push(`brief opener evidence empty (${fx.label})`);
    }
    for (const re of BRIEF_BANNED_PHRASES) {
      if (re.test(a.opener)) {
        failures.push(`brief opener banned phrase /${re.source}/ in ${fx.label}: "${a.opener}"`);
      }
      if (re.test(a.supportingEvidence)) {
        failures.push(
          `brief evidence banned phrase /${re.source}/ in ${fx.label}: "${a.supportingEvidence}"`,
        );
      }
    }
  }
}

function main(): void {
  verifyWorkspaceConfigs();

  const scenarios = buildScenarios();
  for (const scenario of scenarios) {
    try {
      verifyScenario(scenario);
    } catch (error) {
      if (!(error instanceof Error) || !failures.includes(error.message)) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${scenario.id}: ${message}`);
      }
    }
  }

  try {
    verifyRankLeadsDeterminism();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`rankLeads: ${message}`);
  }

  try {
    verifyBriefOpener();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`brief opener: ${message}`);
  }

  if (failures.length > 0) {
    console.error("brief determinism check FAILED");
    for (const message of failures) {
      console.error(`  - ${message}`);
    }
    process.exit(1);
  }

  console.log("brief determinism check passed", {
    fixedNow: FIXED_NOW,
    repeatRuns: REPEAT_RUNS,
    workspaces: WORKSPACES.map((w) => w.config.slug),
    scenarios: scenarios.map((s) => s.id),
    checks: [
      "identical signals → identical scores",
      "identical signals → identical headline selection",
      "identical signals → identical contribution ordering",
      "weakOnly stability",
      "score bounds 0–100",
      "stale/banned/excluded handling deterministic",
      "sort ordering stable",
      "MED headline gating (HIGH required)",
      "WEAK signals never headline",
      "future-dated signals excluded consistently",
      "brief opener delegates to the deterministic workspace builder",
      "brief opener is byte-identical across repeated calls",
      "brief opener source + trust + evidence are always populated",
      "brief opener carries no banned phrases (incl. legacy templated prose)",
      "operator-supplied customOpener wins (T1 content per constitution §1)",
    ],
  });
}

main();
