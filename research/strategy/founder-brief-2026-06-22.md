# Founder Brief - 2026-06-22

Dylan, the hard thing you are probably avoiding is forcing one real buyer judgment on the Recovery Brief while the repository keeps creating cleaner internal ways to avoid that judgment.

## Evidence Base

- Date: 2026-06-22.
- Active branch: `cursor/founder-challenge-brief-2cbf`.
- Current HEAD: `a19b063 feat: add career calendar sync`, also pointed at by `origin/main`, `origin/HEAD`, `main`, and `origin/feature/calendar-sync-v1`.
- Uncommitted work at audit start and after heartbeat: `package-lock.json` only, deleting 105 optional `@next/swc-*` package entries. This is dependency/install churn, not revenue evidence.
- Current heartbeat run: `npm run heartbeat:run` passed 7/7 observer checks and generated `generated/heartbeat/latest.md` plus `generated/heartbeat/brief-today.md`.
- Heartbeat result: 0 approvals awaiting, 0 priorities today, 1 blocked item, 0 opportunities, checks 7/7 passing.
- Heartbeat blocked item: `labortech` contact-level health is not measurable because the source is a snapshots/operator-UI projection, not a contact store.
- Heartbeat explicitly does not cover Brookside health, Revenue health, Build health, or credentialed DB checks.
- Current public CTA in `content/public/home.ts` points to `/brief/staffing-pipeline-recovery/2026-W20` and says the link points at a real generated Recovery Brief on disk under `data/recovery-briefs/`.
- The current tracked `data/` tree has no files.
- The brief route `app/brief/[customer]/[week]/page.tsx` loads `data/recovery-briefs/<customer>/<week>.json`; without that JSON the route returns `notFound()`.
- `lib/outreach/demoBriefs.ts` lists three demo brief URLs, including the staffing sample, all under `/brief/*/2026-W20`.
- `fixtures/` currently contains only operational-event fixtures. `fixtures/sample-brief-prospects.csv` is not present in this checkout, although `app/admin/prospects/page.tsx` reads it at runtime.
- `app/admin/outreach/page.tsx` still identifies boutique staffing and recruiting firms as the recommended first vertical and says to quote a fixed-scope paid pilot after a useful free sample.
- `lib/outreach/scripts.ts` contains manual LinkedIn, email, phone, voicemail, CSV request, delivery, pricing, and follow-up scripts.
- `lib/outreach/checklist.ts` says to open every sample Recovery Brief link before sending or posting, say samples are fictional, avoid overclaims, and use free first brief then fixed-scope paid pilot language.
- Remote Founder Brief artifacts exist for June 10, 14, 15, 17, 18, 19, and 20 on sibling `origin/cursor/founder-challenge-brief-*` branches.
- The latest sampled Founder Brief from June 20 pressed the same conclusion: send the staffing Recovery Brief sample to one buyer and record the response.
- Review artifacts exist: `.github/pull_request_template.md`, `docs/workflows/pr-review-checklist.md`, `docs/meridian-philosophy.md`, `docs/product/product-principles.md`, `docs/product/ingestion-principles.md`, `docs/scoring-principles.md`, and `docs/copywriting-principles.md`.
- Missing evidence in this checkout: no committed customer-feedback file, no payment record, no invoice, no paid pilot record, no sent-outreach log, no buyer reply, no win/loss record, no revenue-health report, no current weekly commercial state document, no standalone CRM audit report, and no current tracked sample/prospect data backing the sales path.

## Repository State

The repository is active. It is not proving revenue.

The current branch is clean except for unrelated `package-lock.json` churn and this brief. There is no product implementation delta on the active branch before this Founder Brief.

The most important repository-state fact is not that the code can render a Recovery Brief in theory. The important fact is that the current checkout cannot verify the buyer-facing staffing sample path from tracked data. The homepage says the CTA points at a real generated brief on disk. The route requires `data/recovery-briefs/staffing-pipeline-recovery/2026-W20.json`. The tracked `data/` tree is empty.

That creates a direct sales-path risk: the product has outreach assets and a CTA, but the current repo does not contain the evidence needed to prove the CTA works from source.

## Git History

Recent all-branch history since June 1 shows:

- Seven Founder Brief commits between June 10 and June 20.
- A June 2 cluster around AE jobs, Career Brief, parsed email ingestion, execution actions, and calendar sync.
- A June 2 cluster around Operations Center, CRM audit severity fixes, external review package manifests, and a revenue-first Founder Morning Brief script.
- May 31 heartbeat and CEO workflow work.
- Ongoing remote branches around CRM import, relationship engine, operational events, outreach readiness, sample briefs, public positioning, and recovery brief work.

The history proves system activity. It does not prove that a buyer saw the offer, replied, sent a CSV, accepted a paid pilot price, or rejected the product.

The repeated Founder Brief commits are themselves evidence. The same pressure has recurred across multiple briefs: expose the Recovery Brief to a buyer and capture the response. If that recommendation keeps reappearing, the blocker is not lack of analysis.

## Active Branch

`cursor/founder-challenge-brief-2cbf` is based on `a19b063`, the same commit as `origin/main`.

This branch did not start with a current dated Founder Brief file in the checkout. Prior briefs exist on sibling remote branches, not in the active tree.

## Uncommitted Work

The pre-existing `package-lock.json` diff removes optional Next SWC platform packages. It should not be treated as product progress, revenue work, or strategy.

It should not be mixed into this brief commit.

## Existing Founder Brief

Existing Founder Briefs are historical artifacts on remote sibling branches:

- June 10.
- June 14.
- June 15.
- June 17.
- June 18.
- June 19.
- June 20.

The latest sampled brief concluded that Dylan should send a clearly framed staffing sample to a high-priority boutique recruiting prospect and ask whether a fixed-scope paid pilot is worth discussing.

Today changes the evidence in one uncomfortable way: this checkout no longer contains the tracked sample/prospect data that the June 20 brief described. The current repo still points to those assets, but cannot verify them from the active tree.

## Ops Reports

Today's heartbeat is green and commercially empty.

Evidence from `generated/heartbeat/brief-today.md`:

- 0 approval(s) awaiting.
- 0 priority(ies) today.
- 1 blocked item.
- 0 opportunity(ies).
- 7/7 checks passing.
- "No revenue opportunities derivable from current evidence."
- Not covered: Brookside health, Revenue health, Build health, Credentialed DB checks.

Evidence from `generated/heartbeat/latest.md`:

- All seven observer checks passed.
- Regression comparison is unavailable because this is the first heartbeat run in the current generated history.
- Coverage is 7 of 24 audit scripts, or 29%; compile/build is not covered in Phase 1.

Green observer checks mean the observer-safe checks passed. They do not mean a buyer cares, the sample link works in the current checkout, a pilot has been quoted, or revenue is moving.

## Weekly State

The stated product is weekly: a Recovery Brief for dormant relationships.

The current public sample week remains `2026-W20`. Today is 2026-06-22. There is no committed weekly commercial state artifact in this checkout answering:

- Which prospects were contacted this week?
- Which sample links were sent?
- Which buyers replied?
- Which CSVs were requested?
- Which CSVs were received?
- Which paid pilots were quoted?
- Which pilots were won or lost?
- Which objections repeated?

The repository can generate weekly product output. It does not show weekly selling output.

## CRM Audits

CRM and relationship-data work is substantial at the code level.

Evidence:

- `lib/crm-import/*` includes normalization, validation, dedupe, diagnostics, trust, reachability, execution, rollback, and storage.
- `scripts/check-crm-import.ts` verifies mapping, trust display alignment, dedupe, relationship scoring, resurfacing buckets, diagnostics, and persistence.
- `scripts/heartbeat/workspace-health.ts` reads `data/crm-contacts/*.json` and `data/snapshots/*.json` and emits contact-level metrics only when the source is measurable.
- Today's heartbeat says `labortech` contact-level health cannot be measured from snapshots.

Missing evidence:

- No dated standalone CRM audit report is present in the current checkout.
- No current `data/crm-contacts` files are tracked here.
- No buyer is identified as waiting on CRM import before revenue can proceed.

CRM reliability can protect delivery later. It does not make money today unless a named buyer is currently blocked on it. Evidence for that buyer is missing.

## Existing Review Artifacts

Review discipline is stronger than revenue evidence.

Evidence:

- `docs/workflows/pr-review-checklist.md` asks whether each change increases operator trust, remains explainable, improves commercial prioritization, reduces noise, and avoids AI theater.
- `docs/scoring-principles.md` requires every score, rank, and why-now line to trace to observable signals.
- `docs/product/product-principles.md` says to build weekly Recovery Briefs, founder-curated calibration, read-only CSV ingestion, verified contact resolution, explainable why-now lines, suggested openers, manual outreach support, and founder QA tooling.
- `docs/product/product-principles.md` says not to build autonomous outreach, CRM replacement workflows, workflow orchestration, enterprise dashboards, real-time CRM write access, or multi-seat/team features before customer pull.
- `docs/product/ingestion-principles.md` says CSV is the primary ingestion path and CRM sync waits until at least three customers request the same integration.
- `docs/copywriting-principles.md` requires prospect-facing samples to carry explicit sample framing: sample banner, sample kicker, fictional summary sentence, and footer disclaimer.

The review apparatus can explain why Meridian should be trustworthy. The repository still lacks evidence that trust has been tested with buyers.

## What Makes Money Today

The only visible money path today is founder-led selling of the Recovery Brief.

What can make money today:

- A boutique staffing or recruiting owner sees a working, clearly framed Recovery Brief sample.
- Dylan asks whether dormant client, candidate, or paused-search follow-up is a real problem.
- If the buyer engages, Dylan asks whether a fixed-scope paid pilot is worth discussing.
- Dylan records the response, silence, objection, or next step.

The heartbeat does not make money today.

The AE job system does not make money today.

The career calendar does not make money today.

CRM import does not make money today unless a buyer is waiting on it.

Relationship-engine architecture does not make money today unless it produces a brief a buyer will pay for.

## Revenue Challenge

The revenue challenge is narrow:

Can Dylan get one buyer to make a concrete judgment on the Recovery Brief offer?

Not Meridian as an operating system.

Not CRM import.

Not relationship-engine architecture.

Not heartbeat.

One sellable artifact: a short founder-reviewed memo that ranks dormant relationships, explains why now, and gives a human opener.

The current repository contains outbound language and first-vertical positioning. It does not currently contain tracked data proving the sample CTA works, a current prospect list, or a recorded buyer response. That means the next evidence unit must be external to the repo or must restore only the smallest missing sales-path artifact.

## What Can Break Revenue

1. Broken sample path.
   - `content/public/home.ts` says the CTA points at a real generated brief on disk.
   - `app/brief/[customer]/[week]/page.tsx` requires `data/recovery-briefs/<customer>/<week>.json`.
   - The tracked `data/` tree is empty in this checkout.

2. Missing prospect worklist.
   - `app/admin/prospects/page.tsx` reads `fixtures/sample-brief-prospects.csv`.
   - That file is absent from the current checkout.
   - If Dylan says prospecting is ready, the repo does not currently prove it.

3. False comfort from heartbeat.
   - Heartbeat passed 7/7 checks.
   - Heartbeat also says 0 revenue opportunities and Revenue health is not covered.
   - Passing observer checks can become a substitute for confronting market risk.

4. Product narrative split.
   - Canon says weekly Recovery Brief.
   - Recent history shows Career Brief, AE job pipeline, calendar sync, heartbeat, CRM import, relationship engine, operational events, workflow surfaces, and workspace routing.
   - A buyer can reasonably become unclear whether Meridian is a memo, CRM layer, lead finder, operator console, or Dylan's personal career system.

5. Sample-framing trust risk.
   - Copywriting canon requires explicit sample framing for prospect-facing samples.
   - The route inspected renders `Recovery Brief - {week}` from data and does not itself enforce the four required sample signals.
   - If sample data is restored without explicit framing, the buyer may have to guess whether names, notes, companies, and contact paths are fictional.

6. Ingestion promise tension.
   - Ingestion canon says founder-assisted CSV, read-only posture, and no customer database during founder-delivered phase.
   - The repo also contains CRM contact persistence, rollback storage, workspace contact health, and relationship-engine surfaces.
   - If Dylan sells a simple manual brief, he must not demonstrate platform storage as though it is part of the first offer without disclosure.

## Founder Contradictions

- Stated priority: revenue before architecture.
  - Observed activity: substantial work around AE jobs, Career Briefs, calendar sync, heartbeat, CRM import, relationship engine, operational events, and workspace surfaces.

- Stated product: weekly Recovery Brief.
  - Observed activity: daily heartbeat, CEO workflow, career brief, AE job operating system, workspace routing, and relationship-data infrastructure.

- Stated rule: evidence before opinion.
  - Observed evidence: strong system-check evidence, weak buyer evidence.

- Stated GTM: boutique staffing and recruiting first.
  - Observed repo: first-vertical positioning exists, but the current tracked prospect CSV is absent.

- Stated CTA: the public sample points at a generated brief on disk.
  - Observed repo: the current tracked `data/` tree is empty.

- Stated rule: customer feedback should guide build decisions.
  - Observed repo: no committed customer-feedback artifact, sent-outreach log, paid pilot record, or buyer objection log.

- Stated constraint: defer integrations and platform expansion until customer pull.
  - Observed repo: platform gravity continues without committed evidence here that buyers pulled it.

## Stated Priorities vs Observed Activity

| Stated priority | Repository evidence | Challenge |
| --- | --- | --- |
| Weekly Recovery Brief | Generator, route, public CTA, demo URL catalog | Current tracked data does not prove the linked sample renders. |
| Manual founder outreach | Outreach scripts, readiness checklist, admin outreach page | No sent outreach or buyer response artifact found. |
| Boutique staffing first | Outreach page and demo brief metadata | Current prospect fixture is absent from this checkout. |
| Commercial prioritization | Canon docs and scoring rules | Heartbeat derives 0 revenue opportunities from current evidence. |
| Trust and explainability | PR checklist, scoring principles, copywriting principles | Sample framing is not enforced by the route itself. |
| CSV-first founder delivery | Ingestion canon and CSV request script | CRM import/persistence/workspace surfaces create platform drift. |
| Shipping before planning | Many internal surfaces shipped | The commercially decisive shipment is still one buyer seeing and judging the offer. |

## Opportunity Cost

Attention spent on heartbeat interpretation, AE job workflows, Career Brief actions, calendar sync, CRM import reliability, relationship-engine architecture, operational-event contracts, and broader platform surfaces is attention not spent on:

- verifying the buyer-facing sample path,
- putting the Recovery Brief in front of one named buyer,
- asking whether the dormant-relationship problem is real,
- asking for a paid-pilot conversation,
- recording the exact response,
- learning whether the Recovery Brief wedge deserves more build time.

The opportunity cost is not abstract. The codebase contains enough language to make a sales attempt, but the current repo does not show the attempt happened.

## Decision Pressure

No Tier 2 approval is blocking progress.

No failing observer check is blocking progress.

No missing architecture is blocking progress.

The blocking decision is whether Dylan will accept a real buyer response as the next unit of progress.

If the sample path is broken, the decision is smaller than it may feel: restore or verify only the sales-path artifact needed to send the sample. Do not convert that into a broader platform project.

If the sample path works in production but not in the repo, the decision is to document where the buyer-facing artifact lives and use it. Do not pretend the current repo proves what it does not prove.

## CEO Attention

Highest leverage use of Dylan today is one auditable buyer interaction around the Recovery Brief.

Not reading heartbeat.

Not improving career workflows.

Not broadening the relationship engine.

Not polishing CRM import.

Not writing another positioning document.

One auditable buyer interaction means: a named buyer, a working sample or clearly described artifact, the exact message or call, the paid-pilot question if interest exists, and the result recorded.

## Recommended Day Structure

1. Open the staffing Recovery Brief sample exactly as a buyer would.
2. If it fails, restore only the missing sample backing data or use the production artifact if it exists.
3. Select one named boutique staffing or recruiting owner from a real list, not from memory haze.
4. Send one founder-written note using the existing manual outreach language.
5. Ask whether dormant client or candidate follow-up is a real problem.
6. If yes, ask whether a fixed-scope paid pilot is worth discussing.
7. Record the exact response, silence, objection, or next step.
8. Stop there.

## Anti Rationalization

"Heartbeat is green" is not traction.

"The sample route exists" is not proof the sample works.

"The homepage CTA points somewhere" is not proof a buyer saw it.

"The outreach scripts exist" is not outreach.

"The prospect page exists" is not a prospect list when the CSV fixture is missing.

"CRM import is safer" is not revenue unless a buyer is waiting on CRM import.

"Relationship-engine architecture is strategic" is not evidence that a recruiting owner will pay for a Recovery Brief.

"The product needs one more internal surface" is unsupported until one buyer reacts to the current offer.

## Pushback

Dylan, the repo shows a founder repeatedly building better internal instruments for deciding what to do while the highest-value decision has stayed unchanged across multiple Founder Briefs.

The current tree makes the avoidance easier to see. It has outbound scripts and a first-vertical story, but it does not currently prove the linked sample or prospect list from tracked files. That can become another technical rabbit hole.

Do not use that rabbit hole.

If the sample link is broken, fix the smallest thing that lets a buyer see the artifact.

If the sample link works outside the repo, use it and record where it lives.

If the buyer says no, that is evidence.

If the buyer ignores it, that is evidence.

If the buyer asks for CRM sync before paying, that is evidence.

If no buyer sees the offer, there is no evidence. There is just a repository getting better at avoiding rejection.

## Single Highest Leverage Action

Put one working Recovery Brief sample in front of one named boutique staffing or recruiting owner today and record the exact response.
