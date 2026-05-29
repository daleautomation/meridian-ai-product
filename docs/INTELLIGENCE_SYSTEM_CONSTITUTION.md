# Meridian — Intelligence System Constitution

> Permanent rules governing every enrichment, signal, ranking adjustment,
> and operator recommendation Meridian produces. Subordinate only to
> [`autonomy/PRODUCT_CONSTITUTION.md`](../autonomy/PRODUCT_CONSTITUTION.md) and
> [`autonomy/NO_DRIFT_RULES.md`](../autonomy/NO_DRIFT_RULES.md).
> Conflicts resolve via a `[canon-amend]` PR, never via silent violation.
>
> If this document and the product constitution disagree, the product
> constitution wins.

---

## 0. Why this exists

Meridian is becoming the operator's source of truth for who deserves
attention this week. Every byte of external data we surface to an
operator gets read as Meridian's claim. When a claim turns out to be
wrong — a wrong owner attribution, an out-of-date role, a fabricated
permit — the operator's trust collapses and does not recover. The cost
of one fabricated claim is greater than the marginal value of a year
of correct ones.

This document encodes the engineering rules that keep that ratio safe.
Every rule below is enforced by validator code (`scripts/check-*.ts`)
or by type-level invariants. Rules are not aspirations.

---

## 1. Source-of-Truth Hierarchy

When two sources disagree about a fact for the same contact, **the
higher tier wins, always**. Lower tiers may add detail; they may not
override.

| Tier | Source | Examples | Surface? |
|---|---|---|---|
| T1 | Operator-entered notes | `crm_contacts.notes` (human-authored) | Yes — highest |
| T2 | Operator-captured outcomes | `data/outcomes/<customer>.json` (append-only) | Yes |
| T3 | CRM-imported tagged facts | tags, `lastInteractionAt`, `sourceCrm` | Yes |
| T4 | Verified external lookup | Hunter (≥75%), Regrid match w/ owner-name match | Yes — gated |
| T5 | Public record (raw) | `lib/enrichment/public-records/*` parcel records | Stored, gated by T4 match |
| T6 | Derived signal | `ownershipYears`, `assessedValueTrend`, `occupancyHint` | Stored, gated by T4–5 |
| T7 | Inferred signal | Anything computed from a model | **Forbidden — see §6** |

**Hard rules:**

1. A T4–T6 fact never silently replaces a T1–T3 fact. If they conflict,
   the higher-tier value is what renders; the lower-tier value is
   stored in the row's audit trail and visible to the operator.
2. Provenance for every T4–T6 fact is mandatory and stored alongside
   the value (see §2). No exception, no "we'll add it later."
3. Operator can re-derive any surfaced T4–T6 claim from the cited
   source URL or record ID in under 60 seconds. This is PR-acceptance
   question #7 in the product constitution.
4. A T7 signal cannot be surfaced or written to durable storage. If
   you find yourself reaching for one, stop and re-scope.

---

## 2. Provenance Requirements

Every external or derived signal stored on a contact MUST carry, as
structurally-required fields, the following:

```ts
{
  source: <named provider or "<county>_assessor">
  fetchedAt: <ISO-8601 UTC instant>
  confidence: "HIGH" | "MED" | "LOW"   // §4
  status: "matched" | "not_found" | "skipped" | "ambiguous" | "error"
  reason?: string  // required when status ∈ {skipped, ambiguous, error}
  // when status="matched", these MAY appear; when present they
  // MUST be verbatim from the source (no paraphrasing):
  recordId?: string
  sourceUrl?: string
}
```

**Hard rules:**

1. The TypeScript type must make `source`, `fetchedAt`, `confidence`,
   and `status` non-optional. A row missing any one of those is a
   malformed row and the audit script flags it.
2. `fetchedAt` is always an ISO-8601 UTC instant. Operator-facing
   surfaces format it; storage never stores a localized string.
3. The `reason` field for non-matched statuses uses a canonical
   vocabulary (e.g. `no_last_name`, `personal_domain`, `auth_error`,
   `quota_exceeded`, `rate_limited`, `wrong_params:<detail>`,
   `transient_error:<detail>`, `ownership_mismatch`,
   `ambiguous_owner_match`). New reasons require an amendment.
4. No "best guess" field that lacks a source. If a fact cannot be
   cited, it cannot exist in the model.

---

## 3. Intelligence Layer Separation

Each operator workspace verticalizes its intelligence. Cross-layer
leakage is forbidden — not because the data conflicts, but because
the *interpretation* of the same fact differs by vertical.

**Defined layers (v1):**

| Layer | Workspace examples | Primary signals | Key sources |
|---|---|---|---|
| **Residential Property Intelligence** | `nicole-lonergan` (Brookside) | ownershipYears, lastSaleDate, permitSignals, occupancyHint | Regrid (v1), Estated (Phase 4), county assessor (last resort) |
| **Contractor Intelligence** | `labortech` (roofing) | permit_pulled, storm_event, license_recently_issued, active_google_ads | Google Places, permit feeds, weather/storm services, county assessor for owner verification |
| **Commercial Relationship Intelligence** | Future | role, employer change, recent business filings | Hunter, Crunchbase-style, business filings |
| **Wealth Intelligence** | **Forbidden in v1** | — | — |

**Hard rules:**

1. Each vertical has its own enrichment script and its own opener
   extractors. No shared "generic enrichment pass" runs across all
   workspaces.
2. A signal valid for one vertical may be inappropriate for another.
   `permit_pulled` is HIGH-value intelligence for LaborTech; it is
   noise on a residential agent's brief unless tied to a verified
   homeowner relationship.
3. A workspace config (`config/workspaces.ts` + `config/signals/<slug>.ts`)
   declares which intelligence layer applies. The enrichment script
   refuses to run against a workspace whose vertical does not
   declare it.
4. Owner-attribution rules vary by vertical and must be encoded per
   vertical, never globally:
   - Residential: contact name must match parcel owner (or surname only).
   - Contractor: permit applicant name need not match — operator is
     prospecting, not verifying past clients.
5. A future vertical addition is a `[canon-amend]` PR that updates
   this section and adds the corresponding config + extractors. It is
   never a one-line `else { /* generic */ }` branch.

---

## 4. Confidence System

Three tiers. Strictly defined by what qualifies, what may surface, and
what may influence ranking.

### HIGH

- Operator-authored notes that match a topical extractor pattern.
- Public-record parcel match with exact parcel ID + exact (or surname)
  owner-name match.
- Verified external lookup where the provider returned a deliverability
  or match score ≥ 90 AND the owner-name match is exact.

**May:** surface in operator-facing openers; influence weekly priority
ranking via the existing scoring path (no separate scoring weight).

### MED

- CRM-imported tag with a known role mapping (past_buyer, past_seller).
- Last-known-close date within reasonable memory (6–35 months).
- Public-record address-only match WITH owner-name surname match.
- Verified external lookup with confidence 75–89% AND owner-name match.

**May:** surface in openers with explicit confidence + date inline;
appear as evidence on cards; influence ranking only via the existing
scoring path. **Must:** carry a "worth confirming" framing when
surfaced as opener text.

### LOW

- Verified external lookup with confidence < 75%.
- Public-record address match WITHOUT owner-name match (stored as
  `ownership_mismatch`).
- Stale enrichment (last `fetchedAt` > 90 days for time-sensitive
  signals; > 1 year for ownership-style signals).
- Anything derived from another LOW-tier signal.

**MAY:** be stored in the durable enrichment block for audit. **MUST
NOT:** appear in any opener, evidence chip, or ranking adjustment.
The audit script counts them; the operator never sees them as facts.

### What may NEVER be shown

- Any "predicted" or "likely" claim about future operator behavior.
- Any score that cannot be decomposed into named signals (see §6).
- Any signal whose source is "unknown" or whose `fetchedAt` is missing.
- Any signal from a banned vertical (Wealth Intelligence in v1).

---

## 5. Deterministic Signal Rules

Every signal — extractor, opener, scoring contribution, ranking
decision — must be deterministic.

**Hard rules:**

1. **Same input → same output.** Asserted by `scripts/check-*.ts`
   determinism passes (`buildWeeklyState` must produce byte-identical
   snapshots on repeated calls; the opener builder must produce
   byte-identical openers).
2. **No `Date.now()` inside pure modules.** `now` is always injected
   via an options argument (`{ now: Date }`). This is what makes the
   weekly snapshot reproducible against a fixed timestamp.
3. **No hidden randomness.** No `Math.random()`, no UUID-keyed
   ordering in the rendering path.
4. **No LLM call inside scoring, ranking, or rendering.** LLMs may
   exist in operator-triggered enrichment, but their output must be
   structured (e.g. ranked entity match), stored with provenance,
   and re-derivable from cached source material. An LLM output that
   was "just typed by Claude that one time" cannot become operator-
   facing.
5. **Pure-function discipline.** Extractors take `(input, { now })`
   and return a value. They do not mutate, they do not call network,
   they do not read process env. Network and env-reading happen in
   thin adapter layers only.
6. **Reproducibility test.** For every new extractor or signal,
   `scripts/check-*.ts` includes at least:
   - one fixture asserting the source/trust label
   - one fixture asserting the signal supports its claim with cited
     evidence
   - one determinism assertion (re-run produces identical output)
   - one banned-phrase scan against generated language

---

## 6. Forbidden Behaviors

This section is exhaustive within v1's scope. New forbidden behaviors
require an amendment. **All of the following are off limits, by code,
in production:**

1. **Hallucinated enrichment.** No surfacing a fact that was not
   present in a real source response. Includes paraphrased role
   titles, inferred companies, "probable" addresses.
2. **Predictive financial claims.** No refinance window estimates,
   no equity calculations, no "ready to sell" probabilities, no
   foreclosure-likelihood signals.
3. **Hidden inference.** No score derived from a process the operator
   cannot inspect. Every score must be a sum of named, weighted,
   provenance-stamped signals.
4. **Emotional manipulation.** No urgency theater ("act now"), no
   guilt ("you've fallen behind"), no FOMO ("don't miss"), no
   streak / gamification language.
5. **"AI predicts" / "Meridian predicts" / "Our model says" /
   "Likely to close" / "Smart sort" / "Hot lead / Warm lead / Cold
   lead" phrasing.** Banned-phrase regex enforced in `check-*.ts`.
6. **Fabricated urgency.** No "the seller is about to list" framing.
   No "act this week" framing not tied to a captured outcome window.
7. **Unverifiable scoring.** No black-box rank, no opaque percentage.
   Every number on a card traces to a named contributing signal.
8. **Surveillance-style aggregation.** No FastPeopleSearch,
   BeenVerified, or similar aggregator that combines public-record
   + social-media + leaked-data sources. Public records direct from
   the county are fine.
9. **Social-media scraping.** No LinkedIn scraping, no Facebook
   scraping, no Twitter/X scraping, no Instagram. If a provider's
   data secretly originated there, audit it and decide; default
   stance: reject.
10. **Probabilistic claims presented as facts.** "70% likely to
    move" is not a fact. If it must be stored, store it with
    `confidence: "LOW"` AND keep it off operator surfaces.
11. **Cross-tenant data leakage.** Workspace A's enrichment never
    influences workspace B's surface, regardless of overlap. Hard
    enforced at the query layer (`workspaceId` keying).
12. **Outbound action automation triggered by enrichment.** No "we
    found permit X so we auto-emailed Y." Enrichment surfaces
    intelligence; the operator decides.
13. **Resale / redistribution of enriched data.** Workspace data
    stays inside the workspace. Forever.
14. **Retroactive rewrite of historical claims.** When new
    enrichment lands, prior captured outcomes remain immutable.
    The append-only outcome log is non-negotiable.

---

## 7. Safe Operator Language

The language pattern is calm, evidence-anchored, confirmation-framed.

**Standard surface shape for a verified-external claim:**

```
<Source> <records show|places|notes> <contact> <fact>
(<confidence>% confidence, <YYYY-MM-DD>).
Worth <opening with that, then confirming | a calm check on |
a short note about>.
```

**Examples (real, from the live codebase):**

- "Your notes mention a kitchen renovation — worth a calm check on whether it wrapped up."
- "Hunter places Greg at Acme Brokerage as Managing Broker (88% confidence, 2026-05-26). Worth opening with that, then confirming."
- "Jackson County records show Greg owned 4321 Main since 2012 (HIGH confidence, 2026-05-27). Worth opening with that, then confirming."
- "Last contact in 2023. Open with a brief check-in — no specific thread on file."
- "Continuity insights begin after your first week of captured outcomes."

**Pattern rules:**

1. **Cite source.** Every external claim names the provider verbatim
   (Hunter, Jackson County records, Regrid). Generic "Meridian"
   attribution is forbidden — Meridian did not learn the fact;
   the named source did.
2. **Cite confidence.** Always inline, never hidden in a tooltip.
3. **Cite date.** Always inline, ISO-day format.
4. **Cite next step.** "Worth opening with that, then confirming"
   is the canonical phrasing for verified-but-secondary evidence.
   For higher-trust evidence: "Worth a calm check on …" For
   stale-only-context: "Open with a brief check-in — no specific
   thread on file."
5. **No certainty inflation.** No "we know," "definitely," "for
   sure." Provenance reads tentatively even when high-confidence.
6. **Honest absence.** When nothing specific is on file, the
   surface says so plainly: "Imported contact with no notes, tags,
   or recent interactions on file" or "Your priorities are still
   untouched this week." Never invent.

---

## 8. Failure Modes

Each failure mode has a single canonical handling. Diverging from
this list requires an amendment.

| Failure | Mechanism | Operator-visible |
|---|---|---|
| Provider outage | Fail-silent (`null` from adapter; no exception escapes to UI) | Existing card with no enrichment — unchanged from yesterday |
| Provider returns HTTP 4xx with named error id | Map to canonical `reason` (auth_error, quota_exceeded, rate_limited, wrong_params, etc.); store as `status: "error"`; honor 90-day freshness window before retry | Audit script shows the bucket; no operator-visible breakage |
| Provider returns HTTP 5xx / network failure | Same as above, `reason: transient_error:<detail>`; retry permitted after freshness window | None |
| Stale enrichment (> 90 days for refreshable signals; > 1 year for ownership signals) | Treat as if absent for opener-surfacing; remain in storage for audit | Card shows the older fact only if it was previously surfaced and operator captured an outcome against it |
| Ownership mismatch (parcel matched but owner-name doesn't match contact) | `status: "ownership_mismatch"`; **never** attached as ownership; surfaces as soft warning | "Public record shows a different owner at this address as of <date>. Your CRM may be stale — worth verifying." |
| Missing confidence on a stored row | Audit script flags it; row excluded from opener surface; never silently rendered | None — invisible until backfilled |
| Conflicting sources (Regrid says 2012, county says 2014) | Higher-tier source wins per §1; lower-tier value stored under `audit` key; never reconciled silently | Higher-tier value visible; auditor can see both |
| Ambiguous owner match (two parcels match same address) | `status: "ambiguous"`; both stored under `candidates`; no opener fires | None until operator resolves manually |
| Missing surname in CRM | Pre-call skip (`reason: no_last_name`); never call the provider; existing enrichment patterns documented in Hunter implementation | None |
| Malformed CRM data (internal diagnostic contact, persist-check rows, missing email + missing phone + missing name) | `lib/crm-import/internalContactFilter.ts` hides; raw rows preserved | Hidden — verified by `scripts/check-weekly-state.ts` |

**Hard rules:**

1. Every failure mode is named, audited, and re-runnable. No silent
   half-successes.
2. Every failure preserves enough provenance that an operator (or a
   developer) can determine in one query why a contact did not get
   enrichment.
3. A provider outage never blocks `/personal` or the weekly snapshot
   from rendering. Enrichment is always optional, additive overlay.

---

## 9. Ranking Governance

Enrichment may *enhance* ranking visibility but cannot dominate the
operator's relationship memory.

**Hard rules:**

1. **Outcome-loop signals (§T2) outrank enrichment-derived signals
   (§T4–T6) in weekly priority generation.** A `meeting_booked`
   outcome captured Tuesday removes the contact from next Monday's
   priorities. A Regrid record claiming a recent sale does not.
2. **Notes-based openers (§T1) outrank tag-based openers (§T3),
   which outrank enrichment-based openers (§T4).** Implemented in
   `lib/personal-workspace/openerBuilder.ts:buildSuggestedOpener`.
   Verified by the fixture "notes always outrank Hunter — CRM
   truth wins" in `scripts/check-opener-generation.ts`.
3. **Stale enrichment decays.** A signal whose `fetchedAt` is older
   than its category's freshness window is treated as if absent for
   opener purposes. The exact windows:
   - Time-sensitive signals (Hunter role, permits, recent sales): 90 days
   - Ownership-style signals (parcel + ownership years): 365 days
4. **Low-confidence signals (§4 LOW) cannot influence ranking
   at all.** They exist in storage so the next pass can honor the
   freshness window; they have zero scoring weight.
5. **No enrichment-only score weights.** Ranking weights live in
   `config/signals/<slug>.ts`. Adding a new weight is a
   `[canon-amend]` PR. Hunter's confidence and Regrid's match
   level are NOT scoring weights — they are gating thresholds.
6. **Outcome-aware exclusion takes precedence over enrichment-aware
   inclusion.** A contact whose latest outcome is `meeting_booked`
   stays excluded from priorities for the week even if fresh
   enrichment lands.

---

## 10. Auditability Rules

Every surfaced signal must be traceable through four independent
mechanisms. If any one of these can't show a given signal, the signal
shouldn't have rendered.

1. **Audit script** (`scripts/audit-<workspace>-data-sources.ts`):
   given a workspace slug, reports source breakdown, completeness
   counts, per-priority field provenance, and a warning row for any
   `status: "matched"` entry missing `source` / `fetchedAt` /
   `confidence`.
2. **Database provenance** (`crm_contacts.source_metadata.enrichment`
   JSONB): every signal is queryable directly via SQL, no
   application code required. Example queries documented in the
   audit script README.
3. **UI evidence**: the surface that renders the signal also renders
   the source + confidence + date. No "AI explained this in a chat"
   layer.
4. **Source-specific diagnostic** (`scripts/check-<provider>-config.ts`):
   end-to-end health check that hits the provider, validates the
   key, reports quota, and runs a single probe call. Mandatory
   pre-flight before any live enrichment run.

**Hard rule:** before merging any new enrichment provider or signal,
add or extend the four mechanisms above. PRs that introduce signals
without audit coverage do not merge.

---

## 11. Future Expansion Rules

Before adding any new intelligence type, the following must be true
and demonstrable:

1. **Vertical fit.** The signal serves at least one defined vertical's
   wedge (§3). Generic "could be useful" doesn't qualify.
2. **Provenance shape.** The signal's storage shape includes
   `source`, `fetchedAt`, `confidence`, `status` as non-optional
   typed fields. No optional provenance.
3. **Confidence floor.** A specific numeric or categorical threshold
   below which the signal does not surface. The threshold lives
   alongside the extractor (e.g. `HUNTER_OPENER_CONFIDENCE_FLOOR = 75`).
4. **Failure modes documented.** Every named failure mode from §8
   that applies to the new provider has handling code.
5. **Banned-phrase compliance.** The renderer outputs language that
   passes the existing banned-phrase scan. New extractor fixtures
   added to the corresponding `check-*.ts`.
6. **Cost ceiling.** Estimated per-month cost per workspace given
   typical contact count. Documented in the design doc.
7. **Operator approval surface.** The first live run on a real
   customer workspace requires a `--limit N` cap. No unbounded
   first runs.

**Specific future expansions and their preconditions:**

- **Permit Intelligence** (Phase 4 of Property Layer): requires
  county-level permit feed or a provider that includes permit data
  (Estated). Filtered to relevant categories (roof, kitchen, bath,
  addition, structural). Verbatim descriptions only — no paraphrase.
  Cost ceiling: under $0.50/contact/month.
- **Move-Timing Intelligence**: requires verified evidence of an
  imminent move (listing posted, address change filed, school
  district change). Pure inference ("they've been in the house 12
  years, maybe moving soon") is forbidden — that's the seller-scoring
  drift to reject.
- **Commercial Prospecting Intelligence**: requires a new vertical
  declaration. Hunter is the precedent for the contact-side; a
  business-filing source (BizFilings API, state SOS feeds) for the
  company-side. No probability scores.
- **Wealth Intelligence**: not approved for any v1 vertical. Requires
  separate constitutional review.
- **Behavioral signals**: outcome-loop signals are the only approved
  behavioral signals. "We noticed Nicole opened this card 3 times"
  is forbidden — it's surveillance of the operator, not intelligence
  about the relationship.
- **Predictive scoring** (of any kind): not approved. See §12.

---

## 12. DO NOT BUILD YET

These are explicitly forbidden in v1, with the reasoning. Each requires
a `[canon-amend]` PR before reconsideration, and at least one of them
should never be built.

1. **Predictive seller scoring.** "X% likely to list this year." No.
   The signal is unfalsifiable inside a week's brief, the operator
   cannot verify it, and it is the canonical wedge of fake-AI real
   estate products. Meridian must not look like that.

2. **Refinance window prediction.** Combining ownership age,
   assessed-value change, and rate environment to predict refi
   intent. Crosses the line into financial-state inference about
   identifiable individuals. Excluded by §6.2 and §12.

3. **Psychological profiling.** Even framed as "communication style
   match" or "preferred outreach time" — anything that infers
   private mental state from public action is forbidden.

4. **Social-media scraping.** Whether direct or via aggregator.
   §6.8 / §6.9.

5. **AI-generated life-event inference.** "We noticed Greg got
   married based on Instagram." No. Even if technically possible,
   the operator's relationship trust collapses on the first
   mistake.

6. **Black-box scoring.** Any number on a card that cannot be
   decomposed into named contributing signals + their weights +
   their decay. §6.7.

7. **Opaque ranking.** A "smart sort" toggle that does anything
   different from the named sort. §6.5.

8. **LLM-generated opener prose.** The deterministic opener builder
   is the moat. LLM-generated openers cannot be re-derived,
   can drift in voice, can fabricate, and rot the trust substrate.

9. **Auto-outreach.** Meridian surfaces intelligence; the operator
   decides and acts. §6.12.

10. **Generic enrichment pass.** A single script that "enriches
    everything from every source for every workspace." §3 forbids
    cross-vertical interpretation. Per-vertical scripts only.

11. **Operator behavioral analytics.** Time-on-card, click-through
    rates, "engagement scores" of the operator. §11 — surveillance
    of the operator is forbidden.

12. **Cross-customer pattern mining.** "Operators who used Meridian
    for a year did X." Workspace isolation is non-negotiable.

---

## Amendment process

To amend this document:

1. Open a PR with title beginning `[canon-amend]`.
2. The PR description states: which section, what changed, why now.
3. The PR adds a dated entry under `## Amendments` below.
4. The founder reviews. No silent amendments. No exceptions.

When in conflict with `autonomy/PRODUCT_CONSTITUTION.md`, the product
constitution wins.

---

## Cross-references

- [`autonomy/PRODUCT_CONSTITUTION.md`](../autonomy/PRODUCT_CONSTITUTION.md) — supreme operating doc
- [`autonomy/NO_DRIFT_RULES.md`](../autonomy/NO_DRIFT_RULES.md) — concrete anti-patterns
- [`autonomy/SIGNAL_TRUST_RULES.md`](../autonomy/SIGNAL_TRUST_RULES.md) — signal taxonomy + decay
- `lib/crm-import/types.ts` — `CrmContactRecord`, `ContactEnrichment`, `HunterEnrichmentEntry`
- `lib/enrichment/public-records/types.ts` — public record + parcel match contracts
- `lib/personal-workspace/openerBuilder.ts` — deterministic opener extractors + `HUNTER_OPENER_CONFIDENCE_FLOOR`
- `lib/personal-workspace/weeklyState.ts` — outcome-aware ranking, `OutcomeInfluence`
- `scripts/check-opener-generation.ts` — fixture + banned-phrase enforcement
- `scripts/check-weekly-state.ts` — rule-engine + determinism + provenance enforcement
- `scripts/audit-nicole-data-sources.ts` — workspace-level provenance audit
- `scripts/check-hunter-config.ts` — provider-specific diagnostic
- `scripts/enrich-nicole-hunter.ts` — enrichment writer (reference pattern)

---

## Amendments

*(none yet)*
