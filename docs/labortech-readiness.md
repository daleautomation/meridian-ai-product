# LaborTech Operational Readiness Audit

> **⚠ STRATEGIC FRAME CORRECTED (2026-05-27).** This document's
> recommendation to flip `labortech.kind` from `"labortech"` to
> `"personal"` has been **reversed**. LaborTech is now correctly
> understood as Product 2 (Operational Lead Execution System), a
> different category from the CRM Intelligence Layer that Nicole
> validates. Keeping `kind: "labortech"` is the right call — it
> signals LaborTech belongs on the Product 2 surface, which is
> deferred. See
> [`docs/product-bifurcation-correction.md`](./product-bifurcation-correction.md).
> The audit findings below (residential biases in code, vertical-
> neutral paths, hardcoded copy locations) remain factually correct
> and useful for whenever Product 2 work begins — but the **action
> recommendations are superseded**.

---

> Audit of the platform's residential biases that may block or degrade
> LaborTech's first paid Monday delivery. Grounded in the actual code
> state as of commit `8c735ad`.

## Top finding — routing

**`config/workspaces.ts:50` declares `labortech.kind = "labortech"`.**

Per `lib/workspaceRouting.ts:19-27`:
- `kind: "personal"` → `/personal?workspace=<slug>` → **weekly briefing panel renders**
- `kind: "labortech"` or `kind: "relationship"` → `/operator?workspace=<slug>` → **weekly briefing panel does NOT render**

The entire infrastructure built across Sprints 1–2 (weekly briefing
panel, outcome-capture buttons, Monday/midweek/Friday modes,
continuity insight, deterministic openers, voice-unified activation
email) lives on `/personal`. The `/operator` surface lacks all of it.

**Operational fix**: change LaborTech's `kind` to `"personal"`.

This is a **one-line config change**. No new infrastructure, no
intelligence layer changes, no UI redesign. The /personal model is
vertical-neutral — it consumes `CrmContactRecord` rows from any
workspace, runs the same opener extractor chain (which falls through
gracefully for B2B notes via `last_close:date` / `stale_relationship`
/ `fallback:no_context`), and renders the same panel. The
`config/signals/labortech.ts` weights stay untouched (those drive
brief-side scoring, which is independent of /personal).

**The opposite move** (extending `/operator` with the weekly briefing
panel) is a UI redesign and explicitly forbidden by this sprint's
scope.

Recommended action: flip LaborTech to `kind: "personal"` immediately
before John's CSV arrives. Add the rationale to
`docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md` Amendment log if needed.

---

## Residential assumptions audited

### Code paths with residential flavor (acceptable — graceful degradation)

| Surface | Residential bias | LaborTech impact |
|---|---|---|
| `openerBuilder.ts` notes extractors (renovation, school district, growing family, refinance, etc.) | Will not fire on B2B notes | Falls through cleanly to tag / last_close / stale_relationship / fallback. No broken behavior. |
| Tag extractors (past_buyer, past_seller, sphere, first_time_buyer) | Real-estate-specific tag names | Will not fire for LaborTech tags. Falls through. Acceptable. |
| Personal-domain skip list (gmail, yahoo, etc. in `enrichmentEligibility.ts`) | Skips personal email enrichment | Correct for B2B too — Hunter doesn't enrich personal-domain anyway. |
| Property layer Phase 1 (`addressNormalizer`, `propertyMatchRules`) | Residential ownership concepts | LaborTech can use the same parcel-match logic for commercial property leads — Phase 2 (provider) is paused regardless. |

### Hardcoded copy worth changing if LaborTech is the wedge

| Location | Current copy | Concern |
|---|---|---|
| `lib/personal-workspace/config.ts:50` | "Brookside Real Estate relationship workspace" — used as fallback eyebrow | Only renders when `branding.accentLabel` is not set. LaborTech has `accentLabel: "LaborTech workspace"` in its workspace config — so this default is overridden. **No fix needed.** |
| `lib/personal-workspace/config.ts:86-88` | Default `displayName`, `accentLabel`, `companyName` strings hardcoded to Brookside | Same — overridden when workspace's `branding` object is set. Confirm LaborTech's `companyName` is set (currently missing in `config/workspaces.ts`). |
| OpenerBuilder tag opener phrasings (`tag:sphere` = "Sphere relationship") | Real-estate "center of influence" language | Won't fire for LaborTech contacts unless someone tags them "sphere" — which they wouldn't. Safe. |

### Code paths that are vertical-neutral (confirmed safe)

- `lib/personal-workspace/workspace.ts:buildPersonalWorkspaceModel` — vertical-agnostic; reads any `CrmContactRecord` shape.
- `lib/personal-workspace/weeklyState.ts` — vertical-agnostic.
- `lib/personal-workspace/openerBuilder.ts:buildSuggestedOpener` — extractor chain is type-driven, not vertical-driven. Falls through gracefully.
- `lib/crm-import/integrity.ts` — universal classifier.
- `lib/crm-import/enrichmentEligibility.ts` — universal.
- `lib/recovery/brief.ts:buildBriefOpener` — universal post-Sprint 1.
- `scripts/crm-audit.ts` — universal.
- `lib/recovery/outcomes/*` — universal.
- The 5 outcome buttons (Sent / No answer / Meeting booked / Follow up later / Wrong contact) — language works for B2B too.

### Code paths that are explicitly NOT yet ready for LaborTech

| Path | Reason |
|---|---|
| `app/operator/page.tsx` | No weekly briefing panel. Either flip routing or this is what the customer sees. |
| `config/signals/labortech.ts` `paid_presence` signal | Shipped per prior memory, **not yet wired into scoring**. If permits / paid presence / storm events matter commercially, this is the next-most-visible gap. |
| Permit + storm-event ingestion | Empty pipelines — config exists, sources don't. Defer until John's data confirms whether his prospects need these signals. |

---

## What John's CSV needs to carry to validate readiness

Before importing, confirm the CSV has:

1. **Separate first_name / last_name columns** (or a full-name column that parses cleanly to ≥ 2 tokens for each row).
2. **Email column where ≥ 70% of values are on business domains** (not gmail/yahoo/etc.).
3. **Address line(s) + ZIP** for ≥ 50% of rows.
4. **At least one of**: "tags" / "category" / "stage" column. Optional but improves opener density.
5. **Last contact / activity date** in any ISO-parseable format. Optional but unlocks the `last_close:date` extractor.

After import, `npm run crm:audit -- --customer=labortech` should
report:
- `HIGH tier ≥ 50%` of visible rows.
- Trust-killer checks: **all OK**.
- `Hunter eligibility: ≥ 30% eligible`.
- `Property eligibility: ≥ 30% eligible`.

If those thresholds hit, LaborTech is operationally ready for live
Monday delivery. If they don't, run the CRM rehab session with John
before the first brief.

---

## What to NOT do before LaborTech imports

- Don't pre-write LaborTech-specific opener extractors. The existing
  chain handles B2B contacts via `last_close:date` and
  `fallback:no_context`. Add vertical-specific extractors only after
  observing real B2B opener output that demonstrably falls short.
- Don't pre-build permit / storm-event enrichment. Validate that
  business-domain Hunter enrichment alone produces enough density first.
- Don't change the deterministic opener voice. The same calm
  source-cited language works for B2B as for residential — the
  evidence cited just shifts from "tag: Buyer" to "tag: Past Job" or
  "last contact in 2024".
- Don't add a "commercial" intelligence layer. The constitution §3
  requires a `[canon-amend]` PR before declaring a new vertical
  layer. LaborTech today reuses the existing layer at a different
  signal-weight config; that is correct.

---

## Recommended action sequence

1. **Flip LaborTech to `kind: "personal"` in `config/workspaces.ts`.** One line. Deploys with the next push.
2. **Add `companyName` to LaborTech's branding** in `config/workspaces.ts` (e.g. "LaborTech" — matches existing displayName).
3. **Run `npm run check-crm-integrity`** — confirm the B2B-fixture portion passes (it already does as of commit `8c735ad`).
4. **Wait for John's CSV.** Don't pre-build anything else.
5. **On CSV arrival**, run the full onboarding checklist from
  `docs/onboarding-checklist.md` against LaborTech.
6. **Run `npm run crm:audit -- --customer=labortech`** and compare
  against the thresholds above. Brutally honest assessment of whether
  to ship a first brief or schedule rehab.

If steps 1–6 pass cleanly, LaborTech is the better v1 customer than
Nicole and should receive the first paid Monday delivery.
