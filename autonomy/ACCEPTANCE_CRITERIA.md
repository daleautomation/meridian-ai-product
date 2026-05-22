# Meridian — Acceptance Criteria

> Concrete pass conditions for every task in
> [`autonomy/AGENT_TASK_QUEUE.md`](./AGENT_TASK_QUEUE.md). An agent is not
> done until every box for its task is checked.
>
> The `scoring-auditor` agent verifies these conditions before approving
> any signal-touching PR.

---

## T1 — Canonical signal schema

- [ ] File created at `lib/recovery/signals/types.ts`.
- [ ] Exports `RecoverySignal` interface with all 9 fields from
      [`SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md) §2.
- [ ] Exports `SignalConfidence` as the literal union `"HIGH" | "MED" | "WEAK"`.
- [ ] Exports `SignalContribution` (name, weight, contribution, observedAt,
      decayApplied, source, recordId, evidenceUrl, confidence).
- [ ] Exports `RankedCard` (leadKey, score, contributions, headlineSignal,
      weakOnly: boolean).
- [ ] Exports `WorkspaceSignalConfig` (slug, signals: SignalDefinition[],
      ramps?: Record<string, RampDefinition>).
- [ ] Exports type guards: `isSignalConfidence`, `isWellFormedSignal`.
- [ ] No runtime code in this file — types only.
- [ ] `npx tsc --noEmit` exits 0.

## T2 — Brookside Real Estate signal config

- [ ] File created at `config/signals/nicole-lonergan.ts`.
- [ ] Default-exports a `WorkspaceSignalConfig` with `slug: "nicole-lonergan"`.
- [ ] Includes every name listed in the task description, no more, no fewer.
- [ ] Every signal has a tier reference (HIGH / MED / WEAK) matching
      [`SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md) §3.1.
- [ ] Every weight is an integer 0–100.
- [ ] Every `halfLifeDays` > 0 and ≤ 1825.
- [ ] No BANNED source referenced.
- [ ] An inline comment near each weight cites why that weight reflects
      residential-brokerage operator priorities.
- [ ] `last_touch_age` is declared as an inverse-time ramp per §5 of the
      trust rules; ramp function is also declared in this file.

## T3 — LaborTech (roofing only) signal config

- [ ] File created at `config/signals/labortech.ts`.
- [ ] Default-exports a `WorkspaceSignalConfig` with `slug: "labortech"`.
- [ ] Roofing-only. No `hvac`, `plumbing`, `painting`, `electrical`, or
      `carpentry` field present.
- [ ] Every signal name has a §3.1 tier reference.
- [ ] Every weight 0–100. Every `halfLifeDays` > 0 and ≤ 1825.
- [ ] `paid_ad_presence` weight ≤ `permit_pulled` weight. (Permits are
      ground truth; ads are inferred intent.)
- [ ] `last_touch_age` declared as inverse-time ramp.

## T4 — Decay function

- [ ] File created at `lib/recovery/signals/decay.ts`.
- [ ] Exports `decay(weight, observedAt, halfLifeDays, now): number`.
- [ ] Pure: no `Math.random`, no `Date.now()` inside the function. `now`
      is a required parameter.
- [ ] Returns 0 for `weight ≤ 0`, `halfLifeDays ≤ 0`, or `observedAt > now`.
- [ ] Exports `inverseTimeRamp(observedAt, ramp, now): number` for §5.
- [ ] Includes inline unit-test examples in JSDoc.

## T5 — Signal evaluation engine

- [ ] File created at `lib/recovery/signals/evaluator.ts`.
- [ ] Exports `evaluateLead(rawSignals, workspaceConfig, now): RankedCard`.
- [ ] Exports `rankLeads(allSignalsByLead, workspaceConfig, now): RankedCard[]`.
- [ ] Pure functions. No I/O.
- [ ] Ignores any signal whose `confidence === "BANNED"` (defensive — should
      not exist).
- [ ] Sets `weakOnly: true` on the returned card when the top contributing
      signal has confidence WEAK.
- [ ] Drops signals whose `evidenceUrl` is null **and** whose
      `(source, recordId)` pair is not present in §3.1 of the trust rules.
- [ ] Returns at most 20 cards per workspace; may return fewer.
- [ ] Same inputs → identical output (validated by T7).

## T6 — Brief generator integration

- [ ] `scripts/generate-brief.ts` consumes `rankLeads` instead of any prior
      ad-hoc scoring path.
- [ ] `lib/recovery/brief.ts` `RecoveryBriefItem` gains a
      `signalContributions: SignalContribution[]` field.
- [ ] Existing fields (`rank`, `companyName`, `whyNow`, `recoveryScore`,
      `decision`, `verifiedContactPath`, `suggestedOpener`) preserved.
- [ ] Brief still serializes valid JSON, validates against existing reader
      code at `app/brief/[customer]/[week]/page.tsx`.
- [ ] Briefs in `data/recovery-briefs/*` regenerate without errors for both
      workspaces.
- [ ] `npm run build` exits 0.

## T7 — Determinism check script

- [ ] File at `scripts/check-brief-determinism.ts`.
- [ ] Script registered as `"brief:determinism"` in `package.json`.
- [ ] For each workspace (Brookside, LaborTech), the script:
  1. Runs the generator with a fixed `now` ISO timestamp.
  2. Runs it again with the same `now`.
  3. Asserts JSON equality of the two outputs (`signalContributions` included).
- [ ] Exits non-zero on any mismatch.
- [ ] No external dependencies beyond `tsx`.

## T8 — Per-workspace signal sanity check

- [ ] File at `scripts/check-workspace-signals.ts`.
- [ ] Script registered as `"signals:check"` in `package.json`.
- [ ] Verifies, for each `config/signals/*.ts`:
  - [ ] Every signal name has a tier reference in `SIGNAL_TRUST_RULES.md` §3.1
  - [ ] Every weight is 0–100
  - [ ] Every `halfLifeDays` is > 0
  - [ ] No BANNED source is referenced
  - [ ] No signal name appears twice
- [ ] Runs the generator once and verifies no brief card has a WEAK
      headline signal without the `weakOnly: true` flag.
- [ ] Exits non-zero on any violation.

## T9 — Decomposition disclosure on the brief card

- [ ] Visible change: a quiet `<details>` element labeled `Show signals · N`
      appears on each brief card, closed by default.
- [ ] When opened, renders each contribution on its own line:
      `name · source · {date} · weight {N} → applied {M}`.
- [ ] No charts, no bars, no badges.
- [ ] Visual style matches `components/outcomes/OutcomeHistory.tsx` (same
      muted greys, same uppercase eyebrow tone).
- [ ] Renders correctly server-side (no hydration warnings in dev).
- [ ] Brief card layout otherwise unchanged.
- [ ] No new fetch on the client — uses the existing server-loaded data.

---

## Cross-cutting acceptance (every task)

- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `npm run auth:check` exits 0.
- [ ] No file in
      [`autonomy/NO_DRIFT_RULES.md`](./NO_DRIFT_RULES.md) §1 (frozen) is touched.
- [ ] No banned phrase or banned source introduced.
- [ ] PR description includes the five-sentence merge memo from
      [`autonomy/PR_REVIEW_CHECKLIST.md`](./PR_REVIEW_CHECKLIST.md) §8.
- [ ] PR title prefixed with `[signals]` (T1–T8) or `[brief]` (T9).

---

## Definition of "Phase 1 complete"

Phase 1 closes when **all of**:

- T1 through T9 are merged.
- `npm run brief:determinism` passes on `main`.
- `npm run signals:check` passes on `main`.
- The brief generator's output JSON contains `signalContributions` for
  every card on both workspaces.
- The brief HTML renders the "Show signals" disclosure with no AI
  language, no charts, no badges.
- The founder has signed off in a PR comment.

After that, Phase 2 may be queued in
[`autonomy/AGENT_TASK_QUEUE.md`](./AGENT_TASK_QUEUE.md).
