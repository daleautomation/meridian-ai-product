# First Monday Brief — Validation Playbook

> Issued 2026-05-27 after the Sev-1 hardening sprint. Founder-operator
> guide for running Meridian's first end-to-end real-data cycle against
> Nicole's workspace.
>
> This is NOT a feature spec. The goal is to let real friction surface
> the next implementation priorities — not to add new infrastructure.
>
> Companion to:
> - `docs/public-record-intelligence-architecture.md` (architecture)
> - `docs/public-record-intelligence-audit.md` (Sev-1 risks + hardening)
> - `docs/public-record-intelligence-operational-readiness.md` *(if you
>   add one to capture this cycle's findings)*

---

## What you are testing (and what you are NOT testing)

| Testing | Not testing |
|---|---|
| Whether the queue actually changes execution behavior | Scale (single workspace, ~5 hand-curated parcels) |
| Whether the operator trusts what they see | Performance, latency, throughput |
| Whether ownership grounding is verifiably accurate | Multi-customer, multi-county breadth |
| Whether openers read naturally and source-grounded | Automation, scheduling, refresh cadence |
| Whether tier assignments feel correct | New scoring factors / weights |
| Whether the audit surfaces the right facts | UI polish, brand voice |
| Where workflow friction lives | Predictive intelligence (forbidden) |

The bar is operational truth, not technical completeness.

---

## Recalibration (2026-05-27) — The 109 as Foundational Proving Ground

The 109 contacts currently in Nicole's workspace are NOT a "small starting
sample" we're working through before adding more. They are Meridian's
**foundational intelligence corpus** — the canonical test environment for
every wedge claim the product makes.

Under this framing, scale does not exist yet. Coverage absence is no longer
"honest" — it is a calibration signal. Every HIGH tier, every misordered
pair, every weakly grounded opener carries proportionally more weight
because there are only 109 chances per cycle for the system to be right
or wrong.

### Recalibrated expectations

| Metric | Numeric expectation | Reasoning |
|---|---|---|
| HIGH tier count on 109 | **3–8 contacts** | Score floor is 70; structurally accessible only to seller-tagged contacts with parcel grounding + stale relationship + actionable channel. Without MLS the absolute factor ceiling is 80 (only seller-side achievable). >8 = scoring is over-amplifying or duplicate; 0 = substrate isn't producing leverage or hand-curated CSV doesn't cover the seller subset of the book |
| MED tier count | **10–20 contacts** | Secondary-priority cycle; includes buyer-tagged contacts with grounding + REVIEW-capped HIGHs that have a verification path |
| REVIEW tier count | **0–5 contacts** | Operator-confirmation-needed; almost always weak owner-name match against an otherwise high-scoring contact |
| WEAK tier count | **the rest** | Explicit demotion, not noise. Includes the 18 no-actionable-channel contacts capped by `no_actionable_channel` |
| Inspection target per cycle | **Every HIGH + every MED** | Tractable at 13–28 contacts. Walk factor breakdown + open county viewer + read opener aloud |
| Friction items per cycle | **≤ 5 by cycle 3**; can be 10–15 in cycle 1 | Cycle-over-cycle decline is the signal of working |
| Recurring friction items | **0** by cycle 3 | The same friction item appearing in cycle 2 that appeared in cycle 1 = we built around it instead of fixing it |
| Cycle 1 operator time end-to-end | **≤ 45 minutes** | Preprocess through brief inspection. Hours = friction signal in itself |
| Determinism break events | **0** | If running the same command twice produces different results, stop the cycle and walk the cause |

### Why these numbers are correct, not arbitrary

The scoring weights make the math explicit:

```
seller-side ceiling (no MLS):
  prior_seller_relationship           30
  operator_preference_seller_bias     15  (Nicole)
  ownership_duration_over_7yr         15  (requires parcel grounding)
  stale_relationship_over_12mo        10
  verified_contact_path               10
                                      ─────
                                      80   → HIGH

buyer-side ceiling (no MLS):
  prior_buyer_relationship            10
  ownership_duration_over_7yr         15
  stale_relationship_over_12mo        10
  verified_contact_path               10
                                      ─────
                                      45   → MED
```

HIGH is **structurally a seller-side achievement** in the current scoring
model. If you see >8 HIGH-tier contacts on 109, the most likely cause is
duplicate-contact inflation, not real opportunity. Walk the dupes before
trusting the count.

### What blocks ingesting more contacts

These are gates, not preferences. Until all five pass for two consecutive
cycles, the 109 are the right canvas:

1. **Coverage gate** — every HIGH-tier contact has been hand-verified
   against the county parcel viewer at least once.
2. **Trust gate** — ≥ 80% of brief opener lines read as "I would say this
   aloud" to the contact. ✓ ratio is the trust signal.
3. **Execution gate** — Tuesday post-brief audit confirms operator
   actually contacted ≥ 3 of the queue's top-5 on Monday. Below 3 =
   the queue isn't shaping behavior yet.
4. **Stability gate** — re-running the full cycle on the same 109 with
   no new ingestion produces byte-identical tier output. Validators
   already prove this in isolation; the gate is end-to-end.
5. **Friction gate** — ≤ 5 friction items in the cycle, and zero of them
   are repeats from the prior cycle.

If you find yourself wanting to add the next 50 contacts before these
gates fall green, that is the failure mode. The substrate's leverage
multiplies with corpus size only if the substrate is already correct on
the corpus you have.

### What success looks like for THIS cycle

Not "the pipeline ran end-to-end." That's table stakes once validators pass.

Success is all four of the following:

1. The HIGH list contains only contacts whose tier the founder can
   justify aloud from the factor breakdown in ≤ 15 seconds each.
2. At least one ownership-grounded fact in the brief measurably changes
   how Nicole approaches a conversation (Tuesday audit confirms).
3. ≥ 3 specific friction items captured — none of which are "the script
   crashed" (those are bugs, not friction).
4. The cycle takes ≤ 45 minutes of operator time.

### Failure signals that matter most (≥ 2 = block all further ingestion)

These are blocking failures, not friction items:

1. ANY HIGH tier the founder can't justify after walking the factor
   breakdown.
2. ANY opener that mentions a fact the founder can't trace to a source
   string in ≤ 30 seconds.
3. ANY contact appearing more than once in the brief (duplicate that
   wasn't audit-flagged).
4. ANY tier inversion the founder's gut would have ordered differently
   AND the factor breakdown doesn't explain the inversion.
5. ANY language that, read aloud, sounds inflated despite passing the
   banned-phrase regex.
6. ANY case where the founder says "I would never act on this" about a
   non-WEAK-tier contact.

≥ 2 of these on the 109 corpus and the gate-5 friction door slams. Fix
before any new ingestion.

### Operator behaviors that indicate genuine product value

The point is to detect *behavior change*, not feature usage:

1. Founder reads the brief Monday and says aloud "I wouldn't have called
   X today without this" — and then actually calls X.
2. Founder skips a contact she would normally have called Monday because
   the queue surfaces a stronger reason to call Y first.
3. Founder cites an ownership fact during the actual call — not from
   memory but from the brief.
4. Tuesday post-cycle audit shows the queue's top-5 and Nicole's actual
   Monday outreach overlap on ≥ 3 contacts.
5. The brief is re-opened during the week — the founder treats it as a
   reference document, not a one-time read.

If zero of these fire across cycle 1, the system isn't producing leverage
yet — investigate before any new feature work.

### Metrics that actually matter right now

NOT: contacts processed, ingestion throughput, factor coverage breadth,
validator-pass count, line-of-code metrics, audit-section count.

YES (in order of importance):

1. Justify-aloud ratio for HIGH tier contacts
2. Opener "would say aloud" ratio across the brief
3. Tuesday execution-match rate (top-5 ∩ actual outreach)
4. Friction items per cycle, with cycle-over-cycle delta
5. Recurring-friction count (same item in cycle N that was in cycle N-1)
6. Determinism-break events

---

## Pre-flight (do this once, before Monday)

### Environment

```bash
# In the repo root.
set -a; source .env.local; set +a
echo "DATABASE_URL is $(test -n "$DATABASE_URL" && echo set || echo MISSING)"
```

If `DATABASE_URL` is missing, stop. The pipeline cannot run.

### Data

```bash
# Confirm the hand-curated CSV is in place.
ls -la data/raw/manual-parcels/nicole-2026-05-27.csv
head -1 data/raw/manual-parcels/nicole-2026-05-27.csv
```

Expected header:

```
countyCode,parcelId,situsAddress,ownerName,mailingAddress,ownershipStartDate,lastTransferDate,assessedValue,propertyType,recordUrl
```

If you've grown the file beyond the seeded 5 rows, **manually spot-check 3 random rows** against the county parcel viewer before any `--write`. Hand-typed data is the single largest correctness risk in this cycle.

### Substrate state

```bash
npm run init-public-records-schema
```

Expected: `public-records schema ready { tables: [public_parcels, public_ownership_snapshots, workspace_contact_parcel_links] }`. Idempotent — safe to run repeatedly.

### Snapshot the existing state (rollback insurance)

```bash
# Capture the current Nicole row + canonical tables BEFORE any --write
psql "$DATABASE_URL" -c "\copy (select * from crm_contacts where workspace_id='nicole-lonergan') to '/tmp/nicole-contacts-pre-cycle.csv' csv header"
psql "$DATABASE_URL" -c "\copy (select * from public_parcels) to '/tmp/parcels-pre-cycle.csv' csv header"
psql "$DATABASE_URL" -c "\copy (select * from public_ownership_snapshots) to '/tmp/snapshots-pre-cycle.csv' csv header"
psql "$DATABASE_URL" -c "\copy (select * from workspace_contact_parcel_links where workspace_id='nicole-lonergan') to '/tmp/links-pre-cycle.csv' csv header"
ls -la /tmp/*-pre-cycle.csv
```

These are your rollback insurance. If anything goes wrong, you can `\copy` them back. Cheap; do it.

### Validator pass

```bash
npm run check-reimport-survival
npm run check-opportunity-pipeline
npm run check-crm-integrity
npm run build
```

All four green. If anything fails, do not proceed — fix the regression first.

---

## Phase 1 — Preprocess

```bash
npm run preprocess:manual-csv -- \
  --in=data/raw/manual-parcels/nicole-2026-05-27.csv \
  --observed-at=2026-05-27T00:00:00Z
```

### Expected output

```
preprocess-manual-csv complete {
  in: 'data/raw/manual-parcels/nicole-2026-05-27.csv',
  out: 'data/raw/canonical/manual-nicole-2026-05-27-2026-05-27.csv',
  observedAt: '2026-05-27T00:00:00Z',
  rowsAdmitted: <N>,
  rowsRejected: 0,
  perCounty: { 'us-mo-jackson': <N>, 'us-ks-johnson': <N> },
  canonicalColumns: [ ... 14 columns ... ]
}
```

### What to inspect manually

- `rowsAdmitted` matches the number of data rows in your source CSV.
- `rowsRejected` is **0** (if not — read the rejection list; common cause is a missing `countyCode` per row or a date that didn't parse).
- `perCounty` matches your expected county mix for the contacts you're enriching this week.
- Open the output CSV: `head -3 data/raw/canonical/<filename>.csv`. The `situsAddress` column should be pre-normalized: `4321 W 63rd St, Kansas City, MO 64113` — NOT `4321 West 63rd Street...`. If it's not normalized, the preprocessor didn't apply `preNormalizeAddress` correctly.
- The `rawSourceRow` column should contain the original JSON of each row, verbatim.

### Indicators

| Problem class | Signal |
|---|---|
| Architecture | Script errors out (import failure, type mismatch); rejections include `unhandled_error` |
| Scoring quality | n/a — preprocessing does not score |
| Trust | Address pre-normalization changed something unexpectedly (e.g., dropped a "1/2" half-address); raw row mutation |
| Operator confusion | Rejection messages reference internal codes you can't translate to a fix |

---

## Phase 2 — Ingest (canonical → substrate)

### Dry run first — always

```bash
npm run ingest-public-records -- \
  --in=data/raw/canonical/manual-nicole-2026-05-27-2026-05-27.csv
```

### Expected dry-run output

```
ingest-public-records DRY-RUN {
  in: '...',
  parsedRows: <N>,
  rowsAdmitted: <N>,
  rowsRejected: 0,
  rejectionsByCode: {},
  parcelInserts: 0,   // dry-run never inserts
  parcelUpdates: 0,
  parcelNoops: 0,
  snapshotInserts: 0,
  snapshotNoops: 0,
  perCounty: { ... },
  perSource: { ... },
  mode: 'dry-run',
  hint: 'Pass --write to persist to Neon.'
}
```

### What to inspect

- `parsedRows === rowsAdmitted` (zero rejections from the ingestor — preprocessor already filtered the bad rows).
- `perSource` has one entry per `sourceName` your preprocessor stamped. For the manual path, this is `us-mo-jackson_manual_2026-05-27` + `us-ks-johnson_manual_2026-05-27`.
- If any rejections appear, the `rejectionsByCode` distribution tells you exactly which validation gate they failed. Walk those rows manually before re-trying.

### Write

```bash
npm run ingest-public-records -- \
  --in=data/raw/canonical/manual-nicole-2026-05-27-2026-05-27.csv \
  --write
```

Expected: `parcelInserts + parcelUpdates + parcelNoops === rowsAdmitted` and `snapshotInserts === rowsAdmitted` on the first run. On a re-run with the same CSV: `parcelNoops === rowsAdmitted` and `snapshotNoops === rowsAdmitted` (idempotency proof).

### Indicators

| Problem class | Signal |
|---|---|
| Architecture | SQL errors (column missing, FK violation); writes claim success but a re-query returns nothing |
| Scoring quality | n/a — ingestion stores facts, does not score |
| Trust | Snapshot's `observedAt` doesn't match your `--observed-at` flag; `rawSourceRow` is empty or mangled |
| Operator confusion | Rejection reason references a canonical code (`weak_address`) without indicating which row |

### Confirmation query

```sql
select source, count(*) as snapshots, min(observed_at), max(observed_at)
  from public_ownership_snapshots
 group by source;
```

You should see exactly your two new source rows with the snapshot count matching the CSV admit count.

---

## Phase 3 — Resolve workspace contact ↔ parcel links

### Dry run

```bash
npm run resolve-contact-parcels -- --customer=nicole-lonergan
```

### Expected output

```
resolve-contact-parcels DRY-RUN {
  workspaceId: 'nicole-lonergan',
  contactsConsidered: ~130,
  internalDiagnosticSkipped: 0..16,
  outcomes: {
    resolved: <small N>,
    no_parcel_match: <large N>,
    weak_address: <some>,
    no_address: <some>,
    ambiguous_parcel: 0..1,
  },
  tierCounts: { HIGH: <n>, MED: <n>, WEAK: <n>, NO_MATCH: <n> },
  matchReasonCounts: { ... },
  reviewReasonCounts: { ... },
  ...
}
Sample resolved plans:
  Greg Smith (crm-abc12345) → tier=MED reason=exact review=[]
  ...
```

### What to inspect

- `outcomes.resolved` should match the count of hand-curated parcels you actually expect to match Nicole's contacts. If your CSV has 5 parcels and 0 resolve, **the addresses don't agree** — pre-normalize both sides and recheck.
- `outcomes.no_parcel_match` will be the majority (most contacts don't have a parcel in the substrate yet). This is **correct and honest**.
- `outcomes.ambiguous_parcel` should be **0** for the manual CSV. If > 0, you have duplicate canonical keys in your CSV (typo or genuine duplicate-address collision); resolve in source before `--write`.
- `outcomes.weak_address` flags contacts whose addresses can't be canonicalized. These need CRM repair before they can be linked — that's a `repair:contacts` session, not a Meridian bug.
- Sample resolved plans should show plausible matches by name. If you see "Smith Family Trust 2014 → tier=WEAK reason=ownership_mismatch" for a contact named Greg Smith, the classifier got it right (mismatched literal owner, surname found in trust → MED on parcel_id strength but WEAK on address strength).

### Write

```bash
npm run resolve-contact-parcels -- --customer=nicole-lonergan --write
```

Expected: `links.inserted === outcomes.resolved` on first run. Re-running with no change: `links.updated === outcomes.resolved` (verifiedAt refreshes; no supersession).

### Indicators

| Problem class | Signal |
|---|---|
| Architecture | Workspace slug rejected; links written under wrong workspace; supersession crash |
| Scoring quality | A surname-only match that should be MED comes through as HIGH (bug in `classifyOwnerNameMatch`); first-name-only match accepted (constitutional violation) |
| Trust | Link created with `matchConfidence` higher than the underlying name-match warrants; ambiguous-parcel was silently linked anyway |
| Operator confusion | Resolution summary doesn't include contact names; review reasons listed as codes without translation |

### Confirmation query

```sql
select match_confidence, match_reason, count(*)
  from workspace_contact_parcel_links
 where workspace_id = 'nicole-lonergan' and link_superseded_at is null
 group by match_confidence, match_reason
 order by match_confidence, match_reason;
```

---

## Phase 4 — Enrich (opportunity scoring)

### Dry run

```bash
npm run enrich-opportunity -- --customer=nicole-lonergan --sample=10
```

### Expected output

```
enrich-opportunity DRY-RUN {
  workspaceId: 'nicole-lonergan',
  contactsConsidered: ~130,
  internalDiagnosticSkipped: 0..16,
  contactsWithLink: <small N matches Phase 3 resolved>,
  contactsWithoutLink: <large N>,
  tiers: { HIGH: <n>, MED: <n>, WEAK: <n>, REVIEW: <n> },
  capReasonCounts: { ... },
  uncertaintyCounts: {
    no_listing_source_loaded: ~130,         // honest — MLS not loaded
    no_public_record_source_loaded: <large> // honest — most contacts unmatched
  },
  factorAppliedCounts: {
    verified_contact_path: <n>,
    stale_relationship_over_12mo: <n>,
    prior_seller_relationship: <n>,
    ...
  },
  topSourceBackedOpportunities: [ <samples> ],
  writes: { applied: 0, missing: 0 },        // dry-run
  mode: 'dry-run',
}

Sample factor breakdowns (top N source-backed contacts):
  Greg Smith (crm-abc12345)
    → HIGH · 80 · prior_seller_relationship · 4321 W 63rd St ... · owned 7+ yrs · no MLS source loaded yet
    + prior_seller_relationship          weight=30  source=crm:tag:Seller
    + operator_preference_seller_bias    weight=15  source=workspace:preferences.sellerBias
    + ownership_duration_over_7yr        weight=15  source=us-mo-jackson_manual_2026-05-27
    + stale_relationship_over_12mo       weight=10  source=crm:lastInteractionAt:2024-01-15T00:00:00Z
    + verified_contact_path              weight=10  source=crm:email
    ⚠ uncertainty: no_listing_source_loaded
```

### What to inspect manually — this is the highest-leverage inspection in the whole cycle

For **every** contact in `topSourceBackedOpportunities`:

1. **Does the score sum match?** Add the weight column. If `30 + 15 + 15 + 10 + 10 = 80`, the displayed score should be `80`. If it doesn't add up, the scorer is broken.
2. **Does the tier match the score?** HIGH = ≥70, MED = ≥40, WEAK = below 40, REVIEW = capped. If a contact has score 75 but tier MED, look for a `capReasonCounts` entry that explains it (`weak_owner_match` or `no_actionable_channel`).
3. **Does the address grounding look right?** Open the county parcel viewer in another tab. Paste the displayed `situsAddress`. Does the parcel exist? Does the owner name match what we have? If no — your hand-curated CSV has a typo OR the contact's CRM address doesn't actually point to that parcel.
4. **Is every applied factor justified?** "prior_seller_relationship" should only fire if the contact has a Seller-style tag. "ownership_duration_over_7yr" should only fire if their ownership start is ≥7 years ago. "verified_contact_path" should only fire if the contact has email or phone.
5. **Are the uncertainty flags honest?** A contact with NO MLS data should ALWAYS show `no_listing_source_loaded`. If it doesn't, the uncertainty layer is silent when it shouldn't be.

### Write

Only after every sample passed the 5-step inspection above:

```bash
npm run enrich-opportunity -- --customer=nicole-lonergan --write
```

Expected: `writes.applied` matches `contactsConsidered`; `writes.missing` is `0`.

### Indicators

| Problem class | Signal |
|---|---|
| Architecture | jsonb_set call errors; enrichment.opportunity appears under wrong key path; CRM-truth fields touched (run `check-reimport-survival` immediately) |
| **Scoring quality** | Score doesn't sum to applied weights; tier doesn't match score floor; a factor fires when it shouldn't; a factor doesn't fire when it should |
| **Trust** | HIGH tier on a contact whose parcel grounding is weak (matchConfidence=WEAK leaked past the cap); inflated score with no real basis; banned-phrase in any string (run validators if suspicious) |
| Operator confusion | Factor names mean nothing to operator without the doc open; the score is a number with no narrative; uncertainty codes need translation |

---

## Phase 5 — Audit

```bash
npm run crm:audit -- --customer=nicole-lonergan
```

### Expected sections (in order)

1. Record counts (total / visible / internal-diagnostic)
2. Integrity tiers (HIGH / MED / WEAK bars + percentages)
3. Field completeness (name / surname / phone / email / address / tags / notes / lastInteraction)
4. Trust-killer checks (Greg·Greg, no-channel, blank-name — all should be 0)
5. Repairs applied
6. Duplicate entities
7. Top gaps (most common WEAK/MED reason)
8. Enrichment eligibility (Hunter + Property)
9. **Public-record substrate** (NEW from Commit B)
10. **Workspace parcel resolution** (NEW from Commit B)
11. **Opportunity tier distribution** (NEW from Commit C)
12. **Top source-backed opportunities** (NEW from Commit C)
13. **Top applied factors** + **Top uncertainty reasons** + **Tier cap reasons** (NEW from Commit C)
14. Founder verdict (with any blocking issues)

### What to inspect manually

- **Integrity tiers** match Phase 3/4 dry-run figures.
- **Public-record substrate** shows your ingested parcel count and snapshot count.
- **Top source-backed opportunities** lists the contacts whose tier was elevated by ownership grounding. Read each line aloud — does the operator-readable framing feel calm + source-grounded?
- **Top applied factors** ranking. Which factor drives the most contacts? If it's `verified_contact_path` for most, that's fine — it's a real signal. If `operator_preference_seller_bias` is high count, that confirms Nicole's seller-side preference is reaching the score.
- **Tier cap reasons** count. `capped by weak owner match → REVIEW` should be small (≤ 2 for the manual cycle). `capped by no actionable channel → WEAK` is whatever the CRM rehab gap is.
- **Founder verdict** at the bottom. Should be ≤ 2 lines or `No blocking issues detected`. If it says "MAJORITY-WEAK workspace" — that's still true and that's fine; we know.

### Indicators

| Problem class | Signal |
|---|---|
| Architecture | An expected section is missing; the substrate section says "schema not initialized" |
| Scoring quality | Tier distribution percentages don't match enrich-opportunity dry-run figures; "Top source-backed" list disagrees with Phase 4 sample |
| Trust | A contact appears HIGH in the top-10 but the operator can't justify why; ownership_mismatch contacts inflate the top-10 |
| Operator confusion | Sections feel redundant; the founder verdict reads as boilerplate; bar charts don't add to clarity |

---

## Phase 6 — Inspect top opportunities (by hand)

Pick the **top 3** rows from "Top source-backed opportunities" in the audit. For each:

### Spend 2 minutes per contact

1. Open the CRM (or Nicole's WiseAgent/notes export) and look up the contact directly. Read their tags, notes, last interaction date.
2. Open the county parcel viewer for their address. Confirm the owner-of-record matches what we ingested.
3. Open Meridian's audit output and find this contact in the breakdown. Read the applied factors aloud:
   > "Greg Smith — HIGH at 80. Tagged Seller (30). Workspace seller bias (15). Owned 11 years (15). 2 years since last touch (10). Has email (10)."
4. Ask out loud: **"If I were Nicole and I read this brief, would I act differently than I would without it?"**

The third bullet is the only one that matters. If the answer is no, the substrate isn't producing operational value yet. If the answer is yes, write down WHY — which factor or grounding tipped you toward action.

### Indicators (this is where misleading signals show up)

| Problem class | Signal |
|---|---|
| Architecture | The contact appears in the audit but not in the CRM (orphan signal — should not exist) |
| **Scoring quality** | Operator reads the factors and immediately knows the right action is different — e.g., the contact JUST closed a deal three weeks ago but the system doesn't know because `lastInteractionAt` is stale in the CRM |
| **Trust** | Operator wouldn't say what the brief says aloud to anyone — language sounds inflated, presumptive, or off-tone |
| **Operator confusion** | Operator has to look up what a factor name means; the source string is opaque |

If any contact in the top-3 fails Bullet 4, that's the friction signal. **Document it** (Phase 8) — don't try to fix it on the spot.

---

## Phase 7 — Generate the operator brief

```bash
# Determinism check first — the brief generator should never drift.
npm run brief:determinism

# Generate the actual brief.
npm run weekly-state:generate -- --customer=nicole-lonergan
```

(Or whichever brief-generation entrypoint exists for Nicole's workspace — confirm via `package.json` if these names have drifted.)

### What to inspect

- Open the generated brief HTML / output.
- For each contact in the brief, read aloud:
  - The opener line
  - The supporting evidence
  - The opportunity grounding (if surfaced)
- Mark contacts where you would say:
  - ✓ "Yes, I'd open with that."
  - ~ "Close, but I'd reword."
  - ✗ "No, this doesn't reflect what I know about them."

The ratio of ✓ to (~ + ✗) is the operator-trust signal for the cycle.

### Indicators

| Problem class | Signal |
|---|---|
| Architecture | Brief generation crashes; some contacts missing; some contacts double-appear |
| Scoring quality | The brief surfaces a contact you would never open this week; misses one you would |
| **Trust** | An opener mentions a fact you can't trace (no source); confidence wording feels inflated; an opener says "you helped them sell" but you didn't |
| **Operator confusion** | Two openers for the same contact say contradictory things; supporting evidence is the same as opener (no new information); the opportunity tier badge feels detached from the opener narrative |

---

## Phase 8 — Document friction (the actual deliverable of this cycle)

Open `docs/operational-friction-2026-05-27.md` (create it). Capture what you observed using the "Things that felt wrong" framework below. **Be specific. No fixes yet.**

The point is to let real friction drive Commit D — not pre-emptive feature work.

---

# Checklists

## A — Monday Brief Validation Checklist

Run through these before declaring the cycle complete.

```
[ ] Pre-flight: DATABASE_URL set; validators green; backup CSVs saved to /tmp
[ ] Phase 1 — preprocessor admitted every expected row; canonical CSV is shaped correctly
[ ] Phase 2 — ingestion dry-run is clean before --write; --write produces expected insert counts
[ ] Phase 3 — resolver dry-run; resolved count matches the parcels I expect; --write proceeds
[ ] Phase 4 — enrich dry-run; I personally inspected EVERY top-source-backed contact;
    factor breakdowns sum to displayed scores; --write proceeds
[ ] Phase 5 — audit run; founder verdict is empty or expected; no blocking issue
[ ] Phase 6 — top-3 contacts each spent 2 minutes verifying:
    [ ] CRM record confirmed
    [ ] county parcel-viewer ownership confirmed
    [ ] would-I-act-differently → yes
[ ] Phase 7 — brief generated; opener ratio ✓ ≥ 60%
[ ] Phase 8 — friction document written with at minimum 3 concrete items
```

## B — Operator Trust Checklist

Read the brief once through. For each contact, score honestly:

```
[ ] Every claim cites a source the operator can verify in under 60s
[ ] No banned phrase ever appears (hot lead, likely motivated, high seller intent,
    ready to transact, AI believes — full list in INTELLIGENCE_SYSTEM_CONSTITUTION.md §6)
[ ] Opener wording is something the operator would actually say aloud
[ ] Tier matches operator's gut on contacts they know well
[ ] When tier is HIGH/MED, the operator can name the one fact that drove it
    without reading the breakdown
[ ] When the system says "uncertain" it actually IS uncertain — not just hedging
[ ] No "this contact is more likely to..." anywhere
[ ] When a fact would be wrong if asserted, the brief either says nothing or
    surfaces the uncertainty
[ ] The brief never claims you helped them with something you didn't
[ ] Sources are dated; "as of YYYY-MM-DD" is present where applicable
```

Trust failures are not bugs — they are wedge violations. Capture every one.

## C — Queue-Quality Checklist

Reading the prioritized contact list as a sequence:

```
[ ] The top-5 are people the operator would have prioritized anyway (=
    Meridian is at least matching baseline judgment)
[ ] At least ONE contact in the top-10 is someone the operator would NOT
    have prioritized anyway, AND on inspection deserves to be there
    (= Meridian is adding real value)
[ ] No contact in the top-10 is someone the operator would actively skip
    (= Meridian is not creating noise)
[ ] WEAK-tier contacts feel correctly demoted
[ ] REVIEW-tier contacts visibly carry their cap reason
[ ] Ordering within a tier feels reasonable (operator can't immediately spot
    a misordered pair)
[ ] No contact appears twice (no duplicate enrichment / duplicate identity)
[ ] No internal-diagnostic / test row leaked through
[ ] Contacts with "no actionable channel" are demoted to WEAK regardless of
    other factors — confirms the cap is firing
[ ] Reading the queue does NOT take longer than reading the brief itself
```

If items 1-3 all fire ✓, the queue is doing useful work. If any of 4-10 fail, that's where to focus next.

## D — "Things That Felt Wrong" Capture Framework

For each item, write 3-4 lines max. Speed matters more than completeness.

```
ID:                <short slug, e.g. "tier-margaret-wong">
What I observed:   <one sentence — "Margaret showed HIGH but she just
                    closed three weeks ago">
Where I saw it:    <phase + section — "Phase 6 inspection of top-3">
What it suggests:  <one sentence on the LIKELY root cause — "lastInteractionAt
                    didn't update in WiseAgent">
Category:          (one of:)
                   - data quality (CRM truth wrong)
                   - scoring quality (right inputs, wrong tier)
                   - trust signal (language inflated or unsourced)
                   - operator confusion (factor / source not parseable)
                   - workflow friction (took too long, too many steps)
                   - missing context (operator needs more, but pipeline
                     doesn't have it yet)
Severity:          (one of: blocks-monday | annoyed-me | curiosity)
```

Aim for ≥ 5 items per cycle. Most will be `annoyed-me` or `curiosity`. The `blocks-monday` ones drive the next commit.

After Phase 8, group by Category. The category with the most items is the next implementation priority.

## E — Post-Brief Audit Framework

After Monday's calls (Tuesday morning):

```
1. Did the operator actually act on Meridian's queue this week?
   - Top 5: which 5 did you actually reach out to / open?
   - Were they the same 5 the queue showed? If not, which differed?

2. For each contact contacted:
   - Did Meridian's opener help the conversation?
     [ ] Used the opener verbatim — and it landed
     [ ] Used the opener — landed flat
     [ ] Rewrote the opener — would have been better fresh
     [ ] Ignored the opener — contact context was different than expected
   - Did Meridian's stated grounding match operator's read of the contact?

3. Did any contact in the brief turn out to be wrong?
   - Wrong ownership (county data stale)
   - Wrong relationship type (mistagged in CRM)
   - Wrong staleness signal (last interaction was actually recent)
   - Wrong inferred priority

4. Did Meridian miss anyone who deserved to be in the top 5?
   - Why was the missing contact NOT surfaced?

5. Net judgment:
   [ ] Meridian made this Monday easier than last Monday
   [ ] Meridian made this Monday the same as last Monday (acceptable for
       cycle 1; not acceptable for cycle 4)
   [ ] Meridian made this Monday harder than last Monday
```

If item 5 is "easier" after 2-3 cycles, you have product-market fit on the wedge. If "same" — investigate why the substrate isn't producing leverage. If "harder" — pause new features and walk the friction document.

---

# What the cycle will and won't prove

## Will prove

- Whether the substrate produces ownership grounding the operator trusts
- Whether the scoring math feels right when contacts are walked one-by-one
- Whether the opener language is something a real person would say
- Whether the queue order matches operator judgment in the easy cases
- Where the workflow has too many manual steps
- Where information density is too high (or too low)

## Won't prove

- Whether scaling to 5 customers works (single workspace is intentional)
- Whether MLS / Dotloop integration is worth the build (not built; not testable)
- Whether scheduled automation is needed (not built; manual is intentional)
- Whether the current weights are optimal across customers (single sample)
- Whether the price point is right (separate conversation)

Don't try to extrapolate. Let cycles 2, 3, 4 add the resolution.

---

# What to do next, based on what surfaces

| If the friction document says... | Then the next commit is... |
|---|---|
| "I never noticed Meridian during the brief" | Investigate distribution / surfacing, NOT add features |
| "Tier was wrong on 3+ contacts I know well" | Walk the factor inputs for those 3; likely a CRM-truth gap, not a scoring bug |
| "Openers sound off" | Tighten the opener-builder language; review the constitution banned-phrase list |
| "I had to run too many commands" | Build the `refresh-workspace-state` orchestrator from audit Priority 4 |
| "I can't tell why X is HIGH without reading 5 lines" | Add a top-factor badge or condensed-tier rationale (UI minimal) |
| "Ownership data was wrong on N parcels" | Re-curate the manual CSV; do NOT add provider APIs |
| "Some opportunities had no actionable next step" | Surface contact-path source (email vs phone) in the opener evidence |
| "I needed MLS data for this to work" | THIS is the friction-driven case for the listings layer; build only after it shows up here, not before |
| "I never used the audit output" | Trim the audit to the 3 sections the founder actually read |

**The friction document is the spec for Commit D.** Resist building anything before it has content.

---

## Amendments

*(none yet — populate after the first cycle)*

## Cross-references

- [`docs/public-record-intelligence-architecture.md`](./public-record-intelligence-architecture.md)
- [`docs/public-record-intelligence-audit.md`](./public-record-intelligence-audit.md)
- [`autonomy/PRODUCT_CONSTITUTION.md`](../autonomy/PRODUCT_CONSTITUTION.md)
- [`docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md`](./INTELLIGENCE_SYSTEM_CONSTITUTION.md)
