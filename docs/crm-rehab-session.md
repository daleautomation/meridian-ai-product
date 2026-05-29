# CRM Rehabilitation Session — Founder Runbook

> A conversational guide for the 30–90 minute call that turns a
> majority-WEAK workspace into a majority-MED/HIGH workspace before the
> next Monday brief. Optimized for low stress and live progress
> visibility.

This is not a software walkthrough. It's a phone call. Treat it as
such: warm tone, fast pace, no technical language with the operator,
no acrobatics, no spreadsheets shared.

---

## Why this session exists

The operator has been running a CRM for years. Most of the rot is
small — single-name contacts, addresses that lost the ZIP, a couple
of "Greg · Greg" artifacts from a bad import. They know who these
people are; the CRM forgot. This session asks them what they know,
captures it in 30–90 minutes, and reruns the audit live so they SEE
the workspace get better.

The operator's cost is one phone call. The founder's cost is the
same call plus 30 minutes of prep + 30 minutes of post-session
regeneration. Outcome: a workspace that can carry a paid Monday brief.

---

## Pre-session prep (founder alone, 30 minutes)

1. Confirm env health:

   ```bash
   set -a; source .env.local; set +a
   npm run env:audit
   ```

2. Confirm integrity validator still passes:

   ```bash
   npm run check-crm-integrity
   ```

3. Read the customer's current audit. Note specifically how many
   contacts are WEAK and what their top gaps are:

   ```bash
   npm run crm:audit -- --customer=<slug>
   ```

4. Generate the rehab list. This is the table you'll work from
   during the call:

   ```bash
   npm run list:weak -- --customer=<slug> --limit=40 > /tmp/rehab-list.txt
   ```

   Then `cat /tmp/rehab-list.txt` to read it once before dialing.

5. Open your terminal in a dedicated window. Keep `repair-contacts`
   command syntax in muscle memory; the operator can hear the
   keystrokes but doesn't need to see them.

6. Optional: queue up a batch file template at
   `/tmp/<customer>-repairs.json` so you can capture entries instead
   of running 30 separate commands. Shape:

   ```json
   {
     "customer": "<slug>",
     "operator": "founder",
     "repairs": [
       { "contactId": "...", "surname": "Smith", "note": "confirmed via call" }
     ]
   }
   ```

---

## Opening the call (founder + operator, 5 minutes)

Open warmly. Don't talk about software. Frame the session this way:

> "I want to spend 30 to 60 minutes with you walking through the
> contacts in your CRM that I can tell are missing pieces — usually
> just a last name, sometimes an address. You know who these people
> are; the CRM doesn't. Once we get those filled in, your Monday
> brief gets dramatically sharper. We won't change anything except
> what you confirm out loud."

Set the expectation that the workspace will visibly improve at the
end of the call — they'll see the HIGH/MED tier counts climb in real
time.

---

## Working through the list (founder + operator, 20–60 minutes)

Pace: **roughly one contact every 30–60 seconds**. Some go in 10
seconds ("Oh, Greg Smith — yeah, that's right"). A few go longer if
the operator wants to add context. Don't let any one contact eat more
than two minutes.

For each row in the list:

**1.** Read the name + one piece of context to the operator. The
context is whatever's already on file: last touch date, tag, partial
address. Example:

> "Greg — you have a tag 'Past Buyer' on him from 2023, last touched
> December that year. Do you remember his last name?"

**2.** Wait for the answer. Three outcomes:

  - **They know it.** Capture it. Move on.
  - **They're not sure.** Skip. Don't push. The next contact is
    almost certainly easier.
  - **It's not a real contact.** ("Oh, that was a junk import.")
    Skip and note the contactId so you can mark it
    `not_worth_pursuing` via the outcome API later. Move on.

**3.** As you capture, type:

   ```bash
   npm run repair:contacts -- --customer=<slug> \
     --contact=<id> --surname="Smith" --write
   ```

   Or, for non-name fields:

   ```bash
   npm run repair:contacts -- --customer=<slug> \
     --contact=<id> --field=address \
     --value="4321 W 63rd St, Kansas City, MO 64113" --write
   ```

   The script logs the planned action; quickly eyeball it; the write
   confirms. Move on.

**4.** Every 10 repairs, run a fast audit:

   ```bash
   npm run crm:audit -- --customer=<slug> | grep -A 3 "Integrity tiers"
   ```

   Read the new HIGH/MED count aloud to the operator. *"OK, you just
   moved 11 contacts from WEAK to MED. Keep going."*

   This is the moment that earns the call. Don't skip it.

---

## What to ask for, in priority order

The rehab list is already sorted so the highest-leverage repairs are
at the top. But during the call, prefer asking for:

1. **Surname** — single-token contacts where the operator obviously
   knows the last name. This is the biggest tier-mover (it's the gate
   for Hunter + Property eligibility).
2. **Address ZIP + state** — when the contact has a partial address
   and the operator knows the city. *"This is Greg in Brookside — was
   that 64113 ZIP?"*
3. **Business email** — when the contact is on gmail but operator
   knows their work email. *"Does Greg have a work email at his
   brokerage?"*
4. **Real company name** — when the company is blank or carries the
   legacy "Greg · Greg" corruption (Sprint 2 already cleared the
   render-time appearance, but a real company name unlocks future
   property/lookup logic).

Skip:
- Phone numbers unless the operator has them obviously handy. Most
  residential agents don't carry phones for their contacts; that's
  a different rehab call.
- Notes / tags. Adding notes during the call slows the pace; capture
  them in your own customer-notes file for later.
- Dates. Don't try to reconstruct historical contact dates from
  memory.

---

## What NOT to do

- Don't show the operator a spreadsheet of all 130 contacts. They'll
  freeze and want to think about each one. The list is for the
  founder; the operator's view is one-question-at-a-time.
- Don't fabricate or guess. If neither of you is sure, skip the row.
  A wrong repair is worse than no repair.
- Don't load the customer with technical detail. They don't need to
  know what `--field=surname` does. They need to feel the workspace
  improving.
- Don't apologize for the bad data. It's not their fault. The CRM is
  the CRM.
- Don't talk about pricing during this call. Pricing is a separate
  Tuesday conversation that lands AFTER the operator sees the
  improved Monday brief.
- Don't run a Hunter pass during the call. Hunter is async
  enrichment, not a real-time data source.
- Don't repair more than ~60 contacts in one session. Past that, the
  operator gets fatigued and accuracy drops.

---

## Wrapping the call (founder + operator, 5 minutes)

End on a numeric high.

> "Before we started: 125 contacts were WEAK tier. After our 35
> minutes: 78 are WEAK, 42 are MED, 10 are HIGH. Your Monday brief
> just got dramatically sharper. I'll generate the new brief tonight;
> you'll have it in your inbox Monday at 7."

Make the next concrete commitment:
- Monday brief will land at 7 AM
- You'll send a short Tuesday email noting what they captured / didn't
- If they have time mid-week to capture outcomes, the brief Week 2
  will visibly reflect those — that's the moment they'll feel the
  product compounding

Close warmly. End the call.

---

## Post-session (founder alone, 30 minutes)

1. **Run the full audit and compare to your pre-session screenshot or
   notes.**

   ```bash
   npm run crm:audit -- --customer=<slug>
   ```

   Note the deltas: HIGH count, MED count, WEAK count, trust-killer
   line. Add a one-paragraph entry to
   `docs/customer-notes/<slug>.md`:

   > "2026-05-27 — rehab session, 40 minutes. Started 0/5/125, ended
   > 10/42/78. Operator was engaged; we caught 38 surnames + 4
   > address completions. Hunter eligibility went from 1 → 18.
   > Brief regeneration tonight."

2. **Regenerate the weekly snapshot.** The Sunday-night step in the
   Founder Monday Runbook. Use the post-rehab data:

   ```bash
   npm run weekly-state:generate -- --customer=<slug>
   ```

3. **Eyeball the post-rehab brief.** Specifically:
   - Are the same priorities ranked higher now? (likely yes, since
     repairs improve evidence density)
   - Does rank-1's opener cite a real piece of evidence? (yes, much
     more often than pre-rehab)
   - Does any priority still cite a placeholder like
     `fallback:no_context`? (should be rare after rehab)

4. **Force-add the snapshot + push + deploy** per runbook step 8.

5. **Plan the operator's pricing conversation.** Tuesday morning,
   referencing the post-rehab brief that lands Monday.

---

## What this session unlocks

Before rehab:
- workspace cannot demonstrate operator-grade priority density
- enrichment layers are blocked (0–1 eligible contacts)
- founder cannot honestly present a paid pricing one-pager

After rehab:
- workspace has 20–40% MED/HIGH tier coverage
- enrichment layers become viable (~10–30 eligible contacts)
- Monday brief carries real evidence on the top priorities
- Tuesday pricing conversation is grounded in a brief the operator
  has personally seen and the founder has personally improved

The session is the unlock. It is the highest-leverage hour of founder
time per customer in the first 60 days.

---

## Operational ceiling

Sustainable founder rate:
- **2–3 rehab sessions per week** (each ~90 min total founder time +
  90 min operator time, scheduled across a week)
- **Plus the existing Monday delivery routine** (~2 hours/week per
  paying customer)
- **Plus founder-led pricing conversations** (~1 hour per closing
  attempt)

Capacity: up to **5 paid customers + 2 in-rehab pipeline customers**
without operational collapse. Past that, the rehab tooling needs
either operator-self-serve interface OR a part-time CRM-rehab
assistant trained on the runbook. Neither is needed yet.
