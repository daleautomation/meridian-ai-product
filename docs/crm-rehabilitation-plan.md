# CRM Rehabilitation Plan — Nicole 130-Contact Corpus

> Issued 2026-05-28. Grounded in the live `check-grounding-quality`
> audit + source-level inspection of `lib/crm-import/normalize.ts`.
> Replaces the assumption that the 109-corpus needed parcel data with
> the finding that it first needs an import-boundary fix.

---

## The actual diagnosis

The audit numbers told a story I didn't expect:

| Metric | Count | Coverage |
|---|---|---|
| Visible contacts | 130 | — |
| Actionable channel | 112 | **86%** ← import handling this correctly |
| Seller-tagged | 21 | 16% |
| Buyer-tagged | 58 | 45% |
| **Contacts with a surname** | **1** | **0.8%** ← **import bug** |
| **Canonicalizable address** | **7** | **5%** ← **import bug** |
| **Parcel-eligible** | **0** | 0% |

The first two of those failures cannot be a CRM-content issue. Real estate
agents do not have CRMs where 99% of contacts are first-name only. They do
not have CRMs where 95% of addresses lack a city, state, or ZIP. Both
findings are the symptom of a single root cause.

### Source-level root cause

`lib/crm-import/normalize.ts` lines 12–49. The column-mapping subsystem
is "first match wins" — `getMappedValue` returns exactly one cell per
canonical field. The alias lists merge **distinct source columns** into
the same canonical target without concatenation:

```ts
name: [
  "name", "full name", ..., "first name", "firstname", "last name",
  "lastname", ...
],
address: [
  "address", "street", "location", "mailing address", "city state",
],
```

When WiseAgent exports a CSV with both `First Name` AND `Last Name`
columns (the standard shape), `getMappedValue("name")` matches `first name`
first and returns ONLY the first name. The surname column exists in the
CSV but is silently discarded.

Same pattern for `address`: WiseAgent typically exports `Street`, `City`,
`State`, `ZIP` as separate columns. The aliases mention `street` but
provide no path to combine all four. The import captures the street line
only — which `detectWeakAddress` correctly rejects as `missing_city`.

So:
- **Surnames** are sitting in the WiseAgent CSV. The import drops them.
- **Addresses** are sitting in the WiseAgent CSV. The import truncates them.
- **Channels** import correctly because phone + email are single-column fields.

The 1 surname and 7 canonical addresses are almost certainly contacts
whose creator manually typed a full name (or full address) into a single
field at some point. They're not a feature — they're the residual cases
where the import bug didn't fire.

---

## What this means for the roadmap

We are NOT building more parcel intelligence. We are NOT building more
scoring. We are NOT building enrichment.

We are repairing one module — the import normalizer — and re-importing
the existing data. The substrate is correct; the wedge is correct; the
intelligence layer is correct. The input pipeline is the bottleneck.

The Sev-1 hardening from yesterday (Priority 1 JSONB-merging upsert)
makes the re-import safe: every existing Hunter call, every opportunity
signal, every operator repair survives.

---

## The plan

### Phase A — Fix the import normalizer (engineering, ~3 hours)

Two concrete changes to `lib/crm-import/normalize.ts`:

#### A1. Multi-column name assembly

Replace the single-match name lookup with a deterministic assembly:

```
input columns (any subset present):
  "full name" | "name" | "contact name" | "display name"  →  name (single)
  "first name" | "firstname"                              →  first
  "last name" | "lastname"                                →  last
  "middle name" | "middle initial"                        →  middle

assembly rule (first applicable wins):
  1. If any single-column "full name"-class match → use it verbatim
  2. Else if both first AND last present → "${first} ${middle ?? ""} ${last}"
     (collapse whitespace; trim)
  3. Else if first only → use first (current degraded behavior; flag in
     validationWarnings)
  4. Else if last only → use last (rare; flag in validationWarnings)
```

The COLUMN_ALIASES `name` array splits into THREE arrays:
- `name` (full-name single-column)
- `firstName` (first-name component)
- `lastName` (last-name component)

`getMappedValue` returns one value per canonical field; the assembly
happens in `normalizeCrmRow`.

#### A2. Multi-column address assembly

Same pattern for address:

```
input columns:
  "address" | "mailing address" | "full address"   →  address (single)
  "street" | "street address" | "address line 1"   →  street
  "address line 2" | "unit" | "apt"                →  unit
  "city"                                            →  city
  "state" | "province"                              →  state
  "zip" | "postal code" | "zip code"                →  postalCode

assembly rule:
  1. If single-column "full address" match → use it verbatim
  2. Else if street present → "${street}${unit ? " " + unit : ""}, ${city}, ${state} ${zip}"
     (skip empty components, but every component must be present for
     the assembled string to be confidence-MED — otherwise flag in
     validationWarnings)
```

The COLUMN_ALIASES `address` array splits into:
- `address` (full single-column)
- `street`, `unit`, `city`, `state`, `postalCode` (components)

### Phase B — Validator update (engineering, ~30 min)

Extend `scripts/check-crm-integrity.ts` with fixtures that exercise the
new assembly paths:

- Full-name single column → admitted
- First + last components → admitted, combined verbatim
- First only → admitted with warning
- Street + city + state + zip → admitted, combined
- Street alone → admitted with warning
- Both single-column AND component columns present → single-column wins

This ensures the fix is regression-protected.

### Phase C — Re-import Nicole's source CSV (operational, ~15 min)

```bash
# Verify what the source CSV actually contains BEFORE re-importing.
head -1 <wiseagent-export>.csv
# Expect: "...,First Name,Last Name,Street,City,State,Zip,..."

# Re-import. The JSONB-merging upsert preserves enrichment + repairs.
# This call is now safe — see check-reimport-survival validator.
npm run crm-import:audit -- --customer=nicole-lonergan --in=<csv>
# Then operator confirms via the import UI / API.
```

### Phase D — Re-audit (operational, 1 min)

```bash
npm run check-grounding-quality -- --customer=nicole-lonergan
```

**Expected delta** (point estimates; ranges in §"Expected outcomes"):

| Metric | Before | After |
|---|---|---|
| Surnames | 1 / 130 | ~110 / 130 |
| Canonical addresses | 7 / 130 | ~95 / 130 |
| Parcel-eligible | 0 / 130 | ~70–90 / 130 |
| Top-likely-HIGH candidates (seller subset) | 0 | ~10–15 |

### Phase E — Tag the sellers in WiseAgent (operational, ~30 min)

After re-import succeeds, scan the 21 currently-Seller-tagged contacts.
If WiseAgent's seller-side book is larger (likely — most agents under-tag),
this is the 30-minute action that doubles the seller pool. Then re-import
again (still safe).

Expected after Phase E: seller-tagged count grows from 21 → ~35–45.

### Phase F — Start the first parcel lookup session

Per the lookup workflow doc (`docs/founder-parcel-lookup-workflow.md`):

```bash
npm run check-grounding-quality -- --customer=nicole-lonergan
# Section 4 — Top likely HIGH-tier candidates BEFORE enrichment
# now produces a real list.
```

Take the top 20 candidates. ~60 minutes per session of hand-curation.
Expected output: ~15–18 grounded contacts (some out-of-county, some
address mismatches).

---

## The 10 questions, answered

### 1. Highest-leverage rehab opportunities

In strict leverage order:

1. **Fix the multi-column name assembly in `normalize.ts`** — single change, unlocks ~99% of surnames. Single highest-leverage commit available.
2. **Fix the multi-column address assembly in `normalize.ts`** — same module, same commit. Unlocks ~90% of canonicalizable addresses.
3. **Re-import the existing WiseAgent CSV** — zero engineering; the hardening from yesterday makes this safe.
4. **Tag missing sellers in WiseAgent** — 30 minutes; doubles the HIGH-tier candidate pool.

Together these four steps move the corpus from 0% parcel-eligible to ~70%.

### 2. Which fields matter most for parcel grounding

Bare necessity for a contact to be parcel-eligible:

| Field | Why it matters | Current coverage | Failure mode |
|---|---|---|---|
| **Full name** (with surname) | Owner-match classifier requires ≥ 2 name tokens | **1/130** | Surname missing → matcher returns `no_match` → no link or WEAK link |
| **Canonical address** (street + city + state + ZIP) | `canonicalPropertyKey` requires all four to detect a non-weak address | **7/130** | Weak address → resolver returns NO_MATCH without trying |
| **Actionable channel** (email OR phone) | Opportunity scorer caps tier at WEAK without one | 112/130 (OK) | Already strong |

These three fields gate everything. Without all three, a contact cannot reach MED tier regardless of substrate state.

### 3. Which fields can be ignored (for now)

- **Company / organization** — no opportunity factor uses it; only surface in render
- **Notes** — important for the OPENER, not for parcel grounding
- **Tags** — important for relationship type, but separately
- **Last interaction** — drives `stale_relationship_over_12mo` factor but optional
- **sourceCrm** — audit metadata only
- **Score metadata** — derived
- Anything inside `enrichment.*` — derived

Optimize the import boundary for the three fields above and ignore everything else's coverage rate.

### 4. Estimated effort to rehabilitate the corpus

| Phase | Type | Time | Risk |
|---|---|---|---|
| A. Fix import normalizer | Engineering | 3 hours | Low — isolated module; covered by check-crm-integrity validator |
| B. Validator updates | Engineering | 30 min | Trivial |
| C. Re-import | Operational | 15 min | Low — JSONB-merging upsert validated |
| D. Re-audit | Operational | 1 min | Zero |
| E. Tag sellers in WiseAgent | Operational | 30 min | Operator discipline |
| F. First parcel lookup session | Operational | 60 min | The actual session |
| **Total to 15-grounded-contacts state** | | **~5–6 hours** | |

This is one focused day of work.

### 5. Fastest route to 20+ parcel-eligible contacts

Phase A + Phase C. Two changes:
- One small SQL-adjacent code commit
- One operator-driven re-import

Skip everything else in this list and you'll be at 70–90 parcel-eligible contacts the same day. ~20 of those will be in the seller subset that matters for HIGH tier.

### 6. Fastest route to trustworthy seller-side prioritization

Phases A + C + E. Three steps:
1. Code fix
2. Re-import
3. Audit + tag the missing sellers in WiseAgent + re-import again

Day-end state: ~35–45 seller-tagged contacts, ~25–30 of them parcel-eligible. After one ~60-minute parcel lookup session (Phase F), ~15–18 of them grounded. ~8–12 of those will hit HIGH tier when scored.

That's a real Monday queue.

### 7. Where should rehabilitation occur?

| Option | Verdict | Reasoning |
|---|---|---|
| **Inside Meridian (per-contact `repair:contacts`)** | NO | 130 × 5 minutes = 11 hours; doesn't scale; can't apply to future imports |
| **In WiseAgent** | NO for surnames/addresses | The data is already correct in WiseAgent. Repairing it there would be busywork. **YES for seller-tagging gaps** — this is a real WiseAgent action |
| **Via import transformations** | **YES** | Fix the normalizer. Data flows through correctly. Future imports benefit automatically. This is the only path that scales. |

The repair tooling exists for **edge cases the import can't handle** (operator-typed-only fields, post-import discoveries). For the systemic problems revealed by the audit, the import is the fix.

### 8. What should be repaired first

1. **The import normalizer** — single highest leverage; all subsequent work depends on it
2. The CSV re-import once the normalizer is fixed
3. The seller-tag audit in WiseAgent
4. Per-contact manual rehab via `repair:contacts` for the residual 20–40 contacts whose names/addresses are genuinely incomplete in WiseAgent itself

### 9. What should be repaired manually

After Phases A–E, the residual rehab class is:
- Contacts whose WiseAgent records lack surnames (real data gaps)
- Contacts whose addresses are pre-existing in WiseAgent as fragments (e.g., "downtown")
- Contacts in counties outside Jackson MO + Johnson KS (deferred until the substrate extends)

These get `repair:contacts` sessions of ~15–30 contacts each. Founder time budget per session: ≤ 45 minutes.

### 10. What should be automated later

Nothing in the constraint window. Specifically NOT to be automated:

- **WiseAgent ↔ Meridian sync** — the import boundary must remain operator-explicit during founder-stage validation
- **Auto-tagging contacts** based on inferred relationship type — constitutional violation
- **Auto-merging duplicates** — must stay operator-confirmed
- **Provider-API enrichment** — wedge violation

Automation candidates to revisit **after** the 109 graduate beyond the five scale gates:
- Scheduled re-import from WiseAgent (probably weekly cron, operator-supervised at first)
- Automatic re-resolve + re-enrich after each import (orchestrator script; not background job)

---

## Expected outcomes

### After Phase A (import fix, no re-import yet)

- Validators still pass (no behavior change for already-imported data)
- New import test fixtures prove multi-column assembly works
- Old data unchanged

### After Phase C (re-import)

| Metric | Before | After (estimated) | Range |
|---|---|---|---|
| Visible contacts | 130 | 130 | unchanged |
| Surnames | 1 | **~110** | 100–120 |
| Canonical addresses | 7 | **~95** | 80–110 |
| Channels | 112 | 112 | unchanged |
| Parcel-eligible | 0 | **~75** | 60–90 |
| Seller-tagged | 21 | 21 | unchanged (tagging unaffected by normalize) |

### After Phase E (seller tagging)

- Seller-tagged: 21 → **~38** (range 30–45)

### After Phase F (first 60-minute parcel session)

- Grounded contacts: 0 → **~15** (range 12–18, accounting for out-of-county + address mismatches)
- HIGH-tier projected: 0 → **~8** (range 6–12 — sellers with grounding + stale + channel)

### After two more parcel lookup sessions (~3 weeks operational)

- Grounded contacts: ~40
- HIGH-tier: 8–15 sustained (the corpus's structural ceiling)
- The 109 (now 130) graduates the five scale gates if the operator-trust signals fire across cycles 2 and 3

---

## Exact next operational actions

In order. Each is ≤ 2 hours.

1. **Read** `lib/crm-import/normalize.ts` end-to-end to confirm my source-level diagnosis.
2. **Look at the actual WiseAgent CSV** Nicole imported. Confirm:
   - Are there separate First Name / Last Name columns?
   - Are there separate Street / City / State / Zip columns?
   - Is the column shape consistent with the diagnosis?
   - If yes, proceed. If no, the diagnosis needs revision before code change.
3. **Implement Phase A1** (multi-column name assembly) with `check-crm-integrity` fixtures
4. **Implement Phase A2** (multi-column address assembly) with `check-crm-integrity` fixtures
5. **Run** `npm run check-crm-integrity && npm run check-reimport-survival && npm run build`
6. **Re-import** the WiseAgent CSV via the operator import API
7. **Re-run** `npm run check-grounding-quality -- --customer=nicole-lonergan`
8. **Confirm** the surname + canonical address coverage rates jump as expected
9. **Audit WiseAgent** for missing seller tags; bulk-tag; re-import once more
10. **Start** the first parcel lookup session against `check-grounding-quality` Section 4

---

## Cross-references

- [`lib/crm-import/normalize.ts`](../lib/crm-import/normalize.ts) — the module to fix
- [`scripts/check-grounding-quality.ts`](../scripts/check-grounding-quality.ts) — the visibility tool that surfaced this
- [`scripts/check-crm-integrity.ts`](../scripts/check-crm-integrity.ts) — extend with assembly fixtures
- [`scripts/check-reimport-survival.ts`](../scripts/check-reimport-survival.ts) — proves re-import is safe
- [`docs/founder-parcel-lookup-workflow.md`](./founder-parcel-lookup-workflow.md) — what happens after Phase F
- [`docs/first-monday-brief-validation.md`](./first-monday-brief-validation.md) — the validation cycle the corpus feeds
