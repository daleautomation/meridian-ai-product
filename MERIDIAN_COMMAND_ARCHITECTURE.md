# MERIDIAN_COMMAND_ARCHITECTURE.md — The Intelligence Layer

> **Status:** Canonical design. Authored 2026-07-06 by the Chief Architect.
> Companion to [`MERIDIAN_AUDIT.md`](./MERIDIAN_AUDIT.md) (the constitution).
>
> **What this document is:** the architecture of the intelligence layer that sits
> *above* every existing module and answers one question continuously:
>
> > **"What creates the highest expected ROI over the next day, week, month, and
> > quarter?"**
>
> **What this document is NOT:** a rebuild. Every component below maps to code
> that already exists in this repository. The design is an *evolution*, not a
> replacement. Where I introduce something new, I name the exact existing module
> it extends.

---

## 0. The one idea

**Meridian Command is not a CRM because a CRM is centered on accounts. Meridian
is centered on *you*.**

Everything becomes a **node** in a single **Opportunity Graph**. There is one
distinguished node — **`self` (Dylan)** — and *every score in the system is
computed relative to that node*. "Strategic importance" means *importance to your
revenue*, not global importance. "Reachability" means *reachability from you*.
Every path is rooted at you. This single decision is what turns a networking map
(a visualization) into an opportunity engine (a compounding system).

The graph is a **deterministic projection over an append-only event log.** It is
replayable, explainable, and never black-box — exactly the philosophy in
`docs/meridian-philosophy.md`. The "AI" lives at the edges (an external Claude
agent that reads your Gmail/LinkedIn/Granola and *emits events*), never in the
scoring.

```
   Observations (email, calendar, meetings, notes, web)
        │  emitted as events by an external Claude agent (via MCP)
        ▼
   ┌─────────────────────────────────────────────┐
   │  EVENT LOG  (append-only, source of truth)   │  ← domain_events (exists, dormant)
   └───────────────────┬─────────────────────────┘
                       │  deterministic projections (replayable)
        ┌──────────────┼───────────────┬──────────────────┐
        ▼              ▼               ▼                  ▼
   OPPORTUNITY     NODE SCORES    INFERRED           NOTIFICATIONS
     GRAPH        (traced 0-100)  OPPORTUNITIES      (EV-thresholded)
   nodes+edges                    (graph patterns)
        │              │               │                  │
        └──────────────┴───────┬───────┴──────────────────┘
                               ▼
                  REVENUE OPTIMIZATION ENGINE
                  ExpectedROI(action) ranker
                               │
                               ▼
                   DAILY COMMAND BRIEF  ← generalizes career-brief.ts
                   (argmax ExpectedROI per category, with traces)
```

---

## 1. Opportunity Graph Architecture

### 1.1 The graph is a projection, not a new database

The audit found `domain_events` (an append-only event stream table) already
defined in `db/schema/phase1-neon.sql` and a 59-file projection/read-model
engine in `lib/relationship-engine/` that returns empty data. **The graph is the
projection that engine was always waiting for.**

- **Source of truth:** the event log. Every fact enters as an immutable event
  (`PERSON_OBSERVED`, `EMAIL_EXCHANGED`, `MEETING_HELD`, `EMPLOYMENT_CHANGED`,
  `INTRODUCTION_MADE`, `REVENUE_ATTRIBUTED`, `NOTE_ADDED`, `PROFILE_VIEWED`…).
- **The graph (`nodes` + `edges`) is a materialized view** rebuilt by replaying
  events. Delete the graph, replay the log, get the identical graph. This is what
  makes it deterministic and auditable.

This reuses, rather than rebuilds, the exact architecture already scaffolded:
timeline normalizers, feed/queue read-models, the boundary facade, and the
projection contracts in `lib/relationship-engine/`.

### 1.2 Node taxonomy

Every object becomes a typed node with a stable `nodeId`, a `nodeType`, canonical
attributes, and **provenance** (which events produced each attribute).

| Node type | Backed today by | Notes |
|---|---|---|
| `self` | `ownerId="dylan"` | The one distinguished node. All scores relative to it. |
| `Person` | `CrmContactRecord`, email/meeting participants | Identity-resolved (see §1.4). |
| `Company` | `CompanySnapshot` (72 exist), `companyKey` | `companyKey` is *already* a node ID. |
| `JobOpportunity` | `JobOpportunity` (`data/ae-jobs/opportunities.json`) | Already live. |
| `Prospect` / `Customer` | `CompanySnapshot.status`, CRM contacts | A status/edge on a Company or Person, not a new store. |
| `Meeting` / `CalendarEvent` | `CareerCalendarEvent`, `CrmActivity`-derived events | Already modeled with reminders. |
| `Conversation` / `Email` | new event types over Gmail (agent-emitted) | Thin nodes; mostly evidence for edges. |
| `Task` / `FollowUp` | `FollowUpTask` (`lib/state/followUpStore.ts`) | Already an intent model. |
| `RevenueStream` | new | Recurring vs one-off; the accumulation targets. |
| `Product` / `Project` / `Idea` | new (lightweight) | Sources of value; link to revenue streams. |
| `Skill` / `Community` / `Document` | new (lightweight) | Career-value and access inputs. |
| `Introduction` | `INTRODUCTION_MADE` events | First-class because referrals compound. |

**Design rule:** most "new" node types are *thin* — a row + edges — because their
value is relational. Do not build a heavy sub-app per node type. That was the
Era-1 mistake (see audit: the 59-file engine with no data).

### 1.3 Edge taxonomy

Edges are the product. Each edge carries: `type`, `direction`, `weight`,
`evidence[]` (event IDs), `firstObservedAt`, `lastObservedAt`, and a **decay
policy** (edges age; a meeting from 2 years ago is weaker than one last week).

| Edge type | Example | Derived from |
|---|---|---|
| `KNOWS` | Blake — Josh | co-occurrence in meetings/emails/explicit |
| `WORKS_AT` / `WORKED_AT` | Josh → OwnerLM | employment events (current vs past) |
| `INTRODUCED` | Blake → (Josh, me) | `INTRODUCTION_MADE` |
| `REPORTS_TO` / `DECISION_FOR` | VP Sales → account | title + org signals |
| `SERVES` / `SELLS_TO` | OwnerLM → contractors | company-segment edges |
| `ATTENDED` | Person → Conference | calendar/community events |
| `CHAMPIONS` | Customer → me | positive interaction + referral history |
| `GENERATED_REVENUE` | Person/Company → RevenueStream | `REVENUE_ATTRIBUTED` |
| `PATH_TO` (derived) | me → … → target account | computed by path-finder (§6) |

The chain in your brief — *Blake KNOWS Josh; Josh WORKS_AT OwnerLM; OwnerLM
SERVES contractors; contractors USE Clue; Clue SELLS_TO fleet managers* — is
literally a path query over these edges. Making that path *visible and scored* is
the networking engine (§6).

### 1.4 Identity resolution (the layer that fixes the audit's #1 data flaw)

The audit found three **disjoint keyspaces** (CRM contacts ↔ activities ↔
snapshots don't join). The graph's identity-resolution layer is the fix, and it
reuses existing code:

- A `node_identities` table maps raw handles (email, phone, LinkedIn URL, name +
  company) → canonical `nodeId`.
- Resolution logic **reuses `lib/contacts/*`** (Google Places, Hunter.io, the
  precedence rules in `docs/SOURCE_PRIORITY.md`) — it already resolves and
  de-dupes contacts with trust scoring.
- Merges are deterministic and reversible (an event, `IDENTITIES_MERGED`, that
  can be replayed or undone).

**This is the missing join that turns four data islands into one graph.**

---

## 2. Relationship Intelligence Architecture

Every relationship-intelligence question you listed is a **deterministic derived
metric over the event log + graph** — no inference of feelings, only observable
signals (philosophy-compliant).

| Question | Deterministic derivation | Reuses |
|---|---|---|
| Who introduced whom | `INTRODUCED` edges | new event, thin |
| Who has influence | graph centrality (degree/betweenness, weighted) | new projection |
| Who responds quickly | median response latency from email/meeting events | new signal |
| Who creates revenue | Σ downstream `GENERATED_REVENUE` reachable via their edges | `execution_outcomes` (attribution) |
| Who creates referrals | count of `INTRODUCED` edges that led to opportunities | inference (§5) |
| Who changes companies often | count of `EMPLOYMENT_CHANGED` events | new signal |
| Who has decision authority | title/role signals + `DECISION_FOR` edges | `lib/scoring` role logic |
| Who has gone inactive | recency of last interaction event | `lib/recovery/staleness.ts` |
| Who to re-engage | resurfacing buckets | `lib/relationship-intelligence/resurfacing.ts` (exists!) |
| Who is rising/falling in importance | **Momentum** = signed Δ of importance over trailing window | `lib/calendar/patternLearning.ts` (delta logic) |
| Who is becoming a hiring manager | `EMPLOYMENT_CHANGED` toward hiring titles | new rule |
| Who has overlapping connections | shared-neighbor count in the graph | new projection |

**Key point:** these are not features to build one by one. They are all *columns
in the `node_scores` projection*, each a pure function with a trace. The
resurfacing engine and staleness logic that already exist are the template.

---

## 3. Deterministic Scoring Framework

Scores are layered. **Every score is a pure function that emits a trace** —
`{value, contributingSignals[], weightsUsed, formulaVersion}` — reusing the
traced-scoring pattern already in `lib/recovery/decisionScore.ts` (3 binary
signals × 33 pts) and `lib/relationship-engine/scoring/healthScoreTrace.ts`.

Weights live in **small, founder-curated weight files** — exactly the calibration
mechanism the philosophy already mandates ("nothing more than founder-curated
weight files").

### Layer 1 — Signals (observed, from events)
`lastInteractionAt`, `interactions90d`, `medianResponseHours`, `reciprocityRatio`,
`title`, `attributedRevenue`, `sharedNeighbors`, `companyChanges`, `profileViews`,
`warmPathCount`, `dealStage`, `dueDate`, `segment`.

### Layer 2 — Node scores (0–100, relative to `self`)
| Score | Definition (deterministic) |
|---|---|
| **Relationship Strength** | recency × frequency × reciprocity × depth |
| **Response Probability** | historical response rate × recency, penalized by latency |
| **Trust Score** | evidence quality × verified-contact × interaction history × mutual connections |
| **Accessibility** | max(direct-channel presence, best warm-path warmth) × response prob |
| **Momentum** | signed derivative of importance over trailing window |
| **Strategic Importance** | revenue proximity × decision authority × centrality |
| **Referral Value** | out-degree into target segments × past referral conversion rate |

### Layer 3 — Opportunity scores (per candidate opportunity)
| Score | Definition |
|---|---|
| **Revenue Potential** | expected $ = deal-size prior × segment multiplier × stage factor |
| **Urgency** | window-closing signals + due dates + decay (higher = sooner) |
| **Career Value** | role uplift × comp delta × skill/network compounding |
| **Sales Value** | revenue potential × close probability |
| **Long-Term Value** | recurring-revenue weight × relationship durability × compounding |

### Layer 4 — The apex: **Expected ROI** (the single ranker)

Everything the system recommends is an **action** (follow up, ask for an intro,
apply, schedule, propose). Every action gets one comparable scalar:

```
                    V(o) · P(a) · U(o) · S(o)
  ExpectedROI(a) = ───────────────────────────
                            E(a)

  V(o) = Revenue Potential of the target opportunity   (normalized $, long-term-weighted)
  P(a) = success probability
       = ResponseProbability(target) · PathWarmth(a) · StageConversionPrior(o)
  U(o) = 1 + Urgency(o)          (time-sensitive actions rank up)
  S(o) = 1 + StrategicImportance weight   (compounding / durable value)
  E(a) = your effort estimate    (time cost, normalized; cheap actions rank up)
```

- Output is a comparable number **with a full trace** — you always see *why* one
  action outranks another.
- This is not new math — it is a **money-denominated generalization of the
  composite already in `lib/ae-jobs/career-brief.ts`** (`priorityScore*100 +
  STAGE_RANK*10 + dueScore*5 + actionableScore`) and `lib/scoring/decision.ts`.
- **Horizons** (day/week/month/quarter) are produced by re-parameterizing `U`
  and the value-realization window: the "revenue this week" ranking weights
  near-term conversion; the "quarter" ranking weights `LongTermValue` and
  pipeline velocity. Same formula, four lenses.

**Constitutional guardrail:** Expected ROI is deterministic and traced. No model
ever *produces a score*. A model may only *emit a signal event* (e.g., "this
email looks like a buying question"), which then flows through the same
transparent formula.

---

## 4. Revenue Optimization Engine

This is the orchestrator that turns scores into a ranked action queue.

1. **Candidate generation** — enumerate all possible actions from the graph:
   every follow-up due, every warm intro path to a target account, every job
   opportunity stage-advance, every dormant high-value relationship, every
   inferred opportunity (§5).
2. **Score each candidate** with `ExpectedROI` across all four horizons.
3. **Diversify** — the top of the list should not be ten variations of one deal.
   Apply a deterministic category cap (reuse the "max 5, evidence-gated" pattern
   from `lib/calendar/insightEngine.ts`).
4. **Explain** — attach the trace and a `whyNow` sentence (reuse
   `lib/recovery/whyNow.ts`).
5. **Emit** the ranked queue to the Daily Command Brief and the notification
   projection.

The engine is a scheduled projection (the daily job), not a live per-request
computation — cheap, cacheable, replayable.

---

## 5. Opportunity Inference Engine

Inferred opportunities are **deterministic graph-pattern matchers.** Each rule is
a named query that scans the graph and, when a pattern matches, emits an
`InferredOpportunity` node with an evidence trace. This reuses the *bucket-rule*
shape of `lib/relationship-intelligence/resurfacing.ts` (which already emits
6 named buckets like `forgotten_high_value`, `dormant_high_frequency`).

| Inference rule | Graph pattern | Emits |
|---|---|---|
| Coworkers reconverged | ≥3 nodes sharing a past `WORKED_AT` now sharing a current `WORKS_AT` | warm cluster opportunity |
| Network hire cluster | Company gains ≥2 new `WORKS_AT` edges from your 1st-degree | warm account opportunity |
| Rising decision-maker | `EMPLOYMENT_CHANGED` → decision title (VP Sales, Head of…) | re-engage + ask opportunity |
| Lost customer moved | Person tagged `lost_customer` + new `WORKS_AT` → fresh company | new-account opportunity |
| Converging hiring manager | Hiring node's shared-neighbor count crosses threshold | referral-path job opportunity |
| Customer bridges to target | Current customer `KNOWS` someone in a target account | warm-intro sales opportunity |
| Recruiter surge | Repeated `PROFILE_VIEWED` from a recruiter node | career opportunity |
| Friend enters your market | 1st-degree `WORKS_AT` a startup in your target segment | partnership/referral opportunity |

Each emitted opportunity flows back into the graph as a node, gets scored by §3,
and competes in §4 like any other candidate. **Inference is just another event
source** — which is why the event-sourced substrate matters.

---

## 6. Networking Graph Architecture (paths & introductions)

- **Warm-path finder:** shortest/strongest path from `self` to any target node.
  Deterministic weighted search (edge weight = inverse of Relationship Strength ×
  Response Probability). Returns ranked paths with a **PathWarmth** score used
  directly in `P(a)` above. "Three warm paths now exist into Company X" is a
  count of viable paths crossing a warmth threshold.
- **Centrality as a node score:** degree/betweenness identify your connectors and
  brokers — the people whose `ReferralValue` compounds.
- **Introduction ledger:** `INTRODUCED` edges + outcomes make referral value
  *measured*, not assumed — closing the loop on "who creates referrals."

---

## 7. Daily Command Brief (the surface you log into)

The brief is a **set of `argmax ExpectedROI` queries**, one per category, each
with its trace. This is a direct generalization of the *already-live*
`buildCareerBriefModel()` — same shape (`morningBrief`, `executeNow`,
`suggestedNextMove`, `topOpportunities`, `waitingOn`, `upcoming`), broader inputs.

| Brief line | Query |
|---|---|
| Highest-ROI move today | `argmax ExpectedROI` over all actions, horizon=day |
| Highest-ROI relationship | `argmax` over `Person` actions |
| Highest-ROI meeting to schedule | `argmax` over proposable meetings (warm path × value) |
| Highest-ROI follow-up | `argmax` over due `FollowUp` actions |
| Highest-ROI revenue / job / business opportunity | `argmax` within each opportunity segment |
| Highest-ROI learning / product / networking action | `argmax` within Skill / Product / Introduction actions |
| Highest probability of revenue this week / month | rank by `P(revenue event within horizon)` from pipeline velocity |

Every line renders its `whyNow` + trace. The brief prints its own honesty line
(as Career Brief already does: *"Deterministic — no black-box scoring"*).

---

## 8. Future Notification Engine

Notifications are a **threshold projection over the event log**, deliberately
scarce:

- A notification fires only on a **state-change delta** that crosses a
  founder-set **expected-value threshold** (e.g., PathWarmth to a target crosses
  "askable"; Momentum flips positive; a buying-window signal appears).
- Every notification **carries its EV** and trace: *"3 warm paths now into
  Company X (est. $Y, p=Z) — ask Blake."*
- Scarcity enforced deterministically: EV floor + rate limit + dedup + delta-only.
- Delivery is the gap the audit found (heartbeat writes to a CI artifact you
  never see) — add one real channel (email/push) in the roadmap.

---

## 9. Data Model Recommendations

New projection tables (all rebuildable from the event log; none are a new source
of truth):

| Table | Purpose |
|---|---|
| `nodes` | id, type, canonical attrs (jsonb), provenance, self-flag |
| `edges` | src, dst, type, direction, weight, evidence[], first/last observed, decay policy |
| `node_identities` | raw handle → canonical nodeId (the join layer) |
| `node_scores` | nodeId, score name, value, **trace jsonb**, formula version, computed at |
| `inferred_opportunities` | ruleId, subject nodes, evidence, ExpectedROI, whyNow |
| `notifications` | trigger, EV, trace, state (fired/suppressed), delivered channel |
| `weights` (or files) | founder-curated weight sets, versioned |

Keep the **event log (`domain_events`) as the sole source of truth.** Everything
above is a view. `execution_outcomes` remains the revenue-attribution ledger that
grounds `V(o)` in real dollars.

**Model principles:** thin nodes; edges carry the value; every score carries a
trace; every attribute carries provenance; every projection is replayable.

---

## 10. Database Changes Required

1. **Turn Postgres on** (audit debt #2 — the blocker). Set `MERIDIAN_TRUTH_STORE`,
   run `scripts/backfill-phase1-neon.ts`. Until this ships, the graph loses data
   on Vercel's read-only FS.
2. **Activate the dormant event + outcome tables** (`domain_events`,
   `execution_outcomes`, `idempotency_keys`) — they were built for exactly this.
3. **Add the projection tables** in §9 as a `phase2-graph.sql` migration
   (additive; nothing dropped).
4. **Backfill the graph** from existing data: `CompanySnapshot` → Company nodes
   (keyed by existing `companyKey`), `JobOpportunity` → nodes, `CrmContactRecord`
   → Person nodes (through identity resolution), `CrmActivity`/`CareerCalendarEvent`
   → interaction events. **No existing data is discarded — it is replayed into the
   graph.**

---

## 11. Existing Code That Can Be Reused (the reuse ledger)

| New capability | Reuses existing | How |
|---|---|---|
| Event log / source of truth | `db/schema/phase1-neon.sql:domain_events`, `lib/tracking/eventFileAdapter.ts` + Neon adapter | Turn on; it exists. |
| Projection / read-model engine | **`lib/relationship-engine/` (59 files)** | Its first real projection = the graph. Justifies the sunk cost. |
| Identity resolution / dedup | `lib/contacts/*`, `docs/SOURCE_PRIORITY.md` | The `node_identities` layer. |
| Traced deterministic scoring | `lib/recovery/decisionScore.ts`, `lib/relationship-engine/scoring/healthScoreTrace.ts` | The trace pattern for `node_scores`. |
| Momentum / learning / calibration | `lib/calendar/{patternLearning,outcomeLearning,workflowRuleLearning}.ts` | Momentum + weight calibration (frequentist, not ML). |
| Inference rules (bucket pattern) | `lib/relationship-intelligence/resurfacing.ts` | Template for §5 rules. |
| Staleness / re-engage | `lib/recovery/staleness.ts` | "Who went inactive." |
| whyNow explanations | `lib/recovery/whyNow.ts` | Every recommendation's rationale. |
| Insight capping / evidence-gating | `lib/calendar/insightEngine.ts` (max 5, min-3-evidence) | Brief diversification. |
| Brief composition | **`lib/ae-jobs/career-brief.ts::buildCareerBriefModel()`** | Generalize → `buildCommandBrief()`. |
| Revenue attribution ($) | `execution_outcomes` + `lib/execution/*` | Grounds `V(o)` and "who creates revenue." |
| Agent I/O to populate graph | `app/api/mcp` + `lib/mcp/` (32 tools) | Add `upsertNode`/`linkEdge`/`emitEvent`/`inferOpportunities` tools alongside existing. |
| Weight-file calibration | philosophy's "founder-curated weight files" + `lib/scoring` weights | `weights` versioned sets. |
| Ingestion (email → items) | `lib/ae-jobs/ingestion.ts`, `/api/ae-jobs/ingest` | Generalize from job emails to all relationship events. |

**Nothing in the reuse column is new construction. It is re-pointing existing
deterministic machinery at a graph and at `self`.**

---

## 12. Modules That Already Support This Vision

- **`lib/ae-jobs/*`** — the brief spine, live today. The prototype of the whole OS.
- **`lib/relationship-engine/*`** — the event-sourced projection substrate (empty
  → gets its data).
- **`lib/recovery/*` + `lib/relationship-intelligence/*`** — re-engagement,
  resurfacing, whyNow, staleness. Half the relationship-intelligence layer is
  already written.
- **`lib/calendar/*`** — insight/workflow/learning = momentum + calibration.
- **`lib/scoring/*`** — the deterministic ranking core.
- **`lib/contacts/*` + `lib/ingestion/*`** — identity resolution + inbound signals.
- **`app/api/mcp` + `lib/mcp/*`** — the agent surface that feeds the graph.
- **`execution_outcomes` / `domain_events`** — the ledgers that make revenue real.

---

## 13. Minimal Architectural Evolution From Today

The smallest set of changes that yields the whole system:

1. **Flip persistence to Postgres** and turn on the event log. *(config change +
   existing backfill script)*
2. **Add a `graph_projector`** that folds events → `nodes`/`edges`. *(new, but
   built on the existing projection contracts in `lib/relationship-engine`)*
3. **Add a `node_scores` projector** wrapping the existing scoring functions with
   a shared trace envelope. *(re-point, don't rewrite)*
4. **Generalize `buildCareerBriefModel()` → `buildCommandBrief()`** over
   graph-derived attention items. *(the `AttentionItem` generalization from the
   audit)*
5. **Add inference rules and the path-finder** as additional event sources.
6. **Add one notification channel.**

No module is deleted. No surface is rebuilt. The B2B product (audit §8.3) is
untouched and keeps running beside Command.

---

## 14. Phased Implementation Plan (preserves existing work)

Each phase ships standalone value and reuses more than it adds.

**Phase 0 — Durability & event log (foundation).**
Turn on Postgres; activate `domain_events`/`execution_outcomes`; backfill.
*Exit:* writes survive on Vercel; every mutation emits an event. *(Audit debt #2.)*

**Phase 1 — Graph projection (prove it, no new UI).**
Backfill existing `CompanySnapshot`/`JobOpportunity`/`CrmContact` into
`nodes`/`edges` through identity resolution. Give `lib/relationship-engine` its
first real data. *Exit:* the four data islands are one queryable graph.

**Phase 2 — Scoring framework.**
Wrap existing scoring in the traced `node_scores` projection; implement the
`ExpectedROI` apex over four horizons. *Exit:* every node/action has a traced,
money-denominated score.

**Phase 3 — Command Brief.**
Generalize `career-brief.ts` → `buildCommandBrief()`; the brief runs `argmax
ExpectedROI` per category. Retire the hollow `/heartbeat`; fold `/personal` in.
*Exit:* one morning surface, self-centered, explained.

**Phase 4 — Inference engine.**
Ship the §5 graph-pattern rules as event sources feeding the brief. *Exit:*
Meridian surfaces opportunities you never entered.

**Phase 5 — Networking engine.**
Warm-path finder + centrality + introduction ledger; PathWarmth feeds `P(a)`.
*Exit:* "3 warm paths into Company X" is real.

**Phase 6 — Notification engine.**
Threshold projection + one delivery channel (email/push). *Exit:* scarce,
EV-carrying nudges.

Phases 0–3 turn today's job-search brief into a real revenue-optimizing OS.
Phases 4–6 make it compound.

---

## 15. What This Design Refuses To Do (guardrails)

- **No black-box scoring, ever.** Models emit *signals* (events); the transparent
  formula produces *scores*.
- **No autonomous action.** The engine ranks and explains; you decide and act.
- **No account-centric CRM drift.** `self` is the center; if a design puts an
  account at the center, it's wrong.
- **No heavy sub-app per node type.** Thin nodes, rich edges.
- **No speculative surface ahead of data.** The Era-1 mistake (59 files, `[]`).
  Every projection must have events flowing before it grows.
- **No new file-based durable store.** Graph state lives in Postgres.

---

## 16. Amendment Log

| Date | Author | Change |
|------|--------|--------|
| 2026-07-06 | Chief Architect | Initial intelligence-layer design. Established the Opportunity Graph as a deterministic projection over the existing event log; defined the ExpectedROI apex ranker; mapped every component to existing reusable modules; specified a 7-phase evolution (0–6) that preserves the B2B product and generalizes `career-brief.ts` into the Command brief. |

---

> **The compounding thesis:** a networking map shows you who you know. The
> Opportunity Graph, scored relative to *you* and ranked by Expected ROI, tells
> you the single next action most likely to increase your revenue — today, this
> week, this month, this quarter — and explains itself every time. Same
> deterministic discipline you already built. New center of gravity: you.
