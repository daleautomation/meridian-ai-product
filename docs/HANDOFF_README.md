# Meridian AI — Handoff README

Single index for the other docs in this folder. Read this first, then the
one most relevant to what you're touching.

## What Meridian AI is

An operator console for LaborTech's KC roofing sales team. For each
roofing lead it:

1. runs a live website scan (`inspect_website`)
2. resolves the best contact path via a provider waterfall
3. scores opportunity and buckets the lead (CALL NOW / TODAY / MONITOR / PASS)
4. renders the above in the operator UI with a deep Scan Report

Every number or claim the UI shows is backed by a specific signal or
provider response. Fabrication is not allowed anywhere in the pipeline.

## Where the single sources of truth live

| Concern | Canonical file | Do not duplicate this |
|---|---|---|
| Lead scoring + bucket | `lib/scoring/companyDecision.ts` → `decideCompany()` | Add signals *into* this function. Never ship a second score. |
| Ranking | `lib/mcp/tools/rankCompanies.ts` | Adjust tiebreakers here, not elsewhere. |
| Contact waterfall | `lib/contacts/resolver.ts` → `resolveContact()` | Add adapters in `lib/contacts/sources/*`, not a second resolver. |
| Provider adapters | `lib/contacts/sources/{googlePlaces,yelp,bbb,facebook,hunter}.ts` | Each one degrades gracefully when its env var is missing. |
| Website audit | `lib/mcp/tools/inspectWebsite.ts` | Extend `issues[]` + `site_classification` here. |
| Persistence | `lib/state/companySnapshotStore.ts` | Use `upsertContactResolution` + `setContactPreferences`. |
| Operator UI | `components/OperatorConsole.jsx` | Extend in place; don't create a second console. |

## Other docs in this folder

- `CONTACT_SOURCING.md` — how contacts get resolved, how to add a provider.
- `SOURCE_PRIORITY.md` — the exact waterfall ranks + verified/unverified rules.
- `SCORING_GUARDRAILS.md` — what *not* to touch inside the scoring engine.
- `KNOWN_LIMITATIONS.md` — stuff that doesn't work yet / gotchas.
- `../.env.example` — env vars, required vs optional, what each provider does.

## Running locally

```
npm install
cp .env.example .env.local     # fill in at least ANTHROPIC_API_KEY + SESSION_SECRET
npm run dev
```

The app boots without any provider API keys — every adapter is
env-gated and returns `[]` when unconfigured. The resolver surfaces
`skippedSources` so you can see exactly which providers were skipped
and why (see `ContactResolution.skippedSources`).

## When something is broken

1. Check the operator dev log for `[google_places]` / `[hunter]` log
   lines — they report query, result count, and top match per call.
2. Hit the persisted snapshots directly at `data/companySnapshots.json`
   (gitignored). `contactResolution.detail` tells you *why* each lead
   got its current result (`verified_phone_found_google`,
   `no_provider_match_contact_page_only (google_skipped_no_key,…)`, etc.).
3. Re-run `batch_resolve_contacts` via `/api/mcp` to force-refresh.
