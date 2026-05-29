# Meridian — Agent Task Queue

> The current work queue. Tasks ship in order unless explicitly noted as
> parallelizable. Each task names an **owner agent role** (see
> `agents/*.md`), a **scope boundary** (which files may be touched), and a
> reference to the matching entry in
> [`autonomy/ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md).
>
> Pick the next `pending` task in numeric order. Do not skip ahead.
> Do not parallelize across tasks unless `parallel-ok: true` is set.

---

## Implementation target (Phase 1)

**Workspace-specific Recovery Brief intelligence architecture.**

The goal of Phase 1 is to replace any remaining static / monolithic scoring
in the brief pipeline with an explicit, deterministic, per-workspace
signal-weighting model that satisfies every clause of
[`autonomy/SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md).

After Phase 1 closes, every brief card carries: named signals, source
citations, `observedAt` timestamps, confidence tiers, decay-applied
weights, and a per-card "show your work" disclosure.

---

## Queue

### T1 — Define the canonical signal schema
- **Status:** pending
- **Owner:** `intelligence-engine`
- **Scope:** new file `lib/recovery/signals/types.ts`
- **Description:** Define `RecoverySignal`, `SignalConfidence`,
  `SignalContribution`, `RankedCard`. Mirror §2 of
  [`SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md) exactly.
- **Touches:** new file only. Do not edit existing scoring code.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T1.
- **parallel-ok:** false

### T2 — Workspace signal config for Brookside Real Estate
- **Status:** pending
- **Owner:** `intelligence-engine`
- **Scope:** new file `config/signals/nicole-lonergan.ts`
- **Description:** Declare the residential signal pyramid with explicit
  weights, half-lives, and tier references for each signal: `prior_client`,
  `permit_pulled`, `mortgage_release`, `comp_listing_nearby`,
  `crm_recorded_interest`, `last_touch_age`, `verified_contact_path`.
  Each entry must reference an entry in `SIGNAL_TRUST_RULES.md` §3.1.
- **Touches:** new file only.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T2.
- **parallel-ok:** true (with T3)

### T3 — Workspace signal config for LaborTech (roofing only)
- **Status:** pending
- **Owner:** `intelligence-engine`
- **Scope:** new file `config/signals/labortech.ts`
- **Description:** Declare the roofing signal pyramid with explicit
  weights and half-lives for: `permit_pulled`, `paid_ad_presence`,
  `storm_event`, `low_rating_high_reviews`, `website_scan_issues`,
  `last_touch_age`, `business_license_recent`. Multi-trade fields are
  out of scope (see `NO_DRIFT_RULES.md` §1).
- **Touches:** new file only.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T3.
- **parallel-ok:** true (with T2)

### T4 — Deterministic decay function
- **Status:** pending
- **Owner:** `intelligence-engine`
- **Scope:** new file `lib/recovery/signals/decay.ts`
- **Description:** Pure exponential half-life function per
  [`SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md) §4. Plus an
  `inverseTimeRamp` helper for inverse-time signals (§5). No globals, no
  randomness, no time-of-day variance.
- **Touches:** new file only.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T4.
- **parallel-ok:** true (with T1)

### T5 — Signal evaluation engine
- **Status:** pending (blocked by T1–T4)
- **Owner:** `intelligence-engine`
- **Scope:** new file `lib/recovery/signals/evaluator.ts`
- **Description:** `evaluateLead(rawSignals, workspaceConfig, now) → RankedCard`.
  Pure function. Sums decay-weighted contributions. Emits per-signal
  `SignalContribution` records so the disclosure UI can render them
  verbatim. Honors WEAK-only labeling per
  [`SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md) §6.
- **Touches:** new file only.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T5.
- **parallel-ok:** false

### T6 — Wire evaluator into the brief generator
- **Status:** pending (blocked by T5)
- **Owner:** `recovery-brief-builder`
- **Scope:** edits to `scripts/generate-brief.ts` + `lib/recovery/brief.ts`
- **Description:** Replace any monolithic scoring code path with the new
  evaluator. Preserve the existing `RecoveryBrief` / `RecoveryBriefItem`
  JSON schema. New per-card field: `signalContributions: SignalContribution[]`.
  No breaking change to brief HTML structure.
- **Touches:** scripts/generate-brief.ts, lib/recovery/brief.ts.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T6.
- **parallel-ok:** false

### T7 — Determinism check script
- **Status:** pending (blocked by T6)
- **Owner:** `scoring-auditor`
- **Scope:** new file `scripts/check-brief-determinism.ts`,
  `package.json` script registration
- **Description:** Run brief generation twice for each workspace; assert
  byte-identical output (ignoring `generatedAt`). Add `brief:determinism`
  script. The auditor agent runs this on every signal-touching PR.
- **Touches:** new script + package.json script entry only.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T7.
- **parallel-ok:** true (with T8)

### T8 — Per-workspace signal sanity check
- **Status:** pending (blocked by T6)
- **Owner:** `scoring-auditor`
- **Scope:** new file `scripts/check-workspace-signals.ts`,
  `package.json` script registration
- **Description:** For each workspace, assert: (a) every signal name in
  config maps to a tier in `SIGNAL_TRUST_RULES.md` §3.1, (b) every weight
  is 0–100, (c) every halfLifeDays > 0, (d) no BANNED source referenced,
  (e) no WEAK-only card ever shipped without the "judgment call" label.
- **Touches:** new script + package.json script entry only.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T8.
- **parallel-ok:** true (with T7)

### T9 — Decomposition disclosure on the brief card
- **Status:** pending (blocked by T6)
- **Owner:** `recovery-brief-builder` + `ui-simplifier`
- **Scope:** edits to `app/brief/[customer]/[week]/page.tsx`,
  possibly new component `components/brief/SignalDecomposition.tsx`
- **Description:** Add a quiet "Show signals" `<details>` disclosure to
  each card that renders the `signalContributions` verbatim — signal name,
  weight, source, observedAt, decay-applied contribution. No charts, no
  bars, no badges. Calm Linear-grade text. Closed by default. Mirrors the
  tone of `components/outcomes/OutcomeHistory.tsx`.
- **Touches:** brief page + optional new component.
- **Acceptance:** [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) §T9.
- **parallel-ok:** false

---

## What is NOT in Phase 1

Each of these is a known-tempting next step. They are **out of scope**
until Phase 1 closes and the founder reviews:

- New data-source integrations (county recorder, permit feeds) — Phase 2
- Per-workspace weight customization driven by captured outcomes — Phase 2
- "What changed since last brief" diff — Phase 2
- A second LaborTech trade — Phase 3
- Self-serve CSV import — Phase 3
- Pricing UI — out of scope indefinitely

To propose a new task: open a PR titled `[queue]` editing this file.

---

## Status legend

- `pending` — not started
- `in_progress` — claimed by an agent; branch open
- `review` — PR open, awaiting auditor + founder pass
- `done` — merged into main
- `blocked` — flagged, see notes on the task
