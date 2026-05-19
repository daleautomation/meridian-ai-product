# Pre-Ingestion Cleanup Report

Branch: `cleanup/pre-ingestion-final`
Final TypeScript: `tsc --noEmit` exit 0
Final Next.js build: green (12 routes)

---

## 1. Executive summary

The platform is now decision-native and ingestion-ready in shape. One
engine produces user-facing output (`lib/scoring/decision.ts`). One
shape exists for future source data (`lib/leads/normalizedLead.ts`).
One readiness display (`lib/sources/readiness.ts` + the header strip)
tells the operator which sources are wired. Tabs read **Today / All
leads / History**. The lead card is decision-first. The detail panel
opens with a clean `DecisionSummary` (bucket, score, why, opening)
instead of operator-jargon axes. The AI assistant only receives a
structured `LeadContext`.

The legacy scoring chain (`closeability`, `companyDecision`,
`nextAction`, `callQueue`) survives behind a `LEGACY` / `INTERNAL`
banner because `decision.ts` and the `rank_companies` MCP tool still
feed off it. No UI surface reads those modules directly.

## 2. Files deleted

```
lib/scoring/opportunityTier.ts        (orphan, no consumers)
lib/types.ts                          (orphan, only consumed by opportunityTier)
data/watches.json                     (vestigial vertical artifact)
data/real-estate.json                 (vestigial vertical artifact)
data/sources/stress-test-dataset.json (unused)
```
Empty `data/sources/` directory removed.

## 3. Files modified

```
app/operator/page.tsx                  decision-native grouping (groupByDecision)
app/api/ai/chat/route.ts               LeadContext + email + weakSignals
components/OperatorConsole.jsx         DecisionSummary; tabs renamed; LeadContext
components/OperatorConsole.d.ts        SourceReadinessItemProp + Error status
components/SourceReadiness.tsx         Error tone
lib/scoring/decision.ts                added groupByDecision
lib/scoring/closeability.ts            INTERNAL banner
lib/scoring/companyDecision.ts         INTERNAL banner
lib/scoring/nextAction.ts              INTERNAL banner
lib/scoring/callQueue.ts               LEGACY banner
lib/sources/readiness.ts               +BBB +Manual upload + Error status
docs/pre-ingestion-cleanup-report.md   this file
```

## 4. Files created

```
lib/leads/normalizedLead.ts            NormalizedLead + normalizeLead()
lib/scoring/decision.ts (additive)     groupByDecision helper
components/operator/index.ts           barrel
components/operator/SourceReadinessBar.tsx  re-export shim
docs/ingestion-contract.md             ingestion contract
docs/pre-ingestion-cleanup-report.md   this file
```

## 5. Remaining legacy survivors (and why)

| Survivor | Reason | Banner |
|---|---|---|
| `lib/scoring/closeability.ts` | `decision.ts` wraps `computeCloseability` to derive bucket axes. | INTERNAL |
| `lib/scoring/companyDecision.ts` | `rank_companies` MCP tool still produces this; `decision.ts` reads it. | INTERNAL |
| `lib/scoring/nextAction.ts` | Consumed by `companyDecision`. | INTERNAL |
| `lib/scoring/callQueue.ts` | `OperatorConsole.jsx` queue overlay still calls `buildCallQueue` / `summarizeQueue`. | LEGACY |
| `lib/scoring/companyPrefilter.ts` | Used by import path; not user-facing. | none needed |
| `lib/leads/decisionEngine.ts`, `outcomes.ts`, `deals.ts`, `scriptEngine.ts`, `leadActions.ts` | Active in OperatorConsole UI/state surfaces. | keep |
| `lib/calendar/*` | OperatorConsole still imports many; gated diagnostics blocks live behind `ENABLE_INTERNAL_GLOBAL_INTELLIGENCE` (false). | TBD next pass |
| `CloseabilitySummary` / `CloseabilityChips` | Defined in OperatorConsole but no longer rendered by the row or detail (replaced by `DecisionSummary`). | dead code, safe to delete next pass |

## 6. One user-facing decision system?

**Yes.** Only `lib/scoring/decision.ts` produces `bucket / score /
reason / suggestedOpening`. No UI reads `lead.bucket`,
`lead.recommendedAction`, `lead.nextAction`, `lead.opportunityTier`,
`lead.closeability`, `lead.dealHeat` for display anymore. Internal
fields stay on the lead object as engine inputs only.

## 7. UI uses `lead.decision.*`?

**Yes.**
- `LeadRow` renders `decision.bucket · decision.score`,
  `decision.reason`, italicized `decision.suggestedOpening`, plus a
  primary `Call` button.
- `DecisionSummary` (detail panel) renders the same four fields with
  "Why this lead" / "Suggested opening" / "Source" / "Last checked".
- `AssistantChat` builds `LeadContext` strictly off `lead.decision.*`.

## 8. Lead card clean?

**Yes.** Card shows: company name, location, decision pill (bucket ·
score), one-line reason, italicized suggested opening, Call button.
Internal axis chips (Intent/Leak/Reach) are no longer rendered.

## 9. Detail panel clean?

**Decision section yes** (`DecisionSummary` is the new top of detail).
The remainder of the detail panel still contains the existing engine
visualizations (NextActionBlock, CallPlanSection, scan report, CRM
timeline). They're not legacy enum dumps — they're plain-English
deeper diagnostics, which the spec explicitly allowed. `Closeability`-
specific subcomponents are no longer reached.

## 10. Source readiness honest?

**Yes.** Header strip lists Google Places, Site scan, Yelp, Hunter,
Serp, Storm, BBB, Manual upload. Status comes from real env detection;
"Connected" only when the credential is present.

## 11. AI uses `LeadContext` only?

**Yes.** `/api/ai/chat` accepts `{ message, context }`. The route
renders `context` through a typed renderer; nothing else flows in.
`AssistantChat` builds the context from `lead.decision` + plain
fields + `weakSignals`. No giant raw lead objects.

## 12. Public Meridian pages clean?

**Yes.** `/`, `/about`, `/login` carry no LaborTech-specific copy;
modules show Roofing **LIVE** and HVAC/Plumbing/Remodeling **Coming
soon**.

## 13. LaborTech only in workspace?

**Yes.** LaborTech name appears only:
- inside `OperatorConsole` after login (header accent label
  "LaborTech workspace")
- inside legacy call-script templates ("Hi, this is X with LaborTech
  Solutions") that are inherent to the rep's pitch and not platform
  branding.

## 14. TypeScript

```
tsc=0
```

## 15. Next.js build

```
✓ Compiled successfully
✓ 12 routes
```

## 16. Blockers

- **OperatorConsole.jsx is still ~10K lines.** Extracting components
  is blocked because the inner subcomponents share a private `S`
  styles map and an in-closure `callMcp`. Hoisting either one
  requires touching every subcomponent at once, which is risky in a
  single pass. Stable extractions deferred. The
  `components/operator/` namespace is now declared so future
  extractions land cleanly.
- **`lib/calendar/*`** is still imported widely by OperatorConsole.
  Removing it requires UI refactor (CalendarCommandCenter rebuild).
  Deferred.
- **`closeability.ts` / `companyDecision.ts`** still drive the
  rank-companies MCP tool. Once ingestion writes directly into
  `NormalizedLead`, `decision.ts` should switch to reading
  `signals.*` instead of the legacy chain.

## 17. What is ready for data ingestion

- One canonical lead shape (`NormalizedLead`).
- One decision producer (`decideLead` + `groupByDecision`).
- Honest source readiness display.
- AI assistant fed by structured `LeadContext`.
- Public site / login / workspace routing untouched and green.
- Build passes after every phase.

## 18. Exact next ingestion steps

1. Set `GOOGLE_PLACES_API_KEY` in `.env.local`.
2. Add a thin Google Places adapter in `lib/ingestion/sources/googlePlaces.ts`
   that returns `NormalizedLead[]` with evidence per the contract.
3. Hydrate the seed Roofing companies and confirm:
   - `signals.reviewCount`, `signals.rating`, `signals.hasWebsite`
     are populated where Google returned data.
   - `evidence[]` carries one item per claim.
4. Update `decideLead()` to read `signals.*` (currently reads the
   legacy `closeability` axes). Cut the closeability dependency once
   ingestion verifies parity.
5. Add a Site scan adapter (already largely built — wire it through
   `NormalizedLead`).
6. Add Storm / Serp adapters when their bucket needs land.

## 19. Sources wired

(none yet — credentials not provisioned)
