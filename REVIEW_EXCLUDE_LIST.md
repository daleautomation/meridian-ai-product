# REVIEW — EXCLUDE LIST
**Files that must NOT be shared with the reviewer. Verified from repository contents (not assumed).**

> Method: classified `git ls-files` (679 tracked files), scanned tracked files for credential
> and PII patterns, and inspected every flagged file directly. Untracked/gitignored paths are
> noted because they must never be added to the review package either.

---

## A. Credentials & secrets

| Path | Verified reason |
|---|---|
| `config/tenants.ts` | **Plaintext login passwords** — `nicole` → `"brookside"` (pilot customer), plus demo creds `"Meridian"`, `"labortech"`. Working credentials for the live app. |
| `DEMO_ACCESS.md` | Demo access credentials / login instructions. |
| `tests/e2e/nicole-workspace.spec.ts` | Hardcoded password fallback (`?? "brookside"`) + live customer URL. |
| `scripts/check-live-auth.ts` | Authenticates against the live system using tenant credentials. |
| `components/auth/DevAuthDebug.tsx` | Dev auth/debug surface that handles credentials. |
| `app/reset-session/route.ts` | Session-reset/dev auth route. |
| *(not tracked — never add)* `.env`, `.env.local`, `.env*.local` | API keys, DB URL, session secret, Vercel/OIDC tokens. Already gitignored. |

> `.env.example` is **safe** (placeholders only — verified). The `scripts/local-set-*.mjs`
> helpers are **safe** (interactive; they embed no secret — verified).

## B. Customer data & PII

| Path | Verified reason |
|---|---|
| `data/**` *(all 27 tracked files)* | Real company/contact/customer runtime state (e.g., `companySnapshots.json` ~1 MB, `rawCompanies.json`, `crmActivities.json`, `weekly-state/nicole-lonergan/2026-W22.json`, `recovery-briefs/**`, `snapshots/labortech-operator.json`, `seed/kc-*-companies.json`, `usage-events.jsonl`). **Exceptions to keep:** `data/public-records/README.md`, `data/raw/king-county/.gitkeep` (scaffolding only). |
| `fixtures/outreach-prospect-tracker.csv` | Real prospect tracker — contact names, emails, phones, pricing-discussed. |
| `fixtures/sample-brief-prospects.csv` | Real companies + founders + LinkedIn (e.g., ELKALYNE/Lisa Gonzales, Huffman Associates/Michael Huffman). |
| `fixtures/recovery-b2b-services.csv`, `fixtures/recovery-staffing.csv`, `fixtures/sample-recovery.csv` | Prospect/recovery datasets — treat as real PII. |
| `config/signals/nicole-lonergan.ts` | Customer-specific scoring config (identifies the customer). |
| `config/workspaces.ts` | Workspace definitions including customer identities. |
| `app/api/debug/migrate-nicole-contacts/route.ts`, `app/api/debug/nicole-contact-count/route.ts` | Customer-named debug routes operating on customer data. |
| `docs/customer-expectations.md` | Customer-specific expectations. |
| *(not tracked — never add)* `data/crm-contacts/`, `data/backups/`, `data/weekly-state/`, raw CSVs | Live customer contacts and snapshots. Already gitignored. |

## C. Business-sensitive information

| Path | Verified reason |
|---|---|
| `docs/MERIDIAN_FOUNDER_DUE_DILIGENCE_MEMO.md` | **Internal critical assessment** (probability of success, founder blind spots). Never for a candidate. |
| `docs/MERIDIAN_FOUNDER_BLUEPRINT.md` | Company/org/strategy internals. |
| `docs/pricing-one-pager.md` | Pricing and terms. |
| `docs/commercial-readiness-verdict.md`, `docs/product-bifurcation-correction.md`, `docs/labortech-readiness.md` | Commercial strategy / product-line decisions. |
| `docs/founder-monday-runbook.md`, `docs/crm-rehab-session.md`, `docs/crm-rehabilitation-plan.md`, `docs/first-monday-brief-validation.md`, `docs/founder-parcel-lookup-workflow.md` | Founder operating playbooks / customer-engagement specifics. |
| `config/signals/labortech.ts` | Vertical strategy / tuning. |
| `research/**` | Mixed market analysis, strategy, and audits (business-sensitive). |
| `archive/**` | Legacy/unknown content — exclude by default. |
| *(not tracked, on disk)* `docs/MERIDIAN_BOARD_MEMO.md`, `docs/MERIDIAN_EXECUTIVE_BLUEPRINT.md` | Board/exec strategy. Do not add. |

---

### Critical handling note
Removing these files in a **branch commit does not remove them from git history.** Anyone with
the branch can recover them via `git log -p` or by checking out an earlier commit. The review
package **must be delivered as a history-free snapshot** (`git archive`) or a fresh repository —
never as a clone of the sanitized branch. See `REVIEW_REPO_MANIFEST.md`.
