# Onboarding Checklist

Per-customer checklist for the founder. Run top-to-bottom when bringing
on a new paid operator. Estimated total: 90 minutes of founder time +
30 minutes of operator time, spread over the first three days.

---

## Pre-call (founder, 15 min)

- [ ] Customer has signed the offer (text confirmation is fine for v1)
- [ ] Decide the workspace slug (e.g. `jane-smith` or `acme-roofing`)
- [ ] Add the customer to `config/tenants.ts` with a real password
  (rotate it; never reuse another customer's)
- [ ] Add a workspace entry to `config/workspaces.ts` with `kind: "personal"`
  (see note below for LaborTech-style B2B)
- [ ] Run `npm run check-crm-integrity` to confirm nothing regressed
- [ ] Push + deploy: `git push && npx vercel --prod`

> **Routing note**: today's weekly briefing panel + outcome capture
> lives on `/personal` only. Workspaces with `kind: "personal"` route
> through that surface; `kind: "labortech"` and `kind: "relationship"`
> route to `/operator`, which does NOT yet carry the weekly panel.
> For first paid customers, set `kind: "personal"` so they reach the
> working surface, regardless of vertical. Revisit only after a
> second-vertical customer is paying.

---

## Kickoff call (founder + operator, 30 min)

- [ ] Walk through the pricing one-pager. Confirm offer + commitment.
- [ ] Confirm which CRM the operator uses + how they'll export.
- [ ] Set expectation: first Monday brief lands in 7–10 days.
- [ ] Set expectation: continuity intelligence becomes visible in Week 3.
- [ ] Send login credentials. Confirm they reach `https://www.meridianai.work/login` and successfully sign in.

---

## CSV import (founder, 30 min)

- [ ] Receive the operator's CSV via email (do NOT use shared links).
- [ ] Open the CSV locally. Note the column shape.
- [ ] Identify:
  - First name + last name columns (preferably separate)
  - Email column
  - Phone column
  - Address line(s) + city + state + ZIP
  - Tags / categories column
  - Last interaction date column
  - Notes / comments column
- [ ] Use the existing operator-import UI at
  `https://www.meridianai.work/personal/import?workspace=<slug>` (or
  `/operator/import` for non-personal workspaces). Upload the CSV.
- [ ] Review the import preview. Confirm column mapping is correct.
- [ ] Commit the import.

---

## Post-import audit (founder, 15 min)

- [ ] `set -a; source .env.local; set +a`
- [ ] `npm run crm:audit -- --customer=<slug>`
- [ ] Read the audit output. Note specifically:
  - **Trust-killer checks** — every line must say `OK`.
  - **Integrity tiers** — if ≥ 30% HIGH tier, the workspace is solid.
    If majority is WEAK, schedule a rehab session (see below).
  - **Enrichment eligibility** — note how many contacts are
    Hunter-eligible and Property-eligible. Don't run live enrichment
    yet.
- [ ] If majority WEAK: schedule a 30-minute rehab call with the
  operator before the first brief generation.

## CRM rehab session (founder + operator, 30 min)

> Only if the audit said majority-WEAK. Many residential CRMs need this.

- [ ] Walk through contacts whose tier is WEAK because of missing
  surnames. Have the operator name them; you type the surnames into
  Neon (one UPDATE per row).
- [ ] Same for unparseable addresses where the operator knows them.
- [ ] Re-run `npm run crm:audit`. Confirm HIGH-tier count climbed.

---

## First weekly state generation (founder, 15 min)

- [ ] `npm run weekly-state:generate -- --customer=<slug>`
- [ ] Read the generated `.email.txt`. Confirm tone is calm + correct.
- [ ] Read the generated `.json` snapshot. Confirm:
  - Priorities are real (not internal-diagnostic).
  - Rank-1 is not `fallback:no_context`.
  - At least one priority cites a real evidence string.
- [ ] Force-add the snapshot file + push + deploy:
  ```
  git add -f data/weekly-state/<slug>/<weekId>.json
  git commit -m "[ops] First weekly snapshot for <slug>"
  git push origin <branch>
  npx vercel --prod
  ```

---

## First Monday delivery (founder, 5 min)

- [ ] 7:00 AM: send activation email by hand. Copy from `.email.txt`,
  paste into your email client, sign personally, include workspace
  link, send.
- [ ] Monitor outcome capture mid-day. If zero by EOD, send a
  light-touch check-in note.

---

## Pricing conversation trigger (founder, 30 min)

- [ ] **Tuesday of Week 2**, after the second Monday brief has landed.
- [ ] Open with: "How did this Monday land vs last Monday?"
- [ ] Walk through what their captured outcomes changed in the
  second-week brief (the continuity moment).
- [ ] Present invoice. Net 7. ACH or check.

---

## Hand-off after Week 4

- [ ] Schedule a 30-minute "what's working / what's not" review.
- [ ] If they're engaging weekly: continue Monday delivery as normal.
- [ ] If they're not: do NOT roll a second 60-day commitment. Have the
  honest conversation; either rehab the workspace or sunset cleanly.

---

## Files / state per customer

- `config/tenants.ts` — credentials (rotate per customer; never share)
- `config/workspaces.ts` — workspace entry (kind, branding, slug)
- `data/weekly-state/<slug>/<weekId>.json` — per-week snapshot files
  (force-added to git after each generation; pruned after 8 weeks)
- `data/weekly-state/<slug>/<weekId>.email.txt` — never committed,
  hand-copied into your email client
- `data/outcomes/<slug>.json` — append-only outcome log (per customer
  on production filesystem; periodically backed up by founder)
- `data/crm-contacts/<slug>.json` — local file backend (only for
  development; production uses Neon)
- `docs/customer-notes/<slug>.md` — your own running notes file (not
  committed if it contains operator details)

---

## What to never do

- Add a customer's email or signing key to a shared doc.
- Skip the audit step. The audit is the only thing that catches
  Greg·Greg-style trust killers BEFORE the operator sees them.
- Generate a Monday brief on top of uncommitted code changes.
- Promise outcomes that the workspace cannot demonstrably produce
  (e.g. "Meridian will tell you when someone is about to sell" — the
  product does not do this).
- Send a brief that uses words like "leverage" or "act now" — they're
  banned by the validator for a reason.
