# Source Priority

The exact ranking used by the contact waterfall. Defined once in
`lib/contacts/resolver.ts::PROVIDER_RANK` + `buildContactPaths()`.

## Provider rank (phone-producing)

Lower rank = preferred.

| Rank | Source | Phone confidence | Verified? |
|---|---|---|---|
| 1 | `google_places` | high | ✓ |
| 2 | `yelp` | high | ✓ |
| 3 | `bbb` | medium | ✓ |
| 4 | `angi` *(not wired)* | medium | ✓ |
| 5 | `facebook` | low | ✗ |
| 6 | `bing` *(not wired)* | low | ✗ |
| 7 | `scrape` (site-extracted) | medium | ✗ |
| 8 | `hunter` | n/a (email only) | — |

## ContactPath rank (sorted paths[] order)

After candidate scoring and path-building, paths are sorted ascending
by `rank`. Lower = best reachable path.

| Rank | Method | Source | Notes |
|---|---|---|---|
| 1–5 | `phone` | provider (1=google, 2=yelp, …) | verified paths |
| 10 | `phone` | website (from `inspect_website.phone_from_site`) | unverified |
| 20 | `website` | business URL | contact page or homepage |
| 28 | `form` | website | fires when `hasContactForm === true` |
| 30 | `social` | facebook | messenger / page fallback |
| 35 | `email` | `hunter` | verified only at providerConfidence ≥ 85 |
| 38 | `email` | other providers | never inferred |
| 39 | `email` | website (mailto link) | first-party, real `<a href="mailto:…">` |
| 40 | `email` | website (JSON-LD schema) | first-party, structured data |
| 41 | `email` | website (visible text) | first-party, regex-extracted |
| 42 | `email` | website (obfuscated) | first-party, decoded from `[at]` / entities |

## Best-next-action derivation

`deriveBestNextAction()` in `resolver.ts` walks the paths in this order
and emits the strongest action the operator can take **right now**:

```
verified phone   →  READY TO CALL
unverified phone →  READY TO CALL (with "(unverified)" note)
person email     →  READY TO EMAIL
generic inbox    →  READY TO EMAIL
contact form     →  SUBMIT FORM
website / social →  MANUAL VERIFY
none             →  RESEARCH FURTHER
```

## Confidence → UI

`sourceConfidence()` normalizes provider-specific score into the
canonical `"high" | "medium" | "low" | "none"`. Confidence pills in the
UI read directly from `phoneConfidence` / `emailConfidence` /
`nameConfidence` on `ContactResolution`.

Any new adapter MUST return a confidence that fits this scale — do not
invent a new tier.

## Corroboration

When two independent verified sources agree on a phone number (digits
only, normalized to 10 digits), `corroborated: true` and
`corroborationReasons[]` records the specific match (e.g.
`"google_phone_matches_site_phone"`,
`"hunter_email_matches_site_domain"`). Adds +6 to contactability and
surfaces a `✓ corroborated` mark in the UI.

## Email domain trust

`enrichResolution()` compares the primary email's domain against
`identity.domain`. Mismatch sets `emailDomainMismatch: true` and
forces `emailConfidence = "low"`. Hunter-provided emails only stay at
`high` when `providerConfidence ≥ 85` AND no domain mismatch.

When the mismatch is what prevented an email from being returned (e.g.
Hunter's best candidate was on a different domain than the matched
business), `noEmailReason` is set to `domain_mismatch_blocked_email`
instead of a generic "no email found" reason.

## Email method → UI label

`ContactResolution.emailMethod` records provenance of the chosen primary
email:

| method | meaning | UI label |
|---|---|---|
| `website_mailto` | `<a href="mailto:…">` on site | mailto on site |
| `website_schema` | JSON-LD contactPoint.email | schema on site |
| `website_visible` | plain text regex match | visible on site |
| `website_obfuscated` | decoded from `[at]` / entities | obfuscated on site |
| `provider_verified` | Hunter w/ providerConfidence ≥ 85 | provider-verified |
| `provider_observed` | Hunter w/ providerConfidence < 85 | provider-observed |
| `fallback_listing` | directory/social last-resort | fallback listing |
| `unresolved` | no email selected | (not rendered) |
