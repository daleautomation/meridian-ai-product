# Meridian — Product Bifurcation Correction

> Strategic correction issued 2026-05-27. Supersedes the LaborTech-as-
> v1-wedge conclusion in `docs/commercial-readiness-verdict.md`.
> Treats Meridian as two distinct products sharing a substrate, not
> one converged architecture.

---

## The drift being corrected

Across Sprints 1–3, Meridian's architecture quietly absorbed the
operational requirements of two distinct products:

- **The CRM Intelligence Layer** (what Nicole's workspace stress-tested)
- **An Operational Lead Execution System** (what LaborTech's actual
  needs would require)

These are not stages of one product. They are different categories
with different customers, different sales cycles, different operational
demands, different price points, and different ways of failing.

Sprint 3 concluded LaborTech was the stronger v1 wedge based on
clean-data ceiling theory. That conclusion missed three operational
truths:

1. John resisted providing the existing CRM. That isn't a logistics
   hiccup; it is a category signal. Agencies and operational teams
   protect pipeline data, expect implementation cycles, and require
   workflow customization. Their pain is real but their procurement is
   slow.
2. Nicole's workspace — even at 96% WEAK tier — already validated the
   CRM Intelligence Layer's primary mechanics: relationship resurfacing,
   continuity intelligence, outcome compounding, Monday prioritization.
   The substrate works on terrible data; that is a strength.
3. The CRM Intelligence Layer can be sold founder-led in a single
   conversation, at $499/mo, with onboarding that takes 90 minutes.
   The Operational Lead Execution System cannot. Treating them as one
   product means letting the harder-to-sell product dictate the
   architecture and timeline of the easier-to-sell one.

This document defines the bifurcation and locks in v1 focus on the
CRM Intelligence Layer.

---

## Product 1 — CRM Intelligence Layer

> **Sellable promise**: *"Every Monday we tell you who in your existing
> CRM list deserves your attention this week and exactly why, and we
> remember what you do about it so next Monday is smarter."*

### Core mechanics

- Relationship resurfacing from CRM-imported context
- Continuity memory (12-week outcome accumulation)
- Weekly priority generation (Monday cadence)
- Deterministic source-cited openers
- CRM rehabilitation (founder-led data cleanup)
- Calm trust-first operator experience

### Who it's for

Solo or near-solo operators whose business is relationship-driven and
whose CRM has accumulated rot they don't have time to fix manually.

| Vertical | Typical CRM | Pain profile |
|---|---|---|
| Residential real estate (Nicole) | Wise Agent, Follow Up Boss, Boomtown | Years of contacts, automation residue dominates notes, surnames missing, gmail-dominant |
| Insurance brokers (P&C / life / health) | Salesforce, Vertafore, NowCerts, AMS360 | Renewal cadence + cross-sell, decay forgotten quickly |
| Independent financial advisors (RIAs, small books) | Redtail, Wealthbox, RightCapital | Birthday-anniversary outreach habits, weak compliance follow-up |
| Recruiters (independent or boutique) | Bullhorn, Crelate, Loxo | Candidate re-engagement, role-match recall, requisition staleness |
| Independent consultants (1–3 person) | HubSpot Starter, Pipedrive, Airtable | Project-based decay, low cadence discipline |
| Small real estate teams (≤ 5 agents) | same as residential | similar pattern, slightly higher per-workspace value |

### What makes it useful enough to return weekly

Three mechanics, in order of strength:

1. **The "Meridian remembered" moment.** Week 2's brief reflects Week 1's
   captured outcomes. A contact marked "no answer" Monday drops to the
   bottom of next Monday's slice. A contact marked "meeting booked"
   disappears. The compounding memory does what no CRM does: it links
   forward and backward in time so the operator doesn't repeat
   themselves.
2. **The "Meridian noticed before I did" moment.** Resurfacing surfaces
   contacts the operator has objectively forgotten — last touch 14
   months ago, with their own old note still on file. Works even when
   the data is weak; the contact's name + their old context is enough.
3. **The visible trust integrity.** The card cites the CRM evidence
   that justified its rank. No AI-generated reasoning. No predictive
   percentage. Operator can audit any claim in 10 seconds.

### Pricing model (already drafted in pricing-one-pager.md)

- **$499/mo solo operator + $500 one-time onboarding + 60-day commit**.
- Founder-led delivery for first 60 days.
- Manual invoice (ACH or check, net 7).
- Cap: 5 paid customers max at this delivery model before either
  systematizing onboarding or holding off new customers.

### Operational unit economics (per customer)

| Bucket | Founder hours/week |
|---|---|
| Sunday-night generation + push | 0.5 |
| Monday morning send + monitor | 0.5 |
| Mid-week return check | 0.25 |
| Friday summary check | 0.25 |
| Weekly customer-notes journaling | 0.5 |
| **Total weekly per customer** | **~2 hours** |

Founder-time ceiling: 5 paid customers × 2 hours = 10 hours/week of
delivery + ~10 hours/week of new-customer founder-led sales =
sustainable as a solo operation. Beyond customer 5, onboarding flow
becomes the next investment, not the next intelligence layer.

---

## Product 2 — Operational Lead Execution System

> **Sellable promise** (not yet validated): *"Assign incoming leads to
> the right operator at the right time, with closeability prioritization
> baked in."*

### Core mechanics (deferred, do not build yet)

- Lead routing / assignment
- Closeability prioritization
- Multi-operator coordination
- Workload distribution
- Execution-state tracking
- Revenue operations infrastructure
- Team / role permissioning

### Who it's for (theoretical)

Multi-operator agencies and contractor teams where leads enter from
multiple channels and must be matched to operators with capacity +
relevant expertise. Roofing, HVAC, plumbing, paving, commercial
brokerages, mid-size staffing agencies.

### Why this is a different product

- Onboarding is implementation, not import.
- Sales cycle is consensus, not single-conversation.
- Pricing model is enterprise-tier ($3,000–$15,000/mo), not solo-tier.
- Workflow replacement anxiety appears in Week 1.
- Multi-user permissions, audit trails, and role hierarchies are
  table-stakes.
- The product needs ROI dashboards (forbidden surface in v1 per
  Intelligence System Constitution §12).

### Why deferring is correct, not avoidance

Building Product 2 today would:

- Force premature multi-tenant complexity into the constitution.
- Distort the deterministic substrate with execution-orchestration
  primitives (queues, assignments, schedulers) that Product 1 doesn't
  need.
- Burn 6–12 months of founder calendar on the Product 2 procurement
  cycle while Product 1's repeatable wedge sits unfunded.
- Push the platform into a category (RevOps / lead-routing) where
  established competitors (Salesforce Lightning, HubSpot Sales Hub,
  LeanData, Distribution Engine) own the seat budget.

Defer Product 2 until Product 1 has 3+ paying customers and the
substrate has demonstrated stability under multi-customer load.

---

## Shared Substrate (already built; both products will reuse)

These modules are vertical-neutral and category-neutral by design.
Both Product 1 and Product 2 (when it ships) consume them. **Do not
duplicate**, do not abstract further until a second consumer exists.

| Module | What it does | Used by P1 | Used by P2 (future) |
|---|---|---|---|
| `lib/personal-workspace/openerBuilder.ts` | Deterministic source-cited opener generation | ✓ | ✓ (would need vertical extractors) |
| `lib/personal-workspace/weeklyState.ts` | Weekly snapshot + outcome-aware ranking | ✓ | ✓ |
| `lib/personal-workspace/weeklyStateLoader.ts` | Per-workspace per-week snapshot loader | ✓ | ✓ |
| `lib/crm-import/integrity.ts` | HIGH/MED/WEAK classifier | ✓ | ✓ |
| `lib/crm-import/enrichmentEligibility.ts` | Canonical eligibility rules | ✓ | ✓ |
| `lib/crm-import/internalContactFilter.ts` | Hide internal-diagnostic rows | ✓ | ✓ |
| `lib/recovery/outcomes/*` | Append-only outcome store | ✓ | ✓ |
| `lib/recovery/brief.ts:buildBriefOpener` | Voice-unified brief opener | ✓ | ✓ |
| `lib/crm-import/crmContactsNeonAdapter.ts` | Per-workspace contact persistence | ✓ | ✓ |
| `lib/integrations/hunter.ts` + eligibility | Optional external enrichment | ✓ | ✓ |
| `lib/enrichment/property/*` Phase 1 | Address normalization + match rules | ✓ | ✓ |
| Intelligence System Constitution | Trust + provenance rules | ✓ | ✓ |
| `scripts/check-*.ts` validators | Determinism + banned-phrase guardrails | ✓ | ✓ |

This substrate is *load-bearing for both products*. Treat it as
production infrastructure; do not refactor without a passing-customer
reason.

---

## Product 1-Specific (built and ready)

| Surface | Location | State |
|---|---|---|
| `/personal` workspace | `app/personal/page.tsx` + `components/personal/PersonalWorkspace.tsx` | Ready |
| Weekly briefing panel + outcome capture | `components/personal/WeeklyBriefingPanel.tsx` | Ready |
| Monday/midweek/Friday modes | same | Ready |
| Activation email artifact | `lib/personal-workspace/weeklyState.ts:buildActivationEmail` | Ready |
| Resurfacing buckets | `lib/relationship-intelligence/resurfacing.ts` | Ready |
| Founder runbook | `docs/founder-monday-runbook.md` | Ready |
| Pricing artifact | `docs/pricing-one-pager.md` | Ready |
| Onboarding checklist | `docs/onboarding-checklist.md` | Ready |
| Customer expectations doc | `docs/customer-expectations.md` | Ready |

What's still missing for Product 1 commercial readiness:
- **CRM rehabilitation tooling** (one focused script, ~100 LOC) —
  enables the 30-minute rehab session with operator that converts WEAK
  workspaces to MED/HIGH viability. This is the **single highest-leverage
  Product 1 build remaining**.
- **An invoice template** — Stripe payment link or PDF + ACH instructions.

---

## Product 2-Specific (do not build yet)

The following do not exist and should NOT be built before Product 1
has 3+ paying customers:

- Lead routing / assignment endpoints
- Closeability scoring (banned by Intelligence System Constitution §12.1 anyway, in its predictive form)
- Multi-operator coordination surfaces
- Operator workload dashboards
- Team / role permission scaffolding
- Multi-user audit-trail UI
- ROI / pipeline-velocity dashboards
- SLA / response-time tracking
- Workflow automation rules
- Implementation services / configuration UI

`config/workspaces.ts` retains `kind: "labortech"` for now. **Reverse
the Sprint 3 recommendation to flip LaborTech to `kind: "personal"`.**
The two products' surfaces should stay separated; LaborTech routing to
`/operator` correctly signals it is on the Product 2 track.

---

## Updated Product Positioning

**External, customer-facing positioning of Meridian (v1, today):**

> Meridian is the calm weekly intelligence layer that sits on top of
> the CRM you already use. Every Monday, we tell you who in your
> existing list deserves your attention this week — with the evidence
> from your own CRM. We remember what you do about it, so next Monday
> compounds.
>
> We are not a CRM. We are not an AI assistant. We are not a sales
> automation tool. We are weekly relationship intelligence for
> operators who can't afford to forget anyone in their book.

**Internal, engineering-facing positioning:**

> Meridian v1 is the CRM Intelligence Layer (Product 1). The
> Operational Lead Execution System (Product 2) is a deferred
> category that will reuse the shared substrate. Until Product 1 has
> 3+ paying customers, no Product 2-specific work is approved.

---

## Revised Execution Priorities (immediate)

**Primary focus (P0 — next 14 days):**

1. CRM rehabilitation workflow that operates inside a 30-minute call.
2. Repeatable founder-led onboarding for a third Product 1 customer
   in a vertical adjacent to Nicole's (insurance broker, financial
   advisor, recruiter, or independent consultant).
3. Monday-delivery retention for Nicole — turn her workspace into a
   real paid relationship.
4. Invoice template + first invoice sent.

**Secondary focus (P1 — next 14 days, only if P0 has progress):**

5. Sales conversations with 1–2 additional Product 1 prospects.
6. Operational notes on what onboarding patterns are repeatable.

**Deferred (P2 — explicitly NOT this 14-day window):**

- Property Layer Phase 2 (provider integration).
- Hunter enrichment for Nicole at scale (her data still doesn't
  support it).
- LaborTech routing changes or workflow tuning.
- New intelligence layers of any kind.
- Workflow automation, lead routing, assignment, closeability
  scoring.
- Self-serve signup, billing automation, marketing surfaces.
- A third constitution amendment.

---

## Revised Monday-Delivery Strategy

Two surfaces matter operationally now:

1. **Continued Nicole delivery** — even pre-rehab, send the brief.
   Demonstrates cadence + founder commitment.
2. **Post-rehab Nicole delivery** — after the 30-minute rehab session
   moves her contacts from 0% HIGH to 20–30% HIGH, the brief carries
   real density. This is the brief that anchors the pricing
   conversation.

For LaborTech specifically:
- Continue with the existing /operator surface unchanged.
- Do NOT generate weekly snapshots for LaborTech yet.
- Do NOT pursue a paid LaborTech relationship as a first priority.
- Continue casual founder relationship with John; treat the LaborTech
  CSV refusal as expected Product 2 behavior, not an obstacle.

---

## Revised Commercial Wedge Analysis

Single most important sentence: **Product 1's lower-friction sales
cycle outranks Product 2's higher revenue ceiling at the founder-led
stage.**

Why:

| Dimension | Product 1 (CRM Intelligence) | Product 2 (Operational Execution) |
|---|---|---|
| Decision-maker count | 1 (the operator) | 2–4 (operator + owner + ops manager + maybe IT) |
| Sales cycle | 1–2 conversations, 7–14 days | 3–8 conversations, 30–120 days |
| Onboarding | 90 minutes white-glove | weeks of implementation |
| Workflow disruption | Adds a Monday habit, replaces nothing | Replaces routing decisions, threatens existing tools |
| Pricing ceiling | $499–2,500/mo solo, $5K/mo small team | $3,000–15,000/mo team |
| Founder time per dollar earned (year 1) | Higher per-dollar but compounds across customers | Lower per-dollar but bottlenecks on one customer |
| Failure mode if wrong vertical | One churned operator | One implementation that took 6 months and stalled |

The founder-led economics favor Product 1 strongly for the first 4–6
quarters. Product 2's higher ceiling matters only after Product 1
demonstrates repeatable per-customer onboarding.

---

## What NOT to Build Yet (lock list)

Locked through 2027-Q1 unless a `[canon-amend]` PR and 3+ Product 1
paying customers exist:

1. Lead routing, assignment, or distribution surfaces.
2. Closeability scoring (any predictive ranking, banned by §12.1 anyway).
3. Operator workload dashboards or analytics.
4. Multi-user role / permission scaffolding (beyond the existing
   workspace isolation).
5. Workflow automation rules ("if X then route to Y").
6. SLA tracking, response-time enforcement, escalation queues.
7. Pipeline-velocity, conversion-rate, or ROI dashboards.
8. Implementation services or per-customer custom configuration UI.
9. Self-serve signup, automated billing, customer portal.
10. Mobile / push / real-time alerts.
11. A third vertical declaration in `config/workspaces.ts`.
12. LLM-generated copy of any kind (constitutionally banned).
13. New intelligence categories (wealth intelligence, behavioral
    signals, move-timing prediction).
14. New external enrichment providers beyond Hunter + Regrid (and
    Regrid Phase 2 itself is paused until CRM rehab unlocks ≥ 30%
    eligible contacts).

---

## Six Strategic Questions, Answered

### Q1. What specifically makes the CRM intelligence workspace useful enough to return to weekly?

Three mechanics in compounding order:

1. **Monday: the calm, source-cited brief tells the operator what to do today.** Saves 20–40 minutes of "who should I reach out to?" decision-making.
2. **Tuesday–Friday: outcome capture is one click; workspace evolves visibly.** No data-entry-into-a-void feeling. The "Captured this week" sub-section is small but psychologically load-bearing.
3. **Next Monday: continuity insight cites their captured outcomes by contact name.** This is the "Meridian remembered" moment that creates the unwillingness to go back to a CRM-only workflow.

### Q2. What onboarding path makes CRM rehabilitation feel fast and painless?

90-minute white-glove session, structured as:

- **0–10 min**: kickoff call. Confirm offer + commitment.
- **10–40 min**: founder imports CSV via existing operator-import UI. Runs `crm:audit`. Shares the audit screen with the operator.
- **40–70 min**: walking through the WEAK rows together. Founder reads name + last context to the operator; operator names the surname + corrects address. Founder types into a CRM rehab script (single command per row). HIGH-tier count climbs in real time.
- **70–90 min**: founder generates first weekly state in front of operator. They see the brief their workspace would produce. Sets the expectation for Monday delivery.

The friction-reducer is that the operator brings their knowledge of who their contacts actually are; the founder does the technical work. The operator's cost is 90 minutes; the founder's cost is the same 90 minutes plus ~30 minutes of post-session generation.

### Q3. What operational surfaces create the strongest continuity dependence?

In order of stickiness contribution (measured by hypothesized dependency on each):

1. **The Monday brief landing in inbox by 7 AM.** Habit-forming. If it doesn't show up, the customer notices.
2. **The "Captured this week" sub-section.** Visible proof the operator's outcome-capture actions are accumulating.
3. **The Friday summary panel.** Quiet closure for the week; creates the "we did this much" mental model.
4. **The Tuesday-of-Week-2 brief that cites Week-1 outcomes by name.** The killer moment. After this lands, the customer cannot easily explain to themselves why they would cancel.
5. **Resurfacing of a forgotten contact whose old notes still apply.** Lower-frequency but high emotional intensity when it hits.

### Q4. How do we make "forgotten relationship recovery" visibly valuable within the first week?

Three moves:

1. **In the rehab session itself**: when the founder asks the operator about a WEAK contact, they often respond "oh, X — I haven't thought about them in 18 months." That moment, before any brief lands, is the first proof point.
2. **In the first Monday brief**: ensure the Resurfaced Relationship callout cites a contact the operator hasn't explicitly thought about recently. The deterministic resurfacing engine already prioritizes long-quiet, high-context contacts.
3. **Within the brief's continuity insight**, even in cold-start week: surface the count of contacts not touched in > 12 months. "Of your 130 active contacts, 87 haven't been contacted in over a year." That number alone justifies the first month's fee.

### Q5. Which CRM verticals besides real estate exhibit the same pain pattern?

The pain pattern is: **solo or near-solo operator + relationship-driven revenue + accumulated CRM rot + no time to maintain manually + a clear weekly cadence makes sense**.

Tier 1 — highest match, lowest onboarding friction:

- Insurance brokers (P&C, life, health). Renewal cadence + cross-sell + birthday/anniversary outreach.
- Independent financial advisors / RIAs (≤ 200 clients).
- Recruiters (independent or boutique, ≤ 100 candidates in active circulation).
- Residential real estate agents (Nicole's category).

Tier 2 — likely match, slightly higher friction:

- Independent consultants with project-based pipelines.
- Mortgage brokers.
- Small wealth management offices.
- Travel advisors (specialty / luxury).

Tier 3 — possible but defer:

- B2B salespeople in mid-market roles (more CRM tooling exists already; harder to displace).
- Coaches / fractional executives (markets too varied).

**Recommendation**: target one customer in Tier 1 outside residential real estate in the next 30 days. An insurance broker or RIA is the highest-signal second customer. If the same Product 1 mechanics work for them with their CRM rot, the category is real.

### Q6. What is the minimum viable founder-led workflow that consistently produces trust?

Already documented in `docs/founder-monday-runbook.md`. Compressed:

- Sunday: 35-minute generation + audit + push + deploy.
- Monday: 5-minute send + light monitoring.
- Mid-week: 5-minute check.
- Friday: 5-minute summary check.
- Saturday: 15-minute retro.

Total: ~2 hours per customer per week. Plus the one-time 90-minute onboarding. Plus monthly 30-minute customer review.

The minimum viable workflow is intentionally manual to preserve trust — the founder reads the brief before it sends. The brief never auto-delivers without a human read.

---

## Recommended Next 14-Day Execution Plan

### Days 1–2 — Strategic correction landed

- [x] This document committed to repo.
- [ ] Add superseded-by notes to `docs/commercial-readiness-verdict.md`
      and `docs/labortech-readiness.md` pointing here.
- [ ] **Do NOT** flip LaborTech to `kind: "personal"`. Reverse the
      Sprint 3 recommendation.

### Days 3–4 — CRM rehab tooling

- [ ] Build `scripts/repair-contacts.ts` — a founder-runnable command
      that takes a YAML or JSON file of `(contactId, field, value)`
      updates and applies them via the existing Neon writers.
      Touches only the named field. Logs every change. Never
      mass-imports.
- [ ] Build a paired `scripts/list-weak-contacts.ts` — prints WEAK-tier
      contacts with their existing data so the founder + operator can
      walk through them in a rehab call.
- [ ] Add `npm run repair:contacts` and `npm run list:weak`.

### Day 5 — Schedule + run Nicole's rehab session

- [ ] Send Nicole a calm note proposing a 90-minute call to "clean up
      what your CRM is missing so the weekly brief gets sharper."
- [ ] During the call: run `list:weak`, walk through together,
      capture surnames + addresses, apply via `repair:contacts`.
- [ ] Re-run `crm:audit` at end of call; share the before/after with
      Nicole live.

### Day 6 — Generate post-rehab brief

- [ ] Sunday evening: generate Nicole's first post-rehab weekly state.
      Eyeball the JSON; expect HIGH-tier count to be 20–30%, opener
      density meaningfully higher.

### Day 7 — Monday brief delivery

- [ ] 7 AM: send Nicole the post-rehab brief.
- [ ] Monitor outcome capture during the day. If high engagement,
      Tuesday's pricing conversation is real.

### Days 8–9 — Pricing conversation + invoice

- [ ] Tuesday: pricing conversation with Nicole using the brief that
      just landed.
- [ ] If yes: send first invoice ($499/mo + $500 onboarding, net 7
      ACH). Build a one-page invoice PDF if not yet done.
- [ ] If no: ask specifically what would have made it a yes. Do not
      chase a third Monday.

### Days 10–11 — Begin second-customer outreach

- [ ] Identify 3–5 candidates in Tier 1 (insurance broker, RIA,
      recruiter) from existing founder network. No cold outreach.
- [ ] Send personal note to top candidate. Reference the Product 1
      framing from this document. Offer 90-minute trial onboarding
      session.

### Days 12–14 — Cadence + Week-2 brief

- [ ] Continue Nicole's Monday cadence regardless of pricing outcome.
- [ ] Generate Week-2 brief. Eyeball the continuity insight — should
      cite real captured outcomes from Week 1 by name.
- [ ] Saturday retro: written reflection on whether Product 1 wedge
      is converting or not.

---

## What This Doc Will NOT Do

- Tell you how to redesign LaborTech later. That's a Product 2
  problem; revisit it when Product 1 has 3+ paying customers.
- Speculate about pricing tiers for Product 2.
- Promise architectural symmetry between the two products. Their
  surfaces should stay distinct; only the substrate is shared.
- Position Nicole as a forever customer. If after 8 weeks she isn't
  engaging, the honest move is to release her. That's not failure;
  that's vertical-fit information.

---

## Final note

The architecture is currently aligned with Product 1 by accident of
how we built it. That accident is a gift. Don't undo it by adding
Product 2 features prematurely. The shared substrate stays shared;
the products stay separate; the customers stay focused. That's how
the next two paid Mondays happen.
