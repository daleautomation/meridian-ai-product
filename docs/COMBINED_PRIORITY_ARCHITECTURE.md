# Combined Priority Architecture

Status: **PLAN** (relationship-intelligence layer shipped; market + preference layers staged)
Last updated: 2026-05-29

## Purpose

Define how Meridian will combine three independent signal sources into one
operator-facing priority order, without ever letting a low-evidence signal
masquerade as a high-evidence one.

The three layers, in increasing evidence cost:

1. **Relationship Intelligence (RI)** — CRM-only. Tags, recency, reachability.
   Cheap, always available, never predictive. *Shipped.*
2. **Market Intelligence (MI)** — listing + public-record evidence (MLS,
   parcels, ownership). Expensive, sparse, the only source allowed to
   produce an "Opportunity." *Engine shipped, data not yet ingested.*
3. **Operator Preference (OP)** — the operator's declared bias (e.g.
   seller-side focus, geography, do-not-contact). A *sort lens*, never
   evidence about a contact.

## Current state (what shipped)

- **RI classifier** — `lib/enrichment/opportunity/relationshipClassification.ts`.
  Pure `classifyRelationship()` → one of:
  `past_seller_reconnect` · `seller_history_verify_recency` ·
  `sphere_reengagement` · `cold_relationship` · `not_reachable`.
  Reachability is a **gate** (no channel → `not_reachable`).
- **Wired into both CRM surfaces** as the PRIMARY label + PRIMARY sort key:
  - Personal: `lib/personal-workspace/workspace.ts` → `PersonalContactCard.relationshipLabel`
  - Operator: `lib/relationship-priority/workspace.ts` → `RelationshipPriorityCard.relationship`
  - Sort: class rank first (`CLASS_RANK` / `OPERATOR_CLASS_RANK`), strength as tiebreaker.
- **MI engine preserved** — `lib/enrichment/opportunity/scoreOpportunity.ts`.
  A **market-evidence gate** caps any contact at WEAK (`tierCapReason:
  "no_market_evidence"`) unless a listing/public-record source is present.
  CRM-only contacts therefore never surface as "Opportunities."
- **OP de-scored** — `operator_preference_seller_bias` is excluded from
  `SCORING_FACTORS`; it remains as `operatorPreferenceWeight` for sort only.
- **No CRM-only numeric score is shown as a market signal.** The operator
  view's strength chip now reads "% strength" (not "% fit") for CRM cards;
  showcase/demo cards keep "% fit". The relationship-intelligence strength
  is demoted to a muted secondary line in the personal detail panel.

## Target architecture (combined priority)

Each contact resolves to a single `CombinedPriority` built from the three
layers. The layers never blend into one opaque number; they compose as an
ordered tuple so the binding reason is always explainable.

```
CombinedPriority = {
  band:        "opportunity" | "relationship" | "maintenance" | "blocked"
  marketTier:  OpportunityTier | null          // MI — null until market data exists
  relClass:    RelationshipClass               // RI — always present
  reachable:   boolean                         // gate
  sortKey:     number                          // deterministic composite, for ordering only
  primaryLabel: string                         // what the operator sees
  evidence:    EvidenceLine[]                  // every contributing source, provenance-tagged
}
```

### Band resolution (precedence, highest first)

1. **`blocked`** — `!reachable`. Cannot be actioned; sinks to bottom regardless
   of any other signal. (A market-hot but unreachable contact becomes a
   "fix contact info" task, not a call.)
2. **`opportunity`** — MI produced `marketTier ∈ {HIGH, MED}` (requires
   listing/public-record evidence). Only this band may use the word
   "Opportunity" / market language.
3. **`relationship`** — no market evidence, but RI is actionable
   (`past_seller_reconnect`, `seller_history_verify_recency`,
   `sphere_reengagement`).
4. **`maintenance`** — `cold_relationship` / weak RI.

### Sort key composition (ordering only — never displayed)

```
sortKey =
    BAND_WEIGHT[band]          * 1_000_000   // band dominates
  + (marketTier rank)          *    10_000   // MI within opportunity band
  + RI_CLASS_RANK[relClass]    *       100   // RI within relationship band
  + operatorPreferenceLens(contact)          // OP nudges ties only (bounded, e.g. 0–50)
  + strengthTiebreak(contact)                // RI strength, final tiebreak
```

Key rules:
- **Operator preference can only move a contact *within* a band**, never across
  one. A seller-bias can re-order two relationship contacts; it can never
  promote a relationship contact into the opportunity band (that needs market
  evidence).
- The displayed `primaryLabel` is the band's label (MI tier name for
  `opportunity`, RI class label otherwise) — never the raw `sortKey`.
- Every band/label carries `evidence[]` with `source` + `evidenceLabel`, so
  "why is this #1" is answerable from the card.

## Integration roadmap

| Phase | Work | Gate to start |
|-------|------|---------------|
| **0 (done)** | RI classifier + wiring + MI market-evidence gate + OP de-scored | — |
| **1** | Ingest KC public records → `public_parcels` / `public_ownership_snapshots`; run `resolve-contact-parcels` to create links | parcels CSV for the workspace |
| **2** | Run `enrich-opportunity --write` → `enrichment.opportunity`; MI tiers become real for linked contacts | Phase 1 links exist |
| **3** | Implement `buildCombinedPriority()` (pure) composing band + sortKey from RI + MI(stored) + OP; unit-test like the existing checks | Phase 2 data flowing |
| **4** | Swap both workspace builders' sort to `buildCombinedPriority`; render band label as primary, MI evidence when present | Phase 3 tested |
| **5** | MLS/listing ingestion → unlocks `active_listing_found` / `listed_by_another_agent` (the 60 highest-weight points) | MLS source available |

## Invariants (must hold at every phase)

1. **Evidence honesty** — a label's wording may only assert what its evidence
   supports. "Opportunity"/"Seller Signal"/"Hot Lead" require MI evidence.
2. **Reachability is a gate, not a score** — unreachable contacts are blocked
   regardless of band.
3. **Operator preference is a lens, not evidence** — bounded, within-band only,
   never written into a contact's evidence list.
4. **Determinism** — `buildCombinedPriority(input)` is pure; same input → same
   order. `now` is injected.
5. **CRM truth is never mutated** — all enrichment lands under
   `source_metadata.enrichment.*`; RI/MI/OP read it, never overwrite
   `normalized.*` / `trust`.

## Pointers

- RI: `lib/enrichment/opportunity/relationshipClassification.ts` + `scripts/check-relationship-classification.ts`
- MI engine + gate: `lib/enrichment/opportunity/scoreOpportunity.ts` (`SCORING_FACTORS`, `MARKET_EVIDENCE_FACTORS`, `no_market_evidence` cap) + `scripts/check-opportunity-scoring.ts`
- Personal wiring: `lib/personal-workspace/workspace.ts` (`CLASS_RANK`, `classifyContact`)
- Operator wiring: `lib/relationship-priority/workspace.ts` (`OPERATOR_CLASS_RANK`, `crmContactsToPriorityCards`)
- Enrichment runners (dry-run by default): `enrich-opportunity`, `resolve-contact-parcels`, `enrich-nicole-hunter`
