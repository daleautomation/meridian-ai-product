# Known Limitations

Stuff that doesn't work yet, stuff that's half-wired, and gotchas for
the next engineer. Kept honest so no one re-solves a solved problem.

## Providers not wired

- **Apollo** — adapter not implemented. Spot reserved on `PROVIDER_RANK`
  via the `bing`/`angi` slots if needed; add a new source file under
  `lib/contacts/sources/apollo.ts` following the BBB pattern (env-gated
  proxy / API), then register it in `resolver.ts::ADAPTERS` and
  `providerSkipReasons()`. Useful mainly for people-level B2B
  enrichment.
- **People Data Labs** — same as Apollo. Higher-volume people enrichment,
  cost-sensitive; worth wiring only if Hunter coverage proves thin.
- **Angi** — listed in `ContactSource` type but no adapter exists.
- **Bing Places** — same.
- **BBB** — adapter exists but requires a self-hosted proxy at
  `BBB_SEARCH_URL` (BBB has no public API). Left unimplemented by
  default. Shape documented in `lib/contacts/sources/bbb.ts`.
- **Facebook** — same story. Needs a proxy at `FACEBOOK_SEARCH_URL`.

## Email extraction

- The inspector does NOT execute JavaScript. Sites that render emails
  client-side only (React/Vue SPAs with no SSR, `<div data-email="…">`
  hydrated at runtime) won't yield emails unless those emails appear in
  the raw HTML or in a JSON-LD block. React apps with server rendering
  typically include them in source.
- Image-based email displays (JPEG / SVG text) are NOT OCR'd. If a
  business only shows `info@acme.com` as an image, we can't read it.
- Our domain-mismatch guard compares the email's domain against
  `matchedDomain` (taken from a scored candidate's website, otherwise
  `input.website`). If the business legitimately uses a separate domain
  for email (e.g. `acme.com` website but `acme-group.com` email), it
  will be flagged as a mismatch. Set `preferredEmail` via
  `set_contact_preferences` to override.
- The resolver does NOT attempt Hunter Email Finder (person-level
  lookup by first/last name + domain) yet. Only Domain Search is wired.

## AI dependency

- The operator UI has deterministic fallbacks for **call scripts**
  (`lib/mcp/tools/generateCallScript.ts` now returns a real template
  when Claude fails), **objection handling** (`defaultObjections()` in
  `OperatorConsole.jsx`), and the **Assistant Chat** (shows
  "Assistant error" panel when `/api/ai/chat` fails).
- `generate_opportunity_summary` still depends on Claude — when
  unavailable the lead just doesn't get a Claude summary; scoring
  continues on deterministic signals alone. Not currently backfilled
  with a template.

## PageSpeed

- `websiteProof.page_speed_mobile` is reserved on the type but never
  populated — no PageSpeed adapter shipped. Add one under
  `lib/mcp/tools/inspectWebsite.ts` or as a separate tool if/when
  Lighthouse access is decided.

## Ingestion / seed data

- `data/seed/kc-roofing-companies.json` includes a handful of
  placeholder-domain leads (`example.org`, `iana.org`, `w3.org`) for
  bootstrap. The resolver's Hunter adapter filters these out via
  `normalizeDomainForHunter()` but they still render in the operator
  list. Swap them for real domains before a demo.
- No automated re-seeding. `POST /api/pipeline/seed` manually imports
  the seed file; `runDailyPipeline()` in `lib/pipeline/dailyJob.ts`
  orchestrates the full cycle.

## UI

- The `key={refreshKey}` body-remount anti-pattern was removed. The
  `refreshKey` state + `setRefreshKey` setter remain in scope so
  `logOutreach` callbacks continue to trigger a React re-render
  without nuking modal state; not yet wired to force a snapshot
  reload. Reloads happen on page navigation only.
- `LeadDetail` still mounts per-row. Modal state (`showScanModal`,
  `showLog`, etc.) dies when the operator switches leads — this is
  intentional, but if we later want modals to persist across lead
  switches, hoist state to `OperatorConsole`.
- Legacy `rowSeverity` / `ROW_SEV` constants are dead code after the
  hierarchy fix. Eslint warnings only; safe to delete in a future
  cleanup pass.

## Scoring

- The Claude-authored `generate_opportunity_summary` signal can still
  nudge score ±20 via `summary_level` in `decideCompany()`. When Claude
  has been failing, recent leads may be mildly under-scored until the
  next successful enrich pass.
- `dealHeat` and `urgency` calculations reference time-of-day /
  follow-up-due logic that assumes the operator is working in KC
  timezone. No explicit timezone normalization.

## MCP / auth

- `/api/mcp` accepts either a session cookie or `MCP_SECRET` header.
  In dev there's no MCP_SECRET set by default, so external callers
  (scripts, tests) can't reach the tools without logging in via the UI
  first. Set `MCP_SECRET` in `.env.local` to enable header auth.

## Data integrity

- `data/companySnapshots.json` is the single source of lead state. It's
  append-only per tool but gets rewritten atomically on every
  persistence call (`fsSafeWrite`). Not durable against multi-process
  writes — the app is a single Next.js server.
- Contact overrides via `set_contact_preferences` with empty string
  clears a field. No soft-delete / history kept on overrides.
