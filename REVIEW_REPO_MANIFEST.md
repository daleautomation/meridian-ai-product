# REVIEW REPO MANIFEST
**How the sanitized read-only engineering-review package for Lejla Ramic was produced and how to deliver it safely.**

---

## 1. Purpose
Provide an experienced engineer enough of the codebase to evaluate **architecture and code
quality** while exposing **no customer data, credentials, production systems, or sensitive
business information.** Classifications were **verified from repository contents**, not assumed.

## 2. What was verified
- Inventoried all **679 tracked files** (`git ls-files`).
- Confirmed `.env`, `.env.local`, `.env*.local`, `data/crm-contacts/`, `data/backups/`,
  `data/weekly-state/` (and raw CSVs) are **gitignored / not tracked** → never in a git share.
- Scanned tracked files for credential and PII patterns and **inspected every match directly.**
- Found real exposures in tracked files (see `REVIEW_EXCLUDE_LIST.md`): plaintext passwords in
  `config/tenants.ts`, demo access in `DEMO_ACCESS.md`, real prospect data in `fixtures/*.csv`,
  27 tracked `data/` files of company/customer intel, customer-named config/debug routes, and
  business/strategy docs.

## 3. Deliverables in this package
- `REVIEW_INCLUDE_LIST.md` — files safe to share.
- `REVIEW_EXCLUDE_LIST.md` — files to withhold, categorized (credentials / customer data /
  business-sensitive), each with a verified reason.
- `REVIEW_REPO_MANIFEST.md` — this document.
- A sanitized branch: **`review/lejla-sanitized`** (the excluded files removed).

## 4. ⚠ Critical: a branch is NOT a safe share artifact
Removing files in a branch commit **does not remove them from git history.** With the branch,
the reviewer could recover every excluded file (including the plaintext passwords) via
`git log -p` or by checking out an earlier commit. **Therefore the package must be delivered as
a history-free snapshot, not as a clone of the branch.**

## 5. How to deliver safely (recommended)
Export the sanitized branch as a **history-free archive** and send that:

```bash
# From the sanitized branch, produce a zip containing only the current (safe) tree, no history:
git archive --format=zip --output="$HOME/Downloads/meridian-review.zip" review/lejla-sanitized

# Verify the archive contains NO excluded files (each command should return nothing):
unzip -l "$HOME/Downloads/meridian-review.zip" | grep -E 'config/tenants.ts|DEMO_ACCESS.md|\.csv|^.*data/(?!public-records/README)|MERIDIAN_FOUNDER_DUE_DILIGENCE'
```

Share `meridian-review.zip`. It carries the working tree only — no `.git`, no history, no secrets.

**Alternative (fresh repo):** unzip the archive into a new folder and `git init` it, so the
reviewer gets a clean repo with a single initial commit and no prior history.

## 6. Access boundary for the reviewer
- **Read-only.** No write access to the live repository, production, database, or deploy.
- **No secrets / no real data.** Credentials and customer data are excluded by construction.
- **NDA first.** Deliver only after the mutual NDA (`docs/LEJLA_MERIDIAN_NDA.md`) is signed.
- **If she needs to run the app:** provide **sanitized config stubs** (placeholder tenants,
  workspaces, and fixture data) separately — never the real `config/` or `data/`.

## 7. Reproduce the sanitized branch
```bash
git checkout -b review/lejla-sanitized        # from a clean HEAD
git rm -r --quiet <paths in REVIEW_EXCLUDE_LIST.md (tracked only)>
git add REVIEW_INCLUDE_LIST.md REVIEW_EXCLUDE_LIST.md REVIEW_REPO_MANIFEST.md
git commit -m "Sanitized review package for external engineering review"
# then export via `git archive` (Section 5) — do not push or share the branch directly
```
