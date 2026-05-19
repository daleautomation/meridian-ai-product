# Contact Sourcing

How Meridian AI turns a company record into a real contact path.

## Flow

```
BusinessInput {companyName, city, state, category, website?, phone?, email?, hasContactForm?}
          │
          ▼
normalizeIdentity()  ──►  Identity {normalizedName, locationKey, domain, …}
          │
          ▼
ADAPTERS run in parallel (env-gated):
  google_places  │  yelp  │  bbb  │  facebook  │  hunter
          │
          ▼
scoreCandidate()   ──►  filter by MATCH_THRESHOLD (0.60)
                         + secondary acceptance (name ≥ 0.50 + loc ≥ 0.70 + phone)
          │
          ▼
buildContactPaths()  ──►  ranked ContactPath[]
          │
          ▼
enrichResolution()   ──►  corroboration + bestNextAction + contactQualityScore +
                          matchType + alternates + …
```

All of this lives in `lib/contacts/resolver.ts`. The only files you
should need to touch to add a new provider are:
1. `lib/contacts/sources/<your-provider>.ts` (new file; follow the
   pattern of `googlePlaces.ts` or `bbb.ts`).
2. Add it to the `ADAPTERS` list in `resolver.ts`.
3. Add its skip reason to `providerSkipReasons()` in the same file.

## First-party vs third-party

| Signal | Source | Verified? |
|---|---|---|
| `phone` via `google_places` | Google Place Details | yes (high confidence) |
| `phone` via `yelp` | Yelp Fusion | yes (high confidence) |
| `phone` via `bbb` | BBB proxy (self-hosted) | medium |
| `phone` via `input.phone` (site-scraped) | `inspect_website` extractor | **no** (`source: "scrape"`) |
| `email` via `input.siteEmails[method="website_mailto"]` | real `<a href="mailto:…">` on site | medium (first-party, real link) |
| `email` via `input.siteEmails[method="website_schema"]` | JSON-LD contactPoint.email | medium (first-party structured) |
| `email` via `input.siteEmails[method="website_visible"]` | visible text on site | low (first-party but easy to misparse) |
| `email` via `input.siteEmails[method="website_obfuscated"]` | `[at]` / HTML entity decoded | low (first-party, obfuscated) |
| `email` via `hunter` | Hunter Domain Search | verified only at ≥85 provider confidence |
| `email` via `input.email` (legacy site primary) | `inspect_website` chosen primary | **no** |
| `form` | `inspect_website.has_contact_form` | n/a (it either exists or it doesn't) |

**Rule:** operator-curated values (`snap.preferredPhone`,
`snap.contactPhone`, `snap.preferredEmail`, etc.) always win over
resolver output. The resolver only backfills empty slots.

## Match types

Exposed on `ContactResolution.matchType` — set deterministically in
`enrichResolution()`:

- `exact` — a scored candidate from a verified provider (not `hunter`
  / not `scrape`) agreed on name and location AND supplied a phone or
  website. Shown in UI as **"Matched business profile: X"**.
- `closest` — a scored candidate cleared the fuzzy threshold but
  isn't phone/website-verified. Shown as **"Matched business profile
  (closest listing): X"** — never as a confirmed match.
- `unresolved` — no business identity came back. Shown as **"No exact
  business match found"**.

## Ask-for logic

```
person on file        → "Ask for: Jane Doe (Operations Manager)"
business matched      → "No direct contact found — ask for owner"
nothing matched       → "Ask for: Owner or Office Manager"
```

Implemented once in `buildAskFor()` inside `resolver.ts` and re-derived
from the same rules inside `buildDecisionContacts()` in
`companyDecision.ts`. Do not introduce a third derivation.

## Email extraction (first-party)

`lib/mcp/tools/inspectWebsite.ts` fetches the homepage plus these
subpaths when the homepage misses phone/email/form:

```
/contact, /contact-us, /about, /quote, /estimate, /request-quote,
/team, /staff, /locations, /services, /roofing,
/residential-roofing, /commercial-roofing
```

On every page we collect emails via four methods (each tagged in the
output `emails_from_site[]` array):

1. **`website_mailto`** — raw `<a href="mailto:…">` links.
2. **`website_schema`** — emails inside JSON-LD / `application/ld+json`
   blocks (schema.org contactPoint.email and similar).
3. **`website_visible`** — plain text matches of the EMAIL_RE regex.
4. **`website_obfuscated`** — emails surfaced only after decoding:
   - `[at]` / `(at)` / `[dot]` / `(dot)`
   - HTML numeric entities (`&#64;`, `&#46;`)
   - HTML named entities (`&commat;`, `&period;`)
   - Spaced `foo @ bar . com`

All hits are deduped by normalized lowercase. Known junk (`@example.com`,
`wordpress@…`, `@sentry.io`, asset filenames ending in `.png/.svg/etc`,
`@domain.com`, `@yourdomain.com`, `someone@…`, `user@…`, `your.name@…`)
is filtered out everywhere.

A single primary is chosen via `pickPrimaryEmail()`:
1. Prefer a hit on the company's own domain.
2. Within that, prefer the stronger method (mailto > schema > visible > obfuscated).
3. Tie-break non-generic (jane@…) over generic (info@, sales@) when both
   are on the company domain.

The full list is persisted in `websiteProof.emails_from_site` and fed
into the resolver via `BusinessInput.siteEmails[]`. The resolver emits
one ContactPath per method-tagged hit (ranks 39–42, see
`docs/SOURCE_PRIORITY.md`).

## Email method provenance on ContactResolution

`ContactResolution.emailMethod` records how the chosen primary email was
obtained. One of: `website_mailto`, `website_visible`, `website_schema`,
`website_obfuscated`, `provider_verified`, `provider_observed`,
`fallback_listing`, `unresolved`. The operator UI surfaces this as a
short tag next to the email row ("mailto on site", "provider-verified",
etc.) so reps can see at a glance why they're looking at that email.

## No-email reasons

When the resolver can't return a trustworthy email, it sets
`ContactResolution.noEmailReason` to one of:

- `no_email_found_on_site` — site reachable, zero email hits
- `contact_page_found_no_email` — form exists (contact page reached) but no email
- `no_provider_email_found` — providers returned no matching business email
- `contact_form_only` — only a form path exists on the site
- `website_only_no_email` — site URL present but no email/form
- `no_website_no_email` — no website on file
- `website_unreachable` — site fetch failed during live check
- `domain_mismatch_blocked_email` — a candidate existed but its domain
  didn't match the matched business domain, so we blocked it
- `low_trust_candidates_only` — every candidate failed the trust bar

## Where the persisted data lives

`lib/state/companySnapshotStore.ts`:
- `snap.contactResolution` — the full `ContactResolution` from the last
  `resolveContact()` run
- `snap.contactResolutionCheckedAt` — when it ran
- `snap.contactPhone / contactEmail / contactName` — operator-curated
  legacy fields; still authoritative
- `snap.preferredPhone / preferredEmail / preferredContactName /
  preferredContactRole / preferredContactSource / contactNotes` —
  explicit manual overrides (via `setContactPreferences` / the
  `set_contact_preferences` MCP tool). Higher priority than everything.
