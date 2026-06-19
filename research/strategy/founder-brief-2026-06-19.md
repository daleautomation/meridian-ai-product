# Founder Brief - 2026-06-19

Dylan, the hard thing you are probably avoiding is selling the founder-reviewed Recovery Brief to a real buyer before building more operating system surface area.

## Evidence Audited

- Active branch: `cursor/founder-challenge-brief-279b`.
- Recent `HEAD`: `a19b063 feat: add career calendar sync`; the last visible commits are concentrated around career brief surfaces, AE job ingestion, CEO workflow/heartbeat, operational events, CRM import reliability, auth, and workspace routing.
- Uncommitted work: `package-lock.json` has 105 deletions removing optional `@next/swc-*` package entries. This appears unrelated to today's Founder Brief and was left untouched.
- Existing founder brief: no dedicated Founder Brief file exists in the current tracked tree. Prior `origin/cursor/founder-challenge-brief-*` branches exist, but this branch starts from `main` without a current dated founder brief.
- Ops reports: heartbeat/report machinery exists, but committed generated reports are absent. `scripts/heartbeat/manifest.ts` says Phase 1 covers 7 of 24 audit scripts, excludes revenue health, build health, Brookside health, and credentialed DB checks.
- Weekly state: no committed weekly state document found.
- CRM audits: no dated CRM audit report found; only code-level diagnostics and smoke checks.
- Review artifacts: `docs/workflows/pr-review-checklist.md` and `.github/pull_request_template.md` enforce trust, explainability, commercial prioritization, noise reduction, and no AI theater.
- Revenue artifact: the public CTA points to `/brief/staffing-pipeline-recovery/2026-W20`; tracked data exists with 4 input rows and 3 recovery candidates.

## What Makes Money Today

The only concrete revenue motion in the repo is founder-led Recovery Brief sales.

Evidence:

- `docs/product/product-principles.md` says build a weekly Recovery Brief, read-only CSV ingestion, founder-curated calibration, manual outreach support, and internal founder QA.
- `content/public/home.ts` routes "First Recovery Brief" demand to a `mailto:dylan@meridian.ai` intake instead of self-serve software.
- `app/admin/outreach/page.tsx` says to start with boutique staffing and recruiting firms, lead with a short memo ranking who to call, why now, and what to say first, and quote a fixed-scope paid pilot after a useful free sample.
- `lib/outreach/demoBriefs.ts` marks "Staffing Pipeline Recovery" as the recommended first vertical.
- `app/admin/prospects/page.tsx` contains a manual 30-firm prospecting surface, safe sample-brief workflow, and no scraping or sending automation.

The money today is not a broader relationship engine. It is one founder-controlled sales loop: pick a boutique recruiting firm, show a believable sample Recovery Brief, ask whether dormant client/candidate follow-up is painful, and sell one paid pilot.

## Revenue Challenge

There is no committed evidence of revenue, paying customers, customer interviews, conversion rates, pilot outcomes, or a current customer-feedback log.

That absence matters because `docs/product/product-principles.md` explicitly says self-serve onboarding waits until 6+ paying customers, CRM sync waits until 3 customers request the same integration, and multi-seat waits until paying customer demand. The repo contains substantial surfaces that look like later-stage operating infrastructure, but it does not contain the commercial evidence that would justify widening.

If Dylan believes the current work is revenue-driven, the burden of proof is a buyer conversation or paid pilot artifact. The repo does not provide it.

## What Can Break Revenue

- Overclaiming can break trust. `app/admin/outreach/page.tsx` explicitly says not to claim customer traction, revenue lift, enrichment, CRM syncing, or enterprise deployment unless true and approved.
- Integration gaps can break the sales promise. `docs/product/KNOWN_LIMITATIONS.md` says Apollo, People Data Labs, Angi, Bing Places, and BBB are not fully wired; Hunter person-level finder is not wired; `generate_opportunity_summary` still depends on Claude.
- Observer confidence is incomplete. `scripts/heartbeat/manifest.ts` excludes revenue health and build health from Phase 1.
- Product sprawl can dilute the buyer story. Recent git history includes career calendar sync, AE job ingestion, career brief execution actions, CEO heartbeat, operational events, and relationship engine infrastructure. Those may be useful systems, but they are not direct evidence of Recovery Brief revenue.
- Legacy gravity remains. `docs/README.md` says roofing/LaborTech material is historical context, while public positioning now centers Meridian. Mixed artifacts increase the risk of selling a confused product.

## Founder Contradictions

- Stated priority: commercial relationship prioritization. Observed activity: recent commits lean heavily toward internal operating surfaces, career workflows, heartbeat, operational events, and infrastructure.
- Stated rule: build when pulled, not pushed. Observed evidence: no committed customer pull signal for CRM sync, multi-seat, self-serve, or broader relationship-engine expansion.
- Stated GTM: boutique staffing/recruiting first. Observed repo: multiple vertical/demo tracks still coexist, including contractors, B2B services, roofing legacy, AE jobs, and personal career workspace.
- Stated principle: evidence before opinion. Observed gap: no weekly state, revenue health, customer feedback, paid pilot outcome, or CRM audit report is committed.

## Opportunity Cost

Every hour spent polishing architecture, heartbeat dashboards, career surfaces, relationship engine projections, or operational event contracts is an hour not spent proving whether boutique recruiting firms will pay for a Recovery Brief.

The opportunity cost is not theoretical. The repo already has enough to make a sales attempt: sample brief, admin outreach page, prospect list, scripts, pricing language, and a CTA. What is missing is evidence that Dylan used those assets with buyers.

## Decision Pressure

Dylan is currently blocking progress if he has not decided:

- whether boutique staffing/recruiting is the active first market or just one of several comfortable options;
- what fixed-scope paid pilot price will be quoted before sensitive data is shared;
- which one prospect will receive a founder-written outreach today;
- what evidence must be captured after the conversation so future product work is pulled by customer demand.

The decision is not architectural. The decision is whether to put the current Recovery Brief in front of a buyer and accept the answer.

## CEO Attention

Highest-leverage use of Dylan today: direct founder sales on the staffing Recovery Brief.

Do not spend CEO attention on another internal surface unless it removes a specific blocker from that sales motion. The repo already has the assets to start: sample brief, prospect list, first-call script, pricing language, and safe data-handling posture.

## Recommended Day Structure

1. Open the tracked Staffing Pipeline Recovery sample and verify the story is believable enough to show.
2. Pick one high-priority boutique recruiting prospect from the admin prospect list.
3. Write one direct founder email using the existing positioning: dormant relationships, ranked call list, why-now context, no automation.
4. Quote the paid pilot boundary before asking for sensitive data.
5. Record the result in a customer-feedback artifact. If the buyer refuses, capture the exact objection.

## Anti Rationalization

The rationalization risk is calling technical clarity "progress" because it feels safer than hearing a buyer say no.

The codebase can now produce a credible sample Recovery Brief. More relationship-engine architecture will not answer whether a recruiting owner will pay for it. More heartbeat coverage will not answer it. More career workflow work will not answer it. Only a buyer conversation will.

If the buyer says the brief is not worth paying for, that is useful evidence. If Dylan avoids asking, the product will keep accumulating elegant surfaces without commercial proof.

## Pushback

Do not use missing infrastructure as the excuse. The repo already contains:

- a public Recovery Brief CTA;
- three demo briefs;
- a recommended first vertical;
- a 30-firm prospecting surface;
- call, voicemail, CSV request, delivery, and pricing scripts;
- explicit constraints against overclaiming.

That is enough for a founder-led sales test. The missing artifact is not another plan. The missing artifact is a real conversation outcome.

## Single Highest Leverage Action

Send one founder-written paid-pilot outreach to a boutique staffing/recruiting owner today, using the tracked Staffing Pipeline Recovery sample, and record the exact response.
