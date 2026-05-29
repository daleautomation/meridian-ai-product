# Commercial Readiness Verdict

> **⚠ SUPERSEDED (2026-05-27).** This document's recommendation that
> LaborTech is the v1 customer was based on data-quality theory and
> overlooked operational signal (John resisted sharing the CRM, which
> is a Product 2 procurement-cycle signal, not a logistics hiccup).
> The corrected strategic frame is in
> [`docs/product-bifurcation-correction.md`](./product-bifurcation-correction.md).
> Meridian is two products; v1 is the **CRM Intelligence Layer** with
> Nicole-pattern customers, not LaborTech-pattern teams. Use the
> bifurcation doc as the current source of truth; this doc is retained
> for historical context only.

---

> Brutally honest assessment of whether Meridian can carry the first
> retained paying operator next week. Grounded in the actual code +
> data state as of commit `8c735ad` and the audits run in Sprints 1–3.
> No optimism inflation.

---

## Is Meridian ready for the first retained customer?

**Conditionally yes. Three conditions must hold.**

1. **The customer is LaborTech, not Nicole.** Nicole's workspace is
   96.2% WEAK tier per `crm:audit` after Sprint 2 cleanup. The CRM
   data is structurally too weak to carry a paid pricing conversation
   in its current form. A founder-led CRM rehab session could change
   this in one afternoon; absent that, Nicole is a learning workspace,
   not a v1 paying customer.
2. **LaborTech routes through `/personal`.** Currently
   `config/workspaces.ts:50` declares `labortech.kind = "labortech"`,
   which routes to `/operator` — the surface with **zero weekly
   briefing infrastructure**. Flip to `kind: "personal"` (one-line
   change documented in `docs/labortech-readiness.md`) before the
   CSV arrives.
3. **The LaborTech CSV imports with HIGH-tier majority.** Validated
   via `npm run crm:audit -- --customer=labortech` after import.
   Thresholds: ≥ 50% HIGH tier, all trust-killer checks OK, ≥ 30%
   Hunter-eligible.

If those three hold, the platform delivers a paid Monday brief to
LaborTech next week with no engineering work beyond the one-line
config change.

If any one fails, do NOT charge yet.

---

## What specifically would cause churn today?

In rough order of likelihood:

1. **"Greg · Greg" cards on /personal.** Already fixed at normalize +
   render, plus the 130 corrupted Nicole rows scrubbed in Neon. Risk
   eliminated. Monitor via `crm:audit` Trust-killer line — must say `OK`.
2. **Generic opener prose.** Sprint 1 unified the voice; banned-phrase
   scan locked in by `check-brief-determinism`. Risk eliminated unless
   a future commit regresses the validator.
3. **Brief lands but workspace doesn't render the panel.** Happens
   when the snapshot file isn't on production filesystem. Runbook step
   8 documents the force-add + deploy. Operator-experienced — possible
   if the founder forgets the snapshot push step. Mitigated by the
   runbook checklist.
4. **An outcome captured Monday doesn't change Tuesday's view.** Sprint 2
   wired the outcome→ranking loop and the validator covers it. Risk:
   the operator misreads "still showing" as "not changed" when the
   contact is in the captured sub-section, not removed. Operator-side
   confusion mitigated by the panel's "Captured this week" header.
5. **Hunter / Property enrichment claims something wrong.** Both
   layers store but do NOT surface low-confidence data; constitution
   §4 enforced. Risk only emerges if a customer-side row produces
   `confidence ≥ 75` and the enrichment is actually wrong (provider
   error). For first paid Monday, recommend NOT running Hunter live
   on the customer's first brief — let the deterministic CRM-only
   openers carry Week 1. Layer Hunter in Week 2 if eligibility ≥ 30%.
6. **The "company = first name" bug recurs from a new import.** The
   normalize fix prevents it; the render guard catches stragglers;
   `crm:audit` Trust-killer check fails loudly if it sneaks back. Risk
   structurally low.
7. **The customer doesn't open the workspace mid-week.** Operational,
   not engineering. The product can't survive an operator who doesn't
   show up. Onboarding sets the expectation; the workspace's
   midweek-mode and Friday-mode designs reward returning. If they
   don't return, the moat doesn't form and the price isn't supportable.

---

## What specifically would create trust today?

1. **Calm, sourced, evidence-cited Monday brief in their inbox at 7 AM.** Already works for HIGH-tier workspace data. The activation email artifact reads operator-grade today.
2. **The brief landing on a Monday after they captured outcomes the prior week, with the workspace visibly reflecting those outcomes.** Sprint 2's outcome-aware ranking + continuity-insight is the moat made physical. This is what "Meridian remembered" looks like.
3. **Refusing to ship enrichment claims the data can't support.** The deterministic gates (Hunter confidence ≥ 75, Property name-match required) protect against the one fabricated detail that ends the relationship. Operator-invisible engineering that earns its keep silently.
4. **A founder who reaches out the second they notice something didn't go right.** Sprint 3 deliverables exist for this: `docs/founder-monday-runbook.md` makes the Monday execution low-stress so the founder has bandwidth to actually monitor.
5. **A pricing artifact (`docs/pricing-one-pager.md`) that doesn't use the word "AI" or "platform" or "leverage."** Customers paying for SMB tooling are exhausted by those words. Plain language reads as competence.

---

## What MUST still be fixed before charging?

| # | Item | Severity | Time to fix |
|---|---|---|---|
| 1 | Flip LaborTech `kind: "labortech"` → `"personal"` in `config/workspaces.ts` | BLOCKING for first commercial customer | 1 minute |
| 2 | LaborTech CSV imported + audited HIGH-tier majority | BLOCKING | depends on John |
| 3 | Add `companyName` to LaborTech's `branding` config (currently missing) | Cosmetic but visible on card | 1 minute |
| 4 | First snapshot generated, eyeballed, force-added, deployed | BLOCKING per delivery | ~15 minutes Sunday night |
| 5 | First activation email hand-composed and sent Monday 7 AM | BLOCKING per delivery | ~5 minutes Monday |
| 6 | Invoice template prepared in advance (Stripe payment link OR PDF + ACH instructions) | BLOCKING for billing | ~30 minutes one-time |

Nothing on this list is engineering work beyond items #1 and #3.
Everything else is operational.

**Conclusion**: the engineering substrate is ready. The remaining
blockers are operational and resolvable in one Sunday evening for the
first paid Monday.

---

## Is Nicole actually viable?

**Honestly, no — not at $499/mo, not in May 2026.**

Per Sprint 2 audit:
- 96.2% of her contacts are WEAK tier
- 92% missing surnames
- 68% unparseable addresses
- 1 of 130 contacts Hunter-eligible
- 1 of 130 contacts Property-eligible
- 67.7% have notes but 51.5% of those are Wise Agent automation residue
- 18 contacts have no actionable channel

The Monday brief CAN be generated for her, and the panel CAN render
correctly post-Sprint 2 cleanup — but the priorities it surfaces are
mostly backed by 2-year-old tags and last-touch dates. There's no
specific evidence in 100+ of her contacts for the deterministic opener
chain to cite. She would receive a brief that says "Worth a calm
check on [contact]" for every priority with no specific reason
attached.

A founder-led CRM rehab session with Nicole could move 50–80 contacts
from WEAK to MED/HIGH. After that, her workspace is viable. Without
that, it isn't.

**Verdict**: Nicole is a great relationship for the founder, a useful
test bed for the substrate, and a credible reference customer at the
$0/mo tier. She is not a $499/mo first paid customer.

---

## Is LaborTech now clearly the stronger wedge?

**Yes, conditional on data quality once imported.**

LaborTech's vertical (B2B roofing, contractor leads) maps to:
- Business-domain emails → Hunter eligible at high rates
- Commercial addresses with proper ZIP → Property eligible at high rates
- Permit / storm-event signals (already configured in `config/signals/labortech.ts`) → real intelligence not derivable from CRM alone
- Deal sizes ($8K–$80K per roofing job) → easy justification for $1,499/mo

The synthetic LaborTech-readiness validator in
`scripts/check-crm-integrity.ts:runLaborTechReadiness` proves the
deterministic substrate handles B2B data correctly. The only
unknown is the actual data quality of John's CSV. If it imports with
HIGH-tier majority, LaborTech is the v1 paying customer and the v2
flywheel (more roofing contractors → permit/storm enrichment becomes
a category) starts there.

**Conditional verdict**: yes, LaborTech is the wedge if and only if
John's CSV passes the audit thresholds named in `docs/labortech-readiness.md`.

---

## The single highest-leverage move this week

**Get the LaborTech CSV.**

- It's not engineering work.
- It costs one phone call.
- The platform's substrate either is ready for the customer (HIGH-tier
  data) or has a clear next step (CRM rehab call with John before
  first brief).
- Without it, Sprint 3's work has nowhere to land. With it, every
  prior sprint pays off.

The second-highest-leverage move: flip LaborTech routing to
`kind: "personal"` so the existing weekly briefing infrastructure
actually carries his customer experience. One-line change. Deploy it
this afternoon.

The third-highest-leverage move: prepare the invoice template (Stripe
payment link is fine; an emailed PDF with ACH instructions is fine;
the absence of any artifact is the failure mode).

Nothing else.

---

## Monday morning execution recommendation

**This Monday, send Nicole's brief one more time as a courtesy.**
- The substrate works. The brief generates.
- It's the right honest signal to her that the founder kept the
  cadence even while the product is repositioning.
- Use it as the launchpad for the "we should talk about your data"
  conversation later in the week.

**Next Monday (Week N+1) — if LaborTech CSV is in:**
- Run the onboarding checklist for LaborTech.
- Generate + audit LaborTech's first weekly state.
- If audit passes thresholds: deliver the first paid Monday brief to
  LaborTech that Monday.
- If audit fails thresholds: hold the brief, schedule a CRM rehab
  call with John, target Week N+2 for the first paid Monday.

**Two weeks from now (Week N+2):**
- First invoice goes to LaborTech if Week N+1 brief landed cleanly.
- $1,499/mo + $1,000 onboarding fee, 60-day commitment, ACH.
- That is the first retained customer.

No engineering work between now and then. Everything else is operational.

---

## What this verdict will NOT do

- Speculate about Customer #3.
- Discuss self-serve, billing automation, or scaling.
- Hedge with "it depends on market timing."
- Suggest pivots that aren't grounded in the actual audit data above.

The platform is ready. Get the CSV.
