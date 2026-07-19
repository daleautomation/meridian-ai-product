Dylan, the hard thing you are probably avoiding is putting the current Recovery Brief in front of a buyer before the surrounding system feels coherent.

## Evidence Base

- Active branch: `cursor/founder-challenge-brief-1e4b`.
- Current HEAD: `a19b063` / `feat: add career calendar sync`. The checked-out branch points at the same commit as `origin/main`.
- Uncommitted work before this brief: `package-lock.json` only, deleting 105 optional Next SWC package entries. This appears to be install/environment churn and is not revenue work.
- Recent git history is concentrated in AE job/career surfaces, heartbeat/CEO surfaces, CRM import/auth fixes, LaborTech/Nicole workspaces, and Recovery Brief/outreach work. The last visible commits on main are career calendar sync, AE job ingestion, career brief actions/home, career brief, AE job pipeline, and AE job operating surface.
- Existing Founder Brief artifact: PR #74, `Add founder challenge brief`, is open on `cursor/founder-challenge-brief-dbc1`; its file is not on this branch.
- Current ops report: `npm run heartbeat:run` on 2026-06-14 passed 7/7 observer checks and generated `generated/heartbeat/brief-today.md`.
- Heartbeat result: 0 approvals awaiting, 0 priorities, 1 blocked item, 0 revenue opportunities, checks 7/7 passing.
- Heartbeat blocked item: Labortech contact-level health is not measurable because the Phase 1 probe cannot read snapshots as a contact store.
- Heartbeat explicitly does not cover Brookside health, revenue health, build health, or credentialed DB checks.
- Stated canonical product: weekly Recovery Briefs, founder-curated calibration, read-only CSV ingestion, verified contact resolution, explainable why-now lines, manual outreach support, and internal founder QA tooling.
- Public front door: homepage links to `/brief/staffing-pipeline-recovery/2026-W20` and `mailto:dylan@meridian.ai` for the first brief request.
- Sellable assets exist: `fixtures/sample-brief-prospects.csv` contains 30 prospects; row 1 is ELKALYNE, high priority, founder/partner Lisa Gonzales. `data/recovery-briefs/staffing-pipeline-recovery/2026-W20.json` contains 4 opportunities from 4 input rows. `lib/outreach/scripts.ts` contains cold DM, cold email, call opener, CSV request, brief delivery, pricing close, and follow-up scripts.
- Review artifacts exist: `.github/pull_request_template.md`, `docs/workflows/pr-review-checklist.md`, `research/audits/MERIDIAN_PUBLIC_POSITIONING_INTERNAL_AUDIT.md`, `research/audits/LABORTECH_OPERATOR_UX_REFACTOR_AUDIT.md`, and PR #74.
- Missing evidence: no committed customer-feedback file, no payment record, no invoice, no closed paid pilot, no conversion metric, no sent-outreach log, and no heartbeat-derived revenue opportunity.

## Repository State

The repository is active. The repository is not proving revenue.

There are enough artifacts to sell the current wedge manually: a public Recovery Brief page, a staffing sample, a prospect list, outreach scripts, pricing language, and a founder email CTA.

There are also many artifacts that make Meridian look broader than the current wedge: roofing pages, relationship-engine routes and docs, CRM import persistence, client workspaces, heartbeat/CEO operations, and Dylan's AE job operating surface.

The current repo state supports this conclusion: the product can be tested with a buyer now, but the evidence that buyers are paying is missing.

## Existing Founder Brief

There is no Founder Brief file on this branch before this one.

The closest artifact is PR #74, which adds `research/strategy/founder-brief-2026-06-10.md` on another branch. It says the same commercial problem directly: the current system is ready enough to ask for a paid pilot, and the missing evidence is market evidence, not system evidence.

That PR is still open. The operating issue has not been closed by merging a brief or by producing new revenue evidence.

## Ops Reports

The heartbeat is useful for system observation. It is not a revenue dashboard.

Observed on 2026-06-14:

- 7/7 observer-safe checks passed.
- 0 approvals awaiting.
- 0 priorities surfaced.
- 1 blocked item: Labortech contact-level health cannot be derived from snapshots.
- 0 revenue opportunities derivable from current evidence.
- Revenue health is not covered.

The heartbeat is saying: the observer-safe checks passed, but the system has no measured revenue opportunity to show Dylan.

That is not a reason to build another observer. It is a reason to create revenue evidence outside the repo.

## Weekly State

The product promise is weekly: a weekly Recovery Brief for dormant relationships.

The operating artifacts are mostly daily/internal: heartbeat, daily workflow, approval queue, workspace health, generated ops reports, and AE job/career task state.

No weekly commercial state artifact was found that answers:

- Which prospects were contacted this week?
- Which prospects replied?
- Which sample briefs were sent?
- Which pilots were quoted?
- Which pilots were won or lost?
- Which objections repeated?

The repo can produce weekly product output. It does not show weekly selling output.

## CRM Audits

CRM import work exists and is substantial:

- `lib/crm-import/*` includes normalization, validation, dedupe, diagnostics, trust, reachability, execution, rollback, and storage.
- `scripts/check-crm-import.ts` exists.
- `components/crm-import/CrmImportWizard.tsx` exists.
- CRM contact persistence throws if writable storage is unavailable.

But CRM import work is not current revenue evidence unless a buyer is blocked on importing CRM data.

Current heartbeat evidence says revenue opportunities are not derivable and Labortech contact-level health is not measurable from the current source.

The challenge is not "can Meridian ingest more data?" The challenge is "will a buyer pay for the first controlled Recovery Brief from data they already control?"

## Existing Review Artifacts

Review discipline is stronger than commercial discipline.

Evidence:

- `docs/workflows/pr-review-checklist.md` requires every PR to answer whether it increases trust, remains explainable, improves commercial prioritization, reduces noise, and avoids AI theater.
- `docs/product/product-principles.md` says build a weekly Recovery Brief and manual outreach support; do not build CRM replacement workflows, workflow orchestration, enterprise dashboards, or invisible behavior.
- `research/audits/MERIDIAN_PUBLIC_POSITIONING_INTERNAL_AUDIT.md` says weak integrations, weak onboarding, unclear transitions, conversion leaks, overpromising risk, and roofing gravity remain risks.
- `research/audits/LABORTECH_OPERATOR_UX_REFACTOR_AUDIT.md` preserves guardrails: no Neon write mode changes, no scheduling date logic changes, no relationship-engine writes, no automation, no reminders, no queue execution.
- PR #74 created a prior Founder Brief with the same pressure: sell the constrained offer instead of substituting internal readiness for customer judgment.

The process can critique work. The missing artifact is evidence that critique changed Dylan's commercial behavior.

## What Makes Money Today

One thing plausibly makes money today: a founder-led Recovery Brief paid pilot.

Evidence:

- Product principles say to build a weekly Recovery Brief that surfaces dormant accounts worth revisiting.
- Homepage says "Weekly Recovery Briefs for dormant relationships" and "outreach stays manual."
- Public CTA routes to the Staffing Pipeline Recovery sample.
- Admin outreach positioning says start with boutique staffing and recruiting firms.
- Pricing language says: free first sample brief, then a fixed-scope paid pilot with one controlled CSV export, one Recovery Brief, and one review call.
- `fixtures/sample-brief-prospects.csv` contains a ready prospect list with high-priority recruiting/search firms.
- `lib/outreach/scripts.ts` contains the outreach and pricing language needed to start the conversation manually.

Missing evidence:

- No payment artifact.
- No paid-pilot artifact.
- No sent-outreach log.
- No customer-feedback artifact.
- No closed-won or closed-lost record.
- No revenue-health report.

The money path is not "more architecture." It is "use the current sample and ask a buyer for a paid pilot decision."

## Revenue Challenge

The commercial question is narrow:

Will a boutique recruiting owner trust Dylan enough to share a small CSV and pay for a fixed-scope Recovery Brief after seeing the fictional staffing sample?

The repo already contains the test materials:

- staffing sample brief,
- prospect list,
- cold email,
- cold LinkedIn DM,
- call opener,
- CSV request,
- delivery email,
- pricing close.

If Dylan is not sending those today, the blocker is not missing product surface. The blocker is exposing the offer to rejection.

## What Can Break Revenue

1. Sample trust can break before pricing is discussed.
   - Copywriting principles require sample briefs to carry a sample banner, fictional framing, and a footer disclaimer.
   - The public brief route renders `Recovery Brief - {week}` and the sample JSON includes phone contact paths. If Dylan sends that link without explicit sample framing, the buyer may read it as real customer work or scraped private knowledge.

2. The product story is split.
   - Public home says Recovery Brief for dormant relationships.
   - `/roofing-intelligence` says Roofing Lead Finder with lead execution workflows.
   - Handoff docs describe Meridian as an operator console for LaborTech's KC roofing sales team.
   - The codebase also contains a personal AE job operating surface for Dylan.
   - A buyer could reasonably ask whether Meridian is a weekly memo, a roofing lead tool, a CRM layer, a relationship engine, or Dylan's personal job workflow.

3. The ingestion promise and implementation are tense.
   - Ingestion principles say the CSV lands on the founder's machine, the brief is generated, the file is deleted, and no customer data is stored in a database during the founder-delivered phase.
   - CRM import code persists contacts and rollback state and requires writable storage.
   - If sales copy implies the founder-delivered CSV promise while the product path uses persistent CRM stores, trust depends on disclosure Dylan has not documented here.

4. Heartbeat can create false comfort.
   - Heartbeat passed 7/7 checks.
   - Heartbeat also says 0 revenue opportunities are derivable and revenue health is not covered.
   - Green checks do not mean the market cares.

5. Security/demo posture can create trust problems.
   - `config/tenants.ts` contains plaintext demo credentials and comments saying to replace them before non-demo deployment.
   - If a buyer receives a workspace-like flow before this is cleaned up and explained, the trust burden increases.

6. Package-lock churn can pollute review.
   - The only uncommitted change before this brief was unrelated `package-lock.json` churn.
   - Mixing environment noise into strategy or product commits weakens review discipline.

## Founder Contradictions

1. Stated priority: revenue-aligned relationship recovery.
   - Observed activity: career calendar sync, AE job ingestion, AE job actions, AE job pipeline, heartbeat, CRM import, client workspaces, relationship-engine architecture, and roofing surfaces.

2. Stated product: weekly Recovery Brief and manual outreach support.
   - Observed surface: public intake flows, workspace requests, CRM import wizard, relationship-engine APIs, operator surfaces, and roofing execution pages.

3. Stated constraint: self-serve onboarding after 6+ paying customers.
   - Observed code: `/intake/*` flows for roofing demo, visibility scan, strategy call, and workspace request.
   - Evidence of 6+ paying customers is missing.

4. Stated rule: customer feedback goes into `customer-feedback.md`.
   - Observed repo: no `customer-feedback.md` found.

5. Stated copy ban: "Operating system" and "Operator system" as product names.
   - Observed code and research: `AE Job Operating System` and `AI_OPERATING_SYSTEM.md`; intake success text says "operator system candidate."

6. Stated avoidance: CRM replacement and workflow orchestration.
   - Observed code: CRM import persistence, relationship-engine queues/feeds/workflows, calendar/workflow logic, and operator workspace surfaces.
   - Some of this may be read-only, but the surface area still increases the chance Dylan sells a platform before proving the memo.

## Stated Priorities vs Observed Activity

| Stated priority | Repository evidence | Challenge |
| --- | --- | --- |
| Weekly Recovery Brief | Product principles, homepage, sample brief, generator | Sell the brief before expanding the platform around it. |
| Manual founder delivery | Mailto CTA, outreach scripts, CSV request, pricing close | No evidence Dylan has used the manual motion with a real buyer this week. |
| Commercial prioritization | Canon, scoring principles, PR checklist | Heartbeat derives 0 revenue opportunities; commercial prioritization is stronger in docs than in sales evidence. |
| Avoid CRM replacement | Product principles and ingestion principles | CRM import, persistent contact stores, relationship-engine routes, and workspace surfaces create platform gravity. |
| Evidence before opinion | Heartbeat, audits, generated reports | Evidence exists for system checks; evidence is missing for buyer willingness to pay. |
| Shipping before planning | Many shipped surfaces and docs | Shipping internal surfaces may be replacing shipping an uncomfortable sales conversation. |

## Opportunity Cost

Attention spent on heartbeat expansion, CRM import reliability, relationship-engine architecture, roofing pages, AE job flows, and internal review artifacts is attention not spent on:

- contacting the high-priority staffing prospects already listed,
- learning whether the staffing sample creates enough trust to request CSV data,
- quoting the fixed-scope paid pilot,
- hearing the exact objection from a real buyer,
- documenting that objection in a customer-feedback artifact,
- deciding from evidence whether the Recovery Brief wedge is commercially urgent.

The opportunity cost is not abstract. The repo already has the prospect list, sample brief, and scripts. If those are not used, the system is competing with customer contact.

## Decision Pressure

The current blocker is not a technical approval.

Evidence:

- Heartbeat shows 0 Tier 2 approvals pending.
- Heartbeat shows 7/7 observer checks passing.
- The sample brief exists.
- The prospect list exists.
- The outreach scripts exist.
- The pricing close exists.

The decision blocking progress is whether Dylan will sell the constrained offer as it exists, with explicit limits, or keep making the system feel more defensible before exposing it to a buyer.

If the sample framing feels unsafe, that is not a reason to build a new product layer. It is a reason to send the sample with explicit fictional/internal framing or fix the sample page before sending it. That is a sales-readiness decision, not an architecture decision.

## CEO Attention

Highest leverage use of Dylan today: direct buyer contact around the staffing Recovery Brief.

Not heartbeat interpretation.

Not relationship-engine expansion.

Not CRM import polish.

Not roofing-page cleanup.

Not AE job workflow.

The only CEO-only work visible from this evidence is asking a real buyer whether the current Recovery Brief is worth a paid pilot.

## Recommended Day Structure

1. Open `/brief/staffing-pipeline-recovery/2026-W20` and verify it renders.
2. Add explicit sample framing in the outbound note: fictional sample, public/internal demo, no CRM accessed, no claim of customer traction.
3. Pick the first high-priority prospect from `fixtures/sample-brief-prospects.csv`: ELKALYNE / Lisa Gonzales.
4. Send one founder-to-founder note using the existing cold email or LinkedIn DM language.
5. Ask one commercial question: if this maps to dormant client or candidate follow-up, is a fixed-scope paid pilot worth discussing?
6. Record the outcome in a customer-feedback artifact.
7. Do not convert silence or discomfort into a technical roadmap item.

## Anti Rationalization

Green heartbeat is not traction.

Architecture docs are not buyer evidence.

CRM import reliability is not revenue unless a buyer is waiting on import.

AE job workflow is not customer delivery.

More review artifacts are not a substitute for a sales artifact.

The phrase "the system is not ready" is unsupported by the current evidence. The evidence says the system is ready enough to test whether the buyer cares, and not mature enough to justify more internal expansion without buyer pull.

## Pushback

Dylan, the repo shows a founder trying to make the system harder to criticize before making the offer easier to reject.

That is backwards.

If ELKALYNE says no, that is evidence.

If ELKALYNE ignores it, that is evidence.

If ELKALYNE says the sample is confusing, that is evidence.

If ELKALYNE asks for HubSpot sync before paying, that is evidence.

If no buyer sees the sample, there is no evidence. There is only more internal motion.

## Single Highest Leverage Action

Send one founder-to-founder note to Lisa Gonzales at ELKALYNE using the Staffing Pipeline Recovery sample, explicitly frame it as a fictional sample, and ask whether a fixed-scope paid pilot is worth discussing if it maps to her dormant client or candidate follow-up problem.
