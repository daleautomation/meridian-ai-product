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
  buildWeeklyState,
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
