# MERIDIAN_DECISION_ENGINE.md — The Brain

> **Status:** Canonical and governing. Authored 2026-07-06 by the Chief Architect.
> This is the philosophical brain of Meridian Command. Where it conflicts with the
> other four documents **on philosophy or scope**, this document wins; they remain
> authoritative on implementation detail. It is deliberately shorter than what it
> governs — a brain is constraints, not features.
>
> **The single question every recommendation, feature, and pull request must answer:**
>
> > **"Is this the highest and best use of my professional capital right now?"**
>
> Meridian does not optimize tasks. It optimizes **future optionality**, measured by
> future revenue. It exists to improve the quality of one person's professional
> decisions, every day, for a decade. Everything else is scaffolding.

---

## 0. Assumptions this document rejects

The brain begins by killing bad assumptions — including ones the earlier canon
introduced. These corrections are binding.

1. **Reject false dollar precision.** Meridian ranks **ordinally** (better / worse /
   not now) before it prices **cardinally** (dollar EV). Dollar figures are earned by
   accumulated outcomes, not assumed on day one. Until an estimate has real evidence
   behind it, showing "$21,600" is a lie with a decimal point. *(Corrects
   MERIDIAN_REVENUE_OS.md, which priced everything up front.)*

2. **Reject sunk-cost reuse.** "Reuse first" is a discipline, not a mandate to preserve
   whatever exists. The 59-file relationship-engine is **on probation**: the built
   Phase-1 graph does not depend on it. If it has not demonstrably improved a decision
   by the time revenue chains ship, it is deleted. *(Corrects the reuse framing in
   MERIDIAN_COMMAND_ARCHITECTURE.md.)*

3. **Reject optimizing within the wrong frontier.** Allocating capital perfectly across
   the current opportunity set is worthless if the set itself is wrong. The engine owes
   a periodic **strategic-altitude check** (§3.6), not just tactical allocation.

4. **Reject momentum-chasing as a goal.** Recency is a signal, not a virtue. Momentum is
   balanced against long-term optionality; a system that always does "what's hottest"
   optimizes for a busy week and a poor decade.

5. **Reject organization masquerading as decision quality.** Any surface whose primary
   output is a list to *read* rather than a decision to *make* is suspect. Meridian is
   not a CRM, calendar, tracker, or dashboard. Those are inputs. Decisions are output.

6. **Reject complexity growth.** As intelligence rises, the model must get *simpler*.
   Every added concept must retire one or justify itself against §10's delete budget.

---

## 1. Core operating philosophy

- **The unit of value is a decision, not a record.** Meridian's only job is to make the
  next allocation of your finite professional capital better than you would make alone.
- **Optionality first, revenue as the meter.** The goal is long-term earning *potential*;
  realized revenue is how we keep score and stay honest. A move that opens three future
  paths can beat a move that closes one deal.
- **Deterministic, explainable, founder-reviewable.** Claude (or any model) may generate
  *signals* — parse an email, detect a buying question, draft a message. The **engine
  that decides is always transparent arithmetic** you can audit. No black-box ranking,
  ever.
- **Honest uncertainty beats confident fiction.** Every estimate carries its evidence.
  Low evidence → a range or a qualitative call, never false precision.
- **Simplicity is a feature of intelligence.** The smarter Meridian gets, the fewer
  things it should ask you to look at. The target end-state is: one screen, one ranked
  allocation, each line explained.

---

## 2. The Professional Capital framework

Meridian is built around **five scarce forms of capital**. They are the only
first-class resources. Everything the system tracks must map to one of them or be cut.

| Capital | What it is | **Dynamics** (this governs how the engine treats it) |
|---|---|---|
| **Time** | Hours, energy, focus, availability (absorbs the old "attention") | **Consumable** — resets daily, cannot be banked. Unused ≈ wasted. |
| **Relationship** | Trust, influence, warm paths, referral potential, reputation *with specific people* (absorbs old "social capital" + "reputation") | **Renewable but depletable** — asks spend it; giving value replenishes it. |
| **Momentum** | The live heat of a specific thread — a recruiter who emailed yesterday, a viewed proposal, a warm intro (§4) | **Perishable** — decays whether or not you act. Use-it-or-lose-it. |
| **Knowledge** | Everything learned: patterns that convert, industries, timing, lessons from wins and failures (§6) | **Appreciating** — only grows, compounds, never depletes. |
| **Financial** | Cash, revenue, recurring income, investments, revenue-chain value, CLV | **Storable** — banks over time. The scoreboard. |

**Why the dynamics matter more than the list:** the engine allocates differently per
type. It cannot hoard Time or Momentum (unused = lost), it *invests* to grow
Relationship and Knowledge (spend now for later return), and it *measures* in Financial.
This typology is the whole model — five forms, five behaviors. Anything that doesn't fit
here doesn't belong in Meridian.

*(This supersedes the five-resource list in MERIDIAN_REVENUE_OS.md: "attention" folds
into Time, "money" into Financial, "reputation" into Relationship; Momentum and Knowledge
are promoted to first-class. Net effect: a cleaner ontology, not a bigger one.)*

---

## 3. Decision engine architecture

### 3.1 The one primitive: an Investment

Every recommendation is a single primitive — an **Investment**:

> *Spend* some capital (Time, Relationship, Momentum, Money) → *expected change* in
> capital (primarily Financial, but also Relationship, Knowledge, and future optionality).

"Follow up with Blake," "apply to Oracle," "build TikTok Shop," "continue this coding
task," "learn discovery-call framing" — all are Investments with a cost vector and an
expected return vector. This single primitive is what lets everything compete against
everything.

### 3.2 Every recommendation answers eleven questions (the explanation contract)

No recommendation ships without answers, all drawn from the trace — never LLM prose:

1. **Why now?** — momentum state + decay window + deadline
2. **Why me?** — why this requires *your* capital, not delegable
3. **Why this?** — the capital-stage transition it causes
4. **Why not something else?** — what it outranks, and by what margin (§7)
5. **What evidence supports it?** — provenance from the graph
6. **How confident are we?** — evidence count `n`, shown honestly (§0.1)
7. **What assumptions is it making?** — the priors and exchange rates in play (§3.4)
8. **What capital does it require?** — the cost vector
9. **What capital will it likely create?** — the return vector
10. **What happens if I ignore it?** — decay of expected value over the horizon
11. **What is the opportunity cost?** — the displaced next-best (§9)

### 3.3 Ordinal before cardinal

The engine's default output is a **ranked order**, not a set of dollar amounts. It
answers "is Blake a better investment than Oracle right now?" with a confident yes/no and
a reason, long before it can answer "how many dollars is Blake worth?" Cardinal (dollar)
mode unlocks per capital-class only when that class has enough logged outcomes to price
honestly. This is the single most important discipline in the engine.

### 3.4 Commensuration is explicit, never silent

Comparing across capital classes (Time vs Relationship vs Money) requires **exchange
rates**. These are **founder-set, visible, and versioned** — never inferred silently.
Within a class, comparisons are trustworthy and automatic. Across classes, the brief
shows the exchange rate it used ("today, 1 relationship-ask ≈ 90 minutes of focus") so
you can veto the assumption. Cross-domain comparison is the hardest problem in the
system; the engine's honesty about it is what keeps it trustworthy.

### 3.5 Signals in, decisions out

Models produce **signals** (events): "this email is a buying question," "this person just
became VP." Signals flow into the deterministic engine as evidence with a confidence.
The engine — not the model — computes rank, cost, return, and opportunity cost. This
boundary is inviolable.

### 3.6 The strategic-altitude check (the frontier question)

Tactical allocation optimizes *within* your opportunity set. On a slower cadence (weekly
or monthly), the engine must ask the **frontier question**: *is the opportunity set
itself right?* Are you in the highest-earning market? Is your positioning/pricing the
constraint? Is a whole category of Investment (a new skill, a new audience) missing? This
is deliberately low-frequency and high-altitude — it prevents the system from perfectly
optimizing the wrong game. Without it, Meridian is a very smart way to run faster in the
wrong direction.

---

## 4. Momentum engine

Momentum is a **first-class object, not a score column.** It is the only capital that
decays on its own, which is why wasting it is a real and common loss.

- **Accrual:** momentum on a thread (a person, opportunity, or chain) rises on observed
  events — a reply, a meeting, a proposal view, an interview advance, an introduction, a
  mention in the news.
- **Decay:** momentum falls continuously with time since the last event
  (exponential decay; hotter threads decay faster if neglected). This is deterministic
  and needs no action to update — time alone cools a thread.
- **The waste signal:** when a high-momentum thread is decaying with no scheduled action,
  the engine flags *"momentum being wasted here."* This is one of the highest-value alerts
  the system produces, because perishable capital is being lost for free.
- **The anti-trap rule:** momentum raises an Investment's *urgency*, not its *underlying
  value*. A hot thread to a low-value opportunity does not beat a cool thread to a
  high-value one — it only means *if* you pursue it, do it now. Momentum sequences the
  day; it does not choose the day's goals. This is what keeps the momentum engine from
  turning Meridian into a reactivity machine.

---

## 5. Revenue chain model

Relationships compound. Meridian models the compounding explicitly.

- A **revenue chain** is one asset, not a sequence of events: *Blake → Josh → Company A →
  Customer B → Investor C → funds Meridian.*
- **The value of a relationship includes its downstream tail.** An introduction from
  someone whose chains historically spawn further opportunities is valued by that
  discounted tail — which is why an intro can rightly outrank a nearer proposal.
- **Chains are identified, preserved, strengthened, and grown** as first-class assets
  (detected by walking the graph; valued from attributed outcomes).
- **Discipline:** chain value is estimated *conservatively* and ordinally until outcomes
  confirm the multiplier. An imagined six-link chain to "Investor D funds Meridian" is a
  hypothesis, not an asset, until links realize. The engine must not let a seductive
  hypothetical chain dominate the brief on speculation alone.

---

## 6. Learning engine

Every completed action should make Meridian better — *eventually*. Honesty about the data
problem is part of the design.

- **Ground truth:** the `execution_outcomes` ledger (already built) — which Investment
  produced which capital change.
- **What it learns:** introduction yield, follow-up conversion by stage/industry, deal-size
  priors, conversion velocity, which people repeatedly create opportunities, which of
  *your* habits precede revenue, and which decisions underperform.
- **Method:** frequentist rate estimation with confidence from sample size (Beta-style
  priors). **Not ML, not black-box.** Every weight is a versioned, founder-reviewable file.
- **The data-starvation caveat (binding):** a solo professional produces few outcomes per
  quarter. For a long time the learning engine leans on *priors and structural reasoning*,
  and it must **say so** — surfacing "low evidence" rather than pretending to have learned.
  Do not build elaborate learning machinery that has nothing to learn from. Learning grows
  in from the edges as `n` accumulates; it is not switched on fully-formed.

---

## 7. Capital allocation engine

This is where everything competes. The morning output is not a list of good ideas — it is
an **allocation of finite capital under constraint.**

- **The arena:** all candidate Investments compete in one ranked contest. "Follow up with
  Blake" competes against "apply to Oracle," "improve OwnerLM," and "keep coding."
- **The mechanism:** given today's budgets (Time, Relationship-asks, Money, and the
  perishable Momentum in play), select the ordered set of Investments that maximizes
  expected future capital — a deterministic, ordinal-first constrained allocation (a
  knapsack heuristic with a documented tie-break). It respects each capital's dynamics
  from §2 (never hoards Time/Momentum; permits investing in Relationship/Knowledge for
  later return).
- **The output is a sequence**, not a pile: "do this, then this" — the literal answer to
  *"if I only had four hours, what order maximizes future earning potential?"*
- **Every line states what it beat and what it cost you** (§9).

---

## 8. Daily Brief philosophy

The brief is the rendered allocation. It has a hard spec — what it must show and, more
importantly, what it must **never** show.

**Must answer, in order:**
- What changed overnight? (new signals, momentum shifts)
- Where is momentum rising? Where is it fading or being wasted?
- Which relationship / company / opportunity / product / learning deserves attention?
- **What is the single highest-leverage action today, and why does it beat the alternatives?**
- If I only worked four hours, what *sequence* maximizes future earning potential?

**Must never show:**
- Tasks completed, emails sent, meetings attended, contacts added — vanity metrics that
  measure motion, not decision quality.
- Undifferentiated lists you have to triage yourself. If Meridian hands you a list to sort,
  it did your job's opposite. It ranks; you decide; it explains.
- More than a handful of things. The brief's quality is inversely related to its length.

---

## 9. Opportunity cost framework

Because capital is finite, **every recommendation states its sacrifice.** This is
non-negotiable and is what separates Meridian from a to-do list.

- Each unit of a binding resource has a **shadow price** = the expected value of the
  best Investment it displaced.
- The brief always names the trade: *"Spending today's one relationship-ask on Blake means
  not asking Preston — the next-best use of that ask."*
- Stated ordinally first ("Blake > Preston > Chandler for your one ask today"), with dollar
  framing only once evidence supports it.
- **Ignoring** is itself an Investment (of Time saved) with its own cost — the decayed
  value of what you didn't act on. The brief shows the cost of inaction, not just action.

---

## 10. Guardrails against feature creep

The system must get **simpler** as it gets smarter. These are enforced, not aspirational.

- **The Simplicity Law.** Net conceptual complexity may not increase unless the
  decision-quality gain provably outweighs it. Adding a concept is a cost, not a feature.
- **The Delete Budget.** Every PR that adds a surface, table, or concept must name what it
  removes — or explicitly justify the exception in the PR description. Additions default to
  requiring a subtraction.
- **The Organization Trap test.** If a feature's primary output is something you *read*
  (a view, a record, a log) rather than a *decision it changes*, it is presumed dead on
  arrival. Prove it alters an allocation or cut it.
- **No metric theater.** Only the single ultimate metric — *revenue created that would not
  exist without Meridian* — may headline. No secondary vanity counters.
- **One brain, one brief, one graph.** Resist every temptation to add a second dashboard,
  a parallel model, or a "just this once" special surface. The audit found five fragmented
  briefs; the mandate is to converge to one, never re-fragment.
- **Probation for the unproven.** Any module that exists but has never changed a decision
  (today: the relationship-engine skeleton) is on a deletion clock, not a preservation list.

---

## 11. How every future feature is evaluated

One test, applied ruthlessly:

> **"Does this measurably improve the quality of a capital-allocation decision — as
> measured by future revenue — more than the simplest alternative, and is that gain worth
> the complexity it adds?"**

Scoring a proposal:
1. **Which capital decision does it improve?** (Name it. "None" → reject.)
2. **How does it change the ranked allocation?** (If it doesn't, it's organization → reject.)
3. **What is the simplest version that captures 80%?** (Build that, not the ambitious one.)
4. **What does it cost in standing complexity?** (Against the Delete Budget.)
5. **Is it deterministic and explainable?** (If it hides reasoning → reject.)
6. **Does it degrade honestly under low evidence?** (If it fabricates confidence → reject.)

A feature that cannot name the decision it improves does not get built — no matter how
interesting it is.

---

## 12. Questions every pull request must answer before merge

A PR cannot merge until its description answers **yes** (or a justified exception) to all:

1. **Decision link:** Which capital-allocation decision does this improve, and how?
2. **Revenue path:** How does it increase earning potential, directly or indirectly?
3. **Ranking impact:** Does it change what the brief recommends or in what order? (If not,
   why does it exist?)
4. **Determinism:** Is every score/decision explainable and free of black-box reasoning?
5. **Honesty:** Does it show confidence/evidence and degrade to ordinal/qualitative when
   `n` is low?
6. **Opportunity cost:** If it surfaces a recommendation, does it state what that beats and
   costs?
7. **Simplicity / Delete Budget:** What does it remove or simplify? If nothing, what is the
   exception?
8. **Organization Trap:** Is the primary output a decision, not just a display?
9. **Guardrail check:** Does it avoid becoming a CRM/calendar/tracker/second-dashboard?
10. **The final question:** Does this help answer *"Is this the highest and best use of my
    professional capital right now?"* — for real, not in theory?

If a PR cannot answer these, it is not ready, regardless of how much work it represents.

---

## 13. Amendment Log

| Date | Author | Change |
|------|--------|--------|
| 2026-07-06 | Chief Architect | Established the governing brain. Rejected false dollar precision (ordinal before cardinal), sunk-cost reuse, within-frontier tunnel vision, momentum-chasing, and complexity growth. Defined the five capital forms **by their dynamics**, the single Investment primitive, the eleven-question explanation contract, explicit commensuration, the strategic-altitude check, the anti-trap momentum law, conservative chain valuation, data-starvation honesty for learning, the ordinal-first allocation engine, the Daily Brief's must-never-show list, the opportunity-cost mandate, and the feature/PR gates. Net direction: fewer concepts, sharper focus, simpler as it gets smarter. |

---

> **The standard this document is held to:** not how many capabilities Meridian gains, but
> how ruthlessly it stays focused on one thing — allocating five forms of scarce capital
> toward the most future revenue, and telling you exactly what each choice costs. If a
> future version is more complex but not more decisive, it has regressed. Every feature
> must earn its place against the only question that matters: *is this the highest and best
> use of my professional capital right now?*
