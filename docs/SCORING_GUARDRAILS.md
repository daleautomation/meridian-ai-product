# Scoring Guardrails

The scoring engine lives in one place: `lib/scoring/companyDecision.ts`.
**Every bucket, score, and opportunity number in the UI comes from
`decideCompany()`.** If you're about to add a new score somewhere else,
stop and ask whether it should be a signal inside `decideCompany()`
instead.

## What already exists

`decideCompany(snap: CompanySnapshot) → CompanyDecision` computes:

- `score` (0–100, overall)
- `opportunityScore`, `closabilityScore`, `contactabilityScore`,
  `proofScore` (sub-scores; all 0–100)
- `urgency`, `dealHeat`, `dealHeatLevel`
- `opportunityLevel` (HIGH / MEDIUM / LOW — legacy)
- `recommendedAction` (CALL NOW / TODAY / MONITOR — legacy)
- **`bucket`** (CALL NOW / TODAY / MONITOR / PASS — operator-facing; this
  is what the UI sections render)
- `verifiedIssue`, `verifiedContact` (bucket gates)
- `reasons[]` (deterministic strategic bullets)
- `opportunityEstimate` (see below)
- `confidenceFloor`, `confidenceLabel`
- `websiteProof` (projected `inspect_website` signals)
- `contactPaths`, `contacts` (projected contact layer)
- `dealStrategy`, `closePlan`, `conversionNarrative`, `closeReadiness`

`rankCompanies(snaps) → CompanyDecision[]` sorts these with force-action
first, then score, then a composite blend of `opportunityScore *
0.30 + closabilityScore * 0.20 + urgency * 0.15 + dealHeat * 0.10 +
contactabilityScore * 0.15 + proofScore * 0.10`.

## Bucket rules (the operator-facing ones)

```
forceAction                                                → CALL NOW
level HIGH + verifiedIssue + verifiedContact + !stale      → CALL NOW
level HIGH + verifiedIssue                                 → TODAY
level MEDIUM + verifiedIssue                               → TODAY
level MEDIUM | (LOW + verifiedIssue + contactability ≥ 40) → MONITOR
no verifiedIssue + contactability < 25 + score < 35        → PASS
else                                                       → MONITOR
```

`verifiedIssue` requires `inspect_website` evidence — at least one
captured weakness. `verifiedContact` requires a provider-verified
contact path (GBP / Yelp / BBB) OR an operator override. Site-scraped
phones do NOT satisfy `verifiedContact`.

## Opportunity estimate — evidence-gated

`computeOpportunityEstimate()` returns:

- three risk subscores (`visibilityRisk`, `trustRisk`, `conversionRisk`)
- `businessPresenceStrength`
- `opportunityRiskLevel` (LOW / MODERATE / HIGH)
- **`opportunityEstimateBand: string | null`** — a numeric band
  (e.g. `"15–30 inbound leads / month at risk"`) is emitted **only**
  when `opportunityEstimateConfidence === "HIGH"` AND presence ≥ 60
  AND ≥ 2 risk subscores ≥ 40. Otherwise `null`.
- `opportunityEstimateConfidence` (LOW / MEDIUM / HIGH)
- `revenueImpactSummary[]`, `realWorldOutcome`, `salesAngle` — all
  deterministic from the issue codes on the snapshot.

**Do not add another "estimated lost leads" metric elsewhere.** Add
new signals into `computeOpportunityEstimate()`.

## Things you *should* change inside the engine

- Adjust risk-subscore weights in `computeOpportunityEstimate()` when
  new signals land.
- Tighten bucket gates when real outcomes prove them too loose.
- Add code → copy mappings in `REVENUE_IMPACT_MAP` when
  `inspect_website` gains new issue codes.
- Extend `buildSiteIssues()` in `inspect_website.ts` with new
  observable checks — it's the single source of `issues[]`.

## Things you MUST NOT do

- Do not create a second `decide*` / `score*` function in any other
  file.
- Do not let a UI component re-derive bucket/score from raw signals.
  Read `decision.bucket`, `decision.score`, etc. directly.
- Do not compute "lost leads" from ad-hoc heuristics in the UI. If
  the engine said there's no band, the UI must respect that.
- Do not override operator-curated contact values (`contactPhone`,
  `preferredPhone`, etc.) from the resolver — the resolver backfills
  empty slots only.
