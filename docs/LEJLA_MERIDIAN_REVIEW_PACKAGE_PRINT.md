<!--
  Print-optimized version of the Meridian Technical Review Package for Lejla Ramic.
  Page breaks use `page-break-after: always`, honored by HTML/CSS-based Markdown→PDF
  engines (md-to-pdf / wkhtmltopdf / weasyprint / browser print). See export command
  at the end of the chat or the project notes.
  Content is identical to LEJLA_MERIDIAN_REVIEW_PACKAGE.md — only formatting/pagination added.
  Sanitized: no customer PII, credentials, secrets, .env values, repo tokens, API keys,
  or financial/equity details.
-->

<div align="center">

<br/><br/><br/><br/>

# MERIDIAN
## Technical Review Package

<br/>

### Prepared for
**Lejla Ramic**

<br/>

### Purpose
Rapid, honest technical orientation for an experienced engineer

<br/><br/>

*Confidential — Review Copy*
*Contains no customer data, secrets, credentials, or financial details*
*Reality and Vision are labeled separately throughout*

<br/><br/><br/>

**Capability labels used in this document**
`BUILT` = working today  ·  `PARTIAL` = exists, incomplete or idle
`PLANNED` = specified, not built  ·  `VISION` = idea, not started

</div>

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# Table of Contents

1. Executive Summary
2. Current State (what is built vs. not)
3. Philosophy
4. Products
5. Architecture
6. Technical Risks
7. Business Risks
8. Questions for Lejla
9. Requested Review Checklist

> **How to read this.** Every capability is labeled **BUILT / PARTIAL / PLANNED / VISION**.
> Reality and vision are kept strictly separate. This is a review document and a
> sanitized, read-only repository accompanies it. No customer data, secrets, credentials,
> infrastructure hosts, API keys, or financial/equity details are included.

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 1. Executive Summary

**What Meridian is.** A trust-first relationship-intelligence layer. It ingests a business's
messy CRM and answers one question each week: *"Which relationships deserve attention right
now, based on observable commercial signals?"* — and explains why, in plain language, citing
the evidence.

**Why it exists.** Relationship professionals neglect their own databases; opportunity decays
silently. Generic CRMs store data but do not judge it. Meridian judges it — and deliberately
refuses to fabricate a judgment it cannot trace to a signal.

**Current stage.** Pre-revenue. Approximately six months old. Built primarily by the founder
directing an AI development workforce.

**Current customers.** **One** live pilot — a residential realtor (referred to here as "the
pilot customer"), with real data in the system of record (one workspace, ~115 contacts).
**Zero paying customers.** A second concept (B2B / operational lead execution) is a deferred
"Product 2"; it has no live data and is demo-grade.

**Current reality in one sentence.** A technically disciplined, well-governed **v1 product
that works** (clean the book → rank who to contact → explain why → suggest what to say),
attached to a strong, codified philosophy — with **no revenue, one pilot, and no market data
feeding the premium features.**

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 2. Current State (what is built vs. not)

| Capability | Status |
|---|---|
| CRM import / cleaning / de-duplication / identity / provenance | **BUILT** |
| Relationship classification + ranked priority list | **BUILT** |
| Suggested openers (deterministic) | **BUILT** |
| Realtor workspace + weekly brief surface | **BUILT** |
| Operations Center (self-validation, ~40 check scripts) | **BUILT (V1)** |
| Auth / session + workspace access control | **BUILT** |
| Opportunity Intelligence engine (market-evidence gated) | **PARTIAL — built, zero live output** |
| Enrichment (provider wired) | **PARTIAL — 0 contacts enriched** |
| Public records / ownership | **PARTIAL — schema only, 0 records** |
| CI merge gate + automated review config | **PARTIAL — written, not enforced** |
| Production-truth monitoring · branch protection · MLS · multi-customer onboarding · billing | **PLANNED** |
| "Decision intelligence" / "memory" / "workflow orchestration" as products · second vertical · in-product AI | **VISION** |

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 3. Philosophy (the codified discipline — read first)

Meridian's doctrine is written and enforced, not improvised. Canonical sources in the repo:
`docs/meridian-philosophy.md`, `docs/scoring-principles.md`,
`docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md`, `autonomy/SIGNAL_TRUST_RULES.md`,
`autonomy/NO_DRIFT_RULES.md`, `autonomy/PRODUCT_CONSTITUTION.md`.

- **Evidence honesty.** Every score, rank, and "why now" must trace to an **observable
  signal** in the customer's own data or public records. No score exists without a documented
  derivation path. *(BUILT — enforced in code and tests.)*
- **Trust over AI theater.** Meridian must feel like "a calm intelligence layer," **not** "an
  AI running the business." It does not talk at the user, predict closings, or show vanity
  metrics. *(BUILT.)*
- **Deterministic intelligence.** Banned: black-box ML, hidden weights, emotional inference,
  predictive certainty. Every coefficient lives in source as a plain number with a comment.
  *(BUILT — and unusual.)*
- **Operator-first design.** Orients around what a human should do next, with outcomes
  captured so next week reflects what they did. *(PARTIAL — loop exists; capture is light.)*
- **Relationship intelligence.** Classify each contact by an observable relationship state;
  rank by commercial relevance. *(BUILT.)*
- **Prioritization philosophy.** Surface a small, actionable set (≤8), reachability-gated —
  never a firehose. *(BUILT.)*
- **No-drift governance.** A written constitution + acceptance criteria + review checklist
  govern how the AI development workforce may change the system. *(BUILT.)*

**Why this matters to an engineer:** the discipline is the product's defensibility. Preserve
it; do not "AI-ify" the scoring path.

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 4. Products

### Product 1 — CRM Intelligence Layer (realtor) — the real product
- **Purpose:** turn a neglected contact book into a weekly "who to contact & why" brief.
- **Capabilities (BUILT):** CSV import + cleaning/de-dup; relationship classification (5
  labels) + ranked list; reachability gating; deterministic suggested openers; on-demand
  workspace audit; a weekly brief surface.
- **Limitations:** single live customer; premium "act now" signals idle (no market data);
  outcome-capture loop is light; onboarding is manual / founder-led.
- **Future vision (PLANNED/VISION):** ownership-backed "act now" alerts; multi-customer
  onboarding; tiered packaging.

### Product 2 — Operational Lead Execution (B2B) — deferred
- **Status:** **PARTIAL/VISION.** Demo/showcase configuration; **no live data**; routing and
  copy still carry residential biases. Deferred per the founder's own strategy documents.

### Operations Center — internal product (BUILT, V1)
- **Purpose:** Meridian watching itself — consolidates ~11 validation checks + a live
  workspace audit into one BLOCKING / REVIEW / HEALTHY status so problems surface
  automatically.
- **Limitation:** measures mostly code-truth; a live production-truth signal is PLANNED.

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 5. Architecture

```
CUSTOMER (realtor, browser)
        │
 FRONTEND  ── Next.js (App Router): realtor view + operator priority view                [BUILT]
        │
 BACKEND   ── API routes + a pure, deterministic intelligence library                     [BUILT]
        │      import · classify · rank · openers · audit · ops
        │
 DATABASE  ── Managed Postgres (system of record)                                          [BUILT]
        │      contacts: 1 live workspace (~115)  |  market-data tables: EMPTY  [PARTIAL/PLANNED]
        │
 INTEGRATIONS ─ one enrichment provider wired (unused); others absent; hosting; source ctl [PARTIAL]
        │
 AI DEVELOPMENT WORKFLOW  (build-time agents, NOT product runtime)                         [BUILT]
        │      build agents · automated review · CI gate (currently OFF) · governed by autonomy/
        │
 DEPLOYMENT ── managed hosting; production currently serves a non-default branch;          [RISK]
               merge gate not yet enforced; "what is live" is ambiguous
```

- **Frontend:** server-rendered Next.js surfaces. **BUILT.**
- **Backend:** the value is a deterministic, pure-function intelligence library (highly
  testable). **BUILT.**
- **Database:** managed Postgres is the system of record; metadata stored as JSON; market-data
  tables exist but are empty. **BUILT (contacts) / PLANNED (market).**
- **AI development workflow:** the codebase is largely agent-built under a written governance
  model. Owning and verifying this is the key skill for the technical leader. **BUILT.**
- **Deployment:** see Technical Risks.

*(Note: the "AI" in Meridian is in how it is built, not in the product runtime — by design.)*

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 6. Technical Risks

- **Bus factor = 1.** One person holds all context and the only ability to direct the agent
  workforce. The single largest technical risk.
- **Deployment truth.** Production serves a non-default branch; the merge gate is built but
  not enforced; "what commit is live" is ambiguous; pre-existing type/lint debt sits in the
  tree. Regressions can ship silently.
- **Over-built surface area** relative to one customer — more to maintain and break, for no
  current return.
- **Data dependency.** The differentiated features require external data the company does not
  yet have and has not proven it can acquire affordably.

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 7. Business Risks

- **No commercial motion.** Pre-revenue after ~6 months; no sales motion; building has
  substituted for selling.
- **Demand unproven.** One indicated interest is not a market.
- **Pricing unresolved.** A documented founder-led subscription + one-time onboarding model
  exists alongside an active lower-entry experiment; the two have not been reconciled.
  *(Specific figures withheld from this package.)*
- **Moat durability.** The visible feature is copyable; the durable moat (proprietary/partnered
  data + trust brand + low-cost structure) is unbuilt.
- **Founder concentration.** Attention is split across product, sales, operations, engineering,
  and hiring.

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 8. Questions for Lejla

As you review, please answer in writing:

1. **Where would you focus first** if you joined Meridian today?
2. **What would you audit first** — and why?
3. **What would you ignore** at this stage?
4. **What would you harden**?
5. **What would you simplify**?
6. **What would you delete or park**?
7. **What would you build next** — and how does it connect to customers/revenue?
8. **How would you work inside an agent-built codebase** — how do you keep AI-written code
   correct and prevent drift, and would you want to work that way?
9. **How would you make "what is live" unambiguous** and the merge gate trustworthy?
10. **What would you do about problems that are only half-engineering** (e.g., acquiring
    trustworthy external data)?

<div style="page-break-after: always;"></div>
<!-- ===================== PAGE BREAK ===================== -->

# 9. Requested Review Checklist

A read-only review (no production access, no real customer data, no secrets). Please produce:

- [ ] A **written architecture & risk review**: what is strong, fragile, dangerous,
      over-engineered, and under-engineered.
- [ ] A **prioritized 30/90-day plan** tied to customers/revenue (not a re-architecture).
- [ ] A **"deployment truth" assessment**: how Meridian should always know what is live, and
      how to enforce the merge gate.
- [ ] A **bus-factor / onboarding assessment**: what documentation or runbooks would let a
      second engineer operate the system.
- [ ] A short **walkthrough of your reasoning and tradeoffs** (live or written).
- [ ] A one-page **"if I owned this, my first 90 days"** plan.

**Boundaries for this review:** sanitized, read-only repository only. No production, no
database access, no deployment, no real customer data, no secrets.

<div align="center">

<br/><br/>

*End of package.*

</div>
