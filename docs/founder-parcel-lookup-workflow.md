# Founder Parcel Lookup Workflow — High-Trust Manual Curation

> Issued 2026-05-27. Operational guide for hand-curating the
> `data/raw/manual-parcels/nicole-<date>.csv` rows that ground
> Meridian's 109-contact intelligence corpus.
>
> This is a **precision-grounded** workflow — every row is operator-
> typed against a county parcel viewer in real time. No bulk import,
> no scraping, no API. The whole point is that you can defend every
> cell when a question gets asked.

---

## Why manual

The substrate's correctness is a function of the inputs. A typo in
`ownershipStartDate` becomes a fabricated `ownership_duration_over_7yr`
factor. A wrong `countyCode` parks a parcel in the wrong jurisdiction
forever. Provider APIs would solve speed and trade away the property
that matters most: every fact is one you personally looked up.

Until the 109 graduate beyond the proving-ground gates, no lookup is
delegated. Founder time spent here is the single highest-leverage
investment in the wedge.

---

## Pre-session preparation

### Pick the right contacts to look up

The substrate only adds value when the contact you look up is one that
matters operationally. Order:

1. **Run** `npm run check-grounding-quality -- --customer=nicole-lonergan`
2. **Read** the "Top likely HIGH-tier candidates BEFORE enrichment" section
3. **Take** the top 10–20 from that list. These are seller-tagged contacts
   with actionable channels and parseable addresses — the ones where a
   parcel match will land them at HIGH tier
4. **Sort by** Nicole's strategic priority — contacts she would be calling
   in the next 4 weeks anyway

Do NOT look up contacts at random. Do NOT look up contacts whose CRM
data is missing fields (`weak_address` or `no_actionable_channel` — those
need CRM rehab first, not parcel grounding).

### Pre-flight checks

- One uninterrupted block of time: **45–60 minutes**. Fatigue is the
  largest source of data errors past the 60-minute mark.
- Two browser tabs ready:
  - `aims.jocogov.org` parcel viewer (Johnson County KS)
  - `parcelviewer.jacksongov.org` (Jackson County MO) — or whichever
    Jackson MO viewer the previous research turned up
- Local file open in your editor: `data/raw/manual-parcels/nicole-<today>.csv`
- Workspace audit run in terminal: `npm run crm:audit -- --customer=nicole-lonergan`
  scrolled to the contact list

---

## The lookup loop (per contact, 90–120 seconds target)

### Step 1 — Read the CRM address

From the audit output or workspace contact card, copy the contact's
address EXACTLY as stored in CRM. Note the city/state — that determines
which county viewer to open.

| If city is in… | County viewer | countyCode value |
|---|---|---|
| Kansas City MO, Independence, Blue Springs, Grandview, Raytown, Lee's Summit, Sugar Creek | Jackson County MO | `us-mo-jackson` |
| Overland Park, Olathe, Lenexa, Leawood, Shawnee, Prairie Village, Mission, Merriam, Roeland Park, Westwood | Johnson County KS | `us-ks-johnson` |
| Anywhere else | **NOT IN SCOPE** — skip this contact for now |

### Step 2 — Look up the parcel in the viewer

Search by address (not name). Confirm:
- The address matches **exactly** including unit numbers / direction
  abbreviations
- The displayed property is residential (single-family, condo,
  townhouse — NOT commercial, vacant land, or industrial unless
  explicitly intentional)
- The viewer returns **one** match. If more than one, see §Ambiguity

### Step 3 — Extract the required fields

In this exact order (so habit memory carries you through fatigue):

1. **parcelId** — copy verbatim from the viewer. Different counties
   use very different formats; preserve dashes, leading zeros, dots
   exactly as shown.
2. **situsAddress** — copy verbatim from the viewer (NOT from CRM,
   even if they match). The viewer is the source of truth for the
   property's address.
3. **ownerName** — copy verbatim. Examples that ARE correct to preserve
   exactly: `"SMITH, GREGORY A & MARY J"`, `"SMITH FAMILY TRUST 2014"`,
   `"ACME HOLDINGS LLC"`. Do not "fix" capitalization or commas.
4. **mailingAddress** — copy verbatim. May equal situs (owner lives
   there) or differ (investment property, second home).
5. **ownershipStartDate** — copy as displayed, expecting YYYY-MM-DD or
   M/D/YYYY format. If the viewer shows only a year, write `YYYY-01-01`
   and add a `founderNotes` annotation. **This is the field most often
   mistyped.** See §Date precision.
6. **lastTransferDate** — if separately shown. If the viewer only shows
   one transfer date, leave `lastTransferDate` blank — don't duplicate.
7. **assessedValue** — copy the most recent assessed value, integer only,
   no $ or commas. Optional; not currently used by scoring.
8. **propertyType** — pick from `single_family | townhouse | condominium |
   multi_family | land | commercial | unknown`. If the viewer's
   classification doesn't fit, write `unknown` — do NOT invent a class.

### Step 4 — Sanity-check before moving on

Before clicking on the next contact, do this 5-second check:

- The `countyCode` matches the city you saw in CRM
- The `ownershipStartDate` is between 1900 and today
- The `ownerName` includes a surname token that resembles the contact's
  surname (NOT a strict match — this is the resolver's job — but if the
  contact is "Greg Smith" and the owner is "ACME HOLDINGS LLC" with no
  Smith anywhere, expect a WEAK ownership-mismatch link; if you weren't
  expecting that, you might have looked up the wrong address)
- No fields are empty that should have values

If anything feels wrong, **stop and resolve before continuing**. The
"I'll come back to it later" pattern is where corruption enters the data.

---

## Date precision (the highest-risk field)

`ownershipStartDate` drives the `ownership_duration_over_7yr` factor.
Off by a year and the factor fires or doesn't fire incorrectly. Off by
ten and a fresh owner looks like a 30-year hold.

Best practices:

- Always type the FULL date `YYYY-MM-DD`, even if the viewer shows
  `4/15/2019`. Re-typing forces a re-read.
- If the viewer shows only `2019`, write `2019-01-01` and add
  `founderNotes: "viewer showed year only"`. The resolver still
  computes a duration; the audit knows the precision.
- If the viewer shows `unknown` or doesn't expose a date, **leave the
  field empty**. The factor will not fire. This is the correct outcome —
  better than fabricating a date.

---

## Ambiguity handling

### Two parcels at the same address

Some addresses (duplexes, multi-unit) resolve to multiple parcels. You'll
see this in the viewer. Options:

- **Skip the contact** and write a row in `docs/operational-friction-<date>.md`
  noting "ambiguous parcel at <address>." The resolver would surface
  this as `ambiguous_parcel` and skip the link anyway.
- **Pick the parcel whose unit matches the CRM mailing address** if
  obvious. Add `founderNotes: "disambiguated by unit XYZ"`.

Do NOT add both parcels as separate rows — that's how cross-county
ambiguity gets baked in.

### Owner name doesn't match the contact name

Three sub-cases:

1. **Spouse on title** — contact is "Greg Smith", owner is "Mary Smith":
   record the owner verbatim. The resolver will classify as
   surname-only (MED at parcel_id strength, WEAK at address strength).
   The opportunity scorer will cap the tier at WEAK because owner-match
   is WEAK. **This is correct**.
2. **Trust / LLC containing surname** — contact is "Greg Smith", owner
   is "Smith Family Trust 2014": record verbatim. Resolver classifies
   as `trust_or_llc` with the surname present → MED/WEAK confidence.
3. **No name resemblance** — contact is "Greg Smith", owner is
   "Patricia Wong": this is genuine ownership_mismatch. Either:
   - The contact sold the property and the CRM hasn't been updated, OR
   - The CRM address is wrong (mailing vs property mix-up), OR
   - The contact never owned this property — it's their child's, a
     family friend, etc.
   Add `founderNotes: "owner of record does not match — verify CRM
   data"` and let the resolver write the WEAK ownership_mismatch link.
   The audit will surface the contact as needing CRM-rehab review.

### Address not found in either county viewer

If neither JoCo AIMS nor Jackson MO has the address:

- Verify the city/state hint from CRM. The contact may live in
  Clay County MO, Wyandotte County KS, or further out.
- Skip the contact. Out-of-scope counties are not failures of the
  substrate; they are gaps in current coverage.
- Add the contact's city to a friction note: "out-of-county: <city>".
  If multiple contacts share the same out-of-scope county, that's a
  signal for the next county to add (one preprocessor + a Sunshine
  Law request).

---

## After the session

### Validate the CSV before preprocessing

```bash
npm run check-manual-parcels-csv -- --in=data/raw/manual-parcels/nicole-<date>.csv
```

Read every warning. The script does NOT block ingestion — it surfaces
risks. You decide whether each is a typo to fix or a real ambiguity to
preserve.

Common warnings and what to do:

- `missing required field` — fix the row before preprocessing
- `unknown countyCode` — fix or remove the row
- `duplicate parcelId within county` — likely typo on second row; verify
- `duplicate canonical address` — operator-flagged ambiguity OR genuine
  multi-unit; add `founderNotes` and decide
- `suspicious ownership duration` — re-read the date in the viewer
- `malformed date` — fix or remove the row
- `weak address` — likely missing ZIP or city; verify against viewer
- `owner looks like LLC/Trust` — informational only; no action needed

### Run the substrate

```bash
# Dry-run first, always
npm run preprocess:manual-csv -- --in=data/raw/manual-parcels/nicole-<date>.csv
npm run ingest-public-records -- --in=data/raw/canonical/<output>.csv
npm run ingest-public-records -- --in=data/raw/canonical/<output>.csv --write
npm run resolve-contact-parcels -- --customer=nicole-lonergan
npm run resolve-contact-parcels -- --customer=nicole-lonergan --write
npm run enrich-opportunity -- --customer=nicole-lonergan --sample=10
# Inspect EVERY HIGH and EVERY MED in the dry-run sample before --write
npm run enrich-opportunity -- --customer=nicole-lonergan --write
npm run crm:audit -- --customer=nicole-lonergan
```

### Verify the result

For each contact you looked up:

1. Find them in the `crm:audit` output (top source-backed
   opportunities + tier distribution)
2. Confirm their tier matches your expectation (typically: seller-tagged
   contacts you grounded should hit HIGH or MED; non-seller contacts you
   grounded should hit MED or WEAK)
3. Confirm the displayed `situsAddress`, `ownerName`, `publicRecordSource`
   match what you typed in the CSV

Discrepancies between what you typed and what the audit shows = bug or
preprocessing surprise. Stop and investigate before continuing.

---

## Session quality targets

These are calibrated for founder-stage manual curation. Don't push past
them.

| Target | Why |
|---|---|
| ≤ 60 minutes per session | Fatigue past 60 min introduces errors |
| ≤ 30 rows per session | Same reason |
| ≥ 90 seconds per row | Faster = corner-cutting |
| 0 rows you can't defend in detail | Trust > coverage |
| 0 rows where you're "pretty sure" about the date | Date precision is the failure mode |

If a session produces 50 rows in an hour, audit the rows after — almost
every cycle a fast session has typos a slow session would have caught.

---

## What this workflow is NOT

- **Not a sustainable scaling method.** It's a deliberate
  precision-grounding investment that ends when the 109 graduate.
- **Not a substitute for CRM rehab.** Contacts with weak CRM data
  (missing surname, missing address, no channel) need their CRM
  hardened first.
- **Not a query-the-API workflow.** Provider APIs trade trust for
  speed. The wedge is the opposite trade.
- **Not a long-term operator role.** Once the substrate is established
  and the queue is proven trustworthy, county data acquisition shifts
  to Open Records bulk requests with verification, not per-contact
  hand-lookup.

---

## Cross-references

- [`docs/first-monday-brief-validation.md`](./first-monday-brief-validation.md) — the cycle this workflow feeds
- [`docs/public-record-intelligence-architecture.md`](./public-record-intelligence-architecture.md) — substrate the CSV ingests into
- [`docs/public-record-intelligence-audit.md`](./public-record-intelligence-audit.md) — risk model
