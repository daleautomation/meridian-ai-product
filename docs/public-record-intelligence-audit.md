# Public-Record Intelligence Architecture — Operational Audit

> Issued 2026-05-27, after Commits A/B/C of the Public-Record
> Intelligence Architecture v1 ship. Companion to
> `docs/public-record-intelligence-architecture.md`. Source-grounded
> assessment of the path from already-imported CRM contacts → canonical
> ownership substrate → opportunity tier display, with adversarial
> walks, hardening priorities, and the things that should NOT be built
> yet.
>
> Scope: ingestion architecture, persistence boundaries, enrichment
> lifecycle, workspace isolation, scoring trust. Not in scope: UI
> redesign, MLS / Dotloop / provider integrations, predictive logic.

---

## 1. Architectural Verdict

**The substrate is structurally sound. Two destructive write paths in the existing CRM-import layer are the blocking risk before paid-customer rollout.**

The split — canonical public-record entities (workspace-agnostic) + workspace-scoped link table + per-contact denormalized cache (`enrichment.opportunity`) — is the right shape and scales cleanly to multi-tenant + multi-county + future MLS/Dotloop. The canonical pipeline (preprocess → ingest → resolve → enrich) is deterministic, source-grounded, append-friendly, and idempotent across re-runs.

What is NOT sound today is the **CRM re-import boundary**. Two paths in `lib/crm-import/crmContactsNeonAdapter.ts` will silently destroy enrichment + repairs the first time a customer's CRM is re-synced after Commit C ships:

1. `upsertContactsNeon` (line 397): `on conflict (workspace_id, contact_id) do update set ... source_metadata = excluded.source_metadata` — overwrites the entire `source_metadata` JSONB. This wipes `enrichment.{hunter, opportunity, propertyIntelligence}` and `repairs[]`.
2. `replaceWorkspaceContactsNeon` (line 411): `delete from crm_contacts where workspace_id = $1` then re-insert. Hard-deletes contacts; orphans every `workspace_contact_parcel_links` row pointing at them; loses everything in `source_metadata`.

Both paths are reachable from `lib/crm-import/store.ts:writeWorkspaceContacts` and `upsertContacts`, which are the canonical import API surfaces.

For the founder-stage one-customer pre-pricing window this hasn't bitten anyone because no re-imports have happened. For paid customers — even Nicole, who will eventually re-sync Wise Agent — this will silently wipe everything between Hunter and Opportunity on every re-import.

Everything else is acceptable for v1 with operator-trust hardening (see §7).

---

## 2. Recommended Ingestion Model

### CRM contacts (already-imported, the focus of this audit)

**Treat existing contacts as the canonical identity layer. Enrichment is layered separately and survives re-imports.**

Concrete rules:

| Field family | Storage | Re-import behavior |
|---|---|---|
| `normalized.*` (name, company, phone, email, address) | `crm_contacts.normalized` JSONB | **Overwrite** — CRM is source-of-truth for these |
| `trust` (T1–T6 tier metadata) | `crm_contacts.trust` JSONB | **Overwrite** |
| `source_metadata.tags / notes / lastInteractionAt / sourceCrm / importJobId` | inside JSONB | **Overwrite** (these come from CRM) |
| `source_metadata.repairs[]` | inside JSONB | **Preserve** — operator T1 truth |
| `source_metadata.enrichment.*` (Hunter, opportunity, propertyIntelligence) | inside JSONB | **Preserve** — derived from external sources, costly to re-derive |
| `source_metadata.scoreMetadata` | inside JSONB | **Preserve** (or invalidate when normalized changes — see §4) |
| `workspace_contact_parcel_links` | separate table | **Preserve** unless the contact_id no longer exists |

The fix shape: change the `ON CONFLICT DO UPDATE` to a **shallow JSONB merge** for `source_metadata`, where the import-side keys (`tags`, `notes`, `lastInteractionAt`, etc.) overwrite but `repairs` and `enrichment` are kept from the existing row. SQL pattern:

```sql
on conflict (workspace_id, contact_id) do update set
  normalized = excluded.normalized,
  trust = excluded.trust,
  source_metadata =
    coalesce(crm_contacts.source_metadata, '{}'::jsonb)
    || excluded.source_metadata                          -- shallow overwrite for top-level CRM-truth keys
    || jsonb_build_object(                                -- but keep operator + enrichment truth
      'repairs', coalesce(crm_contacts.source_metadata->'repairs', '[]'::jsonb),
      'enrichment', coalesce(crm_contacts.source_metadata->'enrichment', '{}'::jsonb)
    ),
  updated_at = excluded.updated_at
```

(The order matters: `excluded` first, then re-overlay the protected keys.)

`replaceWorkspaceContactsNeon` should remain available but only for **explicit destructive operations** (snapshot restore, workspace teardown). It should NOT be the path for "I re-imported my CSV." Caller intent must be explicit.

### Public-record substrate (already-ingested data)

The Commit A/B/C substrate is correct as-is:
- **Append-only snapshots** — never overwritten; new observations create new rows
- **Upsert-only parcels** — `firstObservedAt` immutable; `lastObservedAt` monotonic forward
- **Workspace-scoped links** with supersession chains — old rows stay queryable for audit

No changes needed here. The deterministic ID strategy means re-ingesting the same source CSV is a no-op.

---

## 3. Recommended Persistence Strategy

### What to persist

| Data | Where | Why |
|---|---|---|
| CRM contact identity + trust + repairs | `crm_contacts` | Source of truth, T1–T3 |
| Public parcels | `public_parcels` (workspace-agnostic) | Public record; shared across customers in same county |
| Ownership snapshots | `public_ownership_snapshots` (workspace-agnostic, append-only) | Audit history; cross-source disagreement detection |
| Contact ↔ parcel links | `workspace_contact_parcel_links` (workspace-scoped, supersession-tracked) | Tenant-isolated join state |
| Opportunity signal | `crm_contacts.source_metadata.enrichment.opportunity` (denormalized read-cache) | Fast `/personal` rendering; full provenance preserved |

### What to compute on demand

| Data | Why not persist |
|---|---|
| Address canonical keys at query time | Cheap; deterministic; derivable from `normalized.address`. Persisting would just be a column duplicating the function output. |
| `ownershipDurationYears` | Function of `ownershipStartDate + now`. Persisting freezes it; computing keeps it current without refresh. |
| Founder-verdict text | Already derived in `crm-audit.ts` from counts. No reason to materialize. |
| Tier rank ordering across the workspace | A presentation-layer concern; rebuild on each `/personal` render. |

### What should NEVER be persisted

1. **Predicted future behavior** — "likelihood to sell", "expected close date", "engagement probability". Forbidden by `INTELLIGENCE_SYSTEM_CONSTITUTION.md` §6 and §12. There is no scoring path that produces these today; resist any temptation to add one.
2. **Cross-workspace aggregates of customer-private data** — operator outcomes, customer contact lists, reply rates. Constitutional violation (§6.11).
3. **Owner-name normalization across snapshots** — keep verbatim. The matcher does its work at query time on token sets. Normalizing names destroys audit traceability.
4. **Predicted contact merge decisions** — surface candidates; never auto-merge.
5. **Decayed factor weights** — the scorer marks factors as `decayed: true, applied: false`. Don't persist a "decayed weight" because that suggests a partial contribution. Either applied with full weight, or not.
6. **Imagery, geometry, GIS layers** — out of scope; would force a GIS-company refactor.

---

## 4. Recommended Enrichment Lifecycle

The pipeline today is **manual-trigger, run-to-completion, no auto-invalidation**. That is correct for founder-stage. The lifecycle needs explicit semantics before paid-customer.

```
Trigger:    operator-explicit (npm run enrich-opportunity --write)
Cadence:    on-demand initially; pre-Monday-brief at minimum
Atomicity:  per-contact (one jsonb_set per contact); no cross-contact tx
Failure:    safe-resume — re-running picks up where it left off; ids are
            deterministic so writes are idempotent
Staleness:  detected, NOT auto-fixed:
              • stale_observation review flag (snapshot > 540 days)
              • no_public_record_source_loaded uncertainty (no link)
              • no_listing_source_loaded uncertainty (no MLS layer yet)
Invalidation: NONE automatic. Re-running enrich-opportunity is the
              authoritative refresh signal.
```

**The invalidation gap is real but bounded.** The opportunity signal on a contact is a denormalized cache of:
- contact's name + tags + lastInteractionAt (CRM truth)
- workspace's sellerBias preference (config)
- the active parcel link's matchConfidence (Commit B output)
- the snapshot the link points to (Commit B output)
- listing data (not loaded)

If ANY of these change, the cached signal goes stale. The system doesn't detect that today.

**The right boundary**: lifecycle dependencies are explicit, NOT enforced by the DB.

| Upstream change | Downstream that goes stale | Refresh action |
|---|---|---|
| CRM contact re-import | repairs not affected; enrichment.opportunity becomes stale relative to new tags/lastInteractionAt | re-run `enrich-opportunity` |
| Public-records ingestion (new snapshot) | `getLatestOwnershipSnapshot` now returns a different row; links may need supersession | re-run `resolve-contact-parcels` then `enrich-opportunity` |
| Identity resolution re-run | links may change confidence / parcel id | re-run `enrich-opportunity` |
| Workspace preference change (sellerBias) | every contact's signal | re-run `enrich-opportunity` |

For founder-stage: document this and make the orchestration a single npm script (see §8). For paid customers: a `refresh-state` table tracking "last enrichment run vs last contact mutation" gives a yes/no staleness answer without auto-running expensive work.

---

## 5. Critical Risks

Risks that could corrupt operator trust or force a painful migration. Ordered by severity.

### Sev-1: CRM re-import destroys enrichment + repairs

`upsertContactsNeon`'s ON CONFLICT clause overwrites `source_metadata` wholesale. Any re-import — operator-driven, scheduled-sync-driven, or future bidirectional-sync-driven — silently wipes:
- `repairs[]` (operator-entered T1 truth: surname fixes, company corrections, address repairs)
- `enrichment.hunter` (paid API data with confidence + fetch date)
- `enrichment.opportunity` (the public-record-grounded signal)
- `enrichment.propertyIntelligence` (if/when populated)

**Detection**: silent today. The audit doesn't flag "enrichment count dropped to zero after re-import" because no comparison-over-time is tracked.

**Blast radius**: a single re-import zeroes out the entire workspace's enrichment + every operator repair. Re-running `repair-contacts`, `enrich:nicole:hunter`, `resolve-contact-parcels`, and `enrich-opportunity` is required to restore — and the hand-typed repairs may not be re-derivable without operator memory.

**Mitigation (in §7)**: jsonb merge preserving `repairs` + `enrichment`.

### Sev-1: `replaceWorkspaceContactsNeon` is destructive + orphans canonical links

Used by `writeWorkspaceContacts` (the "replace whole workspace" import path) and by `restoreFromSnapshot`. Hard-DELETE + re-INSERT.

- Destroys every contact row, including `source_metadata.repairs[]` and all `enrichment.*`
- Orphans every `workspace_contact_parcel_links` row pointing at those contacts (no FK from links to crm_contacts exists today — see Sev-2 below)
- Workspace's opportunity signals + parcel resolution state silently zeroed

**Mitigation**: rename to `_destructiveReplaceWorkspaceContactsNeon` or similar to make caller intent explicit. The merging-upsert (Sev-1 above) becomes the default re-import path; destructive replace requires explicit confirmation.

### Sev-2: Links have no FK to `crm_contacts`

`workspace_contact_parcel_links.contact_id` is just text; it does NOT reference `crm_contacts(workspace_id, contact_id)`. A contact deletion leaves orphan link rows. The architecture doc says the FK should exist; the actual `initSchema.ts` does not include it.

**Impact today**: minimal — no contact deletion path is in routine use beyond `replaceWorkspaceContactsNeon`, and that already destroys enrichment too. But once a contact-delete or contact-merge tool ships, orphan links will accumulate.

**Mitigation**: add the FK in a follow-up schema migration with `ON DELETE CASCADE`. Cascading deletes orphan links + their supersession chain in one shot.

### Sev-2: No re-evaluation of frozen link confidence when contact name changes

`workspace_contact_parcel_links.matchConfidence` and `matchReason` are computed at link-creation time from the contact's name + the snapshot's owner. If a CRM re-import changes the contact's name (`Greg Smith` → `Gregory A. Smith`), the link's confidence is no longer correct. Re-running `resolve-contact-parcels` updates it; that re-run is operator-explicit, not automatic.

**Impact**: a contact whose name is corrected to better match the owner-of-record could be displayed at MED forever instead of being upgraded to HIGH.

**Mitigation**: re-running `resolve-contact-parcels` is already idempotent + safe. The fix is process, not code: every CRM re-import should be followed by `resolve-contact-parcels` + `enrich-opportunity`. Wire into the same single command.

### Sev-2: Conflicting snapshots from different sources go silently to "newest wins"

`getLatestOwnershipSnapshot` returns the most recent snapshot by `observed_at`, tie-broken by `id` ascending. If two sources (e.g. JoCo AIMS export + a county Sunshine response in the same week) disagree about the owner of a parcel, one silently wins. The operator never sees the conflict.

**Impact today**: zero — only one source ingests per parcel. **Impact under multi-source**: possible silent misattribution.

**Mitigation**: add an audit query "parcels with cross-source disagreement in the last N snapshots." Don't auto-resolve; surface it. The constitution requires operator review of ambiguity.

### Sev-3: Stale enrichment signal goes undetected on the cache

`enrichment.opportunity` carries `fetchedAt` but the read path doesn't enforce a freshness window. Workspace render today shows whatever was last written. If the operator hasn't run `enrich-opportunity` for 60 days but `lastInteractionAt` has advanced since, the tier displayed is stale.

**Impact**: opportunity tiers can lag CRM truth by however long it's been since last enrichment.

**Mitigation**: surface "signal last refreshed Xd ago" alongside the tier in audit + future UI. Don't auto-invalidate (deterministic display matters more than auto-refresh).

### Sev-3: Duplicate contacts inflate priority list

Two contact rows for "Greg Smith" → two contact_ids → two links to the same parcel (different link_ids because `workspaceId+contactId+parcelId` hashes differ) → two opportunity signals → two HIGH-tier display lines.

**Impact**: the audit already surfaces duplicate counts via `detectDuplicates` in `crm-audit.ts`. Until a merge tool exists, operator sees the duplication.

**Mitigation**: short-term — audit visibility is sufficient. Medium-term — build a merge tool that creates a `_canonical_contact_id` indirection, supersedes old links, and unwinds duplicate enrichment cleanly. **Do not auto-merge.**

### Sev-3: WEAK ownership_mismatch links still carry an opportunity signal

The resolver creates a link with `matchConfidence: "WEAK"` + `matchReason: "ownership_mismatch"` when address matches but owner doesn't. The opportunity scorer caps the tier at WEAK (no_actionable_channel OR weak_owner_match), but a signal is still written.

**Impact**: the operator gets a WEAK opportunity for a contact who doesn't actually own the property at that address. With audit visibility ("capped by weak owner match") this is honest, but a casual scan could miss the cap reason.

**Mitigation**: the audit's "Top source-backed opportunities" should EXCLUDE `ownership_mismatch`-only signals, OR mark them clearly with a `(mismatch)` tag. The constitution requires this honesty.

---

## 6. Hidden Technical Debt Risks

Things that work today but will force a painful migration later if not corrected before scale.

### A. `enrichment.opportunity` payload schema is unversioned

`source: "meridian_opportunity_v1"` is a runtime field but there's no schema-version column or migration plan. If a future commit changes the OpportunitySignal shape (e.g., renames a factor, adds required fields), existing cached signals will deserialize partially. Type checking won't catch it at read time because `enrichment.opportunity` is a JSONB cell, not a typed column.

**Forced migration trigger**: any change to OpportunitySignal that isn't a strict superset.

**Mitigation**: a `migrations/opportunity-signal/` runner that re-derives `enrichment.opportunity` from canonical substrate when the schema version changes. Already covered by the existing pipeline — re-run `enrich-opportunity` is the migration. Encode the version check in the audit so stale-schema signals are flagged.

### B. Single OpportunitySignal per contact — no history

Today's cache stores only the latest signal. If a contact moves from HIGH to WEAK to HIGH over 6 months, only the last value is visible. The audit "tier distribution" is point-in-time; the operator can't see "Greg dropped from HIGH to WEAK in March."

**When this hurts**: outcome-loop analysis ("did contacting HIGH-tier contacts actually correlate with closes?"). The Outcome Loop module exists but isn't wired to opportunity. Without signal history, the correlation can only be computed forward from when the pipeline first ran.

**Mitigation (deferred)**: add an `opportunity_signal_history` table keyed by `(workspace_id, contact_id, computed_at)` that stores prior signals at coarse cadence (weekly?). This is genuine deferred work — not needed for v1.

### C. Canonical substrate has no audit log of WHO ran ingestion / resolution / enrichment

Every script run mutates Neon state but leaves no breadcrumb beyond `created_at`. If a customer asks "who ran the September enrichment and what was the result," the answer requires log files that may not exist.

**Mitigation**: a `meridian_pipeline_runs` table tracking `(workspace_id?, script_name, started_at, completed_at, args, summary_json)`. Cheap to add; high-leverage for trust + debugging.

### D. The CRM import flow knows nothing about the canonical substrate

`writeWorkspaceContacts` and `upsertContacts` are pre-Commit-A architecture. They don't trigger `resolve-contact-parcels` or `enrich-opportunity`. So after a re-import, the workspace's enrichment state is stale until the operator manually re-runs them — and they may forget.

**Mitigation**: a "post-import refresh hook" — a single function the import flow calls that conditionally re-runs resolve + enrich when canonical data is present. Make it explicit in `lib/crm-import/store.ts` so future maintainers see it.

### E. The repair overlay is application-layer, not DB-layer

Repairs are stored in `source_metadata.repairs[]` and applied in `rowToContact()` at read time. Any SQL query bypassing `rowToContact` (raw SQL aggregates, analytics jobs, debug views) sees the IMPORT-TIME values, not the repaired values.

**Today**: only `crm-audit` and the workspace render use `rowToContact`. Direct SQL is rare.

**When this hurts**: when a future analytics or BI surface queries `crm_contacts` directly with `select normalized->'name'` for reporting. The repair overlay won't apply and reports will use stale names.

**Mitigation**: a Postgres view `crm_contacts_repaired` that materializes the overlay. Defer until needed; document as known.

### F. No cross-county canonical-key ambiguity detection at write time

Today, two parcels in different counties with the same canonical address are correctly stored as separate rows (county_code is part of the natural key). At resolution time, `resolve-contact-parcels` gathers candidates across supported counties and surfaces `ambiguous_parcel` outcomes. But there's no AUDIT view of "addresses that are ambiguous across counties."

**When this hurts**: if a future state has many cross-county overlaps (e.g., the KC metro spans two states), ambiguous contacts will accumulate silently.

**Mitigation**: extend `auditView.ts` with a query that surfaces canonical keys appearing in ≥2 counties.

---

## 7. Immediate Hardening Priorities (before paid customers)

Ordered by leverage. Each item is small in code-volume and large in trust-preservation.

### Priority 1: Make `upsertContactsNeon` a JSONB-merging upsert

Replace the wholesale `source_metadata = excluded.source_metadata` with the merging pattern from §2. Protected keys: `repairs`, `enrichment`. Everything else (tags, notes, lastInteractionAt, sourceCrm, importJobId) overwrites from the import.

Tests: extend `check-crm-integrity` with a re-import fixture that asserts `repairs` and `enrichment.opportunity` survive.

**Effort**: ~30 lines of SQL change + 5 fixtures. **Impact**: closes Sev-1.

### Priority 2: Rename `replaceWorkspaceContactsNeon` to surface intent

Rename it to `destructivelyReplaceWorkspaceContactsNeon`. Update callers — `writeWorkspaceContacts` (CRM import) should NOT call it; only `restoreFromSnapshot` should. The import path should call the merging upsert from Priority 1.

**Effort**: rename + 2 callsite updates. **Impact**: closes the second half of Sev-1; makes a destructive operation conspicuous.

### Priority 3: Add the missing FK on `workspace_contact_parcel_links` with `ON DELETE CASCADE`

Add a migration that creates `foreign key (workspace_id, contact_id) references crm_contacts(workspace_id, contact_id) on delete cascade`. Future contact deletions clean up cleanly.

**Effort**: 1 SQL migration. **Impact**: closes Sev-2.

### Priority 4: Single `refresh-state` command

`scripts/refresh-workspace-state.ts -- --customer=<slug>` that runs `resolve-contact-parcels` then `enrich-opportunity` in sequence. The operator (or, later, the CRM-import flow) calls this after any CRM re-import. Documented in the runbook as the one-step-to-recompute-everything.

**Effort**: ~80 LOC orchestration script. **Impact**: closes the lifecycle gap (Sev-2 frozen confidence + Sev-3 stale signals).

### Priority 5: Audit: distinguish `ownership_mismatch` opportunities visually

`crm-audit.ts` "Top source-backed opportunities" should mark rows whose `matchReason === "ownership_mismatch"` with a clear tag (`(mismatch — verify)`) and exclude them from the top-10 unless explicitly requested via flag. Today they could be quietly mixed in.

**Effort**: ~20 lines in `crm-audit.ts`. **Impact**: closes Sev-3 ownership-mismatch surface.

### Priority 6: Pipeline-run audit log

Add a `meridian_pipeline_runs` table; every Commit B/C script writes a row at completion. Founder gets an answer to "when did this last refresh, with what scope?" without grepping shell history.

**Effort**: schema + a thin `logPipelineRun(...)` helper. **Impact**: closes hidden-debt risk C; high trust value for paid customers.

### Priority 7: Re-import test that asserts enrichment survival

Add `scripts/check-reimport-preserves-enrichment.ts` — synthetic round-trip: insert contact with enrichment + repairs → re-import same contact_id with different normalized fields → assert enrichment + repairs survive verbatim. This is the regression that proves Priority 1 actually works.

**Effort**: 1 validator. **Impact**: prevents future regressions on the most critical path.

---

## 8. Safe Next Implementation Steps

The following order minimizes risk and maximizes operator trust before paid-customer rollout.

```
Week of 2026-05-27 — hardening sprint (no new features)
  1. Implement Priority 1 (merging upsert)              [Sev-1 close]
  2. Implement Priority 2 (rename destructive replace)   [Sev-1 close]
  3. Implement Priority 7 (re-import survival validator) [regression gate]
  4. Implement Priority 3 (FK + cascade)                 [Sev-2 close]
  5. Implement Priority 5 (audit mismatch tag)           [Sev-3 close]

Week of 2026-06-03 — operational hardening
  6. Implement Priority 4 (refresh-workspace-state)
  7. Implement Priority 6 (pipeline run log)
  8. Document operator runbook update — re-import sequence

Founder live with one customer (Nicole)
  9. Run end-to-end: county data acquisition (per
     property-data acquisition path) → preprocess → ingest →
     resolve → enrich → audit
  10. Use the system for one full Monday brief cycle WITHOUT
      changing architecture; capture friction
  11. Address whatever real friction surfaces; resist building
      anticipated features

Paid customer rollout (when item 10 produces a clean brief)
  12. Per-customer canonical CSV ingestion (no automation)
  13. Audit visibility surface in /personal (deferred — not
      until needed)
  14. Stale-snapshot detection automation (deferred)
```

---

## 9. Unsafe Implementation Paths to Avoid

Each of these would corrupt the operator-first wedge or force a painful migration. Some are tempting; reject them.

### A. Provider API integration (ATTOM / Regrid / Estated) as a shortcut around county Open Records
**Why tempting**: faster ingestion, broader coverage. **Why fatal**: per-row licensing fees, redistribution restrictions, opaque attribution chains, no audit traceability to a public record. The constitution permits county-acquired data; provider-acquired data carries vendor-imposed constraints that may forbid the very use case (e.g., showing data to a paid customer who is not the licensee).

### B. Auto-merging duplicate contacts
**Why tempting**: cleaner audit numbers, less operator friction. **Why fatal**: false merges destroy contact-specific history (notes, last interaction date, tags). Any merge must be operator-confirmed with full visibility of what is collapsing.

### C. Auto-running enrich-opportunity on every CRM write
**Why tempting**: always-fresh signals. **Why fatal**: write amplification (every CRM webhook triggers a full re-score), nondeterministic display state (race conditions between concurrent writes), expensive opportunity-cache invalidation on every minor edit. The constitution prefers explicit refresh.

### D. Predictive scoring layer ("propensity to sell")
**Why tempting**: differentiation, AI-vibes pricing. **Why fatal**: constitutional violation (§6, §12). Destroys the deterministic-trust wedge. Once you have a predictive score, customers compare it to ATTOM/CoreLogic and you lose the "no fake intelligence" story.

### E. Cross-customer data products ("Nicole's HIGH-tier contacts also tend to..."  )
**Why tempting**: network-effect framing, "Meridian gets smarter with more customers." **Why fatal**: constitutional violation (§6.11). Once one customer's contacts inform another customer's scoring, the operator-first wedge is dead — Meridian becomes a data aggregator with all the legal exposure that brings.

### F. Schemaless / EAV enrichment storage
**Why tempting**: flexibility, "we can add any new factor without migration." **Why fatal**: scoring becomes ungovernable. The closed factor set in `OpportunityFactorName` is a feature, not a constraint — every factor has a name, weight, source, and constitutional audit path. EAV destroys that.

### G. Bidirectional CRM sync (write back to Wise Agent / FUB)
**Why tempting**: operator convenience. **Why fatal**: Meridian then becomes responsible for CRM data integrity in two systems, which means every bug is a customer-CRM bug. The integration philosophy doc forbids this for v1.

### H. ORM / Prisma / Drizzle introduction
**Why tempting**: type safety on raw SQL strings. **Why fatal**: the current Neon-native tagged-template approach is fewer dependencies, fewer migrations, fewer surprises. The substrate's SQL is small (3 tables + indexes + a handful of upserts) and the determinism contract benefits from inspectable SQL. An ORM hides what is currently auditable.

### I. Background job queue (BullMQ, Inngest, Trigger.dev)
**Why tempting**: "production-grade" ingestion. **Why fatal**: founder-stage doesn't have the volume to justify the operational complexity. Manual `npm run` scripts give the operator total visibility. Add a queue only when manual runs measurably bottleneck.

---

## 10. Final Recommendation Before Live Customer Rollout

**Ship the seven hardening priorities (§7) before paid customer #1 imports their first CRM. Then run two full Monday brief cycles with one customer (Nicole) using the unmodified architecture. Only build new features after that experience surfaces real friction.**

The substrate from Commits A/B/C is the correct shape. The wedge — operator-first, deterministic, source-grounded — is intact. The two re-import destructiveness bugs are real and would surface immediately on the first re-sync; they are the only remaining barriers to paid-customer trust.

After the hardening sprint, the architecture supports — without refactor:
- Second customer in JoCo at $0 acquisition cost (parcels + snapshots already shared)
- Third county via a single preprocessor commit
- MLS layer ingestion via the same canonical model (listings join by `propertyKey` to existing parcels)
- Dotloop transaction history via the same join axis
- Outcome loop integration (opportunity signal history table — deferred until needed)
- Multi-source disagreement audit (single SQL view — deferred until needed)

Resist building any of the above before the first customer cycle completes. The temptation to over-engineer is the largest invisible risk in this architecture; the constraints document already calls it out. Trust the substrate. Sand the rough edges. Then run real briefs.

---

## Appendix A — Answers to the 10 audit questions, indexed

| Q | Answer (one-line) | Section |
|---|---|---|
| 1. Best long-term ingestion architecture? | Canonical parcels (shared) + workspace links (scoped) + per-contact enrichment cache. Already in place. | §2 |
| 2. Persist vs compute? | Persist: substrate + signal cache. Compute: canonical keys, durations, presentation rankings. | §3 |
| 3. Never persist? | Predicted behavior, normalized owner names, cross-tenant aggregates, decayed weights, geometry. | §3 |
| 4. Highest operator trust? | Every claim cites source + observedAt; absence is named (not invented); re-runs are idempotent. | §1, §4 |
| 5. Lowest architecture drift? | Per-source preprocessors at the edges; canonical pipeline at the core. Already structured this way. | §1 |
| 6. Scales to millions? | Append-only snapshots + idempotent IDs + per-workspace link queries. Yes — Postgres can carry it. The bottleneck will be acquisition, not storage. | §3 |
| 7. Could silently corrupt scoring? | The two destructive re-import paths (Sev-1) + frozen link confidence (Sev-2) + ownership_mismatch surface (Sev-3). | §5 |
| 8. Painful future migration? | Unversioned signal schema (debt A), missing FK (Sev-2), no signal history (debt B), repair overlay at app layer not DB (debt E). | §6 |
| 9. Harden immediately? | The 7 Priorities in §7 — JSONB merge upsert is the #1 must-fix. | §7 |
| 10. NOT build yet? | Provider APIs, auto-merge, auto-enrich on every write, predictive layer, cross-customer products, ORM, job queue. | §9 |

---

## Appendix B — Adversarial walk index

| Scenario | Coverage | Today's behavior | Risk tier |
|---|---|---|---|
| Duplicate contacts | §5 Sev-3 | Audit surfaces; no merge | Tier 3 |
| Multiple owners on title | §5 Sev-2 + classifyOwnerNameMatch | Surname-only → MED + review flag | Tier 3 |
| LLC ownership | classifyOwnerNameMatch | Trust/LLC containing surname → MED; bare LLC → WEAK ownership_mismatch | Tier 4 (handled) |
| Trust ownership | classifyOwnerNameMatch | Same as LLC pattern | Tier 4 (handled) |
| Stale parcels | §5 Sev-3 + §4 | stale_observation review flag; no auto-invalidation | Tier 3 |
| Conflicting ownership records | §5 Sev-2 | Newest observedAt wins silently | Tier 2 |
| Contact merges | §5 Sev-3 | No tool today; merge would orphan links | Tier 3 (deferred) |
| Repeated imports | §5 Sev-1 | **Destroys enrichment + repairs** | **Tier 1** |
| Changing CRM records | §5 Sev-2 | Link confidence frozen; re-resolve manually | Tier 2 |
| Deleted contacts | §5 Sev-2 | Orphan links (no FK) | Tier 2 |
| Workspace migrations | n/a | Slug change orphans everything; not in routine use | Tier 4 |
| Re-ingestion edge cases | §5 Sev-3 + Commit A design | Idempotent; ✓ | Tier 4 (handled) |
| Partial enrichment failures | §4 | Per-contact atomic; safe-resume | Tier 4 (handled) |

Tier 1 = blocking before paid customer. Tier 2 = address before scale. Tier 3 = operator-visible audit covers it for now. Tier 4 = handled correctly today.

---

## Amendments

*(none yet)*

## Cross-references

- [`autonomy/PRODUCT_CONSTITUTION.md`](../autonomy/PRODUCT_CONSTITUTION.md)
- [`docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md`](./INTELLIGENCE_SYSTEM_CONSTITUTION.md)
- [`docs/public-record-intelligence-architecture.md`](./public-record-intelligence-architecture.md)
- [`docs/integration-philosophy-v1.md`](./integration-philosophy-v1.md)
- `lib/crm-import/crmContactsNeonAdapter.ts:upsertContactsNeon` — the merging-upsert fix lives here
- `lib/enrichment/public-records/canonicalStorage/initSchema.ts` — the missing FK lives here
