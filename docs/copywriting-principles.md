# Copywriting Principles

How Meridian writes. Derived from `meridian-philosophy.md`.

Applies to: brief outputs, public site, About page, intake forms, email signatures, sample-brief framing, footer disclaimers, and any operator-facing string the codebase emits.

---

## Voice

- **Founder, not company.** First-person singular when natural. Plural only when describing the engine behavior.
- **Operator-aware.** The reader is sharper than the average B2B SaaS prospect; write as if they'll catch a vague claim.
- **Restrained.** A sentence is better than two. Adjectives are suspect.
- **Specific over impressive.** "147 days quiet" beats "long overdue." "Phone on homepage" beats "verified contact."

---

## Banned phrases (every surface)

Hard ban. Filter mechanism exists in `lib/recovery/opener.ts` for the generator; the same vocabulary applies everywhere.

- *"Hope you're doing well"*
- *"Checking in"*
- *"Circle back"* / *"Circling back"*
- *"Touching base"*
- *"Just wanted to"*
- *"As discussed previously"* / *"Per our last conversation"*
- *"AI-powered"*
- *"Powered by AI"*
- *"Predictive intelligence"*
- *"Predictive scoring"*
- *"Autonomous"*
- *"Black-box"*
- *"Intelligent recommendations"*
- *"Cinematic"*
- *"Operating system"*
- *"Operator system" / "Operator desk" / "Command center"* (as product names)

---

## Banned claims

Hard ban regardless of phrasing.

- *"This relationship will close"*
- *"This account is guaranteed revenue"*
- *"AI predicts this customer"*
- *"This lead is certain"*
- *"We understand personal trust"*
- *"We learn from your outcomes"* (no learning loop exists; banned until that changes)
- *"Saves you N hours a week"* (no data to support)
- *"Increases pipeline by N%"* (no data to support)
- *"Enterprise-grade"* (until SOC 2 or equivalent ships)
- *"Real-time CRM sync"* (no sync exists)
- *"Multi-user team workspace"* (no team product exists)
- *"Integrations with [X]"* (until the integration actually ships)

---

## Approved phrasings

These are the operating-grade alternatives. Use them.

| Don't write | Write |
|---|---|
| "This lead will close" | "This relationship appears commercially important." |
| "AI predicts this account" | "This account aligns with patterns associated with revenue opportunity." |
| "High-confidence buying signal" | "Observable engagement signals suggest the original need may be active again." |
| "Powered by AI" | (omit; lead with what the brief does) |
| "Predictive scoring" | "Recovery ranking" |
| "Intelligent recommendations" | "Suggested openers" |
| "Best lead in your pipeline" | "Strongest recovery candidate this week" |
| "We'll sync with your CRM" | "You share a CSV. We send a brief." |
| "Automated outreach" | "Manual outreach support" |
| "We'll automatically follow up" | "You'll have the opener, the contact path, and the reason. The send is yours." |

---

## Voice rules for the Recovery Brief itself

The brief is the loudest piece of copy Meridian emits. The rules:

1. **Quote real notes, never paraphrase them.** If the customer wrote a note, the brief uses the customer's words.
2. **Use the customer's stage / status labels lowercased.** "Schedule the call because the proposal conversation went quiet" — not "Schedule the call because the PROPOSAL conversation went quiet."
3. **Trim quoted notes to one sentence or ~90 characters** in priority reads; the full note lives in why-now.
4. **Default to past tense** when referencing prior interactions ("they paused", "we'd outlined").
5. **End openers with a question or a clear narrow ask**, never a soft closer.
6. **Never put words in the customer's mouth that aren't in the note.** When the note is vague, switch to a safer construction ("I had a note on file that…") instead of fabricating customer speech.

---

## Sample brief framing

Every brief delivered to a prospect or anyone other than the brief's named customer must carry:

1. A **SAMPLE banner** at the top: *"Sample · Built from public information · No CRM data accessed"*
2. A **kicker prefix**: `Sample Recovery Brief · Week of …`
3. A **summary sentence** that names the cards as fictional: *"Five fictional recovery cards illustrating the format."*
4. A **footer disclaimer**: *"Built from public industry positioning only. The accounts shown are fictional examples chosen to match the firm's specialty — Meridian has no access to your CRM or your client list. Your real brief would be generated from a CSV export of your own contacts."*

All four signals are required. Removing any one is a credibility break.

---

## Public-site language

The home page, about page, and footer should reinforce one product, one wedge, one voice.

| Surface | Says |
|---|---|
| Hero h1 | A specific product claim, named ("Weekly Recovery Briefs for dormant relationships.") |
| Hero subline | One sentence that names the audience and the manual constraint |
| Hero proof strip | 3–4 short chips of trust signals; never numeric |
| Section h2s | One per section; no questions |
| CTAs | Two only: "See a sample brief" + "Request the first brief on your list" |
| Footer | Founder signature, one-line product description, four links max |

---

## Founder voice in customer communication

When emailing prospects or paying customers:

- Sign with first name only ("Dylan")
- Plain text emails; no HTML; no logo; no banner image
- One link per message
- Short subject lines (≤8 words)
- Personalize one specific detail; never mass-merge variables
- Reply within 4 business hours, always

---

## When in doubt

Pick the **plainer, more concrete** option. Adjectives are suspect; specifics are believable.

Read the result aloud. If it sounds like marketing copy, rewrite it. If it sounds like a sharp operator talking to a peer, keep it.

---

## The single copy governing question

For any line of customer-facing text:

> *"Would a sharp operator quote this on a real call without editing?"*

If the answer is no, rewrite.
