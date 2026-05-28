# Public-Record Intelligence Architecture v1

> Issued 2026-05-27. Defines the canonical, durable substrate Meridian
> uses to ingest, normalize, store, and resolve real-world ownership
> intelligence into CRM relationships. Constitution-aligned, founder-
> stage operational, deterministic by design.
>
> **This is the foundation document for every future county, MLS, and
> transaction-data ingestion path.** Subordinate only to
> `autonomy/PRODUCT_CONSTITUTION.md`, `autonomy/NO_DRIFT_RULES.md`,
> and `docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md`.

---

## 1. Current Infrastructure Audit

Existing modules audited as of commit `fc591c8` on `data/king-county-first-ingest`:

### Reusable in canonical substrate

| Module | What it provides | Role going forward |
|---|---|---|
| `lib/enrichment/public-records/types.ts` | `PublicRecord`, `PublicRecordCsvRow`, `ParcelMatch`, `ParcelIndex`, `PublicRecordIngestResult`, `PublicRecordRejection` | Extended with canonical-storage types; existing shape preserved |
| `lib/enrichment/public-records/parcelMatcher.ts` | `buildParcelIndex`, `lookupMatch` (HIGH = parcel_id, MED = address) | Reused. In-memory index becomes one possible read path against canonical tables. |
| `lib/enrichment/public-records/csvAdapter.ts` | `parsePublicRecordCsv`, `parsePublicRecordRows` — header-tolerant, rejection-codified | Reused as the canonical CSV parser after per-source preprocessing |
| `lib/enrichment/public-records/provenance.ts` | `requirePublicRecordProvenance`, `cleanString`, `parseIsoDate` | Reused for snapshot provenance enforcement |
| `lib/enrichment/property/types.ts` | `PropertyRecord`, `OwnershipRecord`, `PropertySignal`, `FieldProvenance` | Reused; signals layer continues to flow into the brief evaluator independently |
| `lib/enrichment/property/propertyMatchRules.ts` | `classifyOwnerNameMatch` (exact / surname / trust_or_llc / fuzzy / no_match) | The canonical owner-attribution function — single source of truth for identity resolution |
| `lib/enrichment/property/addressNormalizer.ts` | Phase 1 normalizer with HIGH/MED/LOW/NONE confidence | Used for confidence reporting; not the parcel-key path |
| `lib/enrichment/address/normalize.ts` | `canonicalPropertyKey`, `normalizeAddress`, `detectWeakAddress` | **The canonical parcel-key normalizer.** Every source pipes through this. |
| `lib/enrichment/opportunity/*` (Commit 2) | `scoreContactOpportunity`, transparent weighted scoring model | Consumes canonical link → snapshot → parcel chain in v1 Commit C |
| `lib/crm-import/types.ts:PropertyIntelligenceEntry` | Per-contact denormalized view of property intelligence | Becomes a **read cache** populated from canonical entities (not source of truth) |
| `lib/crm-import/crmContactsNeonAdapter.ts:applyContactPropertyIntelligenceNeon` | jsonb_set writer on a single contact | Continues to write the per-contact denormalized cache |

### What's missing

| Gap | Why it matters |
|---|---|
| No canonical parcel entity | Today every contact would carry a duplicate copy of the same parcel data when multiple workspaces (or multiple contacts) reference the same address |
| No ownership snapshot timeline | A January 2026 JoCo export and a July 2026 refresh would overwrite each other today; we'd lose the audit trail of when which fact was true |
| No workspace-scoped contact-parcel link | Identity resolution today produces a denormalized snippet on `contact.enrichment.propertyIntelligence`; no separately-queryable link entity for future joins (MLS × county × Dotloop) |
| No raw-source-row preservation | Once a CSV is ingested, the original rows are lost — operator can't audit "what did the November 2026 export literally say about this parcel" |
| No snapshot versioning | Re-ingesting the same CSV today would double-write rows; no deterministic deduplication |
| No source registry | We have no enumeration of "what county exports has Meridian ever ingested, and when" |
| No cross-source identity resolution scaffold | When the MLS layer arrives, it needs to find county ownership by canonical address; no shared lookup primitive yet |

### Canonical vs source-specific (the boundary)

| Layer | Canonical (shared by all sources) | Source-specific (per-county / per-vendor) |
|---|---|---|
| Storage | `public_parcels`, `public_ownership_snapshots`, `workspace_contact_parcel_links` | Raw CSV files on disk (`data/raw/<county>/...`) — never canonical |
| Normalization | Address normalizer + canonicalPropertyKey + owner-name matcher | Preprocessor scripts (`scripts/preprocess-<county>.ts`) |
| Validation | `parsePublicRecordCsv` + rejection codes | Per-source column-mapping assertions |
| Provenance | `source` + `observedAt` + `rawSourceRow` on every snapshot | Source name string convention (`<jurisdiction>_<authority>_<acquisition-method>_<YYYY-MM>`) |
| Identity resolution | `classifyOwnerNameMatch` + canonical address key | Nothing source-specific — same rules across counties |

The boundary rule: **per-source code stops at the preprocessor**. Once a CSV reaches the canonical adapter, no county-specific logic runs anywhere else in the system.

---

## 2. Canonical Ownership-Record Model

Three new entities. Every field traces to a public record or a deterministic derivation; nothing inferred.

### 2.1 `PublicParcel` — the unique parcel as identified by the issuing authority

```ts
interface PublicParcel {
  // Deterministic identity — hash of (countyCode, sourceParcelId).
  // Same parcel from two snapshots resolves to the same id.
  id: string;

  // The authoritative jurisdiction. ISO-3166-style:
  //   "us-mo-jackson", "us-ks-johnson", "us-ks-wyandotte"
  // Future counties slot in with no schema change.
  countyCode: string;

  // Verbatim parcel id as published by the county. NEVER normalized.
  // Different counties use very different formats (Jackson uses
  // dash-segmented, Johnson uses an integer); we keep them as-given.
  sourceParcelId: string;

  // Canonical address key produced by canonicalPropertyKey().
  // The join axis for CRM × MLS × Dotloop. Case-insensitive, but
  // INTENTIONALLY STRICT about suffix variants (St ≠ Street). Each
  // source must pre-normalize to consistent abbreviation usage.
  propertyKey: string;

  // Verbatim situs address from the source. Preserved for audit even
  // when the canonical key is what we look up by.
  situsAddress: string;

  // First Meridian ingestion that observed this parcel.
  firstObservedAt: string; // ISO-8601

  // Most recent snapshot containing this parcel (any source). Used
  // for staleness detection.
  lastObservedAt: string;

  // Optional categorization from the most-recent snapshot. Never AI-
  // derived; only from explicit source fields.
  estimatedPropertyType?: EstimatedPropertyType;
}
```

**Workspace scoping**: NONE. Parcels are derived from public records and are not tenant data. Sharing parcel records across workspaces is permitted and amortizes acquisition cost.

### 2.2 `PublicOwnershipSnapshot` — a moment-in-time observation of ownership

```ts
interface PublicOwnershipSnapshot {
  // Deterministic identity — hash of (parcelId, sourceSnapshotId,
  // observedAt). Re-ingesting the same CSV produces no new rows.
  id: string;

  parcelId: string;            // → PublicParcel.id

  // Owner of record. VERBATIM from the source. Format varies:
  //   "SMITH, GREGORY A & MARY J"
  //   "Smith Family Trust 2014"
  //   "Acme Holdings LLC"
  // Owner-name normalization happens at the resolver, NOT here.
  ownerName: string;

  // Verbatim mailing address from the source.
  mailingAddress: string | null;

  // When the current owner took title (often deed-recorded date).
  // Verbatim from source; null when source didn't supply.
  ownershipStartDate: string | null; // ISO-8601 date

  // Most recent transfer reflected in this snapshot.
  // Often == ownershipStartDate; may differ for some sources.
  lastTransferDate: string | null;

  // Assessed (or appraised — KS terminology) value at observation.
  // Numeric; null when source didn't supply.
  assessedValue: number | null;

  // Canonical source identifier:
  //   "johnson_county_ks_appraiser_manual_2026-05-27"
  //   "jackson_county_mo_sunshine_law_request_2026-06"
  //   "johnson_county_ks_appraiser_csv_2026-07"
  // Convention: <jurisdiction>_<authority>_<acquisition-method>_<period>
  source: string;

  // Stable identifier for the snapshot BATCH (one snapshot file may
  // contain many parcels; they share a sourceSnapshotId). Lets the
  // audit show "everything from the JoCo May 2026 export."
  sourceSnapshotId: string;

  // When the snapshot was generated by the source (not when ingested).
  observedAt: string; // ISO-8601

  // The original CSV row preserved verbatim. Object form. Never
  // mutated, never overwritten. Used by audit tooling to show
  // exactly what the source said.
  rawSourceRow: Record<string, string>;
}
```

**Append-only contract**: snapshots are **immutable**. Re-ingesting the same source produces zero new rows (deterministic id dedup). Re-ingesting a refreshed source produces new rows; the old ones stay forever for audit.

### 2.3 `WorkspaceContactParcelLink` — per-workspace binding between contact and parcel

```ts
interface WorkspaceContactParcelLink {
  // Deterministic identity — hash of (workspaceId, contactId, parcelId).
  id: string;

  workspaceId: string;         // workspace.slug
  contactId: string;           // crm_contacts.contact_id
  parcelId: string;            // → PublicParcel.id

  // The snapshot that justified this link. Always the most recent
  // snapshot whose owner-name matched the contact, at link-creation
  // time. New snapshots may supersede this link (see linkSupersededAt).
  ownerSnapshotId: string;     // → PublicOwnershipSnapshot.id

  // Outcome of classifyOwnerNameMatch at the time the link was made.
  matchConfidence: "HIGH" | "MED" | "WEAK";

  // Verbatim match category from classifyOwnerNameMatch.
  matchReason: "exact" | "surname" | "trust_or_llc" | "fuzzy" | "ownership_mismatch";

  // ISO-8601 — when the link was created.
  linkCreatedAt: string;

  // ISO-8601 — when this link was last verified against a current
  // snapshot. Equal to linkCreatedAt when never re-verified.
  linkLastVerifiedAt: string;

  // ISO-8601 — null while link is active. Set when a newer snapshot
  // shows a different owner. The link is then read as historical.
  linkSupersededAt: string | null;

  // Optional pointer to the link that replaced this one (when a new
  // ownership shows up). Forms a chronological chain.
  supersededByLinkId?: string;
}
```

**Workspace scoping**: link table carries `workspaceId`. All queries are workspace-scoped. The constitution §6.11 (no cross-tenant leakage) is enforced at this layer — Nicole's links never appear in any LaborTech-style query.

### 2.4 Relationship to existing entities

| Existing entity | Relationship in v1 |
|---|---|
| `crm_contacts.source_metadata.enrichment.propertyIntelligence` | **Becomes a denormalized read-cache.** Populated from `WorkspaceContactParcelLink` → `PublicParcel` → most-recent `PublicOwnershipSnapshot`. Render layer (`/personal` cards) continues to read from the JSONB cache for fast access. The canonical tables are source of truth; the JSONB is rebuilt on every enrich-opportunity run. |
| `crm_contacts.source_metadata.enrichment.opportunity` | Continues to be written by the Commit 2 scorer. The scorer's input fields (parcelId, ownerName, ownershipDurationYears, etc.) come from joining the canonical tables. |
| `crm_contacts.source_metadata.enrichment.hunter` | Unchanged. Separate enrichment dimension; coexists. |
| `crm_contacts.source_metadata.repairs[]` | Unchanged. Repairs continue to overlay the contact's name/company/email/phone/address before identity resolution runs. |

---

## 3. Ingestion Philosophy

Six stages. Each stage is independently runnable + auditable. No stage performs work belonging to another.

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: Acquisition                                             │
│   Founder hand-curates / OR Open Records request / OR public    │
│   sales report download. Raw file lands at:                      │
│   data/raw/<county>/<acquisition-method>-<YYYY-MM-DD>.csv        │
│   (gitignored)                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: Preprocessing (per-source)                              │
│   scripts/preprocess-<county>.ts maps source column names →      │
│   canonical PublicRecordCsvRow shape AND applies consistent      │
│   address pre-normalization. Output:                             │
│   data/raw/canonical/<source>-<YYYY-MM-DD>.csv                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 3: Canonical ingestion                                     │
│   parsePublicRecordCsv (existing) emits PublicRecord[].          │
│   scripts/ingest-public-records.ts upserts parcels (idempotent), │
│   inserts snapshots (idempotent — same id = no-op).              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 4: Identity resolution (per workspace)                     │
│   scripts/resolve-contact-parcels.ts:                            │
│     for each contact in workspace                                │
│       lookup parcel by canonicalPropertyKey(contact.address)     │
│       classifyOwnerNameMatch(contact.name, snapshot.ownerName)   │
│       upsert WorkspaceContactParcelLink                          │
│   Workspace-scoped; never crosses tenant boundaries.             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 5: Opportunity scoring (per workspace)                     │
│   scripts/enrich-opportunity.ts:                                 │
│     for each contact with active link                            │
│       assemble OpportunityScoringInput from canonical tables     │
│       scoreContactOpportunity()  (Commit 2, pure function)       │
│       applyContactOpportunityNeon — write to JSONB cache         │
│   The opportunity scorer reads canonical entities ONCE per       │
│   contact. No re-derivation later.                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 6: Workspace render                                        │
│   /personal page reads crm_contacts.source_metadata.enrichment.* │
│   directly — fast, denormalized, no canonical-table joins on     │
│   the hot path.                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Critical rules**:

1. Raw source rows are preserved on every snapshot in `rawSourceRow`. The full original CSV file also stays on the founder's laptop indefinitely (gitignored, never uploaded).
2. Stages 1–3 are workspace-agnostic. The same JoCo export benefits all future Johnson County operators.
3. Stages 4–6 are workspace-scoped. No cross-tenant query is ever possible.
4. Each stage emits an audit log. Stage 3 records the source + snapshot id + counts; Stage 4 records workspace + match-confidence distribution; Stage 5 records score-tier distribution.
5. Re-running any stage is idempotent — deterministic IDs ensure no double-writes.

---

## 4. Deterministic Identity Resolution

The rules below are absolute. No fuzzy matching, no AI inference, no "close enough" — anything not covered explicitly falls through to `no_match`.

### 4.1 Address canonicalization

The single source of truth: `canonicalPropertyKey()` in `lib/enrichment/address/normalize.ts`.

Pre-normalization rules each source's preprocessor must apply BEFORE the canonical key is computed:

| Variation | Canonical form |
|---|---|
| `W` / `W.` / `west` / `WEST` | `west` (preprocessor expands) |
| `St` / `St.` / `Street` / `STREET` | `street` |
| `Ave` / `Ave.` / `Avenue` | `avenue` |
| `Blvd` / `Boulevard` | `boulevard` |
| Other USPS Pub 28 suffixes | full form |
| Whitespace + case | single space, lowercase |
| ZIP+4 | truncate to 5-digit ZIP |
| Unit / Apt / Suite suffixes | stripped (separate field) |

This preprocessing happens in the per-county script. The canonical `parsePublicRecordCsv` adapter doesn't perform expansion; it relies on the preprocessor to have already canonicalized.

**The strict contract**: `"4321 W 63rd St"` and `"4321 West 63rd Street"` are NOT equal until BOTH pass through preprocessing. If a future source's preprocessor forgets to expand, addresses won't match and contacts get `not_found` — honest failure, never silent misjoin.

### 4.2 Owner-name matching

The single source of truth: `classifyOwnerNameMatch()` in `lib/enrichment/property/propertyMatchRules.ts`.

Returns `{ match, confidence, reason }` per the existing Sprint 4 Phase 1 contract:

| Owner-name pattern | Result | Link confidence | Operator-visible state |
|---|---|---|---|
| `"Greg Smith"` vs `"Greg Smith"` | `exact` HIGH | HIGH | Surfaced as ownership |
| `"Greg Smith"` vs `"SMITH, GREGORY A"` | Token-set + first/surname match → `exact` HIGH | HIGH | Surfaced |
| `"Greg Smith"` vs `"Mary Smith"` | `surname` MED | MED | Surfaced with "spouse-on-title" framing |
| `"Greg Smith"` vs `"Smith Family Trust 2014"` | `trust_or_llc` MED | MED | Surfaced with "trust containing surname" framing |
| `"Greg Smith"` vs `"Acme Properties LLC"` | `no_match` LOW | NOT LINKED | Stored as `ownership_mismatch` snapshot — surfaced as cautionary chip, never as ownership |
| `"Greg Smith"` vs `"Patricia Wong"` | `no_match` LOW | NOT LINKED | Stored as `ownership_mismatch` snapshot |

### 4.3 Confidence ladder for the workspace_contact_parcel_link

| Address match | Owner-name match | Link confidence | matchReason field |
|---|---|---|---|
| parcel_id exact | exact | **HIGH** | `"exact"` |
| parcel_id exact | surname | **MED** | `"surname"` |
| parcel_id exact | trust_or_llc | **MED** | `"trust_or_llc"` |
| parcel_id exact | no_match | (link created with WEAK + ownership_mismatch) | `"ownership_mismatch"` |
| address-only match | exact | **MED** | `"exact"` |
| address-only match | surname | **WEAK** | `"surname"` |
| address-only match | no_match | (link created with WEAK + ownership_mismatch) | `"ownership_mismatch"` |
| no parcel match | — | NO LINK CREATED | — |

REVIEW-tier conditions (downstream consumers see this on the opportunity score):
- `matchConfidence: "WEAK"` triggers REVIEW cap in the scorer (existing behavior in Commit 2).
- `matchReason: "ownership_mismatch"` always renders as cautionary chip; never as ownership.

### 4.4 Ambiguity handling

Two parcels matching the same canonical address (rare — duplexes, parcel-ID overlap) produce a deterministic ambiguity:

| Snapshot count for canonical address | Behavior |
|---|---|
| 1 | Normal resolution path |
| ≥ 2 | NO link created. Audit emits `ambiguous_parcel` uncertainty per affected contact. Operator manually disambiguates. |

The `buildListingIndex` last-write-wins pattern from Commit 1 does NOT apply here; ambiguity is a hard fail because workspace-facing claims about ownership must not silently choose the wrong row.

### 4.5 What Meridian refuses to assume

Documented forever; new contributions to identity resolution that violate these are rejected at PR review.

1. **First-name-only owner match.** "Greg" alone never matches anything. Many Gregs in any county.
2. **Cross-state matching.** A parcel is county-scoped; a CRM contact in MO cannot match a KS parcel. State boundary is enforced via `countyCode` prefix on the canonical key.
3. **Fuzzy address similarity.** Levenshtein, soundex, n-gram, embedding-based — all forbidden. Equality on the canonical key is the only address-match.
4. **Inferred ownership transfer.** If the deed doesn't show in any snapshot, ownership didn't transfer in Meridian's view. We don't reason about deeds that "must have" happened.
5. **Owner intent.** No predictive claim about future seller, refi, divorce, move. The constitution §6.2 + §12.1 are absolute.
6. **Cross-source identity without explicit join.** A Heartland MLS listing matched by canonical address to a Jackson County parcel is a deterministic join. Inferring "this MLS listing might be the contact's other property" from partial name similarity is forbidden.
7. **Backfill of missing fields from "probable" values.** A snapshot with no `ownershipStartDate` stays null; we do not infer it from neighboring transfers.

---

## 5. Long-Term Storage Shape

### 5.1 New Neon tables

```sql
-- Workspace-agnostic — derived from public records, no tenant scoping.
create table if not exists public_parcels (
  id                  text primary key,
  county_code         text not null,
  source_parcel_id    text not null,
  property_key        text not null,
  situs_address       text not null,
  first_observed_at   timestamptz not null,
  last_observed_at    timestamptz not null,
  estimated_property_type text,
  unique (county_code, source_parcel_id),
  unique (county_code, property_key)
);
create index if not exists idx_public_parcels_property_key
  on public_parcels (property_key);
create index if not exists idx_public_parcels_county
  on public_parcels (county_code);

-- Workspace-agnostic, append-only.
create table if not exists public_ownership_snapshots (
  id                  text primary key,
  parcel_id           text not null references public_parcels(id),
  owner_name          text not null,
  mailing_address     text,
  ownership_start_date date,
  last_transfer_date  date,
  assessed_value      numeric,
  source              text not null,
  source_snapshot_id  text not null,
  observed_at         timestamptz not null,
  raw_source_row      jsonb not null,
  created_at          timestamptz not null default now()
);
create index if not exists idx_snapshots_parcel
  on public_ownership_snapshots (parcel_id, observed_at desc);
create index if not exists idx_snapshots_source
  on public_ownership_snapshots (source);

-- Workspace-scoped.
create table if not exists workspace_contact_parcel_links (
  id                       text primary key,
  workspace_id             text not null,
  contact_id               text not null,
  parcel_id                text not null references public_parcels(id),
  owner_snapshot_id        text not null references public_ownership_snapshots(id),
  match_confidence         text not null,
  match_reason             text not null,
  link_created_at          timestamptz not null,
  link_last_verified_at    timestamptz not null,
  link_superseded_at       timestamptz,
  superseded_by_link_id    text references workspace_contact_parcel_links(id),
  unique (workspace_id, contact_id, parcel_id),
  foreign key (workspace_id, contact_id) references crm_contacts(workspace_id, contact_id)
);
create index if not exists idx_links_workspace_contact
  on workspace_contact_parcel_links (workspace_id, contact_id);
create index if not exists idx_links_active
  on workspace_contact_parcel_links (workspace_id, contact_id)
  where link_superseded_at is null;
```

Migration runner: `scripts/init-public-records-schema.ts`. Idempotent via `if not exists`. Founder-runnable. Logs every action.

### 5.2 Deterministic ID computation

```ts
// PublicParcel.id
function parcelIdOf(countyCode: string, sourceParcelId: string): string {
  return hash("sha256", `parcel:${countyCode}:${sourceParcelId}`).slice(0, 24);
}

// PublicOwnershipSnapshot.id
function snapshotIdOf(parcelId: string, sourceSnapshotId: string, observedAt: string): string {
  return hash("sha256", `snap:${parcelId}:${sourceSnapshotId}:${observedAt}`).slice(0, 24);
}

// WorkspaceContactParcelLink.id
function linkIdOf(workspaceId: string, contactId: string, parcelId: string): string {
  return hash("sha256", `link:${workspaceId}:${contactId}:${parcelId}`).slice(0, 24);
}
```

Re-running ingestion with the same inputs produces the same IDs → upsert is idempotent → audit history is preserved → no double-writes.

### 5.3 Snapshot / versioning strategy

| Concern | Approach |
|---|---|
| Snapshot immutability | `public_ownership_snapshots` has no UPDATE path; only INSERT (with idempotent dedup via primary key). |
| Snapshot ordering | Read latest by `(parcel_id, observed_at desc)` — index supports it. |
| Refresh handling | New CSV → new `source_snapshot_id` → new rows with new `observedAt`. Old rows stay forever. |
| Link supersession | When a new snapshot's owner differs from the linked owner, the resolver UPDATEs the old link with `linkSupersededAt = now()` and INSERTs a new active link. The old link is queryable by anyone auditing historical ownership claims. |
| Stale-record detection | `public_parcels.last_observed_at` older than the configured staleness threshold (default 18 months) → flagged in the audit. |
| County refresh frequency | Configurable per-source. JoCo monthly is realistic; Jackson MO quarterly is realistic. The system has no opinion — it just records `observedAt` per snapshot. |
| Future MLS join | MLS listings reference `parcel_id` via canonical address lookup. Listings table (when built) has `parcel_id` foreign key. |
| Future Dotloop join | Dotloop transactions reference `parcel_id` via canonical address + transfer date. Same pattern. |

### 5.4 What stays workspace-isolated

| Data | Where | Isolation enforcement |
|---|---|---|
| Contact → parcel link | `workspace_contact_parcel_links.workspace_id` | All queries filter by workspace_id |
| Opportunity score | `crm_contacts.source_metadata.enrichment.opportunity` (existing) | Contact row already workspace-scoped |
| Owner-match confidence assessment | `workspace_contact_parcel_links.match_confidence` | Same as link |
| Cached property intelligence for `/personal` render | `crm_contacts.source_metadata.enrichment.propertyIntelligence` (existing) | Same as contact |

### 5.5 What's shared (workspace-agnostic)

| Data | Why shareable |
|---|---|
| Parcel records | Public record; not tenant data |
| Ownership snapshots | Public record; not tenant data |
| Source catalog | Which counties/dates have been ingested is shared knowledge |
| Acquisition costs amortize | If Nicole's workspace funded a Jackson MO Sunshine request, the JoCo data benefits future paying customers in JoCo without re-acquisition |

The constitution §6.11 prohibits cross-tenant data flow — but only for **tenant-confidential** data. Public records are by definition not confidential. Sharing them across workspaces is constitutionally permitted and operationally efficient.

---

## 6. Founder-Stage Acquisition Workflow

Three acquisition paths, three preprocessing scripts, one canonical pipeline.

### 6.1 Acquisition

| Path | Effort | Cost | Coverage |
|---|---|---|---|
| **Hand-curated parcel lookups** | 60–90 min founder | $0 | ~30 contacts |
| **Real Estate Sales reports** (free downloads from county sites) | 15 min | $0 | Recent transfers only |
| **Open Records / Sunshine Law request** (narrow + specific) | 30 min to draft, 1–3 weeks wait | $0–$200 | Broad coverage |

Per the previous turn's research — manual curation first (today), Open Records request in parallel for the bulk dataset.

### 6.2 Preprocessing

```
data/raw/manual-parcels/nicole-2026-05-27.csv    ──► scripts/preprocess-manual-csv.ts
data/raw/jackson-county-mo/2026-06.csv           ──► scripts/preprocess-jackson-county-mo.ts
data/raw/johnson-county-ks/2026-05.csv           ──► scripts/preprocess-johnson-county-ks.ts
                                                       │
                                                       ▼
                                       data/raw/canonical/<source>-<date>.csv
```

Each per-source preprocessor:
- Reads the raw source file
- Maps source column names → canonical `PublicRecordCsvRow` shape
- Applies consistent address pre-normalization (suffix expansion, directional expansion, ZIP truncation)
- Writes a canonical CSV
- Emits a `source_snapshot_id` for the batch (e.g. `"jackson-county-mo_2026-06_sunshine-law"`)

### 6.3 Validation

```bash
npm run check-canonical-csv -- --file=data/raw/canonical/jackson-county-mo-2026-06.csv
```

Asserts: every row has `parcelId + situsAddress + ownerName + sourceName + observedAt`; canonical-key collisions reported; weak addresses surfaced.

### 6.4 Ingestion

```bash
npm run ingest-public-records -- --file=data/raw/canonical/jackson-county-mo-2026-06.csv
```

Upserts parcels (idempotent), inserts snapshots (idempotent via deterministic ID). Logs per-row outcome.

### 6.5 Identity resolution

```bash
npm run resolve-contact-parcels -- --customer=nicole-lonergan
```

Per contact: canonical address lookup → owner-name match → upsert link. Workspace-scoped; safe to run anytime.

### 6.6 Opportunity scoring

```bash
npm run enrich-opportunity -- --customer=nicole-lonergan --dry-run
npm run enrich-opportunity -- --customer=nicole-lonergan --write
```

Assembles OpportunityScoringInput from canonical entities. Calls Commit 2's `scoreContactOpportunity`. Writes to `crm_contacts.source_metadata.enrichment.opportunity`.

### 6.7 Future refresh workflow

When JoCo publishes a new export 3 months later:

```bash
# 1. Founder downloads new CSV
# 2. Run preprocessor → produces new canonical CSV with new source_snapshot_id
npm run preprocess:johnson-county-ks -- --in=data/raw/johnson-county-ks/2026-08.csv

# 3. Ingest — idempotent for unchanged parcels, new snapshots for changed ones
npm run ingest-public-records -- --file=data/raw/canonical/johnson-county-ks-2026-08.csv

# 4. Re-resolve all workspaces (or just Nicole)
npm run resolve-contact-parcels -- --customer=nicole-lonergan

# 5. Re-score
npm run enrich-opportunity -- --customer=nicole-lonergan --write
```

The refresh produces:
- New snapshot rows for every parcel that changed
- Same parcel rows (id-stable; lastObservedAt updated)
- Link supersession events where ownership changed
- Audit log of all the above

---

## 7. v1 Architecture Boundary

### What MUST exist now

1. **Canonical ownership storage** — three Neon tables per §5.1.
2. **Schema migration runner** — `scripts/init-public-records-schema.ts`.
3. **Per-source preprocessors** — `scripts/preprocess-manual-csv.ts`, `scripts/preprocess-johnson-county-ks.ts`, `scripts/preprocess-jackson-county-mo.ts`.
4. **Canonical ingestion script** — `scripts/ingest-public-records.ts` consumes preprocessed canonical CSVs, writes parcels + snapshots.
5. **Identity resolver** — `scripts/resolve-contact-parcels.ts` per workspace.
6. **Opportunity-enrichment pipeline** — `scripts/enrich-opportunity.ts` joins canonical → Commit 2 scorer → JSONB write cache.
7. **Audit visibility** — `crm-audit.ts` gains "Public-record coverage" + "Opportunity tiers" sections.
8. **Validators** — `check-public-records-storage.ts`, `check-identity-resolution.ts`.
9. **Provenance enforcement** — every row in every new table carries `source` + `observedAt`; raw rows preserved verbatim.
10. **Workspace isolation** — link queries always filter by `workspaceId`. Asserted in tests.

### What MUST NOT exist now

1. ❌ Parcel polygon storage, shapefile processing, geometry of any kind
2. ❌ ATTOM, Regrid, Estated, CoreLogic, DataTree, or any aggregator API integration
3. ❌ Bridge Interactive, Trestle, RESO API or any direct MLS feed
4. ❌ Live county DDR / replication subscriptions
5. ❌ Automated parcel-viewer scraping
6. ❌ Cross-customer parcel aggregation analytics
7. ❌ Predictive scoring beyond the existing transparent Commit 2 weights
8. ❌ Owner-intent inference (constitution §6.2 + §12.1)
9. ❌ Workspace-shared denormalization of contact-level data (links stay workspace-scoped)
10. ❌ Bidirectional CRM sync, write-back to upstream CRMs
11. ❌ Realtime listing or transaction APIs
12. ❌ Mobile app, push notifications, web extensions
13. ❌ Autonomous refresh / scheduled ingestion jobs (founder runs ingestion manually)
14. ❌ LLM-derived owner-name parsing or address parsing
15. ❌ Fuzzy address matching, Levenshtein, embedding-based equivalence
16. ❌ Multi-county join logic beyond canonical address (no cross-county fallback)

---

## 8. Cursor Implementation Roadmap

Three commits. Each independently reviewable + reversible.

### Commit A — Canonical storage + schema (no ingestion yet)

**Files to create**:
- `lib/enrichment/public-records/canonicalStorage/types.ts` — `PublicParcel`, `PublicOwnershipSnapshot`, `WorkspaceContactParcelLink`
- `lib/enrichment/public-records/canonicalStorage/ids.ts` — deterministic ID hashing
- `lib/enrichment/public-records/canonicalStorage/neonAdapter.ts` — `upsertPublicParcel`, `insertPublicOwnershipSnapshot`, `upsertWorkspaceContactParcelLink`, `lookupParcelByPropertyKey`, `listSnapshotsForParcel`, `getLatestSnapshotForParcel`, `listActiveLinksForContact`, `supersedeLink`
- `scripts/init-public-records-schema.ts` — idempotent migration runner
- `scripts/check-public-records-storage.ts` — fixture-based validator (synthetic parcel + snapshot round-trip)
- `package.json` — `init:public-records-schema`, `check-public-records-storage`

**Files modified**:
- None — substrate-only addition

**Acceptance criteria**:
- Schema runner is idempotent
- All adapter functions deterministic (same input → same row)
- Workspace isolation enforced at link query level
- Validator passes with 20+ fixtures
- No regression in existing validators
- `npm run build` clean

### Commit B — Per-county preprocessors + ingestion + identity resolution

**Files to create**:
- `scripts/preprocess-manual-csv.ts` — passes through canonical-shape rows with source-name validation (for hand-curated CSVs)
- `scripts/preprocess-johnson-county-ks.ts` — maps JoCo CSV column names + applies pre-normalization
- `scripts/preprocess-jackson-county-mo.ts` — same for Jackson MO
- `scripts/check-canonical-csv.ts` — validates a canonical CSV before ingestion
- `scripts/ingest-public-records.ts` — reads canonical CSV → calls adapter writers
- `scripts/resolve-contact-parcels.ts` — per workspace, calls classifyOwnerNameMatch, writes links
- `lib/enrichment/identity-resolution/types.ts` — `ContactParcelResolution`, `ResolutionBatchResult`
- `lib/enrichment/identity-resolution/resolveContactParcel.ts` — pure function: contact + parcel + snapshot → resolution
- `scripts/check-identity-resolution.ts` — fixtures covering every match-confidence path
- `package.json` — wire all of the above

**Files modified**:
- `scripts/crm-audit.ts` — add "Public-record coverage" + "Identity resolution outcomes" sections

**Acceptance criteria**:
- Three preprocessors produce identical canonical-shape output
- Round-trip: CSV → preprocess → ingest → query → identical to source data
- Re-ingest is no-op (idempotency)
- Link supersession works when new snapshot has different owner
- Validators 30+ fixtures
- No regression

### Commit C — Opportunity scoring against canonical substrate

**Files to create**:
- `scripts/enrich-opportunity.ts` — pure pipeline assembler; reads canonical, calls `scoreContactOpportunity` (already exists from Commit 2), writes denormalized cache via `applyContactOpportunityNeon`
- `scripts/check-opportunity-pipeline.ts` — end-to-end fixture: synthetic CSV → ingestion → resolution → opportunity score

**Files modified**:
- `lib/personal-workspace/openerBuilder.ts` — add `enrichment:opportunity` source extractor (gated on tier HIGH/MED + non-null opportunity entry)
- `scripts/check-opener-generation.ts` — opportunity opener fixtures + banned-phrase regression
- `scripts/crm-audit.ts` — add "Opportunity scoring outcomes" section + per-contact factor breakdown via `--verbose`
- `docs/property-intelligence-v1.md` (NEW) — operational doc: what to ingest, what surfaces appear, what stays invisible

**Acceptance criteria**:
- End-to-end pipeline runnable against the hand-curated 30-contact CSV
- Opportunity scores write to JSONB cache
- `/personal` opener cites real ownership when HIGH-confidence link present
- Audit shows full breakdown
- Banned-phrase scan clean
- No regression

---

## 9. File Structure (Final)

```
lib/enrichment/
  address/                            [existing]
    normalize.ts                      [reused — canonical key here]
  public-records/                     [existing, extended]
    types.ts                          [existing]
    parcelMatcher.ts                  [existing]
    csvAdapter.ts                     [existing]
    provenance.ts                     [existing]
    canonicalStorage/                 [NEW]
      types.ts                        [NEW]
      ids.ts                          [NEW]
      neonAdapter.ts                  [NEW]
  property/                           [existing]
    types.ts                          [existing — signals layer]
    propertyMatchRules.ts             [reused — owner-name matcher]
    addressNormalizer.ts              [existing — Phase 1 confidence ladder]
    sellerTiming.ts                   [existing — brief-side signals]
  listings/                           [existing, Commit 1 of Property v1]
    types.ts
    csvAdapter.ts
    listingIndex.ts
    listingAgent.ts
  opportunity/                        [existing, Commit 2 of Property v1]
    types.ts
    relationshipType.ts
    scoreOpportunity.ts
  identity-resolution/                [NEW]
    types.ts                          [NEW]
    resolveContactParcel.ts           [NEW]

scripts/
  init-public-records-schema.ts       [NEW]
  preprocess-manual-csv.ts            [NEW]
  preprocess-johnson-county-ks.ts     [NEW]
  preprocess-jackson-county-mo.ts     [NEW]
  check-canonical-csv.ts              [NEW]
  ingest-public-records.ts            [NEW]
  resolve-contact-parcels.ts          [NEW]
  enrich-opportunity.ts               [NEW]
  check-public-records-storage.ts     [NEW]
  check-identity-resolution.ts        [NEW]
  check-opportunity-pipeline.ts       [NEW]
  crm-audit.ts                        [MODIFIED — add 3 sections]
  check-opener-generation.ts          [MODIFIED — add fixtures]

docs/
  property-intelligence-v1.md         [NEW — operational doc]
  public-record-intelligence-architecture.md  [THIS DOC]
```

---

## 10. The "Do Not Build Yet" List

A permanent reference. Each item requires a `[canon-amend]` PR with founder review before reconsideration.

### Storage & schema
- ❌ Parcel polygons / geometry / shapefile columns
- ❌ PostGIS or any spatial extension
- ❌ Cross-county "national parcel" identifiers
- ❌ Owner-entity normalization (unifying "Greg Smith" + "SMITH, GREGORY A" into one entity) — store both verbatim, match at query time

### Data sources
- ❌ ATTOM Data, Regrid, Estated, CoreLogic, DataTree, ReportAll USA, or any aggregator API
- ❌ Bridge Interactive, Trestle, RESO Web API
- ❌ Zillow API or Zillow scraping
- ❌ Spokeo, BeenVerified, FastPeopleSearch, or any people-search aggregator
- ❌ LinkedIn, Facebook, Instagram, Twitter/X — surveillance aggregation forbidden
- ❌ County DDR / replication subscriptions

### Automation
- ❌ Scheduled refresh jobs (founder runs ingestion manually)
- ❌ Scraping any parcel viewer programmatically
- ❌ Auto-onboarding new counties without per-source preprocessor approval
- ❌ Webhooks for new ownership events
- ❌ Real-time push from MLS or county sources

### Inference
- ❌ Fuzzy address matching (Levenshtein, soundex, embedding-based)
- ❌ Fuzzy owner-name matching beyond the existing exact / surname / trust_or_llc ladder
- ❌ LLM-derived parsing of owner names or addresses
- ❌ Predictive ownership ("Greg might own this other parcel too")
- ❌ Ownership-intent inference (seller probability, refi probability, etc.)
- ❌ Cross-source identity joining without explicit deterministic match

### UI
- ❌ Parcel map / property browser inside Meridian
- ❌ Listing search UI
- ❌ Transaction pipeline UI
- ❌ Cross-workspace dashboards
- ❌ ROI / closing-velocity metrics
- ❌ Owner analytics / portfolio views

### Operations
- ❌ Bulk export from Meridian to external tools (one-way ingest only)
- ❌ Bidirectional CRM sync
- ❌ Auto-redaction beyond constitutionally-required PII handling
- ❌ Multi-tenant data marketplace
- ❌ Customer-driven self-serve ingestion

---

## 11. Critical Engineering Pitfalls (preempted)

Each one has bitten similar systems; the architecture above prevents them.

1. **Parcel-level identity drift across exports.** Jackson County could rebuild its parcel IDs in 2027. Without `countyCode + sourceParcelId` as the natural key, the old + new parcels would look like duplicates. The deterministic ID hashing prevents collision but DOES NOT auto-merge — a county-issued ID change is a manual reconciliation event the founder handles via SQL or a dedicated migration script. Forced explicitness is intentional.
2. **Owner-name canonicalization tempting LLM use.** "SMITH, GREGORY A & MARY J" is two owners. Decomposing it correctly is non-trivial. The architecture handles this by storing the verbatim string and letting `classifyOwnerNameMatch` work on token sets. Never invoke an LLM to "parse" owner names.
3. **Snapshot-table growth.** Re-ingesting every JoCo monthly snapshot for 5 years = ~60 snapshots × ~200k parcels × ~30 fields = ~360M JSONB cells. Manageable on Postgres but worth budgeting. Mitigation: snapshot pruning policy after Year 2 (archive snapshots older than 36 months to a cold-storage CSV, drop from active table). Not a v1 concern.
4. **Link supersession race conditions.** If two ingestions run concurrently and both supersede the same link, one wins. Mitigation: ingestion is founder-runnable single-threaded; no concurrent ingestion supported in v1. Constitution-aligned: no autonomous ingestion = no race conditions.
5. **Address pre-normalization drift between preprocessors.** If Jackson MO's preprocessor expands "Pkwy" → "parkway" but JoCo's doesn't, the same canonical address could miss across county boundaries. Mitigation: shared address pre-normalization helper module (`lib/enrichment/address/preNormalize.ts`) imported by both preprocessors. Validator asserts the shared expansion table is unchanged across the preprocessor regression suite.
6. **Workspace isolation drift.** A future PR could add a "show me everyone who owns property in 64113" query that accidentally leaks across workspaces. Mitigation: queries on `workspace_contact_parcel_links` MUST include `workspace_id` in the WHERE clause; SQL lint or test asserts this. Documented in PR-review checklist.

---

## 12. Final Strategic Note

This architecture treats public records as **infrastructure**, not as a one-off enrichment. Counties publish; Meridian ingests, snapshots, and joins; workspaces consume via identity-resolved links. The same code path supports a single Jackson MO Sunshine response, a future monthly JoCo refresh, a future Wyandotte County addition, a future Brookside team scaling to 5 agents.

The substrate is built so that **the second customer in JoCo costs zero acquisition** — the data is already there. The substrate is built so that **adding a third county is a one-day preprocessor commit** — no architecture work. The substrate is built so that **a fabricated ownership claim is structurally impossible** — every fact traces to a snapshot row whose source + observedAt + raw row are queryable forever.

Meridian is not a GIS company. Meridian is a continuity-and-trust company that grounds relationship intelligence in real public records. This document is the architectural commitment to that positioning.

---

## Amendment process

Same as `INTELLIGENCE_SYSTEM_CONSTITUTION.md`. `[canon-amend]` PR. Founder review. No silent amendments.

---

## Cross-references

- [`autonomy/PRODUCT_CONSTITUTION.md`](../autonomy/PRODUCT_CONSTITUTION.md) — supreme operating doc
- [`docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md`](./INTELLIGENCE_SYSTEM_CONSTITUTION.md) — provenance + determinism rules
- [`docs/integration-philosophy-v1.md`](./integration-philosophy-v1.md) — Meridian as intelligence layer across systems
- [`docs/product-bifurcation-correction.md`](./product-bifurcation-correction.md) — Product 1 (CRM Intelligence) as v1 wedge
- `lib/enrichment/address/normalize.ts` — canonicalPropertyKey
- `lib/enrichment/property/propertyMatchRules.ts` — classifyOwnerNameMatch
- `lib/enrichment/public-records/csvAdapter.ts` — canonical CSV parser
- `lib/enrichment/opportunity/scoreOpportunity.ts` — Commit 2 scoring model

---

## Amendments

*(none yet)*
