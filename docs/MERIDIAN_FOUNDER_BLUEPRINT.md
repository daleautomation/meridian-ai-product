# The Meridian Founder Blueprint
### An executive operating handbook for Dylan Dale, Founder & CEO

*A note on language.* In this document, **Meridian** is the operating company. The
**Founder** (Dylan) is its CEO. The **agents, automations, validation systems,
enrichment systems, and intelligence systems** are Meridian's workforce, organized
into **departments**. The **customer** is the relationship-driven professional who
pays Meridian to tell them who to contact and why (today: Nicole Lonergan, a Kansas
City realtor). This is a company handbook, not an engineering document.

---

## 1. Meridian Company Overview

**What is Meridian?**
Meridian is a relationship-intelligence company. It takes a professional's messy
contact book and turns it into a trustworthy, ranked answer to one question every
morning: *"Who should I reach out to, and why?"* It does this as an operating system
of automated departments rather than a single piece of software — data comes in, gets
cleaned, classified, prioritized, and surfaced, while a monitoring department watches
the whole operation for problems.

**What problem does it solve?**
Relationship professionals (realtors first) sit on hundreds or thousands of past
clients and contacts, but their CRM is stale, duplicated, half-complete, and
un-prioritized. They don't know who's worth a call. Generic CRMs store data; they
don't *judge* it. Meridian judges it — and, critically, refuses to fabricate a
judgment it can't defend with evidence. It separates **"this person is worth
reconnecting with"** (relationship truth, which it has) from **"this person is about
to sell"** (market truth, which it will not claim without proof).

**Long-term mission.**
Become the trusted intelligence layer that tells any relationship-driven business
exactly where to spend its next hour — backed by evidence, continuously verified, and
run by a workforce of agents under founder direction rather than by armies of people.

**Competitive advantage.**
1. **Evidence honesty.** Meridian will only attach a label as strong as its evidence.
   It built a market-evidence gate so that "opportunity" language is impossible without
   listing/ownership proof. Competitors over-promise; Meridian's restraint is the moat —
   operators trust it *because* it says "I don't know" when it doesn't.
2. **A self-watching operation.** Meridian has a Trust & Validation department (the
   Operations Center) that surfaces its own problems automatically. Most products rely
   on the founder to discover breakage; Meridian is being built to report it.
3. **An agent workforce.** The cost structure is software, not headcount. Departments
   are run by Claude, CodeRabbit, GitHub Actions, Autonoma, and future agents — scalable
   without linear hiring.

---

## 2. Organizational Structure

Eight departments. For each: purpose, inputs, outputs, maturity, bottleneck.

### Relationship Intelligence Department
- **Purpose:** decide what each contact *is* and how much they matter — the core product.
- **Inputs:** cleaned contacts (tags, recency, reachability) from Workspace Operations.
- **Outputs:** a primary relationship label per contact — *Past Seller Reconnect,
  Seller History (Verify Recency), Sphere Reengagement, Cold Relationship, Not Reachable* —
  plus the ranked priority queue the customer sees.
- **Maturity:** **Operational.** Shipped and wired into both the customer and operator
  views; ranks by relationship class, reachability-gated.
- **Bottleneck:** it is honest but thin — without market data it can only say "worth
  reconnecting," never "act now." Its ceiling is set by other departments.

### Opportunity Intelligence Department
- **Purpose:** detect *market events* worth acting on (a listing, long ownership, a deal signal).
- **Inputs:** would consume listings + public records; today receives "honest empties."
- **Outputs:** opportunity tiers (HIGH/MED/WEAK) — but **gated**: no market evidence → WEAK.
- **Maturity:** **Built but underutilized.** The engine is complete, deterministic, and
  provenance-tracked, but produces **zero live opportunities** because it has no market data.
- **Bottleneck:** starved of fuel. It is the highest-value department and currently idle.

### Public Records Department
- **Purpose:** supply ownership/parcel/tenure facts that turn relationships into opportunities.
- **Inputs:** county assessor/recorder data (Jackson MO, Johnson KS for the current customer).
- **Outputs:** parcels, ownership snapshots, contact↔parcel links.
- **Maturity:** **Not started (operationally).** The filing cabinets exist (schema), but
  there are **0 records inside**. The wrong county's data (King County WA) is the only sample.
- **Bottleneck:** nobody has ingested the data; the acquisition path is cheap but unrun.

### Workspace Operations Department
- **Purpose:** intake and hygiene — turn a raw CRM export into clean, de-duplicated, trustworthy contacts.
- **Inputs:** customer CRM exports (WiseAgent CSV), operator repairs.
- **Outputs:** the canonical contact book in the system of record (105 clean contacts today),
  plus an on-demand workspace audit (`crm:audit`).
- **Maturity:** **Operational.** Import pipeline hardened (identity-stable IDs, working
  dedup, correct phone/column mapping); the live workspace is clean.
- **Bottleneck:** some recovery tooling (rebuild/backup/forensics) isn't present on the
  active branch; phone coverage caps at ~71% because source data lacks numbers.

### Trust & Validation Department
- **Purpose:** continuously verify that the rest of the company is correct — the quality function.
- **Inputs:** the work product of every other department.
- **Outputs:** the **Operations Center** status — BLOCKING / REVIEW / HEALTHY — consolidating
  ~11 logic checks (Code Truth) plus a live workspace audit (Workspace Truth).
- **Maturity:** **Operational (V1).** Surfaces problems automatically; already caught a
  real workspace finding without the founder looking.
- **Bottleneck:** still measures mostly *code* truth; live production-truth signal not yet wired.

### Deployment & Infrastructure Department
- **Purpose:** get verified work safely into the customer's hands; keep production trustworthy.
- **Inputs:** approved changes; the validation suite.
- **Outputs:** the live product; the merge gate (CI) and protections.
- **Maturity:** **Functional but immature.** CI (the `validate` gate) is built and proven
  green (11/11), but **not yet enforced**; production currently serves an *unmerged branch*,
  and the default branch is stale.
- **Bottleneck:** the gate isn't switched on; "what's deployed" isn't yet provably "what passed."

### Research Department
- **Purpose:** answer open questions (markets, data sources, customers) with cited evidence.
- **Inputs:** founder questions; the web; internal data.
- **Outputs:** research briefs, source evaluations, roadmaps.
- **Maturity:** **Built but underutilized.** Capability exists (deep-research harness,
  prior audits) but is invoked ad hoc, not as a standing function.
- **Bottleneck:** demand-driven only; no recurring research cadence.

### Customer Intelligence Department
- **Purpose:** enrich and verify contacts (emails, phones, company, signals) beyond the raw import.
- **Inputs:** the contact book; external providers (Hunter is keyed; others absent).
- **Outputs:** enrichment written additively alongside CRM truth.
- **Maturity:** **Missing data.** Infrastructure exists, but **0 contacts have been enriched**;
  only Hunter has a key, eligible for ~12 of 105 business-domain contacts.
- **Bottleneck:** no enrichment has been run; most provider keys are absent.

---

## 3. Founder Responsibilities

**What Dylan owns:**
- **Vision & strategy** — what Meridian becomes, which industries, in what order.
- **Capital allocation** — where the (mostly software) budget and the agents' effort go.
- **Customer acquisition** — finding and closing the people who pay. No agent does this.
- **Partnerships** — the data deals that unlock the moat (MLS/listing access, county data).
- **Pricing** — what Meridian is worth and how it's packaged.
- **Approval authority** — the final yes/no on anything that changes truth, ships to
  production, or alters how the company judges contacts. This is the founder's most
  important operating muscle, and it's already the house rule.
- **Prioritization** — which department gets unblocked next.

**What Dylan should stop spending time on** (these are now the workforce's job):
- Discovering bugs and data problems by hand → the Trust & Validation department surfaces them.
- Running audits manually → the Operations Center runs them.
- Hand-fixing contact data, re-reading logs, eyeballing deployments → automation + monitoring.
- Writing or babysitting validation → CI + the check suite.
- Verifying "did my change break something" by inspection → the merge gate answers it.

The shift: **from doing the work and finding the problems, to directing the workforce
and approving the exceptions.**

---

## 4. Meridian Responsibilities

What the company (the operator) owns, end to end, without the founder in the loop:
- **Data processing** — normalize, de-duplicate, assign stable identities, stamp trust.
- **Contact organization** — maintain the canonical, clean contact book.
- **Relationship classification** — assign the primary label to every contact.
- **Opportunity detection** — when (and only when) market evidence exists.
- **Prioritization** — produce the daily ranked "who to contact" queue.
- **Memory** — retain what's known, what was repaired, weekly state, and operational snapshots.
- **Research** — investigate sources and questions on demand.
- **Monitoring** — continuously watch every department's output (the Operations Center).
- **Validation** — prove correctness before anything reaches a customer.

The contract: Meridian is responsible for being **correct and honest**; the founder is
responsible for being **strategic and decisive**.

---

## 5. Agent Responsibilities

The workforce. Each has a job title, a department, a strict authority limit, and a
reporting line. **No agent may merge to the production branch, write to the system of
record's truth, or deploy without founder approval.** That single rule prevents
autonomous drift.

| Agent | Job title | Department | Responsibilities | Authority limit | Reports to |
|---|---|---|---|---|---|
| **Claude (Claude Code)** | Chief of Staff / Senior Engineer | All (cross-functional) | Audit, plan, and implement approved work across every department; surface findings | Proposes & implements on a branch only; never merges to main, writes live truth, or deploys without approval | Founder |
| **Cursor** | Staff Engineer | Engineering | Inline edits and refactors on a branch | Same as above; ships via reviewed PR | Founder (via PR) |
| **CodeRabbit** | Code Reviewer (QA) | Trust & Validation | Reviews every PR; flags risk in import/opportunity/relationship/ops code | **Advisory only — changes nothing** | Founder (advisory) |
| **GitHub Actions** | Compliance Gatekeeper | Deployment & Infrastructure | Runs the 11-check `validate` suite on every PR; blocks merge on failure (once enabled) | Gate, not author; cannot modify code | Founder (pass/fail) |
| **Autonoma** | UI Quality Inspector | Trust & Validation | Post-deploy checks that the live product renders correctly | Asserts only — changes nothing | Founder / deploy gate |
| **Future browser agents** | Field Researchers | Research / Customer Intelligence | Sandboxed exploratory testing and data gathering | Read-only, sandboxed, operator-scoped runs | Founder |
| **Future public-record agents** | Records Clerks | Public Records | Ingest parcels/ownership; create contact↔parcel links | Write **only** public-record tables; never alter contact truth without review | Founder |

*(Kernel is intentionally absent — it is not installed and serves no role today.)*

The workflow every agent follows: **discover → propose on a branch → run validations →
report → Founder reviews → Founder approves & merges.** The gate (GitHub Actions +
CodeRabbit) is the technical enforcement of that chain.

---

## 6. Information Flow

How information enters Meridian and becomes action.

```
   INTAKE                 PROCESSING              INTELLIGENCE            RECOMMENDATION          EXECUTION
   ──────                 ──────────              ────────────            ──────────────          ─────────
 CRM import (CSV) ─┐                                                                            
 Operator notes ──┤   normalize · dedupe ·    relationship class ·    ranked priority queue ·   operator calls /
 Customer history ┼─▶ identity keys · trust ─▶ opportunity (gated) ─▶  labels · openers ·     ─▶ emails the
 Public records ──┤   metadata · integrity     · combined priority      suggested actions         right contact
   (future) ──────┤                                                                              (enrichment
 MLS / listings ──┤                                                                               written back,
   (future) ──────┤                                                                               additively)
 Business data ───┘                                                                            
        Hunter live; others future

                 ┌─────────────────────────────────────────────────────────────────────┐
                 │  TRUST & VALIDATION (Operations Center) watches every stage above:    │
                 │  Code Truth + Live Workspace Truth → BLOCKING / REVIEW / HEALTHY       │
                 └─────────────────────────────────────────────────────────────────────┘
```

Today the pipeline runs fully from **CRM import → recommendation**; the customer sees a
ranked, labeled queue. The **future intake lanes** (public records, MLS, broader business
data) are the fuel that lets the Intelligence stage produce *opportunities*, not just
*relationships*. Execution remains human (the customer makes the call); Meridian's job is
to make that call obvious and defensible.

---

## 7. Current State Assessment (brutally honest)

| Area | Classification |
|---|---|
| Relationship classification & ranking | **Operational** |
| Workspace intake / hygiene (import, dedup, mapping) | **Operational** |
| Trust & Validation (Operations Center V1, check suite) | **Operational** |
| Live workspace audit (`crm:audit` as a monitored signal) | **Operational** |
| Deployment & CI gate | **Functional but immature** (built, proven green, **not enforced**; prod on an unmerged branch) |
| Opportunity engine | **Built but underutilized** (complete, correct, **0 live signals**) |
| Research function | **Built but underutilized** |
| Customer Intelligence / enrichment | **Missing data** (infrastructure ready, **0 contacts enriched**, most keys absent) |
| Public Records / ownership | **Missing data** (schema only, **0 parcels**) |
| MLS / listings / market events | **Not started** |
| Production-truth monitoring | **Not started** |
| Multi-customer / multi-industry | **Not started** (one customer, one vertical) |

**The honest summary:** Meridian's *judgment* is real and trustworthy, but it currently
judges a single clean workspace using only relationship data. The differentiated,
high-value departments (Opportunity, Public Records, Customer Intelligence) are built or
scaffolded but **starved of data**, and the safety rail (the CI gate) is built but **not
yet switched on**.

---

## 8. Growth Constraints (ranked)

**#1 — Revenue / customer constraint (most binding).**
One pre-revenue customer (Nicole), no live pricing. Until there are paying customers,
nothing else is validated by the market. *This is a Founder-owned constraint — no agent
solves it.*

**#2 — Data constraint.**
The crown-jewel department (Opportunity Intelligence) is idle because there are **0 market
records** — no parcels, no listings, ~0 enrichment. The product cannot say "act now"
without this fuel. Cheapest high-leverage unlock: county ownership data.

**#3 — Operational constraint.**
The company still runs with the Founder in the loop for every approval, deploy, and merge;
production tracks an unmerged branch; Autonoma's cloud verification is unconfigured. The
workforce can't yet run unsupervised between decisions.

**#4 — Technical constraint.**
Trust infrastructure is half-installed: the CI gate isn't enforced, production-truth isn't
verified, and there's pre-existing type/lint debt. Real but the smallest blocker, and
mostly already specified.

> Ranking logic: a company with one customer and no market data has a *demand and fuel*
> problem before it has a *plumbing* problem. Fix revenue and data first; the technical
> rail is nearly done.

---

## 9. Future Organization (at maturity)

Picture Meridian with thousands of contacts across multiple customers and industries,
continuous enrichment, and continuous monitoring:

- **Departments run themselves.** Intake, hygiene, classification, opportunity detection,
  and enrichment operate continuously per workspace without manual runs.
- **The Operations Center is the cockpit.** Each customer workspace reports
  BLOCKING / REVIEW / HEALTHY; the Founder reads exceptions, not raw data.
- **The agent workforce scales horizontally.** More customers = more workspaces, not more
  staff. Records Clerks ingest counties; Field Researchers test and gather; the
  Gatekeeper and Reviewer guard every change.
- **Evidence honesty becomes the brand.** Across industries, Meridian is the system that
  only claims what it can prove — and is trusted for exactly that.

**The Founder's role becomes:** CEO of an automated operations company. Dylan stops
approving individual code changes one at a time and starts setting **policy** (what
counts as BLOCKING, which industries to enter, which data partnerships to sign, how to
price), **allocating capital and agent effort**, and **reviewing only the exceptions the
Operations Center escalates.** The day-to-day "find and fix" disappears; the strategic
"direct and decide" is all that's left.

---

## 10. Strategic Roadmap

Five stages, each built only from systems that exist or are already planned.

### Stage 1 — Trust & Validation  *(in progress)*
Make Meridian provably correct before it scales. CI merge gate (the 11-check `validate`
suite), branch protection, CodeRabbit review, and the Operations Center (Code Truth +
Workspace Truth, with Production Truth next).
**Success looks like:** no change reaches production without passing validation; the
Operations Center is the single trusted source of operational truth; HEALTHY genuinely
means code + workspace + production are healthy.

### Stage 2 — Ownership Intelligence
Feed the idle Opportunity department its first real fuel: ingest county public records
(Jackson MO, Johnson KS), resolve contacts to parcels, and let ownership/tenure signals fire.
**Success looks like:** opportunity tiers that are backed by real ownership facts —
"owned 9 years, prior seller, gone cold" — not just relationship recency.

### Stage 3 — Market Intelligence
Add the high-value, high-difficulty source: listings / MLS access (the partnership the
Founder owns). Activate active-listing and listed-by-another-agent signals.
**Success looks like:** Meridian surfaces genuine market events — "your past client just
listed with another agent" — the moment they happen, with evidence.

### Stage 4 — Customer Intelligence
Enrich and verify at scale (Hunter for business contacts, verified email/phone), and
extend cleanly to multiple workspaces and industries.
**Success looks like:** every contact carries verified, provenance-tracked enrichment;
coverage is measured and high; new customers onboard without bespoke work.

### Stage 5 — Autonomous Operations
The workforce runs the company between decisions: agents discover, propose, validate, and
report; the Operations Center monitors every workspace continuously; the Founder approves
exceptions and sets policy.
**Success looks like:** Meridian operates across many customers with the Founder directing
strategy, not repairing systems — the company the first nine sections were building toward.

---

### How to use this handbook
Read Section 7 to know where you stand, Section 8 to know what to fix first, and Section 10
to know the order. Hold every agent to the authority limits in Section 5. And remember the
operating contract: **Meridian is responsible for being correct and honest; you are
responsible for being strategic and decisive.**
