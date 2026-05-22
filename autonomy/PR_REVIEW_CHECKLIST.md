# Meridian — PR Review Checklist (Agent Edition)

> The merge gate. Every PR opened by an agent answers these questions.
> Any "no" or "unclear" answer blocks merge until resolved.
>
> This complements [`docs/workflows/pr-review-checklist.md`](../docs/workflows/pr-review-checklist.md)
> (which is the customer-product gate) by adding agent-autonomy-specific
> checks. Both gates must pass.

---

## 1. Constitutional gate (7 questions)

From [`autonomy/PRODUCT_CONSTITUTION.md`](./PRODUCT_CONSTITUTION.md) §7.
Every PR answers each in one sentence.

- [ ] **Brief value:** Does this directly improve the weekly Recovery Brief for
      a paying customer?
- [ ] **Score integrity:** Does every score touched here remain decomposable,
      source-cited, and decay-aware?
- [ ] **No AI theater:** Zero AI-generated customer-facing reasoning?
- [ ] **No surface bloat:** No new dashboard, real-time surface, or "platform"
      feature?
- [ ] **Tenant safety:** Workspace boundaries preserved?
- [ ] **Continuity safety:** Append-only outcome memory preserved?
- [ ] **Re-derivability:** Could the customer re-derive every claim on a brief
      card in under 60 seconds from a public record or their own CRM?

## 2. No-drift gate

From [`autonomy/NO_DRIFT_RULES.md`](./NO_DRIFT_RULES.md).

- [ ] No frozen surface (§1) extended or refactored
- [ ] No banned feature (§2) added
- [ ] No banned phrase (§3) introduced into customer copy
- [ ] No banned data source (§4) added to the pipeline
- [ ] No banned pattern (§5) — no autonomous writes, no hidden multipliers,
      no random scoring, no cross-workspace leak, no in-place outcome edits
- [ ] No banned change without approval (§6) — auth, billing, schema,
      direct `main` commits, deletes

## 3. Signal trust gate (only when scoring touched)

From [`autonomy/SIGNAL_TRUST_RULES.md`](./SIGNAL_TRUST_RULES.md).

- [ ] Every signal carries `name`, `source`, `recordId`, `observedAt`,
      `confidence`, `halfLifeDays`, `weight`, `evidenceUrl`, `payload`
- [ ] Every new signal name has a tier assignment in §3.1
- [ ] Every BANNED source rejected at ingestion
- [ ] WEAK-only cards labeled "weak signal — judgment call"
- [ ] Brief is allowed to ship fewer than 20 cards rather than pad with WEAK
- [ ] Cross-workspace isolation verified
- [ ] Determinism check passes (`scripts/check-brief-determinism.ts`)

## 4. Build + test gate

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run auth:check` exits 0 (if auth touched)
- [ ] `npm run crm-import:check` exits 0 (if ingestion touched)
- [ ] All check scripts referenced in the task ACCEPTANCE_CRITERIA pass

## 5. Scope gate

- [ ] PR is small enough to review in 15 minutes (LOC < 600 or split)
- [ ] PR title prefixes its scope: `[brief]`, `[signals]`, `[outcomes]`,
      `[infra]`, `[hygiene]`, `[canon-amend]`
- [ ] PR description names the source task from
      [`autonomy/AGENT_TASK_QUEUE.md`](./AGENT_TASK_QUEUE.md)
- [ ] PR does not bundle unrelated work

## 6. Voice gate

From [`docs/copywriting-principles.md`](../docs/copywriting-principles.md).

- [ ] No banned phrases in customer-facing strings
- [ ] No emojis in customer copy
- [ ] No exclamation points in customer copy
- [ ] Plain operator voice — no consultant jargon, no SaaS fluff
- [ ] Confidence is named, never implied with adjectives

## 7. Branch + commit gate

- [ ] Branch is **not** `main`
- [ ] Commit message states *why*, not *what*
- [ ] No `--no-verify` (hooks must pass)
- [ ] No force-push to a shared branch
- [ ] Co-author trailer present if generated with an AI tool

## 8. The five-sentence merge memo

The PR description includes a short memo with this shape:

```
[summary]   One sentence on what changed.
[why now]   One sentence on why this is worth shipping this week.
[risk]      One sentence on the worst case if something goes wrong.
[customer]  One sentence on what changes for Nicole or John.
[rollback]  One sentence on how to revert if needed.
```

If any of these five sentences is empty, the PR is not ready.

## 9. Escalation

If the PR touches an item the reviewing agent cannot judge (auth, billing,
schema, customer credentials, pricing), the PR is **escalated to the
founder** by labeling the PR `needs-founder` and pausing. No autonomy is
exercised over those domains.
