<!--
  Meridian PR template. Auto-applied by GitHub.
  Full checklist + rationale: docs/pr-review-checklist.md
  Governing philosophy:        docs/meridian-philosophy.md
-->

## Summary
<!-- 1–3 sentences. What changes, and why now. -->

## Five acceptance questions
<!-- Every PR answers all five. If any answer is "no" or unclear, do not merge. -->

- [ ] **Does this increase operator trust?**
      <!-- Reply 1 sentence. -->
- [ ] **Does this remain explainable?**
      <!-- Reply 1 sentence. -->
- [ ] **Does this improve commercial prioritization?**
      <!-- Reply 1 sentence. -->
- [ ] **Does this reduce operator noise (not add to it)?**
      <!-- Reply 1 sentence. -->
- [ ] **Does this avoid AI theater?**
      <!-- Reply 1 sentence. -->

## Governing question
<!-- The single test in docs/meridian-philosophy.md. -->

> *"Does this help businesses focus attention on the relationships most connected to commercial opportunity in a calm, trustworthy, explainable way?"*

- [ ] Yes — proceed.
- [ ] No — stop and rescope.

## Scope check

- [ ] No operator-route regressions (`/operator`, `OperatorConsole.jsx`, `CalendarCommandCenter.jsx`)
- [ ] No Recovery Brief generator change unintended (`lib/recovery/*`)
- [ ] No customer-facing copy uses banned phrases (`docs/copywriting-principles.md § Banned phrases`)
- [ ] No new black-box scoring, ML model, or hidden weight (`docs/scoring-principles.md`)
- [ ] No new write path against a customer's CRM (`docs/ingestion-principles.md`)
- [ ] No new dashboard, chat surface, or sticky bar (`docs/ux-principles.md`)

## Verification

- [ ] `npm run build` passes
- [ ] Manual render check on any operator-facing change
- [ ] Live brief renders (anonymous load) if the change touches `/brief/*`

## Canon amendment? (rare)

- [ ] This PR amends one of the seven canonical docs in `docs/`. If yes, the PR title begins with `[canon-amend]` and the relevant doc has a new dated entry under its Amendments section.
