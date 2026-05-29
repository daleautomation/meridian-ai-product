# Founder Monday Runbook

Written for the tired founder at 6:30 AM on a Monday. No theory. No
architecture. Run top-to-bottom; the customer's workspace lands at 7
AM clean.

Every step has: **exact command**, **expected output**, **what to do
if it fails**.

---

## Pre-flight (Sunday evening, 30 minutes)

**1. Confirm env health locally.**

```bash
cd ~/Downloads/decision-platform
npm run env:audit
```

Expected:
- `✓ All required env vars are healthy.`

If it fails:
- **`SESSION_SECRET: empty`** — only blocks local dev, not production. Skip if not running locally. Fix later via Vercel dashboard.
- **`DATABASE_URL: empty`** — blocks everything. Run `node scripts/local-set-database-url.mjs --push-to-vercel` and paste the Neon pooled connection string.
- **`HUNTER_API_KEY: empty`** — only matters if running Hunter pass tonight. Skip otherwise. Fix with `node scripts/local-set-hunter-key.mjs --push-to-vercel`.

**2. Confirm git is clean and on the right branch.**

```bash
git status
git branch --show-current
```

Expected:
- Working tree clean (no uncommitted changes that would surprise tomorrow's deploy).
- Branch: whichever you're shipping from (currently `data/king-county-first-ingest`).

If it fails:
- Commit or stash. Do NOT generate a Monday brief on top of uncommitted work — if something breaks tomorrow, you can't bisect.

**3. Run the integrity validator.**

```bash
set -a; source .env.local; set +a
npm run check-crm-integrity
```

Expected: `check-crm-integrity passed` with 38 fixtures.

If it fails: a code change since last week broke a guarantee. Don't ship the brief tonight; investigate the failure first.

---

## Generation (Sunday evening, 15 minutes)

**4. Audit each customer workspace to confirm data hasn't degraded.**

```bash
set -a; source .env.local; set +a
npm run crm:audit -- --customer=nicole-lonergan
npm run crm:audit -- --customer=labortech
```

What to look for:
- `Trust-killer checks` — every line must say **OK**. If any says BLOCKING, do not ship that customer's brief tonight.
- `Integrity tiers` — HIGH/MED/WEAK counts. Last week's snapshot is in `data/weekly-state/<slug>/<weekId>.json`; eyeball whether tier counts shifted unexpectedly.
- `Founder verdict` — read it. If it names a blocking issue, fix or pause.

If a customer's audit shows new blocking issues:
- Skip them this week. Email them a one-line "Holding this week's brief while I clean up an import issue — back next Monday" note.
- Do NOT send a broken brief. The trust cost is greater than the missed week.

**5. Generate the weekly snapshot.**

```bash
set -a; source .env.local; set +a
npm run weekly-state:generate -- --customer=nicole-lonergan
# For LaborTech (once they have contacts imported):
npm run weekly-state:generate -- --customer=labortech
```

Expected output per customer:
```
[weekly-state] wrote .../<weekId>.json
[weekly-state] wrote .../<weekId>.email.txt
[weekly-state] customer=<slug> weekId=YYYY-Wxx priorities=N resurface=<name> insightKind=<kind> outcomes7d=N
```

If `priorities=0`:
- Customer has no contacts imported OR all contacts are internal-diagnostic. Run `npm run crm:audit` to see why.
- If they truly have no priorities (Friday-mode workspace with everything cleared): send a short "Quiet week — nothing surfaced. Captured outcomes will reshape next Monday's brief." note instead of a generated email.

If `insightKind=honest_cold_start`:
- Expected for first 1–2 weeks. The continuity insight will say "Continuity insights begin after your first week of captured outcomes." Honest.

**6. Eyeball every generated snapshot before sending.**

```bash
cat data/weekly-state/nicole-lonergan/$(date -v+1d +%Y)-W$(date -v+1d +%V).json | jq '.priorities[] | {rank, name, openerSource, supportingEvidence, trustLevel}'
```

(If `jq` isn't installed: `cat <file>` and read top-down.)

What to look for:
- **No "Persist Check"** or test-row names. The filter should hide them, but if you see one, stop and investigate.
- **No `openerSource: "fallback:no_context"` in rank 1**. If it's the top priority, the workspace lacks evidence for the most important card — don't send.
- **Every priority has non-empty `supportingEvidence`**. If any is blank, stop.
- **No banned phrases** ("AI suggests", "perfect time", "leverage", "likely to close"). The validator catches these but a manual scan is reassuring.

**7. Eyeball the activation email.**

```bash
cat data/weekly-state/nicole-lonergan/$(date -v+1d +%Y)-W$(date -v+1d +%V).email.txt
```

Expected shape:
```
Subject: Your Meridian workspace is ready for this week

Your Meridian workspace is ready for YYYY-Wxx.

N priority relationships queued. Top resurface: <Name> — N months quiet.

Continuity insights begin after your first week of captured outcomes.
[OR a real continuity sentence after Week 2+]

Open workspace:
https://www.meridianai.work/personal?workspace=<slug>
```

If anything reads salesy, hyped, or AI-flavored: edit it by hand before sending. The .txt file is your draft, not the final.

---

## Snapshot delivery to production (Sunday evening, 5 minutes)

**8. Get the snapshot file onto the production filesystem.**

Production reads `data/weekly-state/<slug>/<weekId>.json`. Vercel's filesystem doesn't have your laptop's files. Until a per-customer endpoint exists, force-add the snapshots and let the next deploy carry them.

```bash
git add -f data/weekly-state/nicole-lonergan/$(date -v+1d +%Y)-W$(date -v+1d +%V).json
# Same for labortech if generating that brief
git commit -m "[ops] Weekly snapshots for $(date -v+1d +%Y)-W$(date -v+1d +%V)"
git push origin <current branch>
npx vercel --prod
```

Expected from `vercel --prod`:
- `Production https://meridian-ai-product-...`
- `Aliased https://www.meridianai.work`
- `readyState: READY`

If the deploy goes to `decision-platform` instead of `meridian-ai-product`:
- Stop. Check `.vercel/project.json` content — it should read `"projectName":"meridian-ai-product"`. If not, fix it before re-deploying.

**9. Confirm production is serving the new deploy.**

```bash
curl -sI https://www.meridianai.work/login | grep "dpl="
```

The `dpl=` value should match the deployment ID from step 8. If not, wait 30 seconds and retry — Vercel's CDN propagation.

---

## Monday morning (5 minutes total)

**10. 6:55 AM — final dry-run check.**

```bash
npx vercel inspect $(grep dpl= /tmp/.last-deploy 2>/dev/null || echo PASTE_DEPLOYMENT_ID) --scope d-3258s-projects 2>&1 | grep -E "Project|Status|target"
```

Or just open `https://www.meridianai.work/personal?workspace=<customer>` in a private browser window after signing in. The weekly briefing panel should render with the priorities from your snapshot.

**11. 7:00 AM — send the activation email.**

Open your email client. Paste the contents of `<weekId>.email.txt`. Sign personally. Send.

Do NOT:
- Send to multiple customers in the same email thread.
- Add marketing copy, promo, or "stay tuned" language.
- Use a noreply address. Your real address. Reply-able.

---

## Monday during the day (passive monitoring)

**12. Check outcome capture is happening.**

```bash
ls -la data/outcomes/<customer>.json 2>/dev/null | head -3
# Or query Neon directly:
set -a; source .env.local; set +a
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`select count(*) from crm_contacts where workspace_id='<slug>' and source_metadata->'enrichment'->>'hunter' is not null\`.then(r=>console.log(r));
"
```

If by Monday evening the operator has captured zero outcomes: that's signal. Either the email didn't land, the link didn't work, or the workspace didn't feel actionable. Send a short check-in note ("Did the brief land OK? Any trouble opening the workspace?"). Do NOT pressure them to "engage."

---

## Mid-week (Wednesday evening, 5 minutes)

**13. Check midweek-mode is rendering correctly.**

Open the customer's workspace in a private browser window. Confirm the panel has collapsed into "Week in progress" mode with the remaining priority count. Confirm outcomes captured Monday are visible in the "Captured this week" sub-section.

**14. Note any operator feedback in a Sunday-review file.**

```bash
echo "$(date '+%Y-%m-%d'): <observation>" >> docs/customer-notes/<customer>.md
```

---

## Friday evening (5 minutes)

**15. Eyeball the Friday summary mode.**

Open the customer's workspace. Friday panel should show:
- Outcomes captured count
- Priorities touched
- Follow-ups deferred
- Returning next week list

If any number reads wrong, capture the discrepancy and investigate Saturday — don't fix it before next Monday's generation, because outcome data is append-only and overlay logic is deterministic.

---

## Saturday retro (15 minutes)

**16. Read the captured outcomes for the week.**

```bash
cat data/outcomes/<customer>.json | jq '. | sort_by(.recordedAt) | reverse | .[0:20]'
```

What to ask yourself:
- Did the operator capture the things you expected them to capture?
- Were any priorities ignored (no outcome captured all week)?
- Did the continuity insight from Monday match what actually happened?

**17. Update the runbook itself if anything surprised you.**

This file is operational. If a step failed this week and you found a fix, write it down before you forget.

---

## Pricing conversation triggers

After the customer's **second** Monday brief (Week 2) — by which time the outcome loop has visibly compounded — schedule the pricing conversation for Tuesday morning. Bring `docs/pricing-one-pager.md`. Send the invoice that same Tuesday.

Do NOT have the pricing conversation in Week 1. Trust isn't established yet.

Do NOT skip the conversation past Week 4. If after four weekly briefs the customer still isn't engaging or paying, the workspace isn't right for them and you're burning founder-time.

---

## Failure modes (quick reference)

| Symptom | Likely cause | First fix |
|---|---|---|
| `weekly-state:generate` exits with no priorities | Customer has zero contacts OR all are internal-diagnostic | `npm run crm:audit` to confirm |
| Vercel deploy lands on `decision-platform` | `.vercel/project.json` corrupted | Re-write it pointing at `prj_arZciRk1HLFysmUjwElN9gaKg9rk` |
| `/personal` shows "Contact storage not configured" | DATABASE_URL empty on production | `vercel env ls production`; re-add if missing |
| Brief opener says "I was reviewing open follow-ups" | Sprint 1 voice fix regressed | `git log lib/recovery/brief.ts` — find the regression |
| Card shows "Greg · Greg" | Sprint 2 normalize fix regressed OR new corrupt rows from an import | Run `npm run crm:audit` — check trust-killer line |
| `hunter:check` 401 | Key rotated or wrong | `node scripts/local-set-hunter-key.mjs --push-to-vercel` |
| Snapshot panel doesn't render on /personal in production | Snapshot file not in production filesystem | Force-add + deploy per step 8 |
| Operator says "the brief feels generic" | Customer data is too weak for evidence-grounded openers | Don't ship more — schedule a CRM rehab session with them |

---

## What this runbook will NOT do

- Tell you what to charge.
- Tell you what tone to use in customer email.
- Diagnose why an operator didn't open the brief.
- Validate whether the wedge is right.

Those are founder judgment calls. Everything mechanical lives in here.
