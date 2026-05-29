# Autonoma UI testing — Meridian (Nicole workspace)

UI-only end-to-end checks for the Nicole Lonergan personal workspace on live Vercel deployments (`https://www.meridianai.work`).

## Setup status

| Step | Status | Action |
| --- | --- | --- |
| Vercel Marketplace integration | **Manual** | Install [Autonoma UI testing](https://vercel.com/marketplace/autonoma-ai/ui-testing) on the Meridian Vercel project |
| Connect GitHub repo | **Manual** | Link `decision-platform` when prompted during install |
| Application versions | **Manual** | Confirm production + preview URLs in Autonoma Application Settings (not the default `https://vercel.com`) |
| Vercel Protection Bypass | **Auto on connect** | Autonoma configures `x-vercel-protection-bypass` when the integration is linked; rotate in Autonoma if Vercel rotates the secret |
| Repo test definitions | **Done** | Natural-language tests in `autonoma/tests/*.md` |
| Autonoma variables | **Manual** | Create in Autonoma project settings (see below) |
| Deployment Check gate | **Manual** | Optional: Project Settings → Deployment Checks → require Autonoma before production promotion |

This repo does **not** modify Neon, run migrations, or change product logic. Tests assert rendered UI only.

## Autonoma variables

Create these in Autonoma → Project → Variables:

| Variable | Example value | Used for |
| --- | --- | --- |
| `MERIDIAN_BASE_URL` | `https://www.meridianai.work` | Login + workspace navigation |
| `NICOLE_USERNAME` | `nicole` | Client login |
| `NICOLE_PASSWORD` | *(from credential sheet)* | Client login |
| `NICOLE_WORKSPACE_URL` | `https://www.meridianai.work/personal?workspace=nicole-lonergan` | Direct workspace entry after login |

## Import tests into Autonoma

1. Open Autonoma → Applications → Meridian → Tests.
2. Import or recreate each file under `autonoma/tests/` (Markdown + YAML frontmatter).
3. Attach the **Nicole workspace login** test as a prerequisite for tests 01–06, or configure header/cookie auth after a one-time login test.
4. Enable **mobile viewport** (375×812) for test `06-mobile-layout`.

Recommended login flow (matches `00-login-nicole-workspace.md`):

```
POST {{variable:MERIDIAN_BASE_URL}}/api/auth/login
  body: { "username": "{{variable:NICOLE_USERNAME}}", "password": "{{variable:NICOLE_PASSWORD}}" }
→ Navigate to {{variable:NICOLE_WORKSPACE_URL}}
```

Alternative on approved hosts: `GET /api/auth/demo-login?user=nicole&workspace=nicole-lonergan&surface=personal`

## Local mirror (Playwright)

Run the same assertions locally or in CI against any deployment URL:

```bash
MERIDIAN_BASE_URL=https://www.meridianai.work npm run autonoma:nicole:live
```

Uses `@playwright/test` already in devDependencies. Does not replace the Autonoma Deployment Check — it validates the test spec before import and catches regressions during development.

## Test coverage map

| File | Requirement |
| --- | --- |
| `00-login-nicole-workspace.md` | Reach Nicole personal workspace after auth |
| `01-relationship-primary-labels.md` | Relationship classifications render as primary card labels |
| `02-crm-only-no-opportunity-language.md` | CRM-only cards omit Opportunity / Hot Lead / Seller Signal / market-fit copy |
| `03-reachability-recency-confidence-badges.md` | Reachable, recency, and confidence badges on cards |
| `04-card-opens-detail-panel.md` | Clicking a card opens the detail panel |
| `05-not-reachable-not-at-top.md` | Not Reachable contacts are not in the top priority slots |
| `06-mobile-layout-no-overflow.md` | Mobile layout: no horizontal overflow; key labels visible |

## Valid relationship primary labels

Autonoma assertions should accept only these as the **primary relationship chip** on a contact card:

- Past Seller Reconnect
- Seller History (Verify Recency)
- Sphere Reengagement
- Cold Relationship
- Not Reachable

## Live verification (2026-05-29)

Ran `MERIDIAN_BASE_URL=https://www.meridianai.work npm run autonoma:nicole:live` against production:

| Test | Production result | Notes |
| --- | --- | --- |
| 00 login / load | Pass | |
| 01 relationship primary labels | **Fail** | Cards show `30% · raw 42` + `Baseline import score` instead of relationship chips |
| 02 CRM-only language | Pass | No banned Hot Lead / Seller Signal copy (old UI also avoids these) |
| 03 reachability / recency / confidence | **Fail** | Card-level badges absent on production build |
| 04 detail panel | Pass | |
| 05 not reachable at top | Pass | (vacuous — old UI has no Not Reachable chip to detect) |
| 06 mobile layout | **Fail** | Relationship + reachability labels missing on cards (same stale UI) |

**Root cause:** Production is serving the pre–relationship-intelligence `PersonalWorkspace` card layout. The updated UI (relationship chip, reachability/recency/confidence badges, reachable summary metric) exists in this repo but is **not deployed** to `meridianai.work` yet.

**Required fix:** Deploy the current relationship-intelligence UI branch to Vercel production, then re-run Autonoma / `npm run autonoma:nicole:live`.

**Post-deploy watch:** Mobile two-column grid (`minmax(280px, 0.8fr)`) has no breakpoint — re-run test 06 after deploy; if horizontal overflow appears, add a stacked mobile layout in `PersonalWorkspace.tsx` only.

