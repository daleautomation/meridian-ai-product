# Meridian Docs

This folder contains both **canonical governance docs** and **legacy design notes** from earlier eras of the product. Read the canon first; treat the legacy as historical context, not active spec.

---

## Canonical (start here)

These documents govern every product, scoring, ingestion, UI, and roadmap decision. Conflicts with these documents indicate the proposal is wrong, not the document.

- **[meridian-philosophy.md](./meridian-philosophy.md)** — the master philosophy. Permanent strategic direction.
- **[product/product-principles.md](./product/product-principles.md)** — what to build, what not to build, decision framework.
- **[scoring-principles.md](./scoring-principles.md)** — prioritization rules; observable signals only; banned approaches.
- **[product/ingestion-principles.md](./product/ingestion-principles.md)** — read-only CSV-first posture; data-handling promises.
- **[product/ux-principles.md](./product/ux-principles.md)** — calm/operator-grade visual rules; one-screen rule; banned elements.
- **[copywriting-principles.md](./copywriting-principles.md)** — voice, banned phrases, approved phrasings, sample-brief framing.
- **[workflows/pr-review-checklist.md](./workflows/pr-review-checklist.md)** — the five acceptance questions every PR must pass.

These seven documents are **the single source of truth.** A change that conflicts with any of them requires either:
1. Rejecting the change, OR
2. Amending the relevant doc with a dated, signed entry, followed by the change.

Never silently violate the canon.

---

## How to use these docs

**During a PR review:** open `pr-review-checklist.md` and confirm the five answers are yes. If any answer is no, the PR is rejected, deferred, or rescoped.

**During product proposal:** read `product-principles.md § Build / don't build matrix` and `meridian-philosophy.md § The single governing question`. If the proposal doesn't pass the governing question, it doesn't ship.

**When writing operator-facing text:** check `copywriting-principles.md § Banned phrases` and `§ Approved phrasings` before merging.

**When changing scoring:** check `scoring-principles.md § Observable signals` and `§ Banned scoring approaches`. Every line of generated text must trace to a documented signal.

**When changing the UI:** check `ux-principles.md § What disappears from the UI`. The default answer to "can this element come out?" is yes.

**When changing data ingestion:** check `ingestion-principles.md § Banned ingestion paths` and `§ Data handling promises`.

---

## Folder layout

After the May 2026 hygiene pass, supporting material is split into intent-based
subfolders. The seven canonical principles above remain at the `docs/` root.

- `docs/architecture/` — design intent for engines, event envelopes, contracts, and the relationship/operational-event domains. Informational, not active spec.
- `docs/product/` — product-shape documents: limitations, scoring guardrails, source priority, principles for ingestion / product / UX.
- `docs/workflows/` — operator and contributor workflows: handoff README, PR review checklist, contact sourcing, operator continuity.
- `research/audits/` — historical audits and refactor retrospectives (e.g. LaborTech UX audit, public-positioning audit, pre-ingestion cleanup report).
- `research/philosophy/` — long-form essays on the operating philosophy (AI operating system, execution compression).

If a legacy doc conflicts with the canon, the canon wins. Always.

The legacy material is **read-only**. Don't edit it. Don't archive it (yet). Don't delete it. It may yet inform future product decisions when the time comes.

Notable legacy docs to know about:
- `workflows/HANDOFF_README.md` — describes a roofing-vertical positioning that has since been pivoted away from
- `product/KNOWN_LIMITATIONS.md` — still current; flags providers and edge cases that aren't wired
- `product/SOURCE_PRIORITY.md` — still current; contact-resolution provider ranking
- The `architecture/RELATIONSHIP_ENGINE_*.md` family (10+ files) — design intent for a read-only DTO domain; informational only
- The `architecture/OPERATIONAL_EVENT_*.md` family — informational only
- `research/audits/LABORTECH_OPERATOR_UX_REFACTOR_AUDIT.md` — historical UX audit for the live LaborTech operator path

When a future audit identifies legacy docs that contradict the canon and would mislead a new contributor, move them to `archive/`. Never delete without explicit founder approval.

---

## Amending the canon

Any of the seven canonical docs may be amended. The process:

1. Open a PR with the proposed change.
2. The PR title begins with `[canon-amend]`.
3. The PR description states: which document, what changed, why now.
4. The relevant document gets a dated entry under `## Amendments` (or equivalent) at the bottom.
5. The PR is reviewed by the founder. No exceptions.

Canon amendments are the only PRs allowed to bypass the standard five acceptance questions — because they ARE the standard.

---

## The single governing question

If you remember nothing else from this folder, remember this:

> *"Does this help businesses focus attention on the relationships most connected to commercial opportunity in a calm, trustworthy, explainable way?"*

If yes — proceed.
If no — stop.
