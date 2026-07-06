# The Reality Layer — Connector Framework

> The foundation that lets Meridian understand your professional world without
> rewriting architecture every time you connect a new system. Gmail, Calendar, and
> LinkedIn are not products — they are **sensors**. Everything they see becomes an
> **Observation**, and nothing skips the pipeline.
>
> Governed by [`MERIDIAN_TRUST_MODEL.md`](../../MERIDIAN_TRUST_MODEL.md): connectors
> only observe; the Belief Engine interprets; recommendations are ordinal, evidenced,
> and gated; no fabricated numbers.

## The pipeline (this is the whole system)

```
Reality → Connectors → Observations → Beliefs → Recommendations → Daily Brief → Outcome → Calibration ↺
```

- **Connectors** (`lib/connectors/`) read a sensor and emit `Observation[]`. They may
  NOT create opportunities, assign stages, or score anything.
- **Observations** (`lib/connectors/types.ts`) are one canonical, connector-agnostic
  object. A Gmail "email" and a Slack "message" are both `message_received`.
- **Belief Engine** (`lib/beliefs/engine.ts`) is the ONLY interpreter. It groups
  observations from *all* connectors into subjects and derives a `Belief` each —
  momentum, stage, waiting-on, confidence, a **change log**, and a **falsifier**.
- **Recommendations** (`lib/beliefs/recommend.ts`) come only from beliefs that clear
  the engagement + confidence bar; each states its opportunity cost.
- **Daily Brief** (`lib/home/brief.ts`, `app/home/page.tsx`) renders one page.

## Success criterion — met

Adding a connector requires **no new architecture**. The only work is translating a
sensor's data into `Observation[]`. Register one line in `lib/home/pipeline.ts` and
beliefs, recommendations, and the brief all work automatically. The 26-assertion
`reality:check` proves connectors carry no stage/score fields and that the Belief
Engine fuses Gmail + Calendar into a single Clue belief.

## The Connector contract

Every connector implements `Connector<Input>` (`lib/connectors/types.ts`):
`capabilities()`, `health()`, `authenticate()`, `lastSync()`, `collectObservations()`
(with Normalize folded in), and `run()`. It returns only `Observation[]`.

## Connectors built (only these three)

| Connector | Sensor | Auth | Emits |
|---|---|---|---|
| `GmailConnector` | Gmail threads (MCP batch) | MCP session (read-only) | message_*, meeting_invited, application_ack, rejection_received, offer_received, referral_offered, no_response |
| `GoogleCalendarConnector` | Calendar events (MCP batch) | MCP session (read-only) | meeting_scheduled/completed/approaching/canceled |
| `GoogleContactsConnector` | `data/crm-contacts/*.json` (reused) | file (no OAuth) | contact_added/updated, duplicate_identity |

## Google integration audit (reuse-first)

- **No OAuth / no `googleapis` in the repo.** `GOOGLE_API_KEY` powers Google **Places**
  only (contact resolution). No Gmail/Calendar/Contacts API client exists.
- **Reused instead of duplicated:** Gmail and Calendar are read via the **Claude MCP
  session** (read-only) — the same pattern as the Gmail scanner. There is **no Contacts
  MCP**, so `GoogleContactsConnector` reuses the contacts Meridian already imported
  (`data/crm-contacts`). **Zero new OAuth, zero new Google Cloud setup.**
- **Future unattended path** (documented, not built): enable Gmail/Calendar/People APIs,
  add `gmail.readonly` + `calendar.readonly` + `contacts.readonly` scopes and
  `GOOGLE_OAUTH_*` env vars, and have the connectors read the live API into the same
  batch shape. Nothing downstream changes.

## Usage

```bash
npm run reality:check                          # 26 assertions over fixtures (no live data)
npm run reality:scan                           # dry-run over fixtures
npm run reality:scan -- --live                 # real batches in data/{gmail,calendar}
npm run reality:scan -- --live --write         # persist → feeds the Home page (/home)
```

Live inputs: `data/gmail/inbox-batch.json` and `data/calendar/inbox-batch.json` are
produced by Claude via the Gmail / Google Calendar MCP tools; contacts read
`data/crm-contacts`. The Home page (`/home`) renders `data/reality/brief-today.json`.

## Trust guarantees (enforced, tested)

- Connectors observe only — observations have no stage/score/opportunity fields.
- The Belief Engine is deterministic and connector-agnostic; every belief carries
  evidence, a change log, and a falsifier.
- **Engagement gate:** cold one-way inbound (newsletters, cold blasts, leasing agents)
  is observed and believed but never recommended or surfaced — only two-way,
  owner-initiated, or qualified-inbound (seed/lifecycle/meeting) relationships are.
  *(This gate was added after a live run ranked an apartment agent and a newsletter
  above Clue and Blake — exactly the failure the Trust Model exists to prevent.)*
- **No fabricated dollars.** The revenue outlook is ordinal + honest; capital summary
  is qualitative until outcomes calibrate.

## Adding the next sensor (e.g., Slack, GitHub, LinkedIn)

1. Implement `Connector<YourBatch>` that emits `Observation[]`.
2. Map its events to canonical `ObservationType`s (add to the enum only if genuinely new).
3. Register it in `lib/home/pipeline.ts`.

That's it. Beliefs, recommendations, opportunity cost, the change log, and the Home
page already work.
