# Meridian — Technical Review Package
### Prepared for: Lejla Ramic · Purpose: rapid, honest technical & business orientation

> **How to read this.** Every capability is labeled **BUILT** (working today), **PARTIAL**
> (exists, incomplete or idle), **PLANNED** (specified, not built), or **VISION** (idea,
> not started). Reality and vision are kept strictly separate — do not blend them.
> This is a review document: it contains **no customer data, secrets, or production
> credentials.** Source documents are cited by path; a sanitized, read-only repo
> accompanies this package.

---

## SECTION 1 — Executive Summary

**What Meridian is.** A trust-first relationship-intelligence layer. It ingests a
business's messy CRM and answers one question every week: *"Which relationships deserve
attention right now, based on observable commercial signals?"* — and explains why, in
plain language, citing the evidence. *(Source: `docs/meridian-philosophy.md`.)*

**Why it exists.** Relationship professionals neglect their own databases; opportunity
decays silently. Generic CRMs store data but don't judge it. Meridian judges it — and
deliberately refuses to fabricate a judgment it can't trace to a signal.

**Current stage.** Pre-revenue. ~6 months old. Built primarily by the founder directing
an AI development workforce.

**Current customers (reality).** **One** live pilot — a residential realtor ("Brookside"/
Nicole), with real data in the system of record (one workspace, ~115 contacts). **Zero
paying customers.** LaborTech (a B2B/staffing concept) is **Product 2 — deferred**; it has
**no live data** in the system of record and is demo-grade. *(The founder's own strategy
doc, `docs/product-bifurcation-correction.md`, already reaches this conclusion.)*

**Current reality in one sentence.** A technically disciplined, well-governed **v1 product
that works** (clean the book → rank who to call → say why → suggest what to say) attached
to **a strong, codified philosophy** — with **no revenue, one pilot, and no market data
feeding the premium features.**

---

## SECTION 2 — Founder Philosophy *(this is the real moat — read it first)*

Meridian's doctrine is codified, not improvised. Canonical sources:
`docs/meridian-philosophy.md`, `docs/scoring-principles.md`,
`docs/integration-philosophy-v1.md`, `autonomy/SIGNAL_TRUST_RULES.md`,
`autonomy/NO_DRIFT_RULES.md`, `autonomy/PRODUCT_CONSTITUTION.md`,
`docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md`.

- **Evidence honesty.** Every score, rank, and "why now" must trace to an **observable
  signal** in the customer's own data or public records. No score exists without a
  documented derivation path. *(BUILT — enforced in code and tests.)*
- **Trust over AI theater.** Meridian must feel like "a calm intelligence layer," **not**
  "an AI running the business." It explicitly does **not** talk at the user, predict
  closings, or show vanity metrics. *(BUILT — see `docs/pricing-one-pager.md` "What you do
  not get.")*
- **Deterministic intelligence.** **Banned:** black-box ML, hidden weights, emotional
  inference ("warmth/trust scores"), predictive certainty ("this will close"). Every
  coefficient lives in source as a plain number with a comment. *(BUILT — and unusual.)*
- **Operator-first design.** The product orients around what a human operator should do
  next, with outcomes captured inline so next week reflects what they did. *(PARTIAL —
  the weekly-brief loop exists; outcome capture is lightweight.)*
- **Relationship intelligence.** Classify each contact by an observable relationship state
  (e.g., past seller, sphere, dormant) and rank by commercial relevance. *(BUILT.)*
- **Prioritization philosophy.** Surface a small set (≤8) the operator can actually act on,
  reachability-gated, never a firehose. *(BUILT.)*
- **No-drift governance.** A written constitution + acceptance criteria + PR-review checklist
  govern how the AI development workforce is allowed to change the system. *(BUILT — see
  `autonomy/`.)*

**Why this matters to an engineer:** the discipline is the product's defensibility. In a
category that over-promises, Meridian's restraint — provable, deterministic, honest — is
the differentiation. Preserve it; do not "AI-ify" the scoring path.

---

## SECTION 3 — Business Strategy

**The corrected strategic frame (current source of truth: `docs/product-bifurcation-correction.md`, 2026-05-27):** Meridian is **two products sharing one substrate**, not one converged platform.

| | Product 1 — **CRM Intelligence Layer** | Product 2 — **Operational Lead Execution** |
|---|---|---|
| Customer | Residential realtor (Brookside/Nicole) | B2B/agency teams (LaborTech) |
| Status | **v1 focus — sellable now** | **Deferred** |
| Sale | Founder-led, single conversation | Slow procurement, customization |
| Onboarding | ~90 minutes | Implementation cycle |
| Data today | 1 live workspace, ~115 contacts | **none (demo-grade)** |

- **Brookside (realtor) strategy — ACTIVE.** Clean the agent's book, deliver a Monday
  priority brief, founder-led. The substrate already validated the core mechanics even on
  weak data. *(This is where revenue comes from first.)*
- **LaborTech (B2B) strategy — DEFERRED (PLANNED/VISION).** Different category, slower sale.
  The founder's own docs say: do not let the harder-to-sell product dictate the timeline of
  the easier one. *(Note for the founder: continuing to describe LaborTech as a "current
  customer initiative" contradicts your own bifurcation decision.)*
- **Pricing — documented (`docs/pricing-one-pager.md`):** Solo operator **$499/mo + $500
  onboarding**, 60-day commitment; Specialty contractor **$1,499/mo**; Small team
  **$2,500/mo**. Founder-led, no self-serve. *(BUILT as strategy.)*
- **Founding Member exploration — ACTIVE EXPERIMENT (PLANNED):** a lower-friction entry
  ($500 setup + $99/mo locked, first 10; or Nicole's $500 setup + $500/closing). **⚠
  Tension to resolve:** $99 founding vs. the documented $499 — discount-to-acquire vs.
  hold-price. Decide deliberately.
- **Customer acquisition — NOT BUILT.** No marketing, no sales motion, no pipeline. Founder-
  led only, not yet running.
- **Revenue strategy — the gap.** Setup-cash for adoption + a modest recurring base +
  (optionally) a per-closing success fee. *(PLANNED. $0 collected to date.)*

---

## SECTION 4 — Current Products

### Product 1 — CRM Intelligence Layer (realtor) — **the real product**
- **Purpose:** turn a neglected contact book into a weekly "who to call & why" brief.
- **Capabilities (BUILT):** CSV import + cleaning/de-dup; relationship classification (5
  labels) + ranked priority list; reachability gating; deterministic suggested openers;
  on-demand workspace audit; a weekly brief surface.
- **Limitations:** single live customer; premium "act now" signals idle (no market data);
  outcome-capture loop is light; onboarding is manual/founder-led.
- **Users:** one pilot realtor.
- **Future vision (PLANNED/VISION):** ownership-backed "act now" alerts; multi-customer
  onboarding; tiered packaging.

### Product 2 — Operational Lead Execution (LaborTech) — **deferred**
- **Purpose:** B2B lead prioritization, company intelligence, outreach workflows.
- **Status:** **PARTIAL/VISION.** Demo/showcase configuration; **no live data**; routing and
  copy still carry residential biases (documented in `docs/labortech-readiness.md`).
- **Users:** none.

### Operations Center — **internal product (BUILT, V1)**
- **Purpose:** Meridian watching itself — consolidates ~11 validation checks + a live
  workspace audit into one BLOCKING/REVIEW/HEALTHY status so problems surface automatically.
- **Limitation:** measures mostly code-truth; live production-truth signal is PLANNED.

---

## SECTION 5 — Architecture

```
CUSTOMER (realtor, browser)
        │
 FRONTEND  ── Next.js (App Router) · /personal (realtor view) · /operator (priority view)   [BUILT]
        │
 BACKEND   ── Next API routes + a pure intelligence library                                  [BUILT]
        │      import · classify · rank · openers · audit · ops
        │
 DATABASE  ── Neon Postgres (system of record)                                               [BUILT]
        │      crm_contacts: 1 live workspace (~115)   |  parcels/ownership: EMPTY [PARTIAL/PLANNED]
        │
 INTEGRATIONS ─ Hunter (keyed, unused) · Google/Yelp/etc (absent)                            [PARTIAL]
        │       Vercel (hosting) · GitHub (source) · Autonoma (UI tests, unconfigured)
        │
 AI DEVELOPMENT WORKFLOW  (⚠ build-time agents, NOT product runtime)                          [BUILT]
        │      Claude / Cursor (build) · CodeRabbit (review) · GitHub Actions (gate, OFF)
        │      governed by autonomy/ constitution + no-drift rules
        │
 DEPLOYMENT ── Vercel; ⚠ production currently serves an UNMERGED branch; gate not enforced    [RISK]
```

- **Frontend:** server-rendered Next.js; inline-styled operator/realtor surfaces. **BUILT.**
- **Backend:** the value is a **deterministic, pure-function intelligence library** (highly
  testable). **BUILT.**
- **Database:** Neon Postgres is the system of record; metadata stored as JSONB; market-data
  tables exist but **empty**. **BUILT (contacts) / PLANNED (market).**
- **AI development workflow:** the codebase is largely agent-built under a written governance
  model — owning/verifying this is the key skill for the technical leader. **BUILT.**
- **Deployment architecture:** Vercel. **Current technical risks (see §7).**

---

## SECTION 6 — Current State Audit

| Capability | Status |
|---|---|
| CRM import / cleaning / de-dup / identity / provenance | **BUILT** |
| Relationship classification + ranked priority list | **BUILT** |
| Suggested openers (deterministic) | **BUILT** |
| Realtor workspace + weekly brief surface | **BUILT** |
| Operations Center (self-validation, ~40 check scripts) | **BUILT (V1)** |
| Auth/session + workspace access | **BUILT** |
| Opportunity Intelligence engine (market-evidence gated) | **PARTIAL — built, zero live output** |
| Enrichment (Hunter wired) | **PARTIAL — 0 contacts enriched** |
| Public records / ownership | **PARTIAL — schema only, 0 records** |
| CI merge gate + CodeRabbit config | **PARTIAL — written, not enforced** |
| Production-truth monitoring · branch protection · MLS · multi-customer onboarding · billing | **PLANNED** |
| "Decision intelligence" / "memory systems" / "workflow orchestration" as products · LaborTech as a vertical · in-product AI assistance | **VISION** |

---

## SECTION 7 — Open Problems

- **Technical:** production serves an **unmerged branch**; merge gate built but **off**; "what
  is actually live" is ambiguous; pre-existing type/lint debt; **bus factor = 1**; dual
  storage (file vs. Neon) footgun.
- **Product:** the premium ("act now") is **undemonstrable** without market data; the
  intelligence/ops stack is **over-built for one customer**; outcome-capture loop is thin.
- **Revenue:** **$0**; no finalized price (tension between $499 and $99 founding); no sales
  motion; founder attention split across building, two verticals, and hiring.
- **Data:** **zero market data** (parcels/ownership/MLS) — the single biggest value blocker;
  near-zero enrichment; one workspace of data.
- **Organizational:** one human; no second engineer, no sales, no customer success.

---

## SECTION 8 — For the Technical Leader (Lejla)

*A candid orientation for an experienced engineer evaluating where to add leverage.*

- **Where I'd focus first:** **deployment truth and the merge gate.** Make "what's live"
  unambiguous (merge to the default branch, enforce CI). Then **own and direct the AI
  development workflow** — that is how this company actually ships.
- **What to audit first:** (1) the import / identity / provenance layer (the strongest,
  most load-bearing code); (2) deployment & "what commit is in production"; (3) the
  validation suite (how trustworthy is the green light?).
- **What to ignore (for now):** scale/infra concerns (there is no scale problem at ~115
  contacts), LaborTech/Product 2, and most of the "platform vision" words.
- **What to harden:** deployment hygiene, the enforced merge gate, secrets handling,
  single-point-of-failure (documentation + onboarding so it isn't all in one head).
- **What to simplify:** the breadth of intelligence/validation relative to one customer —
  resist adding more; consolidate.
- **What to delete / park:** dead/duplicate scripts and superseded artifacts; **park
  LaborTech** until Product 1 has revenue.
- **What to build next:** the **smallest data pipeline that makes the premium demoable**
  (seed one metro's ownership data), and the **thinnest onboarding/billing path** to take a
  realtor from "yes" to "paying" without founder heroics.
- **The non-obvious truth:** Meridian's hardest problems are **data acquisition** (a
  partnerships/ETL problem) and **getting to revenue** — not backend engineering. The
  technical leader who helps here is the one who connects engineering to customers, not the
  one who re-architects a system that already works.

*(Suggested trial: a paid, scoped 2-week project — "harden the path to the next paying
customer" — judged on outcome, not interview.)*

---

## SECTION 9 — Recommended Next 90 Days

- **CEO priorities:** set the price; put the pilot on it; run founder-led sales (book ~10
  realtor conversations); **stop initiating new technical scope**; park LaborTech.
- **Technical priorities:** make deployment truth unambiguous (merge + enforce gate); seed
  one metro's ownership data so the premium demos; stand up the thinnest onboarding/billing
  path. Harden, don't expand.
- **Revenue priorities:** first 1–3 paying customers; first ~$1,000 MRR via a small recurring
  base; resolve the $499-vs-$99 pricing question with real customer data.
- **Customer priorities:** convert the pilot to paying + referenceable; collect one
  attributable win; turn that into the story that sells the next nine.

---

## Appendix — Source Document Index (in the repo)

- Philosophy & doctrine: `docs/meridian-philosophy.md` · `docs/scoring-principles.md` ·
  `docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md` · `docs/integration-philosophy-v1.md` ·
  `autonomy/PRODUCT_CONSTITUTION.md` · `autonomy/NO_DRIFT_RULES.md` ·
  `autonomy/SIGNAL_TRUST_RULES.md` · `research/philosophy/*`
- Strategy: `docs/product-bifurcation-correction.md` (current) ·
  `docs/commercial-readiness-verdict.md` (superseded) · `docs/labortech-readiness.md` ·
  `docs/pricing-one-pager.md` · `docs/customer-expectations.md` · `docs/onboarding-checklist.md`
- Architecture: `docs/COMBINED_PRIORITY_ARCHITECTURE.md` ·
  `docs/public-record-intelligence-architecture.md` · `docs/architecture/*`
- Company blueprints: `docs/MERIDIAN_FOUNDER_BLUEPRINT.md` (+ Executive Blueprint & Board Memo)
- Product principles: `docs/product/*` · `docs/scoring-principles.md`

> **Sharing note for the founder:** before granting access, exclude real customer data
> (the pilot's contacts are PII), all secrets/`.env`, and Neon production credentials.
> Provide a sanitized, read-only repo with fixtures only.
