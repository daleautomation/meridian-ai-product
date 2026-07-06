# Gmail Opportunity Ingestion

> Turns real Gmail activity (inbox + sent + archived, full threads) into deterministic,
> evidence-bearing Meridian opportunities. Read-only. No AI scoring. Nothing invented.
> Governed by [`MERIDIAN_TRUST_MODEL.md`](../../MERIDIAN_TRUST_MODEL.md): every opportunity
> carries evidence, weak signals are marked low-confidence, and unknowns say UNKNOWN.

## How it works (the pattern)

This repo has no LLM calls and no OAuth SDK by design. The established pattern is:
**Claude reads the world; the deterministic engine decides.** For Gmail:

```
Claude (VS Code, via Gmail MCP)  ──reads threads──▶  GmailThreadBatch (JSON)
                                                          │
                                     lib/gmail/scan.ts (pure, deterministic)
                                                          │
              normalize ▶ classify stage/momentum/status/confidence ▶ evidence
                                                          │
                     data/gmail/opportunities.json  +  Opportunity Graph (Postgres)
```

The reader is interchangeable: **Claude via MCP today**, a direct Gmail API client later
(§ Direct API path). The classifier never changes.

## The two ways to run

### A) Agent-driven (works today, recommended)

Claude (in this VS Code session) uses the Gmail MCP tools to search your inbox and writes
the results to a batch file, then the CLI classifies them:

```bash
# Claude runs search_threads across the query plan (lib/gmail/queries.ts),
# writes data/gmail/inbox-batch.json in GmailThreadBatch shape, then:
npm run gmail:opportunities:scan -- --batch data/gmail/inbox-batch.json          # dry-run
npm run gmail:opportunities:scan -- --batch data/gmail/inbox-batch.json --write  # persist
```

### B) Fixture (no Gmail needed — for validation/CI)

```bash
npm run gmail:opportunities:scan     # dry-run over fixtures/gmail/sample-threads.json
npm run gmail:scan:check             # 20 assertions incl. correct Clue detection
```

## What it detects

For each opportunity: name, company, people, **stage**, momentum, status, last inbound,
last outbound, who owes a reply, next action, why-now, confidence + relevance, evidence
(thread id, sender, subject, date, excerpt), the reason the stage was assigned, and **what
changed since the last scan** (the trust-model change log).

**Stages** (deterministic): `discovered, contacted, replied, meeting_scheduled,
meeting_completed, waiting_on_them, waiting_on_me, follow_up_due, active_pipeline, stalled,
rejected, closed_won, closed_lost, watch`.

**Not job-search only.** Kinds: `career, sales, consulting, partnership, referral`.

## Search strategy

`lib/gmail/queries.ts` builds a *plan* of focused Gmail queries — seeds, career/recruiter,
founders/referrals, proposals/bids, calendar invites, **sent-with-no-reply**,
**inbox-unanswered**, plus people/companies already in the graph. Full threads are read
(a sent email with no reply and an unanswered inbound are both signals). Dedup is by
opportunity (all Clue threads collapse into one), not just by thread.

## Trust model

- Every opportunity **must** have evidence; the scanner cannot emit one without it.
- Weak/ambiguous signals → `confidence: low`; unclassifiable → counted as `unknown`.
- Newsletters/no-reply automation are dropped as noise (unless a seed matched).
- Deterministic and replayable: same threads + same reference time → identical output.

## Seeds

`lib/gmail/seeds.ts` holds known entities (Clue Insights, Blake/Quext/OwnerLM, Chandler,
Ronco, Block & Mortar, Clipboard, SafetyCulture, Oracle, Holland 1916, SoftDoes,
Preston/painting, LaborTech). Seeds **boost and canonicalize** — they are not an allowlist;
any real two-way human thread can become an opportunity. Extend the registry as data.

## Persistence

- **Primary:** `data/gmail/opportunities.json` (staging store + the "previous scan" source
  for the change log).
- **Graph:** when `DATABASE_URL` is set and the graph tables exist (see
  `OPPORTUNITY_GRAPH_PHASE_0_1.md`), `--write` also projects people/companies + `KNOWS`/
  `WORKS_AT` edges carrying live stage/momentum into the Opportunity Graph, provenance
  `source_system = "gmail"`.

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `MERIDIAN_OWNER_EMAILS` | comma-separated addresses that count as "me" (outbound) | `dylandinkc@gmail.com` |
| `MERIDIAN_GMAIL_NOW` | override "now" for deterministic runs (ISO) | current time |
| `DATABASE_URL` | enables graph persistence on `--write` | unset (staging only) |

## Direct Gmail API path (later, for unattended runs)

The agent-driven path needs no OAuth. If/when you want an unattended cron scan, add a
minimal read-only client:

- **Google Cloud:** enable the **Gmail API** on the project.
- **OAuth scopes (read-only, first pass):**
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.metadata` (optional, metadata-only)
  - `https://www.googleapis.com/auth/gmail.labels` (optional, to read label ids)
  - Do **not** request `gmail.modify` for the first pass (labeling comes later).
- **Env vars:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
  (or `GMAIL_ACCESS_TOKEN` for a short-lived test). The client fetches `users.threads.list`
  (paginated) + `users.threads.get`, maps to `GmailThreadBatch`, and pipes into the same
  `scanThreads()`.
- **Local test:** `curl -s -H "Authorization: Bearer $GMAIL_ACCESS_TOKEN" \
  "https://gmail.googleapis.com/gmail/v1/users/me/threads?q=from:getclue.com&maxResults=5"`

This is documented, not built — the guardrail is "do not overbuild." The MCP path already
delivers the goal: Claude actively scans Gmail and tells Meridian where every opportunity
stands.
