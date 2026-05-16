# Ingestion Principles

How Meridian takes in customer data. Derived from `meridian-philosophy.md`.

---

## Core posture

**Read-only first. CRM-agnostic. Founder-assisted onboarding. Low-friction.**

Meridian is a complement to the customer's existing systems, never a replacement.

---

## Allowed ingestion paths

- **CSV upload** — primary path. CSV from any source: HubSpot, Pipedrive, Salesforce, Bullhorn, Crelate, Loxo, JobAdder, ATS exports, spreadsheets, or hand-curated lists.
- **Direct file share** — customer sends a CSV by email, Drive, Dropbox, or any vehicle the customer trusts. The file lands on the founder's machine, the brief is generated, the file is deleted.
- **Future, when pulled**: read-only OAuth into HubSpot / Pipedrive / Salesforce. Build when ≥3 customers request the same one. Never before.

## Banned ingestion paths

- **Write access to a customer's CRM** — under no circumstances. Includes "minor" writes like marking activities, updating fields, or syncing tags.
- **Workflow control** — Meridian does not trigger emails, calendar invites, or any side effect in the customer's tools.
- **Webhooks that mutate customer state** — outbound notifications fine; inbound mutations banned.
- **Browser-extension scraping** — invasive; trust-eroding.
- **Live screen-share data collection** — invasive; trust-eroding.
- **Automation-heavy infrastructure** at the ingestion layer — no message queues, no Kafka, no microservices. Plain Node + file read is the right tool.

---

## CSV alias tolerance

The ingestion layer must handle real-world export variability:

- Case- and punctuation-insensitive header matching (`Company Name` ≈ `company_NAME` ≈ `companyname`)
- Common CRM aliases per logical field (company / account / organization; contact / full name / primary contact; phone / tel / telephone; etc.)
- Null-like values normalized to null (`"-"`, `"—"`, `"n/a"`, `"TBD"`, `"null"`, etc.)
- Malformed dates parse leniently; imprecise dates (`"Q1 2026"`, `"last week"`) reject to null
- Partial / fictional phone numbers reject silently (NANP 555-01XX range, <10 digits)
- Merged contact fields (`"Name, Title"` / `"Name (Title)"`) split safely
- Vague notes (`"vm"`, `"followed up"`, `"."`) and meta-notes (`"no specific note"`, `"was sourced from"`) drop at the boundary — never templated into output

Reference: `lib/recovery/normalize.ts`.

---

## Data-quality classification

Every ingested row is classified into one of three tiers:

| Tier | Trigger | Generator behavior |
|---|---|---|
| **HIGH** | Substantive last-note or specific next-step present | Lead with the prior thread; quote specifics |
| **MEDIUM** | Stage + dates + contact path present, but no usable note | Fall back to industry timing cues or stage-based reopen language |
| **LOW** | Sparse — only company name and maybe a contact path | Conservative, exploratory wording. Never invent context. |

The tier determines language calmness, not whether the row is included.

---

## Data handling promises (customer-visible)

These are explicit, repeatable customer commitments. Never quietly weaken them.

- *"The CSV is deleted after the brief is generated."*
- *"The brief lives at a private URL only you have."*
- *"You can ask me to delete it at any time."*
- *"I never store your data in a database during the founder-delivered phase."*

When persistent storage is introduced (post-founder-delivered), each of these claims requires explicit customer disclosure and re-consent.

---

## What ingestion does NOT do

- **Does not normalize the customer's CRM.** The customer keeps their CRM. We read; we don't reshape.
- **Does not enrich the source data.** Public-source enrichment happens during contact resolution at brief-gen time; it never writes back to the source.
- **Does not require schema alignment.** A customer's "Last Note" column doesn't need to be renamed to match Meridian's expectations — the normalizer handles aliases.
- **Does not require minimum data quality.** A sparse list produces a calmer brief; a rich list produces a richer brief. Both are valid.

---

## File handling discipline

- Every CSV the founder receives is treated as confidential.
- Generated briefs live at `data/recovery-briefs/<slug>/<week>.{json,html}`.
- Per-customer config (if any) lives at `data/customer-preferences/<slug>.json`.
- No customer data goes into commit history. CSV inputs are never committed; generated briefs may be committed only if marked `isSample: true` and the contacts are fictional.

---

## Future enrichment posture

When public-source enrichment is added at the ingestion layer (rather than at brief-gen time):

- Sources must be **public** — Google Places, Yelp, BBB, Hunter (verified emails), LinkedIn public pages
- Sources must be **explicit** — every enrichment carries a `source` and `confidence` field that traces back through `lib/contacts/sources/*`
- Sources must be **rejectable** — the customer can opt out of any source by name
- No source may be used to **infer** anything about the customer's relationship to a contact

---

## The single ingestion governing question

For any proposed ingestion change:

> *"Does this stay read-only, CRM-agnostic, low-friction, and easy for the customer to walk away from?"*

If the answer is no, the change is rejected or rescoped.
