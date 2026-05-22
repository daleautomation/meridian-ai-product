# Meridian — Signal Trust Rules

> The signal taxonomy. Machine-checkable. Every signal that enters the
> pipeline must comply with §2 (required fields) and be classified per §3
> (trust tiers).
>
> An agent (`scoring-auditor`) reads this document and rejects PRs that
> violate it. See `agents/scoring-auditor.md`.

---

## 1. What a signal is

A **signal** is a single named, dated, sourced observation about a
real-world entity (a person, a business, a property, an account). Signals
are atomic — a brief card's score is built by summing decay-weighted
contributions from multiple signals.

A signal is **not** a derived metric, an internal heuristic, or a vendor's
opaque score. Those are forbidden.

## 2. Required fields on every signal

Every signal in the pipeline must carry these fields. Missing any field is
a hard reject by the scoring auditor.

| Field | Type | Purpose |
| --- | --- | --- |
| `name` | string | Canonical name (e.g. `permit_pulled`, `prior_client`) |
| `source` | string | Origin label (e.g. `county_recorder:king_wa`, `crm:hubspot`, `google_places`) |
| `recordId` | string | Stable record id at the source (deed #, permit #, CRM activity id, URL) |
| `observedAt` | ISO-8601 timestamp | When the underlying event happened (not when we fetched it) |
| `confidence` | `"HIGH" \| "MED" \| "WEAK"` | Tier per §3 |
| `halfLifeDays` | number | Per-signal decay constant (see §4) |
| `weight` | number 0–100 | Workspace-config-supplied weight |
| `evidenceUrl` | string \| null | Public URL or internal link the operator can click |
| `payload` | object \| null | Optional source-specific context (kept small, never used for ranking) |

If `evidenceUrl` is null, the signal must be re-derivable from `source` +
`recordId` alone. "Re-derivable in under 60 seconds by the customer" is the
trust test.

## 3. Trust tiers

| Tier | Definition | Rules |
| --- | --- | --- |
| **HIGH** | Public record with legal weight, or the customer's own CRM with an explicit timestamp | May be the sole "why now" reason on a card. Cited by name + record id. |
| **MED** | Authoritative but lagging, access-gated, or inferred-not-declared | May contribute to ranking. Must be paired with at least one HIGH on the same card to appear as the headline reason. |
| **WEAK** | Recent but unverifiable, or pattern-based with low specificity | May influence background bias. **Cannot appear as a "why now" line on its own.** A card whose top signal is WEAK must be labeled "weak signal — judgment call." |
| **BANNED** | Black-box vendor scores, ML model outputs without provenance, sentiment proxies, "predicted likelihood" outputs | Cannot enter the pipeline. Reject at ingestion. |

### 3.1 Canonical tier catalog

| Source | Tier | Notes |
| --- | --- | --- |
| County recorder (deeds, mortgages, liens, NOD) | HIGH | Public, legal, dated, structured |
| Permit databases (Shovels, BuildZoom, city/county direct) | HIGH | Tied to physical work |
| Secretary of State business filings | HIGH | Public, structured |
| Google Places (rating, review_count, photos, hours) | HIGH | Public; rate-limit-respect |
| Customer's own CRM with timestamps | HIGH | The customer's own truth |
| Google Ads transparency | HIGH | Public, intent-revealing |
| Hunter.io email verification (boolean result) | HIGH | Source-attributed, deterministic boolean |
| NOAA storm / weather events tied to zip | HIGH | Public, scientific, dated |
| Google Ads campaign metadata (paid presence) | MED | Inferred intent, not declared |
| MLS listing history (licensed agent's own IDX feed) | MED | Authoritative, access-gated |
| Tax assessor records | MED | Lagging by months |
| OSHA / EPA filings | MED | Authoritative, vertical-specific |
| LinkedIn profile signals (residential) | WEAK | Demographic mismatch |
| LinkedIn employee count (sub-$5M trades) | WEAK | Often wrong by 5× |
| Generic intent vendors (Bombora, 6sense, G2 intent) | BANNED | Black-box |
| Vendor "likelihood to X" scores | BANNED | Not deterministic |
| Internal ML model outputs without record-level provenance | BANNED | Not explainable |
| Social media sentiment scores | BANNED | Noise, not signal |
| Any source labeled "proprietary intelligence" with no paper trail | BANNED | Anti-trust by definition |

New source proposals go through the **data-source-researcher** agent (see
`agents/data-source-researcher.md`). New sources never enter the pipeline
without a tier assignment in this document.

## 4. Decay

Every signal has a `halfLifeDays`. The signal's contribution at evaluation
time is:

```
contribution = weight × 0.5 ^ ((now - observedAt) / halfLifeDays)
```

Pure, deterministic, testable. No "boost" curves, no minimum-floor logic,
no "freshness multiplier" tricks. A signal that decayed to ~1% is still
recorded — it just contributes near-zero.

Recommended half-lives (defaults; per-workspace configs may override):

| Signal | halfLifeDays |
| --- | --- |
| `permit_pulled` | 90 |
| `mortgage_release` | 90 |
| `storm_event` | 21 |
| `paid_ad_presence` | 14 |
| `prior_client` | 1095 (3 years) |
| `crm_recorded_interest` | 180 |
| `low_rating_high_reviews` | 365 |
| `last_touch_age` | inverse — see §5 |

## 5. Inverse-time signals

Some signals' value grows as time passes (e.g., "last touch was 9+ months
ago"). For these, the contribution is computed by an explicit ramp
function, never by inverting the decay constant. The ramp must be a pure
function declared alongside the signal in the workspace config.

## 6. Confidence honesty

The brief is allowed to be short. If the customer's data only supports 7
high-confidence cards in a given week, the brief contains 7 cards plus a
calm line: *"7 high-confidence opportunities this week; 13 dormant
relationships available on request."* It does not pad to 20.

Padding the brief with WEAK-only cards to hit 20 is a violation of the
Constitution (§6.11) and a release blocker.

## 7. Cross-workspace isolation

Signals are sourced per-workspace. A signal recorded against
`workspace=labortech` may never appear on a brief for `workspace=nicole-lonergan`.
The scoring auditor verifies this at evaluation time.

## 8. Determinism

Same inputs (raw signals + workspace config + `now` timestamp) must
produce identical outputs. The determinism check script (see
`autonomy/ACCEPTANCE_CRITERIA.md` task T7) enforces this in CI.

## 9. Adding a new signal — the agent checklist

Before a new signal name enters the codebase, the proposing agent must
have answered, in writing, each of:

1. What is the source? Is the source already tier-classified in §3.1?
2. What is the canonical `recordId` shape?
3. What is the `observedAt` source (event time, not fetch time)?
4. What confidence tier? Why?
5. What `halfLifeDays`? Why?
6. Can a customer re-derive the signal from `evidenceUrl` in under 60s?
7. Is this signal an inverse-time signal (§5)? If so, declare the ramp.
8. Which workspaces will weight this signal? Why those weights?

A signal that cannot answer all eight questions is not merged.
