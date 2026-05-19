# UX Principles

How Meridian looks and behaves. Derived from `meridian-philosophy.md`.

---

## Visual register

Meridian should feel:

- **Calm** — restrained palette, generous whitespace, single primary action per surface
- **Premium** — disciplined typography, no gradients/neon/holographic effects
- **Operator-grade** — the operator can use it without instruction
- **Founder-delivered** — a person made this, not a product team
- **Apple/Linear/Stripe Atlas-adjacent** — the answer to *"can I remove this element?"* is yes more often than no

Meridian should never feel like:

- A sci-fi command center
- A SaaS dashboard demo
- A startup-theater landing page
- A CRM workflow tool
- An AI product launch

---

## One-screen rule

When a surface presents work to be done, it should answer one question with one obvious primary action:

> *"What should I do next?"*

If the answer requires reading two paragraphs or scanning three panels, the surface fails the rule.

---

## Information density

- **Maximum one number per row** in any list of cards
- **Maximum one reason per row**; expansion goes in the detail view
- **Verbs, not metrics**, on buttons — "Call," "Email," "Snooze," never "Engage" / "Activate" / "Touch"
- **No urgency theatrics** — no red flashes, no countdown timers
- **No confidence chips with "unknown" values** — suppress instead

---

## What disappears from the UI

These categories of element are banned by default. A specific exception requires a documented reason in PR description.

- **Dashboards** — metric grids, KPI walls, summary stat blocks beyond one or two
- **Score-and-confidence pairs on cards** — score alone, anchored, is enough
- **Chat assistant panels** — banned outright in customer-facing surfaces
- **"AI Score Explained" tooltips** — if the score needs explaining, the line above it should explain it in prose
- **Sticky conversion bars** — pushy without being clear
- **Auto-playing animations** — orbs, ambient motion, pulsing dots
- **Sci-fi naming** — "Command Center", "Operator Desk", "Intelligence Panel"
- **Tabs labeled with engineering concepts** — "Relationships", "Pipeline", "Intelligence"
- **"Live" indicators** — green dots, pulsing badges, real-time counters

---

## CTA discipline

- **One primary CTA per surface.** Maximum.
- **One secondary CTA** if the primary alone doesn't cover the natural fallback case.
- **No tertiary CTAs** in primary flows.
- **CTAs route to where they say they route.** A button labeled "See a sample brief" goes to a sample brief, not a scroll anchor.

---

## Trust language at the interface

The brief, the homepage, and any operator-facing surface must reinforce the same trust posture established in `meridian-philosophy.md`:

- *"Founder-reviewed"* — say it where it's true
- *"Manual outreach"* — say it everywhere a prospect might assume otherwise
- *"We never invent context"* — earned by the engine; visible to the reader
- *"Built from public information"* — required on every sample brief

---

## The hero-card test

Every primary card (brief card, lead card, sample card) must satisfy:

1. **Who** — the company and contact, named and located
2. **Why now** — one anchored sentence
3. **What to say** — one suggested opener
4. **How to reach them** — one verified contact path

That's it. No additional content unless this principle is amended.

---

## Microcopy rules

| Don't write | Write instead |
|---|---|
| "AI-powered" | "Founder-reviewed" |
| "Predictive scoring" | "Recovery ranking" |
| "Intelligent recommendations" | "Suggested openers" |
| "Powered by AI" | (omit entirely) |
| "Cinematic" | (omit entirely; never use) |
| "Workspace" (as a noun referring to Meridian) | "Brief," "memo," "service" |
| "Platform" (in marketing) | (omit; we are a service) |
| "Operating system" | (banned; legacy framing) |

---

## Layout discipline

- A page never has more than **5 vertical sections** unless this doc is amended.
- A section never has more than **one h2** and **one CTA pair**.
- A card never has more than **4 fields** in its primary face.
- The homepage hero shows **one** product, not a ladder of them.

---

## The single UX governing question

For any UI change:

> *"Does this make the screen calmer, the action clearer, and the trust more visible?"*

If the answer is no, the change is rejected or rescoped.
