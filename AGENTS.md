# Meridian AI — Agent Development Guide

## Cursor Cloud specific instructions

### Overview

This is a Next.js 16 app (React 19, Tailwind CSS 4, TypeScript) — a B2B sales operator console for the home services industry. All state is persisted to JSON files in `data/` (no database). The app degrades gracefully when optional API keys are missing.

### Running the app

```bash
npm run dev       # starts Next.js on http://localhost:3000 (Turbopack)
```

Before running, ensure `.env.local` exists with at least:
```
SESSION_SECRET=<any-string-16+-chars>
```

Without `ANTHROPIC_API_KEY`, AI features (assistant chat, deal coach, call scripts) fall back to deterministic templates. All other provider keys (Google, Yelp, Hunter, etc.) are optional — adapters return `[]` when keys are missing.

### Demo credentials (hardcoded in `config/tenants.ts`)

| Username | Password | Workspace |
|----------|----------|-----------|
| dylan | meridian | labortech |
| john | labortech | labortech |
| labortech | labortech | labortech |

### Lint & type-checking

```bash
npm run lint      # ESLint (flat config in eslint.config.mjs)
npx tsc --noEmit  # TypeScript type-check (no build output)
```

Note: The codebase has pre-existing lint warnings/errors (unused vars, unused eslint-disable directives). These are not regressions.

### Key directories

- `app/` — Next.js App Router pages and API routes
- `components/` — React components (including the large `OperatorConsole.jsx`)
- `lib/` — Business logic (contacts, scoring, session, AI, MCP tools)
- `config/` — Tenant config, scoring weights
- `data/` — JSON persistence files (seed data in `data/seed/`)
- `scripts/` — Utility scripts (smoke tests, reranking reports)

### Seeding data

The app ships with seed data pre-loaded. To re-import:
```bash
curl -X POST http://localhost:3000/api/pipeline/seed
```

### No external services required

No Docker, no database, no Redis. The app is self-contained — just Node.js and npm.
