Dylan, the hard thing you are probably avoiding is sending the paid-pilot ask and accepting a market answer instead of producing another internal artifact.

# Founder Brief - 2026-07-03

## Evidence Base

- Repository: `/workspace`.
- Active branch: `cursor/founder-challenge-brief-afbc`.
- HEAD at audit time: `a19b063 feat: add career calendar sync`, the same commit as `main`, `origin/main`, and `origin/HEAD`.
- Uncommitted work before this brief: `package-lock.json` only. The diff removes optional Next SWC platform packages from the lockfile. I did not create or stage that change.
- Current checkout had no committed Founder Brief file under `research/strategy/` before this brief; only `.gitkeep` was present there.
- Existing Founder Brief artifacts are open PRs, not merged repository state. `gh pr list` showed Founder Brief PRs #74 through #86 still open, including #86 for July 2.
- Recent remote history shows repeated daily Founder Brief branches plus product work around career calendar sync, AE job ingestion/actions/briefs, CEO daily workflow, heartbeat, CRM import, auth, and relationship engine surfaces.
- `npm run heartbeat:run` passed 7/7 on 2026-07-03.
- Heartbeat reported: 0 approvals awaiting, 0 priorities today, 1 blocked item, 0 revenue opportunities, and checks 7/7 passing.
- Heartbeat blocked item: `labortech contact-level health`, blocked because the Phase 1 probe cannot read the snapshots source as a contact store.
- Heartbeat explicitly says Brookside health, Revenue health, Build health, and credentialed DB checks are not covered yet.
- `npm run crm-import:check` passed. It created a local CRM smoke-test artifact, which I restored before staging this brief.
- Tracked CRM import state contains one previewing test job for `nicole-lonergan` with `rowCount: 1` and `importedCount: 0`.
- `npm run ae-jobs:check` failed on `career brief clipboard loom recommendation`.
- `fixtures/outreach-prospect-tracker.csv` contains only headers. There is no recorded outreach, last touch, next step, sample brief sent, call status, pricing discussion, or notes.
- `fixtures/sample-brief-prospects.csv` contains 30 recruiting/search prospects. The first high-priority prospect is ELKALYNE, with Lisa Gonzales listed as founder/partner.
- `data/reviews.json` is `{}`.
- `data/recovery-briefs/staffing-pipeline-recovery/2026-W20.json` exists. It has 4 input rows, 4 opportunities, and 3 recovery candidates.
- `content/public/home.ts` points the public sample CTA at `/brief/staffing-pipeline-recovery/2026-W20`.
- `docs/product/product-principles.md` says to build weekly Recovery Briefs, read-only CSV ingestion, verified contact resolution, explainable why-now lines, suggested openers, manual outreach support, and internal founder QA tooling.
- The same product principles say not to build autonomous outreach, CRM replacement workflows, workflow orchestration, enterprise dashboards, real-time CRM writes, or multi-seat/team features before paying customer demand.

## Repository State

The repository has enough to demonstrate the Recovery Brief wedge:

- A public CTA routes to a real sample brief.
- The sample brief has ranked opportunities, why-now lines, contact paths, suggested openers, and recovery scores.
- The prospect fixture identifies a concrete first target.
- The product canon supports founder-reviewed manual outreach now.

The repository does not show evidence that the wedge has been sold:

- Outreach tracker: blank except headers.
- Reviews: empty.
- CRM import: preview test data only, 0 imported rows.
- Heartbeat revenue opportunities: 0.
- Revenue health coverage: not covered.

## Git History

Observed recent work is concentrated in internal systems:

- `feat: add career calendar sync`
- `feat: add AE job parsed email ingestion`
- `feat: add career brief execution actions`
- `feat: make career brief default operating surface`
- `feat: add career brief operating surface`
- `feat: add real AE job pipeline foundation`
- `feat: add AE job operating system surface`
- CEO daily workflow, CEO approval queue, heartbeat, CRM import, auth, relationship intelligence, and relationship engine work.

Daily Founder Brief PRs also exist, but they are open artifacts rather than merged operating changes. The repeated challenge loop is visible. The business response to that loop is not visible.

## Active Branch

`cursor/founder-challenge-brief-afbc`.

This branch started at `a19b063`, aligned with `main` and `origin/main`.

## Uncommitted Work

Pre-existing uncommitted work:

- `package-lock.json`: removes optional Next SWC platform package entries.

I left that unstaged because it is review noise unrelated to the revenue question.

## Existing Founder Brief

The current checkout did not contain a merged Founder Brief under `research/strategy/`.

Existing brief artifacts are remote open PRs:

- #74 through #86 are open.
- Latest observed: #86, "Add founder brief for July 2", head `cursor/founder-challenge-brief-fa8e`.

That means the founder challenge mechanism is producing documents faster than the repo is resolving them.

## Ops Reports

`generated/heartbeat/latest.md` from today's run says:

- 0 approval(s) awaiting.
- 0 priority(ies) today.
- 1 blocked.
- 0 opportunity(ies).
- Checks 7/7 passing.

The blocked item is not a customer revenue blocker. It is an observability limitation: contact-level health is not derivable from the Labortech snapshot source in Phase 1.

## Weekly State

The only tracked weekly Recovery Brief evidence is sample/demo state:

- `Staffing Pipeline Recovery`
- Week: `2026-W20`
- Generated: `2026-05-17T00:11:44.447Z`
- 4 input rows.
- 4 opportunities.
- 3 recovery candidates.

There is no observed current customer weekly brief, current customer CSV, current customer delivery, or current customer payment.

## CRM Audits

`npm run crm-import:check` passed.

That proves the smoke path can parse and persist test-like import state. It does not prove a customer has sent data. It does not prove a customer brief has been generated from a real customer CSV. It does not prove a customer is paying.

Tracked CRM import state still shows preview-only test data:

- Workspace: `nicole-lonergan`.
- Source label: `test`.
- State: `previewing`.
- Row count: 1.
- Imported count: 0.

## Existing Review Artifacts

- `data/reviews.json` is empty.
- `docs/workflows/pr-review-checklist.md` exists and defines review standards.
- Founder Brief PRs #74 through #86 remain open.

The review system exists. Review decisions are not visible in the repository.

## What Makes Money Today

The only observed thing that can make money today is a founder-delivered Recovery Brief paid pilot.

Evidence:

- The public site already routes to a sample Recovery Brief.
- The sample brief already demonstrates the product shape.
- The prospect list already identifies a first high-priority recruiting buyer: Lisa Gonzales at ELKALYNE.
- The offer matches the canon: founder-reviewed, manual, read-only, explainable, revenue-oriented relationship recovery.

What does not make money today, based on observed evidence:

- AE job tooling. It is Dylan career workflow evidence, not Meridian customer revenue evidence.
- Heartbeat. It reports 0 revenue opportunities and no Revenue health coverage.
- Relationship engine architecture. It may become useful, but the current evidence does not connect it to a paid customer.
- CRM smoke tests. They show technical readiness, not demand.
- Open Founder Brief PRs. They preserve warnings, but warnings are not revenue.

## Revenue Challenge

Send one founder-written paid-pilot outreach using the existing Staffing Pipeline Recovery sample and record the exact result.

The repeated recommendation has not changed because the underlying evidence has not changed:

- No sent paid-pilot message recorded.
- No prospect reply recorded.
- No pricing discussion recorded.
- No discovery call recorded.
- No customer CSV received.
- No paid pilot accepted or rejected.

If the tracker remains blank, the revenue constraint is not missing architecture. It is missing founder selling.

## What Can Break Revenue

- No market contact. A sample brief with no ask produces no revenue signal.
- Open challenge PR pileup. PRs #74 through #86 are evidence that feedback is accumulating without visible resolution.
- Revenue health is unmeasured. Heartbeat says Revenue health is not covered and reports 0 revenue opportunities.
- CRM import is still test-state evidence. The tracked job has `importedCount: 0`.
- AE job checks are red. The newest career workflow surface still fails one check.
- Product attention is drifting toward Dylan's personal career system while the customer-facing paid-pilot loop remains unproven.
- The lockfile is dirty before revenue work begins. That creates review noise unrelated to selling.

## Founder Contradictions

- Stated priority: revenue before architecture. Observed activity: recent product work centers on AE job tooling, career calendar sync, heartbeat, approval queues, and relationship engine surfaces.
- Stated priority: customer value before technical elegance. Observed evidence: no customer outreach response, no pricing conversation, no customer CSV, no imported customer CRM rows.
- Stated priority: shipping before planning. Observed state: a public sample exists, but the tracked outreach motion is empty.
- Stated priority: evidence before opinion. Observed pattern: the repository has repeated briefs saying the same thing, but no durable evidence that the recommended customer ask happened.
- Stated product boundary: manual outreach support, not automation. Observed opportunity: the manual outreach itself is absent.

## Stated Priorities vs Observed Activity

Stated priorities in canon:

- Commercially important relationships.
- Dormant opportunity recovery.
- Explainable why-now compression.
- Read-only CSV ingestion.
- Founder-reviewed manual outreach support.

Observed repository activity:

- Career calendar sync is HEAD.
- AE job ingestion, AE job actions, career brief home, and AE job operating surfaces appear immediately behind HEAD in recent history.
- Heartbeat and CEO workflow surfaces exist.
- CRM import check passes, but tracked state is preview-only.
- Recovery Brief sample exists, but outreach tracker is blank.
- Daily Founder Brief PRs are open and unresolved.

The observed pattern is not "revenue before architecture." It is "internal operating system before customer contact."

## Opportunity Cost

What is not getting done because attention is elsewhere:

- No paid-pilot ask is recorded.
- No buyer objection is captured.
- No pricing sentence is tested.
- No first-call script is validated against an actual prospect.
- No customer CSV is obtained.
- No customer Recovery Brief is delivered.
- No evidence exists that the first wedge is commercially valuable.

Every internal system that does not force a customer conversation increases the chance that technical work is replacing the work that can disprove or validate the business.

## Decision Pressure

Dylan is blocking one decision:

Is Recovery Brief a paid founder-delivered offer now, or still an internal product idea waiting for more polish?

The repository cannot answer that. A prospect can.

If the answer is "not ready," the missing artifact must be named precisely. "More product work" is too vague. The current evidence already includes a sample, a prospect list, a mailto intake path, and a manual delivery posture.

## CEO Attention

The highest leverage use of Dylan today is not code review, not system design, not AE job workflow, and not another observer report.

The highest leverage use is direct founder selling against the first named high-priority prospect.

## Recommended Day Structure

1. Open the Staffing Pipeline Recovery sample and ELKALYNE prospect row.
2. Write a short paid-pilot ask in Dylan's voice.
3. Send it manually.
4. Record the exact message, timestamp, outreach status, and response status in the tracker.
5. Do not touch product code unless the reply exposes a specific sales-critical gap.

## Anti Rationalization

Rationalization: "The product needs more proof before outreach."

Counter-evidence:

- The public site already points to a real sample.
- The sample already contains ranked opportunities, why-now lines, contact paths, and suggested openers.
- The prospect fixture already identifies a high-priority buyer.
- Product principles explicitly support founder-reviewed manual outreach now.

Rationalization: "Heartbeat passing means the business is healthier."

Counter-evidence:

- Heartbeat passed 7/7 and still reported 0 revenue opportunities.
- Heartbeat says Revenue health is not covered.
- Passing observer checks does not create demand.

Rationalization: "AE career workflow work sharpens Meridian."

Counter-evidence:

- The AE data is Dylan's career workflow, not customer revenue.
- The AE check still fails.
- A better personal career surface does not validate the Recovery Brief offer.

Rationalization: "Open Founder Brief PRs preserve the operating memory."

Counter-evidence:

- PRs #74 through #86 are still open.
- Preserved warnings are not decisions.
- A warning that does not change behavior becomes background noise.

## Pushback

The evidence says Meridian has enough product surface to ask for money and not enough customer evidence to justify more internal buildout.

The uncomfortable read is that technical work is functioning as controlled avoidance. Code gives a clean feedback loop: run checks, fix failures, commit, push. Sales gives an uncontrolled feedback loop: a buyer can ignore, object, negotiate, or reject. That is exactly why it matters.

The repository is strongest where it observes and explains. The business is weakest where it must ask and learn.

If Lisa Gonzales says no, that is evidence. If she ignores the email, that is evidence. If she asks price, that is evidence. If she sends a CSV, that is evidence. A blank tracker is not evidence. It is an absence of execution.

## Single Highest Leverage Action

Send one founder-written paid-pilot outreach to Lisa Gonzales at ELKALYNE using the Staffing Pipeline Recovery sample, then record the exact message and response status.
