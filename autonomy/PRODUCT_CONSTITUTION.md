# Meridian — Product Constitution

> Supreme operating document for every agent (human or AI) that writes code,
> data, or copy in this repository. Conflicts with this document are resolved
> by amending the document via a `[canon-amend]` PR. They are never resolved
> by silently violating it.

---

## 1. What Meridian is

Meridian is **operational intelligence infrastructure** delivered first through
a weekly per-customer **Recovery Brief** that ranks **10–20 contacts or
businesses** most likely to create revenue movement this week, with every
recommendation tied to:

- a named real-world signal
- a source citation (record id / URL / CRM activity row)
- an `observedAt` timestamp
- an explicit confidence tier
- a decay-aware weight

The brief is delivered at a per-customer URL on a weekly cadence. The
customer captures outcomes per card. Continuity memory accumulates. That is
the entire customer-facing product.

## 2. What Meridian is not

Meridian is **not** any of the following. An agent who finds itself building
toward one of these has drifted and must stop.

- An AI CRM
- A generic lead platform
- A dashboard product
- A workflow automation engine
- A copilot or chat product
- An "autonomous agent" system that takes external actions on behalf of operators
- A predictive ML product
- An orchestration platform
- A real-time alerts / notifications system
- A "platform" with tiers, marketplace, or webhook surface

## 3. The sellable promise

> *"Every week, we tell you who in your existing list is most likely to move
> revenue this week — and we show you the public-records evidence."*

A paying customer pays for that paragraph. Nothing else.

## 4. The moat

Per-customer **continuity memory** (`lib/recovery/outcomes/`). After 12 weeks
of outcome capture, the customer's brief is informed by 12 weeks of
operator-recorded outcomes. A competitor who started today cannot replicate
that for 12 weeks. The moat is patience plus deterministic accumulation. It
is not technology.

## 5. Primary workspaces

| Slug | Customer | Vertical |
| --- | --- | --- |
| `nicole-lonergan` | Brookside Real Estate (Nicole) | Residential brokerage |
| `labortech` | LaborTech (John) | Specialty contractor (roofing) |

A third workspace requires founder approval and a written signal weighting
config in `config/signals/<slug>.ts` (see `autonomy/AGENT_TASK_QUEUE.md`).

## 6. Non-negotiable rules

These are constitutional. They cannot be relaxed by an agent. They can only
be amended via a `[canon-amend]` PR reviewed by the founder.

1. **No fake AI scoring.** Every score is a sum of named, weighted signals.
2. **No opaque percentages.** Any number on a card must trace to a signal.
3. **No generic "high leverage" language.** Plain operator voice only.
4. **No new dashboards unless approved.** The brief is the surface.
5. **No autonomous deletes.** Operators delete; agents propose.
6. **No auth or payment changes without explicit approval.** Tenant boundaries
   and billing are out of bounds.
7. **No direct commits to `main`.** All changes go through PR.
8. **No new product surfaces unless they improve the weekly Recovery Brief.**
9. **Every score must be explainable.** "Show your work" is required.
10. **Every signal must carry `source`, `observedAt`, `confidence`, and `decay`.**
11. **Weak confidence must be labeled weak.** Padding the brief is forbidden.
12. **Operator trust is the moat.** When in doubt, choose the less-confident,
    more-honest output.

## 7. The seven PR acceptance questions

Every PR answers these. If any answer is "no" or unclear, the PR does not
merge. The full checklist lives in
[`autonomy/PR_REVIEW_CHECKLIST.md`](./PR_REVIEW_CHECKLIST.md).

1. Does this directly improve the weekly Recovery Brief for a paying customer?
2. Does every score this PR touches remain decomposable, source-cited, and
   decay-aware?
3. Does this introduce any AI-generated customer-facing reasoning? (must be no)
4. Does this add a dashboard, real-time surface, or "platform" feature?
   (must be no)
5. Does this preserve workspace tenant boundaries?
6. Does this preserve append-only continuity memory?
7. Could the customer re-derive every claim on a brief card from a public
   record or their own CRM in under 60 seconds?

## 8. The single governing question

If you remember nothing else from this document, remember this:

> *"Does this help an operator focus on the relationships most connected to
> commercial opportunity, with explainable evidence, in a calm and trustworthy
> way?"*

If yes — proceed.
If no — stop and re-scope.

## 9. Related canon (read these before writing code)

- [`autonomy/NO_DRIFT_RULES.md`](./NO_DRIFT_RULES.md) — concrete anti-patterns
- [`autonomy/SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md) — signal taxonomy
- [`autonomy/AGENT_TASK_QUEUE.md`](./AGENT_TASK_QUEUE.md) — current work
- [`autonomy/ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) — done conditions
- [`autonomy/PR_REVIEW_CHECKLIST.md`](./PR_REVIEW_CHECKLIST.md) — merge gate
- [`docs/meridian-philosophy.md`](../docs/meridian-philosophy.md) — origin philosophy
- [`docs/scoring-principles.md`](../docs/scoring-principles.md) — scoring canon
- [`docs/copywriting-principles.md`](../docs/copywriting-principles.md) — voice
- [`docs/product/product-principles.md`](../docs/product/product-principles.md) — build/don't-build

## 10. Amendment process

To amend this document:

1. Open a PR with title beginning `[canon-amend]`.
2. The PR description states: which clause, what changed, why now.
3. The PR adds a dated entry under `## Amendments` at the bottom.
4. The founder reviews. No exceptions. No silent amendments.

---

## Amendments

*(none yet)*
