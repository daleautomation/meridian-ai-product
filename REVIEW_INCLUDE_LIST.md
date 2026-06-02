# REVIEW — INCLUDE LIST
**Files safe to share for a read-only engineering review. Verified from repository contents.**

> Goal: give the reviewer enough to evaluate architecture and code quality without exposing
> customer data, credentials, production systems, or sensitive business information. Every
> directory below was checked; named exceptions are carved out to the EXCLUDE list.

---

## Source code (the engineering core)

| Path | Notes |
|---|---|
| `lib/**` | The intelligence, CRM-import, enrichment, ops, and engine source (~325 files). Verified: contains no embedded secrets (credentials live only in `config/tenants.ts`, which is excluded). Mentions of "brookside" here are a workspace/source label, not a credential. |
| `app/**` | Next.js routes and pages **except** the excluded items: `app/reset-session/route.ts`, `app/api/debug/migrate-nicole-contacts/route.ts`, `app/api/debug/nicole-contact-count/route.ts`. *(Keep `app/api/debug/runtime-fingerprint/route.ts` — admin-gated, no secret, good architecture example.)* |
| `components/**` | UI components **except** `components/auth/DevAuthDebug.tsx`. |
| `scripts/**` | Validation/check/utility scripts **except** `scripts/check-live-auth.ts`. The `local-set-*.mjs` env helpers are safe (no embedded secrets). |
| `db/**`, `proxy.ts` | Infrastructure/source. |
| `fixtures/operational-events/*.ts` | Synthetic, code-based test fixtures (no real data). |

## Documentation (technical & philosophy only)

| Path | Notes |
|---|---|
| `docs/meridian-philosophy.md`, `docs/scoring-principles.md`, `docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md`, `docs/integration-philosophy-v1.md`, `docs/copywriting-principles.md` | Doctrine — the codified discipline. |
| `docs/architecture/**` | Engine domain, storage, event/contract, and integration architecture. |
| `docs/product/**` | Product/scoring/UX principles, known limitations, guardrails. |
| `docs/workflows/**` | Technical workflow + handoff documentation. |
| `docs/COMBINED_PRIORITY_ARCHITECTURE.md`, `docs/public-record-intelligence-architecture.md`, `docs/public-record-intelligence-audit.md`, `docs/onboarding-checklist.md`, `docs/README.md` | Technical architecture & process. |
| `docs/MERIDIAN_TECHNICAL_REVIEW_PACKAGE.md`, `docs/LEJLA_MERIDIAN_REVIEW_PACKAGE.md`, `docs/LEJLA_MERIDIAN_REVIEW_PACKAGE_PRINT.md` (+ `.pdf`) | The reviewer's orientation package (already sanitized). |
| `docs/LEJLA_MERIDIAN_NDA.md` | The NDA (or share/sign separately). |

## Governance & agent doctrine

| Path | Notes |
|---|---|
| `autonomy/**` | Product constitution, no-drift rules, signal-trust rules, acceptance criteria, review checklist. |
| `agents/**`, `prompts/**` | Agent/role instructions (no secrets). |
| `autonoma/**` | UI-test definitions + README (documents the bypass mechanism conceptually; contains no secret value). |

## Project configuration & assets

| Path | Notes |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs` | Build/tooling config. |
| `.env.example` | Placeholder template only (verified — no real values). |
| `.gitignore`, `README.md` | Repo metadata. |
| `public/**`, `content/public/**` | Public static assets. |
| `REVIEW_INCLUDE_LIST.md`, `REVIEW_EXCLUDE_LIST.md`, `REVIEW_REPO_MANIFEST.md` | These manifests (document the package). |

---

### Excluded from the include set
`config/**` (all four files: credentials, customer identities, vertical tuning), `data/**`
(except scaffolding), `fixtures/*.csv`, `research/**`, `archive/**`, `tests/e2e/**`, the
business/strategy docs, and the credential/debug files named in `REVIEW_EXCLUDE_LIST.md`.
If the reviewer needs to *run* the app, provide **sanitized config stubs** (placeholder tenants/
workspaces, fixture data) separately — do not ship the real `config/`.
