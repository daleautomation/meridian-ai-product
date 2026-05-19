# generated/

Canonical home for all generated artifacts. Contents are git-ignored by default
(see `.gitignore`) and `.cursorignore`'d from semantic indexing.

| Subdir            | Use                                                   |
| ----------------- | ----------------------------------------------------- |
| `recovery-briefs` | Output of `scripts/generate-brief.ts` (HTML/JSON)     |
| `exports`         | CSV / JSON exports for partners, ops, demos           |
| `reports`         | Long-form generated reports                           |
| `snapshots`       | Pipeline snapshots, debug dumps                       |

**Rule of thumb:** if a file is produced by a script and could be regenerated,
it belongs here, not under `data/` or `docs/`.

> Note: some legacy generated outputs still live under `data/` because runtime
> code reads them via `process.cwd()` joins. Those paths are excluded from
> semantic indexing in `.cursorignore` and future-writes are gitignored, but
> they have not been physically relocated to avoid breaking the app.
