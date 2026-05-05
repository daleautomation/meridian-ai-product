# Meridian — Ingestion Contract

This is the contract every new source must follow before it can land
in production. The platform is intentionally restrictive about what
ingestion is allowed to write.

## 1. The normalized lead shape

Defined in `lib/leads/normalizedLead.ts` — `NormalizedLead`. All future
ingestion must produce this shape. Do not invent fields. Do not write
to UI-only fields.

```ts
type NormalizedLead = {
  id: string;
  workspaceSlug: string;
  moduleId: "roofing" | "hvac" | "plumbing" | "remodeling";
  companyName: string;
  location?: string;
  website?: string;
  phone?: string;
  email?: string;
  source: SourceName;
  sourceStatus: SourceStatus;
  lastChecked?: string;
  signals: { /* boolean / numeric proxies — see file */ };
  crm: { status?: string; lastAction?: string; notes?: string };
  evidence: EvidenceItem[];
  decision?: LeadDecision;
};
```

## 2. What every source must provide

| Field | Required? | Notes |
|---|---|---|
| `id` | yes | Stable, source-scoped. |
| `companyName` | yes | Trim, no markup. |
| `source` | yes | Must be one of `SourceName`. |
| `sourceStatus` | yes | Honest: `connected` / `available` / `not_connected` / `missing` / `stale` / `error`. |
| `lastChecked` | yes when `sourceStatus === "connected"` | ISO timestamp of the read. |
| `evidence[]` | yes per signal it claims | Every claim needs evidence. |
| `signals.*` | optional | Only set what the source can defend. |
| `decision` | never | Computed by `lib/scoring/decision.ts`, not by sources. |

## 3. Missing data handling

- Missing fields stay `undefined`.
- Do not substitute placeholders, defaults, or "0".
- A missing signal must lower confidence, never raise urgency.
- The UI renders honest empty states ("No data yet — connect a source
  to populate this section"). Do not paper over them.

## 4. Evidence

Every signal a source asserts MUST be backed by an `EvidenceItem`:

```ts
{
  label: "Google rating",
  value: 4.1,
  source: "google_places",
  confidence: "high"
}
```

Bad:
```ts
lead.rating = 4.1;
```

Good:
```ts
lead.signals.rating = 4.1;
lead.evidence.push({
  label: "Google rating",
  value: 4.1,
  source: "google_places",
  confidence: "high",
});
```

Confidence levels:
- `high` — direct API response from a primary source.
- `medium` — derived/parsed (e.g., site scan inferring a contact form).
- `low` — heuristic, scraped, or user-submitted without verification.

## 5. How `decision.ts` consumes signals

`lib/scoring/decision.ts` is the **only** producer of user-facing
decision output (`bucket / score / reason / suggestedOpening`).

It reads:
- `signals.*` (when present)
- `evidence[]` (for confidence weighting)
- snapshot CRM state (status, recent attempts)

It does NOT read:
- source-specific fields
- raw scraper output
- legacy enums (`recommendedAction`, `closeability`, `dealHeat`, etc.)

If a new source needs a new bucket, it must:
1. Land its signal in `signals.*` with evidence.
2. Update `decideLead()` to consume that signal.
3. Never bypass `decision.ts`.

## 6. Source readiness display

`lib/sources/readiness.ts` reports per-source status to the workspace
header. Each ingestion adapter is expected to either:
- read its credentials from a documented env var, OR
- declare itself `available` (built-in, no credential).

Do not show "Connected" if the credential is absent. Do not show
"Available" if the adapter is broken — emit `Error` with detail.

## 7. UI fields are off-limits

UI components read `lead.decision.{bucket, score, reason, suggestedOpening}`,
plus a small set of plain fields (`companyName`, `location`, `website`,
`phone`, `email`, `lastChecked`, `source`). Sources must never:
- write to UI-only diagnostics
- attach styling, color, or copy
- emit user-facing strings (the UI builds those from decision output)

## 8. What NOT to do

- ❌ Do not write directly to UI fields.
- ❌ Do not create source-specific scoring outside `decision.ts`.
- ❌ Do not invent missing values.
- ❌ Do not add a new bucket without source evidence.
- ❌ Do not import `closeability`, `companyDecision`, `nextAction`,
  `callQueue`, `opportunityTier`, or any other legacy scoring file
  from a source adapter. Those are internal to the engine.
- ❌ Do not surface raw enums (`CALL NOW`, `MONITOR`, `HOT`, `WARM`,
  `EXECUTE_NOW`, etc.) anywhere user-visible.

## 9. Acceptance checklist for a new source

Before merging an ingestion adapter:

- [ ] Adapter emits `NormalizedLead` shape only.
- [ ] Every claim has an `EvidenceItem`.
- [ ] Missing data is `undefined`, not faked.
- [ ] Source registered in `lib/sources/readiness.ts` with honest status.
- [ ] No new fields added to UI components.
- [ ] No imports of legacy scoring modules.
- [ ] `decideLead()` updated only if a new signal was added.
- [ ] `tsc --noEmit` clean.
- [ ] `next build` clean.
- [ ] One short note added to `docs/pre-ingestion-cleanup-report.md`
      under "Sources wired".
