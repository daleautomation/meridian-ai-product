# MERIDIAN_REVENUE_OS.md — The Revenue Operating System

> **Status:** Canonical design. Authored 2026-07-06 by the Chief Architect.
> Third in the canon, sitting above [`MERIDIAN_AUDIT.md`](./MERIDIAN_AUDIT.md)
> (what exists) and [`MERIDIAN_COMMAND_ARCHITECTURE.md`](./MERIDIAN_COMMAND_ARCHITECTURE.md)
> (the Opportunity Graph, Phases 0–1 of which are **built** — see
> [`docs/architecture/OPPORTUNITY_GRAPH_PHASE_0_1.md`](./docs/architecture/OPPORTUNITY_GRAPH_PHASE_0_1.md)).
>
> **Mission (amends the governing question).** Meridian exists for one reason: to
> continuously maximize professional earning potential. The governing question is
> upgraded from *"highest ROI"* to:
>
> > **"If I had only four hours today, which allocation of my finite time,
> > attention, social capital, money, and reputation has the highest probability
> > of producing future revenue — and what am I sacrificing by choosing it?"**
>
> If a screen, notification, inference, integration, agent, or datum does not move
> that number, it does not belong in Meridian Command.

---

## 0. The reframing this document makes

The Opportunity Graph (built) models **entities and structure** — who, what, and how
they connect. That is necessary but not sufficient. A graph that only grows is just a
richer database. This document adds the three layers that make it *decide*:

1. **Revenue Graph** — annotate every node with its position in the value chain, so the
   system knows *where revenue is and where it could come from*.
2. **Capital Allocation** — model the five scarce resources you spend each day and turn
   the morning brief into a *budget-constrained allocation*, not a ranked list.
3. **Learning Engine** — close the loop with realized outcomes so every estimate gets
   truer over time.

All three stay **deterministic and explainable** (the philosophy's non-negotiable). The
only "AI" remains external agents emitting *signal events*; the math that spends your
resources is transparent arithmetic you can audit.

```
  LEARNING ENGINE  (execution_outcomes → updated priors → better estimates)
        ▲                                                         │
        │ realized revenue                          better probabilities/values
        │                                                         ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  CAPITAL ALLOCATION   — spend finite budgets for max expected revenue   │  ← the decision
  │  time · attention · social capital · money · reputation                 │
  └───────────────────────────────────────────────────────────────────────┘
        ▲ candidate actions (cost vector + expected revenue + chain multiplier)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  REVENUE GRAPH        — every node's stage in the value chain +          │
  │                         revenue chains as first-class compounding assets │
  └───────────────────────────────────────────────────────────────────────┘
        ▲ nodes + edges + provenance
  ┌───────────────────────────────────────────────────────────────────────┐
  │  OPPORTUNITY GRAPH    — BUILT (Phase 0/1): graph_nodes, graph_edges,     │
  │                         source_records, identity_resolution              │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## 1. The Revenue Graph (value-chain overlay)

Every node is assigned a **revenue stage** — its position in the compounding chain:

```
Relationship → Introduction → Meeting → Opportunity → Proposal → Customer
     → Recurring Revenue → Referral → (back to Relationship)
```

- **Implementation:** a `revenue_positions` projection over the built `graph_nodes` —
  `(node_id, revenue_stage, direct_expected_value, realized_value, confidence,
  trace)`. It is a *view/projection*, not a new source of truth. The graph stays the
  spine; this overlays revenue meaning.
- **Edges gain value-flow semantics.** A `KNOWS`/`INTRODUCED` edge is a potential value
  *transfer*; `GENERATED_VALUE` (already modeled) is a realized one. This lets the system
  compute, for any node, both **realized revenue behind it** and **expected revenue ahead
  of it**.
- **What it answers:** "where does every relationship sit in the chain, and what is the
  expected value of moving it one stage forward?"

The stage-advance value is the atom of everything above: an action is worth the expected
revenue of the stage transition it causes (a follow-up that moves Opportunity→Proposal is
worth the marginal EV of that transition, not the whole deal).

---

## 2. Revenue Chains (the network compound effect)

A **revenue chain** is a directed path through the Revenue Graph from a relationship to
realized (or expected) revenue. Your example —

> Blake → Josh → Company A → Customer B → Company C → Investor D → funds Meridian

— is **one asset**, not six events. Chains are first-class and stored (`revenue_chains`):
`(chain_id, ordered_node_ids[], realized_value, expected_future_value, compounding_multiplier, evidence[])`.

- **Detection** is a deterministic walk over `graph_edges` (`INTRODUCED`/`KNOWS`/`WORKS_AT`/
  `AT_COMPANY`/`GENERATED_VALUE`), reusing the path-finder from the architecture doc.
- **Valuation** is deterministic: `realized_value` = sum of `execution_outcomes` attributed
  along the chain; `expected_future_value` = stage-transition EV of the chain's frontier ×
  historical yield of similar chains.
- **The compounding multiplier** is why an introduction can outrank a proposal: an
  introduction from a person whose chains historically spawn 3 further opportunities carries
  the discounted expected value of that *tail*, not just the next meeting. This is the
  structural advantage the Revenue Graph has over isolated per-item scoring.

Chains are, as you said, among the highest-value assets in the system — protect and grow
them; the learning engine (§5) scores which *sources* start the richest chains.

---

## 3. Capital Allocation (the core decision engine)

This is the piece the audit's architecture was missing. Each morning Meridian assumes a
**finite budget of five scarce resources** and allocates them for maximum expected revenue.

### 3.1 The five budgets

| Resource | Daily budget (default) | Deterministic proxy for "cost" of an action |
|---|---|---|
| **Time** | ~4 focused hours | estimated minutes to complete |
| **Attention** | 3–5 deep slots | cognitive load: deep=1 slot, shallow=0.2 |
| **Social capital** | ~2 "asks" | ask-cost to the target: intro requests / favors deplete; reciprocity balance and recency raise cost |
| **Money** | configurable $/day | direct spend (tools, travel, investment) |
| **Reputation** | bounded downside | irreversibility × visibility × failure likelihood of the move |

Budgets are founder-set weight-file values (philosophy-compliant), adjustable per day
("today I have 8 hours and one big ask to spend").

### 3.2 Every candidate action carries a cost vector + an expected return

For each candidate action `a` (follow-up, intro request, meeting, proposal, apply, invest):

```
cost(a)   = { time, attention, social, money, reputation }        // 5-vector
return(a) = ExpectedRevenue(a) = p(a) · V(a) · U(a) · (1 + chainMultiplier(a))
```

where `p`, `V`, `U` are the probability, value, and urgency terms from the ExpectedROI
framework (money-denominated), and `chainMultiplier` injects the compounding tail from §2.
Every term is traced.

### 3.3 The allocation is a deterministic constrained optimization

The morning brief is the solution to a **multi-dimensional 0/1 knapsack**:

```
maximize   Σ  return(a) · x(a)
subject to Σ  cost(a, r) · x(a)  ≤  Budget(r)     for each resource r
           x(a) ∈ {0, 1}
```

Knapsack is NP-hard, so we use a **deterministic greedy + bounded-swap heuristic** with a
documented tie-break (by `ExpectedRevenue`, then earliest `dueAt`, then `node_id`) — so it
is reproducible and never a black box. The output is an **ordered sequence** ("do this,
then this") that fits the day's budgets — the literal answer to "if I only worked four
hours, what should I do, in what order?"

### 3.4 Opportunity cost falls out for free

Because resources are finite, each spent unit has a **shadow price** = the expected revenue
of the best action it *displaced*. So Meridian can always state the sacrifice:

> *"Spending your one social-capital ask on the Clipboard intro (EV ≈ $22k) costs you the
> SafetyCulture intro (EV ≈ $14k) you can't also ask for today."*

This is the deterministic engine behind your example:

> *"Sending this follow-up ≈ 18% chance of a $120k opportunity → EV ≈ $21,600 over 6
> months. Not sending it forfeits ≈ $21,600 of expected revenue (decaying to ≈ $9k if
> delayed a month)."*
> where `EV = p·V = 0.18 × 120,000`, and `p`, `V`, decay come from learned priors (§5),
> each shown with its evidence and confidence.

---

## 4. The Daily Revenue Brief (the surface)

The brief is the rendered allocation. For each recommended action it answers your eight
questions, all from the trace — no prose invented by an LLM:

| Question | Source |
|---|---|
| What should I do first? | the allocation's ordered sequence |
| Why? | the stage-transition it causes + chain it advances |
| How much revenue could this create? | `V(a)` (direct + chain tail), as a **range** |
| How confident is the system? | confidence from prior sample size `n` (§6) |
| What evidence supports it? | `provenance`/`evidence` from the graph |
| What happens if I ignore it? | decay of EV over the horizon |
| How long will it take? | `cost(a).time` |
| What is the opportunity cost? | shadow price of the binding resource (§3.4) |

This is a direct generalization of the built `attention_items` view and the already-live
`buildCareerBriefModel()` — the brief now ranks *allocations*, not just items.

---

## 5. Learning Engine (close the loop)

Every recommendation is logged; every realized outcome updates the priors. **Frequentist,
not ML** — counting and rate estimation with confidence from sample size. Reuses the
existing delta logic in `lib/calendar/patternLearning.ts` and the `execution_outcomes`
ledger as ground truth.

What it learns (each a versioned, founder-reviewable weight file):

- **Introduction yield** — which people/sources start chains that convert (updates
  `chainMultiplier`).
- **Follow-up conversion** — by stage and industry (updates `p`).
- **Deal-size priors** — by segment (updates `V`).
- **Velocity** — which industries convert fastest (updates `U`/horizon).
- **Personal habits** — which of *your* actions historically preceded revenue.

Update rule is transparent: `p_new = (conversions + α) / (attempts + α + β)` with a
Beta-style prior; confidence widens or narrows with `n`. Founder can inspect and veto every
weight change. Nothing self-modifies opaquely.

---

## 6. The honesty guardrail (why this doesn't become fantasy math)

Deterministic dollar figures are only as good as their priors, and early on the priors are
thin. The architecture must therefore **treat confidence as a first-class output**:

- Every `p` and `V` carries `n` (evidence count). Low `n` → the brief shows a **range** and
  labels it *"low-evidence estimate (n=3)"*, never a false-precise number.
- When evidence is insufficient, actions surface with a **qualitative** priority and an
  explicit *"needs evidence"* flag rather than a fabricated EV.
- This is the philosophy's "never overstate predictive certainty," enforced structurally.
  The $21,600 is a *decision aid with error bars*, not a promise.

Social capital and reputation are the coarsest proxies; they are deliberately conservative
(bias toward *not* spending them) until outcome data calibrates them. Better to under-ask
than to burn a relationship on a low-confidence guess.

---

## 7. The Ultimate Metric

Success is one number: **revenue created that would not have existed without Meridian.**

It is already half-built: `execution_outcomes` carries `meridian_influenced` (boolean) and
`influence_reason`. Add a **recommendation ledger** (`recommendations` → `outcome_id`)
linking each brief action to the outcome it produced. The metric is then a deterministic
sum of realized value over outcomes that (a) are `meridian_influenced` and (b) trace to a
Meridian recommendation. Every other stat (emails sent, tasks done, contacts added) is
explicitly *not* the metric and must never headline a screen.

---

## 8. Reuse map — what this is built on (not rebuilt)

| New capability | Reuses (already present) |
|---|---|
| Revenue Graph overlay | the built `graph_nodes`/`graph_edges` (Phase 1) |
| Stage-transition value | `execution_outcomes` (realized $) + the graph frontier |
| Revenue chains | path-finder over `graph_edges`; `GENERATED_VALUE` edges |
| Candidate actions | the `attention_items` view (the built seam) |
| ExpectedRevenue math | the `ExpectedROI` framework in the architecture doc |
| Capital-allocation solver | new, but small — a deterministic knapsack over existing candidates |
| Learning engine | `lib/calendar/patternLearning.ts` + `execution_outcomes` |
| Ultimate metric | `execution_outcomes.meridian_influenced` (already exists) + a recommendation ledger |
| Weight files | philosophy's founder-curated weights + `lib/scoring` weights |

**Nothing here is a rebuild.** It is three deterministic projections and one solver, layered
onto the graph that already exists.

---

## 9. Database changes required (additive, later phases)

All additive, all rebuildable from the graph + `execution_outcomes`:

| Object | Purpose |
|---|---|
| `revenue_positions` (view/table) | node → stage, direct/expected/realized value, confidence |
| `revenue_chains` (table) | detected chains: path, realized, expected, multiplier, evidence |
| `resource_budgets` (table) | per-day budgets for the five resources |
| `action_candidates` (view) | candidate actions with cost vector + expected revenue (over `attention_items`) |
| `recommendations` (table) | brief action → linked `outcome_id` (attribution + learning) |
| `capital_weights` (files) | founder-curated priors, budgets, resource weights (versioned) |

---

## 10. Phased evolution (continues from the built Phase 0/1)

- **Phase 2 — Revenue Graph.** Add `revenue_positions`; assign stages; compute
  stage-transition EV. *Exit:* every node knows its place in the chain and its next-stage
  value.
- **Phase 3 — Revenue chains.** Detect and store chains; compute compounding multipliers.
  *Exit:* introductions are valued by their tail, not just their next step.
- **Phase 4 — Capital allocation.** Cost vectors + budgets + the deterministic knapsack.
  Generalize the Command Brief from ranking to allocation, with opportunity cost. *Exit:*
  the four-hour question is answered.
- **Phase 5 — Learning engine.** Recommendation ledger + outcome-driven weight updates +
  confidence surfacing. *Exit:* estimates improve with every logged outcome.
- **Phase 6 — Ultimate-metric dashboard (single number).** Meridian-attributed revenue.
  *Exit:* the system is measured by the only thing that matters.

Each phase ships standalone value, reuses more than it adds, and touches neither the B2B
product nor the built graph's contracts.

---

## 11. Amendment Log

| Date | Author | Change |
|------|--------|--------|
| 2026-07-06 | Chief Architect | Established the Revenue OS: Revenue Graph overlay, revenue chains as first-class compounding assets, the five-resource capital-allocation model (the missing decision layer), the deterministic opportunity-cost/knapsack formulation, the outcome-closed learning engine, and the single Meridian-attributed-revenue metric. Upgraded the governing question to a finite-resource allocation question. All deterministic, all explainable, all layered on the built Opportunity Graph. |

---

> **The discipline this enforces:** Meridian is not a database of relationships that grows
> more sophisticated. It is a system that, every morning, spends five scarce resources where
> they compound into the most future revenue — and tells you exactly what it gave up to do
> so. If it ever stops improving that allocation better than you would alone, it has failed,
> no matter how elegant the graph.
