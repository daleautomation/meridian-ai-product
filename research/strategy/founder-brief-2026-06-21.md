# Founder Brief - 2026-06-21

Dylan, the hard thing you are probably avoiding is using the Recovery Brief sales assets with a real buyer and accepting the answer.

## Evidence Audited

- Repository state: active branch `cursor/founder-challenge-brief-87a1`; HEAD `a19b063 feat: add career calendar sync`; HEAD is aligned with `origin/main` and local `main`.
- Uncommitted work before this brief: `package-lock.json` only, deleting 105 optional `@next/swc-*` package entries. That looks like install/platform churn, not revenue work.
- Generated during this audit: `npm run heartbeat:run` on 2026-06-21 passed 7/7 observer checks and wrote ignored files under `generated/heartbeat/`.
- Existing founder brief on active branch: none. `research/strategy/` contained only `.gitkeep`.
- Prior founder brief evidence: remote founder-brief branches exist for June 10, 14, 15, 17, 18, and 19. Recent open PRs include #74, #75, #76, and #77 for prior founder brief branches. The same pressure has been raised repeatedly: sell the Recovery Brief before widening the system.
- Ops reports: today's heartbeat says 0 approvals awaiting, 0 priorities today, 1 blocked item, 0 revenue opportunities, and 7/7 observer checks passing.
- Heartbeat coverage gap: `generated/heartbeat/latest.md` says Phase 1 covers 7 of 24 audit scripts; Brookside health, revenue health, build health, and credentialed DB checks are not covered.
- Weekly state: no committed weekly commercial state artifact was found. The product promise is weekly, but the repo does not show a weekly sales ledger of contacted prospects, replies, samples sent, pilots quoted, pilots won, or pilots lost.
- CRM audits/state: `data/crmActivities.json` contains 35 internal activities across 5 companies: 17 `contact_search_started`, 5 `contact_search_expanded`, 7 `scan_viewed`, 4 `domain_opened`, and 2 `site_opened`. It does not show sent outreach, replies, meetings, pilots, or revenue.
- CRM import state: `data/crmImportJobs.json` has 1 job in `previewing`, 1 row, and 0 imported rows. That is not customer delivery evidence.
- Review artifacts: `.github/pull_request_template.md` and `docs/workflows/pr-review-checklist.md` require operator trust, explainability, commercial prioritization, noise reduction, and no AI theater.
- Revenue artifacts: three tracked sample Recovery Brief JSON files exist under `data/recovery-briefs/*/2026-W20.json`: Staffing Pipeline Recovery, Contractor Growth Recovery, and B2B Services Recovery. Together they contain 12 opportunities from 12 fixture rows.
- Public sales path: `content/public/home.ts` points "See a sample brief" to `/brief/staffing-pipeline-recovery/2026-W20` and "Request the first brief" to a `mailto:dylan@meridian.ai` founder-led intake.
- Admin sales assets: `app/admin/outreach/page.tsx`, `app/admin/prospects/page.tsx`, `lib/outreach/scripts.ts`, `lib/outreach/demoBriefs.ts`, and `fixtures/sample-brief-prospects.csv` define a manual outreach system, three demo briefs, scripts, and 30 boutique recruiting/search prospects.
- Missing commercial evidence: no committed payment, invoice, paid pilot, customer-feedback file, sent-outreach log, reply log, meeting outcome, or closed-won/closed-lost artifact was found. `data/reviews.json` is empty.

## What Makes Money Today

The only repository-backed money path today is founder-led Recovery Brief sales.

Evidence:

- `docs/product/product-principles.md` says the product to build is a weekly Recovery Brief, founder-curated calibration, read-only CSV ingestion, verified contact resolution, explainable why-now lines, manual outreach support, and founder QA.
- `docs/product/ingestion-principles.md` says CSV upload and direct file share are the primary paths; CRM sync is future only after repeated customer request.
- `components/public/sections/HeroSection.tsx`, `RecoveryBriefSection.tsx`, and `FinalCta.tsx` all frame the public offer around weekly, manual, founder-reviewed Recovery Briefs for dormant relationships.
- `app/admin/outreach/page.tsx` says the recommended first vertical is boutique staffing and recruiting firms.
- `fixtures/sample-brief-prospects.csv` lists 30 manual prospects and marks several as `High` outreach priority.
- `lib/outreach/scripts.ts` contains a cold email, LinkedIn DM, call opener, voicemail, CSV request, brief delivery email, pricing close, and follow-up scripts.

What makes money today is not another internal surface. It is Dylan putting the staffing sample in front of one boutique recruiting owner, asking whether dormant client/candidate follow-up is painful, and quoting a fixed-scope paid pilot if the answer is yes.

## Revenue Challenge

The repo has sales preparation, not sales evidence.

The Recovery Brief path is materially ready enough to test:

- three sample briefs load from tracked JSON;
- the strongest public CTA points to the staffing sample;
- admin pages provide positioning, scripts, prospect priorities, objection handling, and pricing language;
- the product docs constrain the promise to manual, founder-reviewed, read-only, CSV-first delivery.

The missing evidence is buyer response. There is no artifact showing that a prospect received the sample, replied, shared a CSV, objected, booked a review call, accepted a paid pilot, or paid.

If the claim is "we need more system work before selling," the repository does not support it. The repository supports "we need one real sales attempt before more system work can be justified."

## What Can Break Revenue

- **False confidence from green ops.** Heartbeat passed 7/7, but also says 0 revenue opportunities and no revenue-health coverage. Green observer checks do not prove commercial progress.
- **Unmeasured workspace health.** Heartbeat says Labortech contact-level health is blocked because snapshots are operator-UI projections, not a contact store. If Dylan is relying on workspace health as a sales or delivery claim, evidence is insufficient.
- **Overclaiming the sample.** `lib/outreach/checklist.ts` says sample briefs are fictional/internal, visible contact paths need review, and no automation, guaranteed revenue, customer proof, or enterprise readiness should be claimed.
- **Integration promises.** `docs/product/KNOWN_LIMITATIONS.md` says Apollo, People Data Labs, Angi, Bing Places, BBB proxies, Hunter person-level finder, and PageSpeed are not fully wired. Selling integrations now would create delivery risk.
- **CRM write drift.** `docs/product/ingestion-principles.md` bans CRM write access and workflow control. Any founder promise that implies syncing, updating, or orchestrating customer systems would violate the current trust posture.
- **Outcome gap.** `data/reviews.json` is empty, CRM import has 0 imported rows, and CRM activities are internal actions. The repo cannot currently prove the brief changes customer behavior.

## Founder Contradictions

- Stated priority: weekly Recovery Briefs for dormant relationships. Observed recent HEAD: career calendar sync, AE job operating surfaces, career brief actions, CEO heartbeat, operational events, CRM import reliability, and relationship-engine work.
- Stated rule: build when pulled, not pushed. Observed evidence: no committed customer pull signal for live CRM sync, multi-seat workspace, self-serve onboarding, broader relationship engine expansion, or career/AE-job surface area.
- Stated principle: evidence before opinion. Observed gap: no customer-feedback artifact, no paid pilot evidence, no sent-outreach log, no weekly sales state, and no revenue-health report.
- Stated sales posture: founder-led, manual, read-only, modest claims. Observed repo: enough founder-led sales assets exist, but activity keeps accumulating around internal systems.
- Stated review standard: commercial prioritization. Observed PR history: Recovery Brief work was merged around May 15-16, then attention moved into trust hardening, operator workflows, relationship intelligence, heartbeat, CRM/import, and later career/AE-job branches. Some of that may protect delivery. It does not prove demand.

## Opportunity Cost

The opportunity cost is buyer evidence.

Every additional pass on heartbeat, relationship-engine projections, career calendar sync, CRM import internals, admin observability, or operator surface polish delays learning whether a boutique recruiting owner will pay for the Recovery Brief.

That cost is visible because the sales assets are already present:

- public CTA;
- sample brief route;
- staffing sample;
- 30-prospect manual list;
- outreach scripts;
- pricing close;
- CSV request script;
- readiness checklist.

What is not getting done because attention is elsewhere: one buyer-facing outreach, one response captured verbatim, one decision on whether the paid pilot offer is commercially credible.

## Decision Pressure

Dylan is blocking progress if these decisions remain implicit:

- Is boutique staffing/recruiting the active first market, or is it just one more example in a growing demo library?
- What exact paid pilot scope and price will be quoted after the free sample?
- Which one prospect gets the first founder-written note?
- Where will the response be recorded so future product work is pulled by evidence?
- What work stops until one sales response exists?

These are CEO decisions. They cannot be delegated to architecture.

## CEO Attention

Highest leverage use of Dylan today: direct founder sales against the staffing Recovery Brief.

Do not spend CEO attention reviewing another internal surface unless it removes a specific blocker from sending one founder-written paid-pilot outreach. The repo does not show that blocker. It shows discomfort with the sales step.

## Recommended Day Structure

1. Open `/brief/staffing-pipeline-recovery/2026-W20` and verify the sample is safe to send.
2. Pick one `High` prospect from `fixtures/sample-brief-prospects.csv`.
3. Send a founder-written version of the `cold-email` or `cold-linkedin-dm` script.
4. If they engage, use the `pricing-close` language before any sensitive data is shared.
5. Record the exact response in a customer-feedback artifact.

## Anti Rationalization

"The system needs more maturity" is not supported by the evidence unless Dylan can name the buyer who is blocked by that maturity gap.

The current repo can already show a fictional Recovery Brief, explain the promise, request a small CSV, deliver a manual brief, and quote a fixed-scope pilot. More internal systems may improve future delivery, but they will not answer the current commercial question.

Technical work is replacing customer work when the next commit makes the product easier to observe but not easier to sell.

## Pushback

Do not use missing architecture as cover for missing sales evidence.

The hard evidence says:

- Recovery Brief assets exist.
- The first vertical is named.
- The prospect list exists.
- The scripts exist.
- The sample route exists.
- The pricing language exists.
- The repo contains no buyer response.

If Dylan believes another system pass is necessary before outreach, the standard is evidence: name the exact buyer-facing blocker and the exact sales step it prevents. Otherwise it is rationalization.

## Single Highest Leverage Action

Send one founder-written paid-pilot outreach to one high-priority boutique staffing/recruiting prospect using the Staffing Pipeline Recovery sample, then record the exact response.
