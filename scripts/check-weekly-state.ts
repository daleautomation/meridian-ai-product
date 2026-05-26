/**
 * Validation for the weekly-state builder.
 *
 *   1. Determinism: identical input → byte-identical snapshot.
 *   2. ISO week id: known instants → known week ids.
 *   3. Mode resolver: known weekdays → expected mode.
 *   4. Honest cold start: empty outcomes → continuity insight reads
 *      "Continuity insights begin after your first week of captured
 *      outcomes." Never fabricated.
 *   5. Banned-phrase scan on every opener, every reason, every activation
 *      email line.
 *   6. Live audit against Nicole's Neon contacts when DATABASE_URL is
 *      set: asserts the snapshot fits the published shape, every priority
 *      cites supporting evidence, and the activation email body is non-empty.
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — at least one assertion failed
 */

import { getWorkspaceBySlug } from "@/config/workspaces";
import { describeContactStorageMode, listContactsByWorkspace } from "@/lib/crm-import/store";
import { readCustomerOutcomes } from "@/lib/recovery/outcomes/persistence";
import { buildResurfacingBuckets } from "@/lib/relationship-intelligence/resurfacing";
import { buildPersonalWorkspaceModel } from "@/lib/personal-workspace/workspace";
import {
  applyOutcomesOverlay,
  buildWeeklyState,
  evaluateOutcomeInfluence,
  isoWeekId,
  resolveWeeklyMode,
  type BuildWeeklyStateInput,
  type WeeklyState,
} from "@/lib/personal-workspace/weeklyState";
import type { CrmContactRecord } from "@/lib/crm-import/types";
import type { PersonalContactCard } from "@/lib/personal-workspace/workspace";
import type { RelationshipOutcome } from "@/lib/recovery/outcomes/types";

const NICOLE_WORKSPACE = "nicole-lonergan";
const FIXED_NOW = new Date("2026-05-25T17:00:00.000Z"); // Sunday afternoon UTC

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
}

// Banned in any generated text. These keep the surface operator-grade.
// Includes productivity-guilt phrases (no "still have N!", no "overdue").
const BANNED_PHRASES = [
  /perfect time/i,
  /great opportunity/i,
  /game[-\s]?changing/i,
  /\bleverage\b/i,
  /personalize/i,
  /AI[-\s]?(?:powered|driven|suggests|recommends|believes)/i,
  /likely to (?:close|sell|buy)/i,
  /unlock/i,
  /\bsynergy\b/i,
  /act now/i,
  /don't miss/i,
  /\boverdue\b/i,
  /\bstreak\b/i,
  /\bcrush(?:ed|ing)?\b/i,
  /you[''']?ve fallen behind/i,
] as const;

function assertCleanText(text: string, where: string): void {
  for (const re of BANNED_PHRASES) {
    if (re.test(text)) {
      fail(`${where}: banned phrase /${re.source}/ in "${text.slice(0, 100)}"`);
    }
  }
}

// ── 1. ISO week id ────────────────────────────────────────────────

function runIsoWeekChecks(): void {
  const cases: Array<[string, string]> = [
    ["2026-01-05T12:00:00.000Z", "2026-W02"], // first Monday of W02
    ["2026-05-26T12:00:00.000Z", "2026-W22"],
    ["2026-12-28T12:00:00.000Z", "2026-W53"], // 2026 has 53 ISO weeks
    ["2025-12-29T12:00:00.000Z", "2026-W01"], // belongs to 2026's W01
  ];
  for (const [iso, expected] of cases) {
    const got = isoWeekId(new Date(iso));
    if (got !== expected) {
      fail(`isoWeekId(${iso}): expected ${expected}, got ${got}`);
    }
  }
}

// ── 2. Mode resolver ──────────────────────────────────────────────

function runModeChecks(): void {
  const cases: Array<[string, "monday" | "midweek" | "friday"]> = [
    ["2026-05-25T12:00:00.000Z", "monday"], // Mon
    ["2026-05-26T12:00:00.000Z", "monday"], // Tue
    ["2026-05-27T12:00:00.000Z", "midweek"], // Wed
    ["2026-05-28T12:00:00.000Z", "midweek"], // Thu
    ["2026-05-29T12:00:00.000Z", "friday"], // Fri
    ["2026-05-30T12:00:00.000Z", "friday"], // Sat
    ["2026-05-31T12:00:00.000Z", "friday"], // Sun
  ];
  for (const [iso, expected] of cases) {
    const got = resolveWeeklyMode(new Date(iso));
    if (got !== expected) {
      fail(`resolveWeeklyMode(${iso}): expected ${expected}, got ${got}`);
    }
  }
}

// ── 3. Synthetic builder check (cold start + banned-phrase scan) ──

function makeSyntheticInput(overrides: Partial<BuildWeeklyStateInput> = {}): BuildWeeklyStateInput {
  // The weekly-state builder reads only a few fields from the contact
  // record and the priority card — id/name/notes/tags/lastInteractionAt/
  // sourceCrm on the contact, and contactId/id/rank/name/company/strength*/
  // primaryChannel on the card. Cast through a narrow literal for the
  // rest so the synthetic fixture stays readable.
  const sampleContact = {
    id: "syn-1",
    workspaceId: "syn",
    name: "Sample Person",
    company: "Acme",
    phone: null,
    email: "sample@example.com",
    address: null,
    notes: "Mid-conversation about a kitchen renovation last spring.",
    tags: ["Buyer"],
    lastInteractionAt: "2024-08-01T00:00:00.000Z",
    sourceCrm: "test",
  } as unknown as CrmContactRecord;
  const sampleCard = {
    id: "card-1",
    contactId: "syn-1",
    rank: 1,
    name: "Sample Person",
    company: "Acme",
    strength: 60,
    strengthRaw: 60,
    primaryChannel: "email",
  } as unknown as PersonalContactCard;
  return {
    workspaceSlug: "syn",
    workspaceDisplayName: "Synthetic Workspace",
    workspaceUrl: "https://www.meridianai.work/personal?workspace=syn",
    priorityCards: [sampleCard],
    contactsById: new Map([["syn-1", sampleContact]]),
    outcomes: [],
    resurfacingHighlight: null,
    now: FIXED_NOW,
    ...overrides,
  };
}

function runColdStartCheck(): WeeklyState {
  const state = buildWeeklyState(makeSyntheticInput());
  if (state.continuityInsight.kind !== "honest_cold_start") {
    fail(
      `cold-start: expected continuityInsight.kind = honest_cold_start, got ${state.continuityInsight.kind}`,
    );
  }
  if (
    !state.continuityInsight.text.startsWith(
      "Continuity insights begin after your first week of captured outcomes.",
    )
  ) {
    fail(
      `cold-start: continuity insight text was not the honest fallback; got "${state.continuityInsight.text}"`,
    );
  }
  if (state.continuityInsight.citedContactIds.length !== 0) {
    fail("cold-start: honest fallback must cite zero contacts");
  }
  if (state.weekId !== isoWeekId(FIXED_NOW)) {
    fail(`weekId mismatch: ${state.weekId} vs ${isoWeekId(FIXED_NOW)}`);
  }
  if (state.priorities.length !== 1) {
    fail(`priority count mismatch: expected 1, got ${state.priorities.length}`);
  }
  return state;
}

function runDeterminismCheck(): void {
  const a = buildWeeklyState(makeSyntheticInput());
  const b = buildWeeklyState(makeSyntheticInput());
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail("determinism: two identical inputs produced different snapshots");
  }
}

function runOverlayChecks(): void {
  const baseState = buildWeeklyState(makeSyntheticInput());
  if (baseState.priorities[0].lastOperatorOutcome !== null) {
    fail("overlay: pre-overlay priority should have null lastOperatorOutcome");
  }
  if (baseState.outcomeRollup.outcomesCaptured !== 0) {
    fail("overlay: pre-overlay rollup should be zero");
  }
  if (baseState.outcomeRollup.followUpsDeferred !== 0) {
    fail("overlay: rollup should include followUpsDeferred=0 initially");
  }

  // Apply a meeting_booked outcome.
  const recentBooking: RelationshipOutcome[] = [
    {
      id: "o-m",
      leadKey: "syn-1",
      recordedAt: new Date(FIXED_NOW.getTime() - 60 * 1000).toISOString(),
      outcome: "meeting_booked",
      source: "operator_console",
    },
  ];
  const overlaid = applyOutcomesOverlay(baseState, recentBooking, FIXED_NOW);
  if (overlaid.priorities[0].lastOperatorOutcome?.outcome !== "meeting_booked") {
    fail("overlay: meeting_booked outcome did not propagate to priority");
  }
  if (overlaid.outcomeRollup.outcomesCaptured !== 1) {
    fail(`overlay: rollup outcomesCaptured expected 1, got ${overlaid.outcomeRollup.outcomesCaptured}`);
  }
  if (overlaid.outcomeRollup.meetingsBooked !== 1) {
    fail(`overlay: rollup meetingsBooked expected 1, got ${overlaid.outcomeRollup.meetingsBooked}`);
  }

  // Apply a follow_up_later outcome — second pass — to confirm the
  // rollup tracks deferred follow-ups independently and the snapshot
  // is not mutated (immutability via spread).
  const withDeferred = applyOutcomesOverlay(
    baseState,
    [
      {
        id: "o-f",
        leadKey: "syn-1",
        recordedAt: new Date(FIXED_NOW.getTime() - 2 * 60 * 1000).toISOString(),
        outcome: "follow_up_later",
        source: "operator_console",
      },
    ],
    FIXED_NOW,
  );
  if (withDeferred.outcomeRollup.followUpsDeferred !== 1) {
    fail(
      `overlay: rollup followUpsDeferred expected 1, got ${withDeferred.outcomeRollup.followUpsDeferred}`,
    );
  }
  if (baseState.priorities[0].lastOperatorOutcome !== null) {
    fail("overlay: base state was mutated — must remain immutable");
  }

  // Determinism: identical overlay inputs → byte-identical results.
  const repeat = applyOutcomesOverlay(baseState, recentBooking, FIXED_NOW);
  if (JSON.stringify(overlaid) !== JSON.stringify(repeat)) {
    fail("overlay: not deterministic between two calls");
  }

  // No-op overlay: empty outcomes leaves priorities alone but still
  // returns a fresh rollup (zeroed within the 7-day window).
  const noop = applyOutcomesOverlay(baseState, [], FIXED_NOW);
  if (noop.priorities[0].lastOperatorOutcome !== null) {
    fail("overlay: empty outcomes should not invent a lastOperatorOutcome");
  }
}

// ── Outcome-aware ranking rules ───────────────────────────────────

function makeContact(id: string, name: string): CrmContactRecord {
  return {
    id,
    workspaceId: "syn",
    name,
    company: "Acme",
    phone: null,
    email: `${id}@example.com`,
    address: null,
    notes: "Mid-conversation about a kitchen renovation last spring.",
    tags: ["Buyer"],
    lastInteractionAt: "2024-08-01T00:00:00.000Z",
    sourceCrm: "test",
  } as unknown as CrmContactRecord;
}

function makeCard(id: string, name: string, rank: number): PersonalContactCard {
  return {
    id: `card-${id}`,
    contactId: id,
    rank,
    name,
    company: "Acme",
    strength: 60,
    strengthRaw: 60,
    primaryChannel: "email",
  } as unknown as PersonalContactCard;
}

function multiContactInput(
  ids: readonly string[],
  outcomes: readonly RelationshipOutcome[] = [],
): BuildWeeklyStateInput {
  const contacts = ids.map((id, idx) => makeContact(id, `Person ${idx + 1}`));
  const cards = ids.map((id, idx) => makeCard(id, `Person ${idx + 1}`, idx + 1));
  return {
    workspaceSlug: "syn",
    workspaceDisplayName: "Synthetic",
    workspaceUrl: "https://www.meridianai.work/personal?workspace=syn",
    priorityCards: cards,
    contactsById: new Map(contacts.map((c) => [c.id, c])),
    outcomes,
    resurfacingHighlight: null,
    now: FIXED_NOW,
  };
}

function outcomeAt(
  leadKey: string,
  outcome: RelationshipOutcome["outcome"],
  ageDays: number,
  extras: Partial<RelationshipOutcome> = {},
): RelationshipOutcome {
  return {
    id: `o-${leadKey}-${outcome}`,
    leadKey,
    recordedAt: new Date(FIXED_NOW.getTime() - ageDays * 24 * 60 * 60 * 1000).toISOString(),
    outcome,
    source: "operator_console",
    ...extras,
  };
}

function runRuleEngineUnitChecks(): void {
  // 1. No outcome → no influence, not excluded.
  {
    const d = evaluateOutcomeInfluence([], "c-1", FIXED_NOW);
    if (d.excluded || d.influence !== null || d.reason !== null) {
      fail(`rule:no-outcome → expected pass-through, got ${JSON.stringify(d)}`);
    }
  }
  // 2. meeting_booked → excluded.
  {
    const d = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "meeting_booked", 2)],
      "c-1",
      FIXED_NOW,
    );
    if (!d.excluded) fail("rule:meeting_booked must exclude");
  }
  // 3. closed_won / closed_lost → excluded.
  {
    const dWon = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "closed_won", 9)],
      "c-1",
      FIXED_NOW,
    );
    const dLost = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "closed_lost", 9)],
      "c-1",
      FIXED_NOW,
    );
    if (!dWon.excluded || !dLost.excluded) fail("rule:closed_won/closed_lost must exclude");
  }
  // 4. wrong_contact / not_worth_pursuing → excluded.
  {
    const dWrong = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "wrong_contact", 1)],
      "c-1",
      FIXED_NOW,
    );
    const dDnp = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "not_worth_pursuing", 1)],
      "c-1",
      FIXED_NOW,
    );
    if (!dWrong.excluded || !dDnp.excluded) {
      fail("rule:wrong_contact/not_worth_pursuing must exclude");
    }
  }
  // 5. follow_up_later with future nextReviewAt → deferred, excluded.
  {
    const future = new Date(FIXED_NOW.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const d = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "follow_up_later", 2, { nextReviewAt: future })],
      "c-1",
      FIXED_NOW,
    );
    if (!d.excluded || d.influence !== "deferred") {
      fail(`rule:follow_up_later future → expected deferred+excluded, got ${JSON.stringify(d)}`);
    }
    if (!d.reason || !d.reason.startsWith("Deferred until ")) {
      fail(`rule:follow_up_later future → reason missing/wrong: ${d.reason}`);
    }
  }
  // 6. follow_up_later with past nextReviewAt within 14 days → resurfaced.
  {
    const past = new Date(FIXED_NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const d = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "follow_up_later", 10, { nextReviewAt: past })],
      "c-1",
      FIXED_NOW,
    );
    if (d.excluded || d.influence !== "resurfaced") {
      fail(`rule:follow_up_later past → expected resurfaced, got ${JSON.stringify(d)}`);
    }
  }
  // 7. follow_up_later with no nextReviewAt → no influence (eligible).
  {
    const d = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "follow_up_later", 2)],
      "c-1",
      FIXED_NOW,
    );
    if (d.excluded || d.influence !== null) {
      fail(`rule:follow_up_later no-date → expected pass-through, got ${JSON.stringify(d)}`);
    }
  }
  // 8. no_response within 7 days → deprioritized.
  {
    const d = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "no_response", 3)],
      "c-1",
      FIXED_NOW,
    );
    if (d.excluded || d.influence !== "deprioritized") {
      fail(`rule:no_response 3d → expected deprioritized, got ${JSON.stringify(d)}`);
    }
    if (!d.reason || !/Deprioritized after no answer/.test(d.reason)) {
      fail(`rule:no_response reason missing/wrong: ${d.reason}`);
    }
  }
  // 9. no_response older than 7 days → no current effect.
  {
    const d = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "no_response", 14)],
      "c-1",
      FIXED_NOW,
    );
    if (d.excluded || d.influence !== null) {
      fail(`rule:no_response 14d → expected pass-through, got ${JSON.stringify(d)}`);
    }
  }
  // 10. contacted → neutral, not excluded.
  {
    const d = evaluateOutcomeInfluence(
      [outcomeAt("c-1", "contacted", 2)],
      "c-1",
      FIXED_NOW,
    );
    if (d.excluded || d.influence !== null) {
      fail(`rule:contacted → expected pass-through, got ${JSON.stringify(d)}`);
    }
  }
  // 11. Multiple outcomes — latest one wins (append-only history).
  {
    const d = evaluateOutcomeInfluence(
      [
        outcomeAt("c-1", "no_response", 5),
        outcomeAt("c-1", "meeting_booked", 1),
      ],
      "c-1",
      FIXED_NOW,
    );
    if (!d.excluded) {
      fail("rule:latest-wins — meeting_booked (newer) should override no_response (older)");
    }
  }
  // 12. Deterministic — identical input → identical decision.
  {
    const outcomes = [outcomeAt("c-1", "no_response", 3)];
    const a = evaluateOutcomeInfluence(outcomes, "c-1", FIXED_NOW);
    const b = evaluateOutcomeInfluence(outcomes, "c-1", FIXED_NOW);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fail("rule:determinism — identical input produced different decisions");
    }
  }
}

function runRankingIntegrationChecks(): void {
  // Setup: 4 candidate contacts, each with a different outcome.
  // Verify the slice ordering + reason text.
  const outcomes: RelationshipOutcome[] = [
    outcomeAt("c-2", "no_response", 3), // should be deprioritized → bottom
    outcomeAt("c-3", "meeting_booked", 1), // should be excluded
    outcomeAt("c-4", "wrong_contact", 1), // should be excluded
  ];
  const input = multiContactInput(["c-1", "c-2", "c-3", "c-4", "c-5"], outcomes);
  const state = buildWeeklyState(input);

  const ids = state.priorities.map((p) => p.contactId);
  // Excluded contacts must NOT appear.
  if (ids.includes("c-3") || ids.includes("c-4")) {
    fail(`ranking: excluded contacts leaked into priorities: ${ids.join(", ")}`);
  }
  // c-1 + c-5 (no outcomes) should appear before c-2 (deprioritized).
  const idxOfDeprio = ids.indexOf("c-2");
  const idxOfClean1 = ids.indexOf("c-1");
  const idxOfClean5 = ids.indexOf("c-5");
  if (idxOfDeprio === -1 || idxOfClean1 === -1 || idxOfClean5 === -1) {
    fail(`ranking: expected all of c-1, c-2, c-5 in slice; got ${ids.join(", ")}`);
  } else if (idxOfDeprio < idxOfClean1 || idxOfDeprio < idxOfClean5) {
    fail(
      `ranking: deprioritized c-2 must follow non-deprioritized contacts (got order ${ids.join(", ")})`,
    );
  }

  // Reason must be present on deprioritized priority and absent on others.
  const c2 = state.priorities.find((p) => p.contactId === "c-2");
  if (!c2 || c2.outcomeInfluence !== "deprioritized" || !c2.outcomeReason) {
    fail(`ranking: c-2 should carry deprioritized influence + reason; got ${JSON.stringify(c2)}`);
  }
  const c1 = state.priorities.find((p) => p.contactId === "c-1");
  if (c1 && c1.outcomeReason !== null) {
    fail(`ranking: c-1 has no outcomes → outcomeReason must be null; got "${c1.outcomeReason}"`);
  }

  // Determinism: rerun must produce identical state.
  const stateRepeat = buildWeeklyState(input);
  if (JSON.stringify(state) !== JSON.stringify(stateRepeat)) {
    fail("ranking: outcome-aware buildWeeklyState is not deterministic across calls");
  }

  // Banned-phrase scan on every reason text emitted.
  for (const p of state.priorities) {
    if (p.outcomeReason) assertCleanText(p.outcomeReason, `priority#${p.rank} outcomeReason`);
  }
}

function runDeferUntilCheck(): void {
  const future = new Date(FIXED_NOW.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(FIXED_NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const outcomes: RelationshipOutcome[] = [
    outcomeAt("c-2", "follow_up_later", 5, { nextReviewAt: future }),
    outcomeAt("c-3", "follow_up_later", 5, { nextReviewAt: past }),
  ];
  const input = multiContactInput(["c-1", "c-2", "c-3"], outcomes);
  const state = buildWeeklyState(input);
  const ids = state.priorities.map((p) => p.contactId);
  if (ids.includes("c-2")) {
    fail("defer: c-2 (future nextReviewAt) must be excluded from priorities");
  }
  if (!ids.includes("c-3")) {
    fail("defer: c-3 (past nextReviewAt within 14 days) must be eligible again");
  }
  const c3 = state.priorities.find((p) => p.contactId === "c-3");
  if (!c3 || c3.outcomeInfluence !== "resurfaced" || !c3.outcomeReason) {
    fail(`defer: c-3 must carry resurfaced influence + reason; got ${JSON.stringify(c3)}`);
  }
}

function runHistoryPreservationCheck(): void {
  // closed_won is excluded from priorities BUT must still appear in
  // the outcome history (lastOperatorOutcome surfaces via applyOverlay
  // on any priority that's still rendered). The override here:
  // even though c-1 is excluded, the rollup still counts the outcome.
  const outcomes: RelationshipOutcome[] = [
    outcomeAt("c-1", "closed_won", 2),
    outcomeAt("c-2", "contacted", 1),
  ];
  const input = multiContactInput(["c-1", "c-2"], outcomes);
  const state = buildWeeklyState(input);
  if (state.outcomeRollup.outcomesCaptured !== 2) {
    fail(
      `history: rollup must count closed_won in the 7-day window; got ${state.outcomeRollup.outcomesCaptured}`,
    );
  }
  // c-1 is excluded; only c-2 should render.
  const ids = state.priorities.map((p) => p.contactId);
  if (ids.includes("c-1")) fail("history: closed_won contact must not render as a priority");
  if (!ids.includes("c-2")) fail("history: contacted contact must still render as a priority");
}

function runRuleEngineChecks(): void {
  runRuleEngineUnitChecks();
  runRankingIntegrationChecks();
  runDeferUntilCheck();
  runHistoryPreservationCheck();
}

/**
 * Panel-side copy lives in the React component, not the snapshot.
 * Validate the literal strings here so they participate in the same
 * banned-phrase scan as everything the snapshot emits.
 */
const PANEL_COPY_STRINGS: readonly string[] = [
  "Saved to continuity memory.",
  "Your priorities are still untouched this week.",
  "Every priority has at least one captured outcome. Next week opens Monday.",
  "No outcomes were captured this week.",
  "Your next workspace opens Monday morning.",
  "Your workspace is ready",
  // Outcome action labels — operator-grade, no productivity guilt.
  "Sent",
  "No answer",
  "Meeting booked",
  "Follow up later",
  "Wrong contact",
];

function runPanelCopyScan(): void {
  for (const line of PANEL_COPY_STRINGS) {
    assertCleanText(line, `panel copy "${line.slice(0, 40)}"`);
  }
}

function runOutcomeDrivenInsightCheck(): void {
  const outcomes: RelationshipOutcome[] = [
    {
      id: "o-1",
      leadKey: "syn-1",
      recordedAt: new Date(FIXED_NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      outcome: "no_response",
      source: "operator_console",
    },
  ];
  const state = buildWeeklyState(makeSyntheticInput({ outcomes }));
  if (state.continuityInsight.kind !== "outcome_driven") {
    fail(
      `outcome-driven: expected outcome_driven insight, got ${state.continuityInsight.kind}`,
    );
  }
  if (state.continuityInsight.citedContactIds[0] !== "syn-1") {
    fail("outcome-driven: insight must cite the contact whose outcome reshapes priorities");
  }
  if (state.priorities[0].lastOperatorOutcome?.outcome !== "no_response") {
    fail(
      `outcome-driven: priority should carry last outcome; got ${JSON.stringify(state.priorities[0].lastOperatorOutcome)}`,
    );
  }
}

function runBannedPhraseScan(state: WeeklyState): void {
  for (const p of state.priorities) {
    assertCleanText(p.suggestedOpener, `priority#${p.rank} opener`);
    assertCleanText(p.supportingEvidence, `priority#${p.rank} supportingEvidence`);
    assertCleanText(p.lastTouchSummary, `priority#${p.rank} lastTouchSummary`);
  }
  if (state.resurfacedRelationship) {
    assertCleanText(state.resurfacedRelationship.reason, "resurface.reason");
    assertCleanText(state.resurfacedRelationship.evidence, "resurface.evidence");
  }
  assertCleanText(state.continuityInsight.text, "continuityInsight");
  assertCleanText(state.activationEmail.body, "activationEmail.body");
  assertCleanText(state.activationEmail.subject, "activationEmail.subject");
}

// ── 4. Live audit against Nicole ──────────────────────────────────

async function runLiveAudit(): Promise<void> {
  const storage = describeContactStorageMode();
  if (storage.mode === "none") {
    console.log("[weekly-state:check] no contact storage configured — skipping Nicole live audit.");
    return;
  }
  console.log(
    `[weekly-state:check] live audit will read from storage.mode=${storage.mode} durable=${storage.durable}`,
  );

  const workspace = getWorkspaceBySlug(NICOLE_WORKSPACE);
  if (!workspace) {
    fail(`Nicole workspace config missing: ${NICOLE_WORKSPACE}`);
    return;
  }

  const contacts = await listContactsByWorkspace(NICOLE_WORKSPACE);
  if (contacts.length === 0) {
    console.log("[weekly-state:check] Nicole has 0 contacts — skipping live audit.");
    return;
  }

  const resurfacingBuckets = buildResurfacingBuckets(contacts);
  const model = buildPersonalWorkspaceModel({
    workspace,
    user: {
      id: "weekly-state-check",
      name: "Weekly State Check",
      accessRole: "admin_operator",
      modules: [],
      geo: [],
      workspaces: [NICOLE_WORKSPACE],
    },
    crmContacts: contacts,
    resurfacingBuckets,
    generatedAt: FIXED_NOW.toISOString(),
  });
  const outcomes = await readCustomerOutcomes(NICOLE_WORKSPACE);
  const contactsById = new Map(contacts.map((c) => [c.id, c]));
  const resurfaceHighlight = (() => {
    const ordered = ["overdue_follow_ups", "forgotten_high_value", "stale_reengage", "dormant_high_frequency"];
    for (const id of ordered) {
      const bucket = resurfacingBuckets.find((b) => b.id === id);
      if (!bucket || bucket.contacts.length === 0) continue;
      const first = bucket.contacts[0];
      return {
        contactId: first.contactId,
        name: first.name ?? first.contactId,
        bucketLabel: bucket.label,
        whyNow: first.whyNow ?? "Resurfaced relationship",
      };
    }
    return null;
  })();

  const state = buildWeeklyState({
    workspaceSlug: NICOLE_WORKSPACE,
    workspaceDisplayName: workspace.branding?.displayName ?? workspace.name,
    workspaceUrl: "https://www.meridianai.work/personal?workspace=nicole-lonergan",
    priorityCards: model.priorityContacts,
    contactsById,
    outcomes,
    resurfacingHighlight: resurfaceHighlight,
    now: FIXED_NOW,
  });

  if (state.schemaVersion !== 1) fail("schemaVersion not 1");
  if (state.workspaceSlug !== NICOLE_WORKSPACE) fail("workspaceSlug mismatch");
  if (!state.weekId.match(/^\d{4}-W\d{2}$/)) fail(`weekId malformed: ${state.weekId}`);
  if (state.priorities.length === 0) fail("Nicole: 0 priorities — unexpected");
  for (const p of state.priorities) {
    if (!p.suggestedOpener.trim()) fail(`Nicole priority#${p.rank}: empty opener`);
    if (!p.supportingEvidence.trim()) fail(`Nicole priority#${p.rank}: empty evidence`);
    if (!p.lastTouchSummary.trim()) fail(`Nicole priority#${p.rank}: empty lastTouchSummary`);
    if (!["HIGH", "MED", "WEAK"].includes(p.trustLevel)) {
      fail(`Nicole priority#${p.rank}: bad trust level ${p.trustLevel}`);
    }
  }
  if (!state.activationEmail.subject.trim()) fail("Nicole: empty activation email subject");
  if (!state.activationEmail.body.includes(state.weekId)) {
    fail("Nicole: activation email body must reference the weekId");
  }
  if (!state.activationEmail.body.includes("https://")) {
    fail("Nicole: activation email body must include a workspace URL");
  }
  // Validate determinism on the live data.
  const stateRepeat = buildWeeklyState({
    workspaceSlug: NICOLE_WORKSPACE,
    workspaceDisplayName: workspace.branding?.displayName ?? workspace.name,
    workspaceUrl: "https://www.meridianai.work/personal?workspace=nicole-lonergan",
    priorityCards: model.priorityContacts,
    contactsById,
    outcomes,
    resurfacingHighlight: resurfaceHighlight,
    now: FIXED_NOW,
  });
  if (JSON.stringify(state) !== JSON.stringify(stateRepeat)) {
    fail("Nicole live audit: snapshot not deterministic between two calls");
  }

  runBannedPhraseScan(state);

  console.log("");
  console.log("Nicole live weekly state:");
  console.log(`  weekId:               ${state.weekId}`);
  console.log(`  priorities:           ${state.priorities.length}`);
  console.log(`  resurfaced:           ${state.resurfacedRelationship?.name ?? "(none)"}`);
  console.log(`  continuityInsight:    ${state.continuityInsight.kind}`);
  console.log(`  outcomes(7d):         ${state.outcomeRollup.outcomesCaptured}`);
  console.log("");
  console.log("Activation email preview:");
  console.log(`  Subject: ${state.activationEmail.subject}`);
  for (const line of state.activationEmail.body.split("\n")) {
    console.log(`  | ${line}`);
  }
}

async function main(): Promise<void> {
  runIsoWeekChecks();
  runModeChecks();
  const coldState = runColdStartCheck();
  runDeterminismCheck();
  runOutcomeDrivenInsightCheck();
  runOverlayChecks();
  runRuleEngineChecks();
  runPanelCopyScan();
  runBannedPhraseScan(coldState);
  await runLiveAudit();

  if (failures.length > 0) {
    console.error("");
    console.error("check-weekly-state FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-weekly-state passed", {
    checks: [
      "ISO week id stable for known instants",
      "weekly mode resolver maps weekdays correctly",
      "honest cold-start insight when no outcomes captured",
      "outcome-driven insight cites the right contact",
      "snapshot is deterministic (same input → same output)",
      "applyOutcomesOverlay layers outcomes onto priorities + rollup",
      "applyOutcomesOverlay tracks followUpsDeferred independently",
      "applyOutcomesOverlay does not mutate the base snapshot",
      "applyOutcomesOverlay is deterministic across calls",
      "rule:meeting_booked excludes from priorities",
      "rule:closed_won / closed_lost / wrong_contact / not_worth_pursuing all exclude",
      "rule:follow_up_later defers until nextReviewAt, resurfaces afterward",
      "rule:no_response within 7 days deprioritizes (never suppresses)",
      "rule:contacted is neutral (no ranking effect)",
      "rule: latest outcome wins, identical input → identical decision",
      "ranking: deprioritized priorities follow non-deprioritized in slice order",
      "ranking: outcome-aware buildWeeklyState is deterministic across calls",
      "ranking: outcomeReason text passes banned-phrase scan",
      "defer: future nextReviewAt excludes; past within 14 days surfaces with resurfaced reason",
      "history: excluded contacts remain visible in the weekly rollup count",
      "panel copy (reinforcement, empty states, action labels) passes banned-phrase scan",
      "no banned phrases in any opener / evidence / insight / email",
      "Nicole live audit: shape valid, every priority cites evidence",
      "Nicole live audit: snapshot deterministic across calls",
      "Nicole activation email references weekId + workspace URL",
    ],
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[weekly-state:check] crashed");
  console.error(message);
  process.exit(1);
});
