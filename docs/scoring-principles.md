# Scoring Principles

How Meridian ranks relationships. Derived from `meridian-philosophy.md`.

---

## Core rule

Every score, every rank, every "why now" line traces back to an **observable signal** from the customer's own data. No score is allowed to exist without a documented derivation path.

---

## Observable signals (allowed)

Scoring may be derived from any of:

- Relationship staleness (days since last touch)
- Engagement history (count and recency of prior touches)
- CRM touch density (touches per unit time, recent vs. historical)
- Prior opportunity stage (qualified, proposal, demo, closed-lost, etc.)
- Previous deal movement (stage transitions, deal-value history)
- Company activity (public hiring, expansion, website changes, news)
- Hiring activity (job postings, recent role openings)
- Operator interaction frequency (who touched whom, how often)
- Follow-up abandonment (next-steps that never closed)
- Account expansion signals (new business lines, vertical pushes, AUM growth)
- Organizational changes (titles, departures, role moves)
- Recency of commercial interaction (last meaningful exchange)
- Strategic fit (industry, deal-size band, customer's stated preferences)
- Repeat engagement patterns (cyclical relationships)
- Account value indicators (size, prestige, revenue contribution)

Each signal must be:
- **Derivable** from data the customer provided or from public sources
- **Documented** in code with a comment naming the signal it represents
- **Citable** — the brief output must reference it explicitly or implicitly when the signal drives the ranking

---

## Banned scoring approaches

- **Black-box ML models.** No trained classifier, no regression, no neural network in the scoring path.
- **Hidden weights.** Every coefficient is in source code, in plain numbers, with a comment.
- **Emotional inference.** No "trust score," no "warmth score," no "relationship strength" abstraction that can't be traced back to a signal listed above.
- **Predictive certainty.** No "this will close" output. Forbidden by `meridian-philosophy.md`.
- **Composite scores without component traceability.** A `recoveryScore` of 82 must decompose into the underlying components (staleness × decision × contact reachability) on demand.

---

## Allowed scoring approaches

- **Linear weighted combinations** of observable signal scores
- **Rule-based bucketing** (e.g., "Call now / Call this week / Watch / Skip" derived from explicit thresholds)
- **Deterministic per-customer multipliers** loaded from `data/customer-preferences/<slug>.json` (see `meridian-philosophy.md § Company-specific calibration`)
- **Variant text rotation** (multiple phrasings of the same evidence-bound line) seeded on stable inputs (company name, days, etc.) — never random

---

## Evidence-bound output requirement

Every line of generated text in a brief must derive from:
1. A field the customer provided, OR
2. A public-source enrichment with a recorded provider + confidence, OR
3. A deterministic combination of (1) and (2) per documented rules

If none of these holds, the engine must produce a **calmer, narrower** line — not a fabricated specific one. See `dataQuality LOW` tier in `lib/recovery/whyNow.ts` for the canonical example.

---

## Calibration mechanics

Per-customer calibration is one of:
- A multiplier (1.0 = default; 0.5 = half-weight; 1.5 = boost) on a named component
- An additive offset (rare; use with caution)
- An opener-tone selector (`tight | warm | deferential`)

Calibration is **never**:
- A self-modifying value that changes based on observed outcomes
- A model that "learns" — no learning loop is allowed in the scoring path
- An opaque blob — every value must be human-readable in a config file

Calibration files live at `data/customer-preferences/<slug>.json`. Founder-edited. Never customer-edited until this document is amended.

---

## Score legibility

Every score Meridian outputs must be:

- **Anchored** — `Recovery 66 / 100`, not `66 recovery score` (the anchor explains the scale)
- **Bounded** — clamped to its stated range; a `0–100` score never returns `103`
- **Decomposable** — on demand, the founder can produce the component breakdown
- **Explanatory** — the brief's "why now" line should make the score self-evident even without the number visible

---

## Banned language in operator-facing surfaces

| Don't render | Why |
|---|---|
| `confidence: "unknown"` | Reads as engine failure; surface as "limited signal" prose instead |
| `score: 0` | Same; suppress the number when the engine has no signal |
| Stage labels like `MQL`, `SQL`, `QUAL` rendered raw inline | Reads CRM-y; lowercase or expand |
| Internal kebab-case IDs (`partner-referral-campaign`) | Engineery; never expose |
| Decimal scores with more than one digit of precision | Implies false precision; round to integer |

---

## Auditability

A founder reviewing a generated brief must be able to answer, for any card:

1. **Where did this rank come from?** → component score breakdown
2. **What signal drove the why-now line?** → which input field or public source
3. **Why is the priority read prescribing this specific action?** → the strongest available angle in `strongestAngle()`
4. **Why is the contact path this one, not another?** → the provider waterfall order in `lib/contacts/resolver.ts`

If a generated brief contains a line the founder cannot trace, the line is a bug. Not a feature.

---

## When in doubt

The default behavior when signal is weak is **calmer language with less specificity**, not invented certainty. The dataQuality LOW tier exists for exactly this case. Use it.
