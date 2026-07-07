# Founder Brief - 2026-07-05

Dylan, the hard thing you are probably avoiding is asking one real recruiting prospect to pay for a controlled Recovery Brief pilot, then recording the actual response instead of producing another internal artifact.

## Audit Evidence

- Repository state: active branch is `cursor/founder-challenge-brief-8bde` at `a19b063` (`feat: add career calendar sync`), equal to `origin/main` at audit time.
- Uncommitted work at audit start: `package-lock.json` had 105 deleted optional Next/SWC platform package entries. This appears to be pre-existing dependency churn and is not part of this brief.
- Current checkout had no committed files under `research/strategy/` before this brief was created.
- GitHub has open Founder Brief PRs #74 through #88, including July 4's `cursor/founder-challenge-brief-1b93`; the recurring briefs are accumulating as open review artifacts, not merged operating state.
- Recent mainline history is dominated by AE career-job work and heartbeat/operator surfaces: career calendar sync, AE job ingestion, career brief actions, career brief home/default surface, real AE job pipeline foundation, CEO Daily Workflow, approval queue, and workspace health.
- `npm run heartbeat:run` passed 7/7 on 2026-07-05, but the generated CEO workflow said: 0 approvals, 0 priorities, 1 blocked item, 0 revenue opportunities, and "No revenue opportunities derivable from current evidence."
- The heartbeat coverage line says only 7 of 24 audit scripts run as observer-safe, and Revenue health, Brookside health, Build health, and credentialed DB checks are not covered yet.
- The only blocked heartbeat item is `labortech contact-level health`; the reason is that the Phase 1 probe cannot read the snapshots source as a contact store.
- `npm run crm-import:check` passed, but the persisted CRM import state is one `previewing` Nicole Lonergan test job with 1 row and 0 imported rows. The smoke check created a local test artifact, then it was restored.
- `npm run ae-jobs:check` failed on `career brief clipboard loom recommendation`; this failure is in Dylan's career/job workflow, not in the Recovery Brief revenue path.
- `fixtures/sample-brief-prospects.csv` contains 30 recruiting/staffing prospects. The first high-priority row is ELKALYNE / Lisa Gonzales, with `sample_brief_status` = `Public scan complete`.
- `fixtures/outreach-prospect-tracker.csv` contains headers only and 0 tracked outreach rows.
- `data/reviews.json` is `{}`.
- The public CTA still points to `/brief/staffing-pipeline-recovery/2026-W20`.
- The staffing Recovery Brief sample exists and shows 4 input rows, 4 opportunities, and 3 recovery candidates; its top card is Mason Hill Search, 151 days stale, bucketed as "Call now."
- Product principles say to build weekly Recovery Briefs, read-only CSV ingestion, verified contact resolution, manual outreach support, and founder QA tooling. They explicitly say not to build autonomous outreach, predictive ML scoring, CRM replacement workflows, workflow orchestration, enterprise dashboards, or real-time CRM write access.
- Outreach readiness copy says the commercial motion is: free first sample brief, then fixed-scope paid pilot with one controlled CSV export, one Recovery Brief, and one review call.
- Evidence of actual paid-pilot outreach, customer payment, signed pilot, invoice, or prospect response is missing from the repo.

## What Makes Money Today

The only observed money path is not another product surface. It is founder-led sale of the Recovery Brief:

1. Use the existing staffing sample brief.
2. Contact a real high-priority recruiting prospect from the prospect fixture.
3. Offer a fixed-scope paid pilot before any sensitive data is shared.
4. Record the exact message and response in the outreach tracker.

Everything needed to make the ask appears to exist: a public sample URL, a strongest staffing sample, a high-priority prospect list, positioning language, pricing language, and objection language. What is missing is evidence that the ask happened.

## Revenue Challenge

The repo is treating "ready to sell" as equivalent to "sold or selling." It is not.

Heartbeat passing 7/7 does not mean the business is healthy. It means a narrow observer-safe test set passed. The same heartbeat says there are 0 revenue opportunities derivable from current evidence and that Revenue health is not covered.

The challenge is simple: if Lisa Gonzales or another high-priority staffing prospect has not received a founder-written paid-pilot ask, the bottleneck is not code. The bottleneck is Dylan avoiding direct commercial exposure.

If outreach has happened outside the repo, the repository still fails the evidence test because the tracker is empty. The operator cannot distinguish "no customer work happened" from "customer work happened but was not recorded." Both are operationally bad.

## What Can Break Revenue

- No tracked outreach: the prospect tracker has 0 rows, so there is no follow-up system for the only visible commercial motion.
- No Revenue health coverage: heartbeat explicitly omits Revenue health, so a green heartbeat can hide a commercially dead day.
- Open brief PR accumulation: PRs #74-#88 are still open, which turns founder challenge into review inventory instead of decision pressure.
- Sample/demo ambiguity: product canon says committed generated briefs may be committed only if marked `isSample: true`; the committed Recovery Brief JSON files do not show that marker in the audited staffing sample.
- Career-job surface drift: the latest commits and the failing `ae-jobs:check` are about Dylan's job-search operating surface, not the Recovery Brief business.
- CRM import state is still preview/test evidence: one previewing job, 0 imported rows, and no live customer CRM evidence.

## Founder Contradictions

- Stated priority: revenue before architecture. Observed activity: open Founder Brief PRs stack up while the outreach tracker remains empty.
- Stated priority: customer value before technical elegance. Observed activity: recent mainline work emphasizes AE job/career surfaces and heartbeat infrastructure; there is no recorded customer conversation tied to the paid-pilot motion.
- Stated priority: shipping before planning. Observed activity: daily briefs are being produced, but prior daily briefs remain open PRs rather than merged operating records.
- Stated priority: evidence before opinion. Observed activity: the system can prove tests pass, but cannot prove one prospect was asked to pay.
- Product principle: build manual outreach support. Observed artifact: support exists in `/admin/outreach`; execution evidence is missing.
- Heartbeat says "Nothing needs your call today." Founder reality says the opposite: Dylan needs to make the revenue ask because the system cannot do it for him without violating the manual founder-led promise.

## Compare Stated Priorities Against Observed Activity

The stated company direction is Recovery Briefs for dormant relationship revenue. The observed repository direction is operational tooling, heartbeat reporting, relationship-engine dry-run boundaries, and Dylan career-job workflow.

Those are not worthless, but they are lower leverage than customer proof. The repo now has enough internal tooling to make non-selling feel like operating. That is the rationalization risk.

The strongest commercial artifact is still the staffing Recovery Brief sample from 2026-W20. The strongest commercial next step is still outbound paid-pilot pressure against the recruiting prospect list. The observed activity has not displaced that fact.

## Opportunity Cost

Attention spent on career brief recommendations, calendar sync, observer-safe command contracts, and recurring Founder Brief PRs is attention not spent on:

- asking one high-priority prospect to pay;
- learning why the pitch fails;
- turning a "public scan complete" prospect into a recorded outcome;
- validating whether boutique recruiters actually want a paid Recovery Brief;
- discovering whether the sample brief is persuasive enough to move money.

The opportunity cost is not theoretical. It is visible in an empty outreach tracker.

## Decision Pressure

Dylan is blocking progress by leaving the commercial decision unforced.

The decision is not whether Meridian needs a better architecture, a broader heartbeat, or another operating surface. The decision is whether Dylan is willing to put the current Recovery Brief in front of a real buyer and ask for paid pilot commitment.

If the answer is no, say no and stop pretending technical work is the constraint.

If the answer is yes, the only acceptable evidence is the exact outbound message, recipient, date, and response status recorded in the tracker.

## CEO Attention

Highest leverage use of Dylan today: one uninterrupted founder-sales block aimed at converting one high-priority recruiting prospect from "public scan complete" to a documented paid-pilot ask.

Do not spend that block reviewing more internal artifacts unless the review directly changes the outbound message being sent today.

## Recommended Day Structure

Use the first work block for customer contact before opening architecture, AE job workflow, or heartbeat work. The block should end with one recorded artifact: the sent message and response status in `fixtures/outreach-prospect-tracker.csv`.

After that, technical work can resume only if it supports the next customer ask or records the outcome. If it does neither, it is displacement.

## Anti Rationalization

"The checks pass" is not revenue evidence.

"The sample brief exists" is not revenue evidence.

"The prospect list exists" is not revenue evidence.

"The outreach page has pricing language" is not revenue evidence.

"Founder Briefs keep getting produced" is not revenue evidence.

Revenue evidence is a buyer interaction with a commercial ask and a recorded outcome.

## Pushback

You are likely using operator improvement as a safer substitute for founder selling. The repo supports that read: internal systems keep advancing while the first commercial action remains unrecorded.

The uncomfortable assumption to challenge is that better tooling will make the first sale easier. The current evidence says the bottleneck is not tooling. It is commercial exposure.

If this is wrong, the evidence should be easy to produce: a dated outbound message, a prospect name, and the reply or no-reply status. That evidence is missing.

## Single Highest Leverage Action

Send one founder-written paid-pilot outreach to Lisa Gonzales at ELKALYNE using the Staffing Pipeline Recovery sample, then record the exact message and response status in `fixtures/outreach-prospect-tracker.csv`.
