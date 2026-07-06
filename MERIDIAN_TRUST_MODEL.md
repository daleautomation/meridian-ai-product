# MERIDIAN_TRUST_MODEL.md — The Highest Law

> **Status:** Highest canonical document. Supersedes all others where they conflict.
> **Nothing in Meridian may recommend an action unless it satisfies this document.**
> Authored 2026-07-06 by the Chief Architect.
>
> The other five documents describe what Meridian *can* build. This one decides what
> Meridian is *allowed* to say. It is a gate, not a blueprint — and it deletes more
> than it adds.
>
> **The purpose of Meridian is not to appear intelligent. It is to become consistently
> trustworthy.** Success is one feeling, every morning:
>
> > *"I understand exactly why Meridian told me to do this."*

---

## 1. The real product

Meridian is **not** a graph, a CRM, a dashboard, or a revenue tracker. It is an
**Adaptive Decision Engine**. Revenue is merely *today's objective function* — a
pluggable target, not the architecture. Tomorrow the same engine could optimize another
domain by swapping the objective. Do not overfit anything to revenue.

Because the engine is objective-agnostic, its trustworthiness cannot come from
revenue-specific cleverness. It can only come from one thing: **a track record of
beliefs that turned out to be right, honestly kept.**

---

## 2. The whole system, collapsed to one loop

Every document we have written reduces to this. There are five nouns and one loop.
Anything that is not one of these five nouns, or does not serve the loop, is deleted.

```
   OBSERVATION  →  BELIEF  →  RECOMMENDATION  →  OUTCOME  →  CALIBRATION  ↺
   (a fact,       (a claim    (a belief that     (what      (belief vs outcome →
    with           with        passed the         actually    earned confidence,
    provenance)    evidence)   Trust Contract)    happened)   tuned priors)
```

- **Observation** — a fact with a source (the built graph + `source_records`).
- **Belief** — a deterministic claim derived from observations, with evidence, a
  rank/probability, a confidence, and a change log (§4).
- **Recommendation** — the top belief about what to *do*, released only if it passes the
  Trust Contract (§6).
- **Outcome** — what happened (the built `execution_outcomes` ledger).
- **Calibration** — belief measured against outcome; this is the only thing that earns
  confidence (§7).

**What this collapse deletes as standalone subsystems:** the momentum engine, capital
engine, revenue-chain engine, and learning engine are **not subsystems** — they are
belief-generating or belief-adjusting functions inside this one loop. The graph is not
the product — it is where observations are stored. Naming them as engines added concepts
without adding trust. They are folded in.

---

## 3. The attack — what every existing document must survive

Applied ruthlessly. Verdicts are binding until amended.

| Subsystem (source doc) | Verdict | Reason |
|---|---|---|
| Opportunity Graph, built Phase 0/1 (`OPPORTUNITY_GRAPH_PHASE_0_1`) | **Keep — as infrastructure** | It stores observations with provenance. Necessary; not the product. |
| `execution_outcomes` ledger (audit) | **Keep — promote to critical** | Ground truth for calibration. Without it, trust is impossible. |
| Belief + Change Log | **Keep — make it the core output** | Legible, falsifiable reasoning is the highest-trust mechanism we have. |
| Deterministic scoring (`lib/scoring`, `recovery`, `resurfacing`) | **Keep — as belief functions** | Reusable, explainable. They generate beliefs; they are not "engines." |
| Capital-allocation knapsack (`REVENUE_OS`) | **Defer → replace with sorting** | You do not need multi-dimensional optimization to order five actions. Over-engineering. |
| Dollar EV / opportunity cost in dollars (`REVENUE_OS`) | **Defer behind calibration** | False precision until predictions are scored. Ordinal only, for now. |
| Revenue chains, multi-hop valuation (`REVENUE_OS`) | **Defer** | A speculative chain is a hypothesis, not an asset. |
| Momentum / Knowledge / Relationship "engines" (`DECISION_ENGINE`) | **Fold into belief inputs** | Features that move a rank, not subsystems. Removes three concepts. |
| Learning engine (`DECISION_ENGINE`, `REVENUE_OS`) | **Fold into Calibration** | Data-starved; it *is* the calibration loop, nothing more. |
| Probability propagation, naive (this doc's own brief) | **Reject** | Multiplying probabilities across a sparse graph fabricates confidence. Replaced by §5. |
| 59-file relationship-engine (`audit`) | **Delete** | Off probation. The built graph never uses it; it has never changed a decision. |

**Net effect: fewer concepts, not more.** The trust model introduces Belief, Calibration,
and the Trust Contract, and in exchange retires four "engines," the knapsack, dollar math,
multi-hop chains, and a 59-file module.

---

## 4. The Belief system (the missing layer)

The graph stored entities, relationships, and opportunities. It did not store **belief** —
and belief is what a person actually trusts or distrusts. This is the new core.

A **Belief** is a deterministic object:

```
Belief {
  subject           // a node or a candidate action
  claim             // "Blake is the highest-value relationship action today"
  rank / probability// ordinal position (cardinal only once calibrated, §7)
  evidence[]        // observations, each with provenance
  assumptions[]     // priors and exchange rates used, made explicit
  confidence        // tier from evidence count + calibration (§7)
  changeLog[]       // WHY this belief moved since last time (below)
  falsifier         // "what would change our mind" — the observation that would most
                    // lower this rank
}
```

Two things make a belief trustworthy, and both are mandatory:

- **The Change Log.** Every belief carries the *diff* of why it moved. Not just an
  explanation — a change history:
  > *"Blake: #4 → #1. Changed by three observations: (1) Blake replied 2h ago
  > [momentum ↑]; (2) Blake is now connected to Company A's hiring manager [new warm
  > path]; (3) the Chandler thread went cold 9 days [Chandler ↓]."*
  If Meridian cannot say *what changed*, it has not earned the right to change its
  recommendation.

- **The Falsifier.** Every belief names the single observation that would most weaken it
  (*"if Blake doesn't reply by Thursday, this drops below Preston"*). A belief that cannot
  be falsified is faith, not reasoning, and may not drive a recommendation.

---

## 5. Probability, propagation, and optionality — honestly

Relationships are uncertain, and it is tempting to propagate probability through the
graph. **Naive multi-hop propagation is rejected**: multiplying uncertain edge
probabilities across a sparse, data-starved graph yields tiny numbers with false
confidence — the exact opposite of trust. In its place, three honest mechanisms:

1. **Single-hop, evidenced only.** Probability propagates one hop, and only across edges
   with real evidence. Anything beyond one hop is labeled **"possible path,
   unquantified"** — surfaced, never scored.
2. **Optionality = reachability count, not probability.** "Which introductions increase
   optionality?" is answered as *how many high-value nodes this makes newly reachable
   within one or two hops* — a count you can verify, not a percentage you cannot.
3. **Uncertainty reduction = information value.** "Which relationships reduce
   uncertainty?" is answered as *which single observation would most tighten a top
   belief's confidence* — deterministic, and directly useful for choosing what to do next.

This keeps the graph's uncertainty legible instead of impressive.

---

## 6. The Trust Contract (permission to recommend)

**Meridian may not recommend an action unless the belief behind it can produce all six.**
If any is missing, it does not recommend — it says "watch" or "I don't know" (§8).

1. **Belief** — a clear claim and its rank.
2. **Evidence** — observations with provenance, deterministically combined.
3. **Change Log** — what moved this since last time (or "new belief, first seen").
4. **Confidence** — an honest tier from evidence and calibration, not a vibe.
5. **Opportunity cost** — what this beats and what choosing it forfeits.
6. **Falsifier** — what would change our mind tomorrow.

A recommendation is a belief that cleared this bar. Nothing else may appear as a
recommendation — no matter how sophisticated the function that produced it.

---

## 7. Earned confidence — the calibration ledger

**Trust is earned by being scored, not by being clever.** Meridian keeps a calibration
ledger: every belief it acted on is later checked against the outcome. This produces the
only honest basis for confidence.

- **Three confidence tiers, and what each unlocks:**
  - **Suggestive** — structural priors only, little evidence. May *surface* (WATCH), may
    not *recommend*. Ordinal only.
  - **Evidenced** — enough observations to rank with a stated margin. May recommend,
    ordinally.
  - **Calibrated** — this *kind* of belief has been scored against real outcomes and held
    up. Only Calibrated beliefs earn cardinal (dollar/probability) framing.
- **Meridian shows its own record.** "Of the last 20 high-confidence calls, 14 played
  out." A system accountable for its past predictions is one you can trust with the next;
  a system that hides its hit rate cannot be.
- **Confidence grows only with the track record**, never by assertion. Early on, almost
  everything is Suggestive — and Meridian says so.

---

## 8. The "I don't know" doctrine

The willingness to abstain is the source of trust, not a weakness in it.

- **Three output states, always:** **RECOMMEND** (act now), **WATCH** (surface, don't
  push), **UNKNOWN** (insufficient basis — say so plainly).
- Meridian says **"I don't know"** when: evidence is below threshold, the margin between
  #1 and #2 is within noise, the belief has no falsifier, or the required exchange rate is
  a pure guess.
- **How uncertainty is communicated:** ranges over point estimates; "low evidence (n=3)"
  labels; "possible path, unquantified" for unproven chains; and an explicit UNKNOWN
  rather than a hedged recommendation.
- **How much evidence is enough:** enough to (a) rank #1 above #2 with a stated margin and
  (b) produce all six Trust Contract elements. Below that, WATCH — never RECOMMEND.

A day where Meridian honestly says "nothing here clears the bar — here's what I'm
watching" builds more trust than a day of confident guesses.

---

## 9. Earned Complexity (why the system stays simple)

**Complexity is unlocked by evidence, not by design.** Each capability is gated behind a
proven track record of the simpler one beneath it:

```
ordinal ranking  →  (calibrated?)  →  cardinal estimates
single-node beliefs → (calibrated?) → single-hop propagation
realized 1-hop chains → (observed?) → multi-hop chain valuation
```

You do not get probability propagation until single-node beliefs are calibrated. You do
not get dollar EV until ordinal ranks are calibrated. You do not get multi-hop chains
until one-hop chains have actually realized. This is what makes Meridian **simpler as it
gets smarter**: intelligence is added only where trust has already been earned, so the
system is never more complex than its evidence justifies.

---

## 10. The Simplicity Test (run on every subsystem, forever)

For every subsystem, score, graph, engine, and feature — existing or proposed — ask:

1. **Could this be removed?**
2. **Would Meridian make *worse decisions* without it?** (Not "would we lose data" —
   *worse decisions*.)
3. If the honest answer to #2 is no → **delete it.**

An abstraction that does not change a decision is decoration. This test outranks every
other consideration, including reuse and sunk cost.

---

## 11. What this document deletes or defers now

Binding, effective immediately:

- **Delete** the 59-file relationship-engine and `relationshipEngineFeed.ts`.
- **Defer** dollar EV, opportunity cost in dollars, the capital-allocation knapsack, and
  multi-hop revenue-chain valuation until the Calibration ledger promotes beliefs to
  **Calibrated**.
- **Fold** momentum, knowledge, relationship, and learning "engines" into belief
  inputs/calibration — remove them as standalone concepts.
- **Do not build** probability propagation beyond a single evidenced hop.
- **Reframe** the graph in all docs as infrastructure, not the product.

---

## 12. How every future feature and recommendation is judged

The single gate, above the feature test and the PR gate in the other docs:

> **A subsystem may exist only if it makes a recommendation more trustworthy — more
> evidenced, more legible, more calibrated, or more honestly uncertain. If it makes
> Meridian look smarter without making its decisions more trustworthy, it is deleted.**

And the final check on every recommendation Meridian emits:

> **Would this make me think, "I understand exactly why Meridian told me to do this"?**
> If not, it does not ship. That sentence is the product.

---

## 13. Amendment Log

| Date | Author | Change |
|------|--------|--------|
| 2026-07-06 | Chief Architect | Established the highest law. Reframed Meridian as an objective-agnostic Adaptive Decision Engine (revenue is a pluggable target). Collapsed the entire architecture to one loop and five nouns. Introduced the deterministic Belief system with mandatory Change Log and Falsifier. Rejected naive probability propagation in favor of single-hop/optionality-as-reachability/information-value. Defined the six-part Trust Contract as the permission gate for any recommendation, the calibration ledger as the only source of earned confidence, the three output states (RECOMMEND/WATCH/UNKNOWN), and Earned Complexity (capabilities unlocked by evidence, not design). Deleted the relationship-engine; deferred dollar math, the knapsack, and multi-hop chains; folded four "engines" into the loop. Net: fewer concepts, and simpler as it grows. |

---

> **The standard:** Meridian earns trust the way a person does — by being right, admitting
> when it isn't sure, showing its reasoning, and being accountable for its past calls.
> Not once. Every day. When this is true, you will trust it more than your own intuition —
> not because it is clever, but because you can always see exactly why it is right.
