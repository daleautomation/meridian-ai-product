# MERIDIAN — FOUNDER DUE DILIGENCE MEMO
**Internal · Not for distribution · Prepared after multi-week evaluation of the product, code, data, strategy documents, and founder.**

> **Reading convention.** Every material claim is tagged:
> **REALITY** (verified true today) · **VISION** (aspirational, not built) ·
> **ASSUMPTION** (unproven belief the thesis depends on) · **RISK** (what could break it).
> This memo does not sugarcoat, encourage, or sell. It is written for someone deciding
> whether to give Meridian years of their life.

---

## Recommendation (read first)

Meridian is a **technically disciplined, philosophically coherent, pre-revenue product
with one unpaid pilot and no commercial engine, built unusually fast by a single founder
directing an AI workforce.** The asset is real; the company is not yet a company. Its
outcome is gated almost entirely on **one non-technical variable: whether the founder
transitions from building to selling.** As an investment today: **pass / too early.** As a
build-bet for an operator: **conditionally interesting, but only if you can tolerate that
the deciding risk is behavioral, not technical, and largely outside your control.** The
honest near-term probability of a meaningful outcome on the current trajectory is **low
(high-single-digits)**, with real upside **only** if the revenue transition happens.

---

## I. What Meridian is and why it might matter (Q1–4)

**1. What is Meridian?**
**REALITY:** a trust-first relationship-intelligence layer. It ingests a professional's
messy CRM and produces a weekly, ranked, evidence-cited answer to *"which relationships
deserve attention now, and why?"* — for residential realtors first.
**VISION:** a multi-vertical "decision intelligence / memory / workflow orchestration"
platform. That platform does not exist; ~1.5 of the seven advertised pillars are real.

**2. What problem does it solve?**
**REALITY:** relationship professionals neglect their own databases; opportunity decays
silently; generic CRMs store data but do not judge it. Meridian judges it and refuses to
fabricate. This is a real, felt pain.

**3. Why does the world need it?**
**ASSUMPTION:** that "who should I contact and why" is a problem people will *pay* to solve,
versus a nice-to-have they ignore. The pain is real; the **willingness to pay is unproven**
(one prospect indicated terms; zero have paid).

**4. Why now?**
**REALITY:** AI collapses the cost of building an intelligence layer — a solo founder can
now build what took a team, which is how Meridian exists at all.
**ASSUMPTION / weak:** that there is *demand-side* urgency. The supply-side "why now" is
strong; the demand-side "why now" is asserted, not demonstrated. A weak "why now" on the
demand side is the most common reason disciplined products die.

## II. What is actually true (Q5–8)

**5. What has actually been built? (REALITY)**
Idempotent CRM import with identity-stable de-duplication and data provenance; relationship
classification (5 observable labels) + a ranked, reachability-gated priority list;
deterministic suggested openers; a realtor workspace with a weekly brief; a self-monitoring
"Operations Center" and ~40 validation checks; auth and workspace isolation. For a 6-month-
old, single-founder, ~18-month-experience effort, this is **above-average engineering
discipline.**

**6. What has not been built?**
**PARTIAL/idle:** the opportunity ("act now") engine — *complete but fed zero data*;
enrichment — *0 contacts enriched*; public records — *schema only, 0 records*; the CI merge
gate — *written, not enforced*. **PLANNED:** market-data ingestion (county, MLS), multi-
customer onboarding, billing, production-truth monitoring. **VISION:** the platform pillars,
LaborTech as a vertical, in-product AI assistance.

**7. What is currently working? (REALITY)**
The core loop works on real (even poor-quality) data: clean → classify → rank → explain →
suggest. One pilot workspace runs it. The philosophy is enforced in code, not just stated.

**8. What is currently failing?**
**REALITY:** commercialization (zero revenue, no sales motion); the premium is
undemonstrable (no market data); deployment integrity (production serves an *unmerged*
branch with the gate off; "what is live" is ambiguous). **The product isn't failing; the
company-building is.**

## III. Risks (Q9–10)

**9. Biggest technical risks (RISK)**
- **Bus factor = 1.** One person holds all context plus the only ability to direct the agent
  workforce. This is the single largest technical risk.
- **Deployment truth.** No reliable answer to "what commit is in production"; gate unenforced;
  pre-existing type/lint debt. Regressions can ship silently.
- **Over-built surface area** relative to one customer — more to maintain, more to break, for
  no current return.
- **Data dependency.** The differentiated features require external data the company does not
  have and has not proven it can acquire affordably.

**10. Biggest business risks (RISK)**
- **No commercial motion after 6 months.** The defining risk. Building has substituted for
  selling.
- **Demand unproven.** One indicated-yes is not a market.
- **Pricing unresolved.** Documented at $499/mo; an active experiment at $99 founding — a
  3–5x discount-vs-hold question decided by neither data nor conviction yet.
- **Moat durability** (see Q13) — the visible feature is copyable; the durable moat is
  unbuilt (data + brand).
- **Founder concentration** across product, sales, ops, engineering, and now hiring — attention
  is the scarcest resource and it is fragmented.

## IV. The founder (Q11–12)

**11. What is the founder uniquely good at? (REALITY)**
- **Directing an AI workforce to build rigorous systems fast** — a genuinely differentiated,
  modern capability; the product's existence is the proof.
- **Product taste and restraint** — codifying "evidence honesty / no AI theater / deterministic
  intelligence" and *enforcing* it. Most founders can't resist faking sophistication; this one
  built guardrails against it.
- **Systems and governance thinking** — a written constitution, no-drift rules, a self-watching
  ops layer. Unusual maturity for the experience level.

**12. The founder's blind spots (RISK — and the crux of this memo)**
- **Revenue avoidance.** Six months, zero paying customers, and a steady stream of building,
  strategizing, and now hiring — all of which feel productive and are emotionally safer than
  asking someone to pay. **The technical-cofounder search itself reads as sophisticated revenue
  avoidance.**
- **Vision-vs-reality inflation.** Describes a seven-pillar platform and "two customer
  initiatives" when reality is ~1.5 working pillars and **one unpaid pilot** (the second
  "customer," LaborTech, has no live data and is deferred by the founder's own strategy doc).
- **Mistaking motion for progress.** Audits, refactors, blueprints, and pricing exercises
  accumulate; revenue does not.
- **Over-engineering for a company that hasn't sold anything.**

## V. Moat and outcomes (Q13–15)

**13. What is Meridian's moat?**
- **Today (REALITY, thin):** discipline and trust ("won't fabricate") — real, but **the
  surface feature ("who to call & why") is copyable** by any incumbent CRM with engineers.
- **Durable moat (VISION/ASSUMPTION, unbuilt):** (a) **proprietary/partnered market data**
  (county + MLS) that makes "act now" defensible; (b) a **trust brand** in an over-promising
  category; (c) a **low-cost agent-built cost structure** enabling margins competitors with
  headcount can't match. **None of the three is yet established.** The moat is a plan, not a fact.

**14. What would cause Meridian to fail? (RISK)**
The base case: **the founder keeps building and never builds a sales motion, runs out of
runway pre-revenue holding a beautiful, unsold product.** Secondary: never secures market
data, so the product stays a "nicer CRM" and commoditizes; or the single founder burns out /
is hit by the bus-factor.

**15. What would cause Meridian to succeed?**
A **founder behavioral shift to founder-led selling**, proving the realtor wedge with paying,
referenceable customers, fueled by a **thin slice of real market data** that makes the premium
demoable — then replicating metro-by-metro on the low-cost workforce and the trust brand.
Success is **commercial and behavioral, not technical.**

## VI. Forward (Q16–18)

**16. Next 90 days (what *should* happen)**
Stop new technical scope. Set the price. Put the pilot on it. Run founder-led sales (≥10
realtor conversations). Seed one metro's ownership data to make the premium demoable. Fix
deployment truth (merge, enforce the gate). **Target: first 1–3 paying customers.**

**17. Before hiring a technical cofounder**
Have **revenue or a clear paid-trial signal**; **de-risk the bus factor** (docs, runbooks);
**prove any candidate via a paid trial**, not an interview; resolve role/equity. Granting
cofounder equity pre-revenue, off an impression, would be a serious unforced error.

**18. Where a strong engineer creates the most leverage**
Not by re-architecting (the system works). By (a) **owning deployment + the agent workflow so
the founder can leave the codebase and sell**; (b) **building the thin data pipeline** that
makes the premium real; (c) **standing up onboarding/billing** so "yes" → "paying" without
founder heroics. The highest-leverage engineer here is the one who **connects engineering to
revenue and frees the founder** — not the one who builds more intelligence.

## VII. The bet (Q19–20)

**19. If Meridian succeeds, the 3-year company (VISION):**
A multi-metro, possibly multi-vertical relationship-intelligence business with thousands of
contacts under management per customer, continuous enrichment and monitoring, a self-running
operation watched via the Operations Center, a small commercial team, and the founder operating
as CEO of an automated company — directing strategy and exceptions, not repairing systems. This
is coherent and achievable **if and only if** the commercial transition happens first.

**20. Honest probability of success if the founder continues executing as observed:**
- **On the current trajectory (building, not selling): ~5–10%** of a meaningful outcome. Strong
  product, no demand proof, no motion, single point of failure.
- **If the founder pivots hard to revenue and proves the wedge in one metro: ~20–30%** — the
  product quality and cost structure would then be real advantages.
The estimate is **dominated by a single behavioral variable.** That is unusual and important:
this is not a "can they build it" bet (they can) — it is a "will they sell it" bet (unproven).

---

## Consolidated Reality / Vision / Assumption / Risk

| Dimension | Verdict |
|---|---|
| **REALITY** | Working v1 (clean→rank→explain→suggest); enforced philosophy; strong data-integrity & validation discipline; one unpaid pilot; built fast by an AI workforce. |
| **VISION** | The platform (decision intelligence / memory / orchestration); the "act now" premium; multi-customer, multi-vertical; the durable data/brand moat; LaborTech. |
| **ASSUMPTION** (thesis depends on these) | Realtors will *pay*; market data is acquirable affordably; the founder will transition to selling; the wedge generalizes beyond one metro. **None proven.** |
| **RISK** | Revenue avoidance; demand unproven; bus factor = 1; deployment integrity; copyable surface feature; pricing unresolved; founder attention fragmented. |

## Risk register (ranked)

| # | Risk | Severity | Mitigable by an operator? |
|---|---|---|---|
| 1 | Founder doesn't transition to selling | **Critical** | Only partially — it's behavioral |
| 2 | Demand never proven (no paying customers) | Critical | Yes — sell |
| 3 | Bus factor = 1 | High | Yes — second engineer + docs |
| 4 | No durable moat without market data | High | Yes — data partnerships/ingestion |
| 5 | Deployment integrity / "what's live" | Medium | Yes — enforce the gate |
| 6 | Over-building vs. stage | Medium | Yes — discipline/freeze |
| 7 | Pricing unresolved | Medium | Yes — test in market |

---

## Bottom line for the reader deciding whether to commit years

Meridian is the rare early company where **the technology is the least of the risks.** What
you would be betting on is **a talented builder becoming a seller** — and on a wedge that is
plausible but unvalidated. If you join, your leverage is to **free the founder to sell and to
de-risk the single-point-of-failure**, and your honest expected value is governed less by your
own work than by a founder behavior you can influence but not control. Go in clear-eyed: the
product will likely keep getting better; the open question — six months in and still open — is
whether anyone will pay for it. Until that question has a "yes," everything else is preface.

*Prepared as an independent evaluation. No optimism added.*
