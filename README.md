# Meridian AI

Meridian is an operator-focused relationship and revenue workflow system. It turns fragmented lead, CRM, scheduling, and activity data into a prioritized daily execution surface while keeping source evidence, workspace boundaries, and human approval visible.

**Live product:** [meridianai.work](https://www.meridianai.work)  
**Safe demo entry:** [meridianai.work/demo/public](https://www.meridianai.work/demo/public)

## What to demo

Use the public demo profile for a read-only walkthrough. It signs into the isolated `advisor-demo` workspace; mutation controls remain disabled and the session cannot enter the LaborTech client workspace.

A focused five-minute walkthrough:

1. Open the public site and explain the recovery-brief workflow.
2. Enter `/demo/public` and show the prioritized operator surface.
3. Move through Calendar, Scheduling, History, and Relationships.
4. Open a lead's assist panel to show context and next-action support.
5. Point out that writes are blocked in demo mode and workspace access is enforced server-side.

More access details are documented in [DEMO_ACCESS.md](DEMO_ACCESS.md).

## Product surfaces

- **Relationship intelligence:** relationship summaries, timelines, queues, and resurfacing signals.
- **Operator workspace:** daily priorities, scheduling, execution history, and guided lead actions.
- **Recovery briefs:** deterministic, source-traceable customer briefs with explicit evidence.
- **CRM ingestion:** preview, execute, status, and rollback paths for controlled imports.
- **Workspace isolation:** signed sessions, role checks, demo-safe workspaces, and blocked writes.
- **Showcase workflows:** vertical-specific demo routes without exposing customer runtime data.

## Architecture

Meridian is a Next.js 16 application using React 19 and TypeScript. Product logic is split across route handlers, deterministic domain modules, and server-rendered operator surfaces.

```text
app/           pages, server routes, demo and showcase entry points
components/    operator, public, brief, and relationship UI
lib/           auth, scoring, ingestion, CRM, relationship, and workflow logic
scripts/       deterministic checks, data utilities, and demo smoke tests
config/        tenant and workspace policy
fixtures/      synthetic demo and validation inputs
```

Real customer exports and local runtime state are excluded from source control. Demo routes use isolated data and server-side authorization rules.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Set `SESSION_SECRET` in `.env.local` to a stable value with at least 16 characters before testing authenticated routes.

## Validation

The repository's baseline demo gate is a clean dependency install followed by a production build:

```bash
npm ci
npm run build
```

For the browser smoke test, start the application with `SESSION_SECRET` configured, then run:

```bash
npm run smoke:demo -- --base-url=http://localhost:3000
```

The smoke test verifies isolated demo login, navigation, blocked mutation controls, write rejection, and workspace access boundaries.

## Current status

- Production build passes on `main`.
- The public site and controlled demo routes are deployed.
- The full repository lint backlog is not yet clean; CI intentionally gates the production build while lint debt is reduced in scoped follow-up work.
- Durable production CRM imports require Postgres configuration; local development can use filesystem-backed storage.
- Live provider integrations degrade to deterministic or skipped-source behavior when their credentials are absent.

This repository is an actively developed product prototype. Demo-safe behavior is not a substitute for a production security or compliance review.
