# MERIDIAN_AUDIT.md — The Constitution

> **Status:** Canonical. Authored 2026-07-06 by the incoming CTO after a complete
> technical, product, and strategic audit of the existing codebase.
>
> **Purpose:** This document is the single source of truth for what Meridian
> *is*, what it *is not*, and what already exists to serve the long-term vision
> of **Meridian Command** (Dylan's personal operating system).
>
> **The governing question.** Every future feature, refactor, or AI agent must
> answer **yes** to this before it is built:
>
> > *"Does this help me decide, every morning, where my attention creates the
> > highest ROI — across relationships, companies, revenue, and meetings — in a
> > calm, explainable, deterministic way?"*
>
> If the answer is no, do not build it. If a proposed change conflicts with this
> document, the change is wrong — not the document. Amendments are dated and
> founder-signed (see the log at the bottom).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Feature Inventory](#3-feature-inventory)
4. [Database Audit](#4-database-audit)
5. [AI Audit](#5-ai-audit)
6. [Technical Debt Report](#6-technical-debt-report)
7. [UX Audit](#7-ux-audit)
8. [Reuse Plan](#8-reuse-plan)
9. [Module Plan](#9-module-plan)
10. [Migration Plan](#10-migration-plan)
11. [90-Day Roadmap](#11-90-day-roadmap)
12. [What I Should Build First](#12-what-i-should-build-first)
13. [What I Should Never Build Again](#13-what-i-should-never-build-again)
14. [Vision Alignment Scoreboard](#14-vision-alignment-scoreboard)
15. [Amendment Log](#15-amendment-log)

---

## 1. Executive Summary

### The one-sentence finding

**You have already built Meridian Command — you just built it as a job search.**
The engine at `lib/ae-jobs/career-brief.ts`, served at `/operator/jobs/brief`, is a
working, deterministic, calm "every-morning, what-matters-most-today" command
center. It is the founder's hardcoded landing page. It is ~80% of the vision.
The remaining 20% is **widening its data model** from "job opportunities" to
"attention items (relationships + companies + revenue + meetings)" — not
rebuilding anything.

### What this codebase actually is

A 433-file Next.js 16 / React 19 application that has lived through **three
overlapping eras**, all still present in the tree:

1. **Era 1 — B2B Relationship Intelligence (the original Meridian).** A
   multi-tenant SaaS for trade businesses (roofing/HVAC/plumbing). Company
   snapshots, CRM ingestion, contact resolution, lead scoring, recovery briefs,
   an operator console. This is the *bulk* of the code (~70%) and the source of
   most technical debt. It is governed by `docs/meridian-philosophy.md`.

2. **Era 2 — The "CEO Heartbeat" experiment.** An observer-only daily pulse
   (`scripts/heartbeat/`, `app/heartbeat`) that frames a morning brief as
   *CEO Decisions / What Changed / What Needs Dylan / Not Covered Yet*. It has
   the **right taxonomy** but a hollow body — the markdown generator it reads
   from does not exist in the repo.

3. **Era 3 — Meridian Command (the pivot, in progress now).** The last ~14
   commits — `career brief`, `AE job operating system`, `AE job email
   ingestion`, `career calendar sync` — build a personal operating surface for
   Dylan's job search. This is the newest, cleanest, most on-vision code, and
   it is already the default surface after login.

The audit's job was to prove reuse over rebuild. **The pivot is not a rewrite —
it is a generalization of Era 3, fed by the reusable deterministic engines
salvaged from Era 1, delivered in the taxonomy of Era 2.**

### The five findings that matter most

1. **The command center already exists and is live.** `buildCareerBriefModel()`
   already produces a dated morning-brief hero, an `executeNow` action list, a
   single `suggestedNextMove` ("what should I do first"), ranked
   `topOpportunities`, `waitingOn`, and `upcoming`. This is the spine of
   Meridian Command. (`lib/ae-jobs/career-brief.ts`)

2. **There is no live AI anywhere — and that is a feature, not a gap.** Zero
   calls to any LLM API exist in `lib/` or `app/`. Every "engine,"
   "intelligence," and "AI" name is deterministic rule-based scoring. This
   perfectly matches the philosophy's "deterministic, explainable, not
   black-box" mandate. `ANTHROPIC_API_KEY` is documented but read by zero files.
   The intended AI pattern is **external**: a Claude agent drives the system
   through the MCP tool surface (`app/api/mcp`, 32 tools) and POSTs results back.

3. **The persistence layer is a demo architecture wearing a production
   costume.** ~100% of live data is flat JSON files under `data/`. The Neon
   Postgres schema exists and is code-complete but is **switched off**
   (`MERIDIAN_TRUTH_STORE` unset → file mode). On Vercel's read-only filesystem,
   **writes silently fail and are lost** (`safeWriteJson` swallows errors). This
   is the #1 durability risk and must be fixed before Command is trusted daily.

4. **Meridian Command is architecturally an island.** The `ae-jobs` estate is
   clean but disjoint: it does not use the workspace/tenant model, does not
   touch Postgres, and shares no join keys with the B2B estate. This is *good*
   for a clean pivot — but it means the reusable Era-1 engines
   (recovery, resurfacing, insight) are not yet feeding it.

5. **You own five separate "daily brief" surfaces that should be one.** Career
   Brief (live), Heartbeat (hollow), Recovery Brief (weekly batch), Founder
   Brief markdown (generated, no accessor), and the LaborTech Daily Pipeline
   (B2B cron). The core act of Meridian Command is **unifying these into a
   single read model.** The pieces exist; the join does not.

### The strategic reconciliation you must accept

The original philosophy says Meridian *"does not feel like an AI system running
the business."* Meridian Command says the system *"determines what to do every
morning."* **These are not in conflict** — and resolving the apparent conflict
is the whole point of this document:

> Meridian Command is a **decision-support operating system, not an autonomous
> agent.** It ranks, surfaces, and explains. *You* decide and act. The engine
> stays deterministic, evidence-bound, and explainable — the philosophy's core
> — but the **subject changes from "my B2B customers' relationships" to "my
> own professional life."** Same engine. Same discipline. New subject.

---

## 2. Architecture Diagram

### 2.1 System topology (as it exists today)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS / ACTORS                                 │
│   Dylan (founder)      B2B tenants        External Claude agent (via MCP)     │
└───────┬───────────────────┬───────────────────────┬─────────────────────────┘
        │                   │                        │
        ▼                   ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND — Next.js App Router                          │
│  app/layout.tsx (only layout: fonts + SessionProvider; NO app shell/nav)      │
│                                                                               │
│  ┌── PERSONAL / COMMAND (Era 3) ──┐  ┌── B2B OPERATOR (Era 1) ────────────┐   │
│  │ /operator/jobs/brief ★COMMAND  │  │ /operator (LaborTech console 13k+  │   │
│  │ /operator/jobs (AE pipeline)   │  │   lines: OperatorConsole.jsx)      │   │
│  │ /heartbeat (hollow morning)    │  │ /operator/relationship-priority    │   │
│  │ /personal (Nicole, mislabeled) │  │ /operator/import, /brief/[..]      │   │
│  └────────────────────────────────┘  │ /admin/{prospects,outreach,runs}   │   │
│  ┌── PUBLIC MARKETING (Era 1) ────┐  └────────────────────────────────────┘   │
│  │ / , /about , /roofing-intel.,  │   Auth: /login , /workspace-select        │
│  │ /showcase , /intake            │   (workspace-select = real routing hub)   │
│  └────────────────────────────────┘                                           │
└───────┬───────────────────────────────────────────────────────┬─────────────┘
        │ 40 API routes (app/api/**)                             │
        ▼                                                        ▼
┌───────────────────────────────────────────┐  ┌────────────────────────────────┐
│         BACKEND — lib/ (deterministic)     │  │   MCP SURFACE (agent I/O)        │
│                                            │  │  app/api/mcp/route.ts            │
│  DECISION ENGINES (reusable):              │  │  JSON-RPC: tools/list, tools/call│
│   • ae-jobs/career-brief.ts  ★             │  │  Auth: x-mcp-key OR admin session│
│   • scoring/ (decision, company, close.)   │  │  32 tools (all company/lead CRM) │
│   • recovery/ (decisionScore, whyNow)      │  │  → rank, prefilter, snapshot,    │
│   • relationship-intelligence/resurfacing  │  │    followUp, paidPresence, ...   │
│   • calendar/ (insight, workflow, learning)│  └────────────────────────────────┘
│   • pipeline/dailyJob.ts (B2B cron target) │
│                                            │  ┌────────────────────────────────┐
│  BIG SKELETON (read-only, empty):          │  │  EXTERNAL INTEGRATIONS (fetch)  │
│   • relationship-engine/ (59 files,        │  │  Google Places ✓  Yelp ✓        │
│     event-sourcing, returns [])            │  │  Hunter.io ✓  Meta Ad Library ✓ │
│                                            │  │  Google Ads Transparency ⚠scrape│
│  AUTH: hand-rolled signed cookie +         │  │  BBB / Facebook (proxy stubs)   │
│        plaintext tenant passwords ⚠        │  │  Trade leads (scaffold/TODO)    │
└───────────────────┬────────────────────────┘  └────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PERSISTENCE — split brain                               │
│                                                                               │
│  ACTIVE (file mode, default):            DORMANT (Postgres, code-complete):   │
│   data/*.json  (companySnapshots 975KB,   db/schema/phase1-neon.sql:          │
│   crmActivities, rawCompanies, ...)        • idempotency_keys                 │
│   data/ae-jobs/*.json  ★ (opportunities,   • execution_outcomes (+ _latest)   │
│     calendar-events)                       • company_current_state            │
│   data/{founder-brief,weekly-state,        • domain_events                    │
│     recovery-briefs,crm-contacts}/         @neondatabase/serverless           │
│   generated/* (empty .gitkeep)             MERIDIAN_TRUTH_STORE unset = OFF    │
│                                                                               │
│  ⚠ On Vercel: data/ is READ-ONLY → all writes silently lost.                  │
│    Only crm-import has a /tmp fallback (ephemeral across cold starts).        │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTOMATION / SCHEDULING                                │
│  ONLY live cron: .github/workflows/heartbeat.yml (13:00 UTC daily,            │
│    observer-only, runs 7/24 check scripts, writes generated/heartbeat/,       │
│    uploads CI artifact — NO delivery to founder)                              │
│  Dead/unwired: lib/pipeline/cron.ts (setInterval, off), /api/pipeline/daily   │
│    (no caller), NO vercel.json / vercel.ts → NO Vercel Cron                    │
└─────────────────────────────────────────────────────────────────────────────┘

  ★ = the seed of Meridian Command   ⚠ = risk   ✓ = wired & working
```

### 2.2 Layer-by-layer

| Layer | Technology | State |
|---|---|---|
| **Frontend** | Next.js 16.2.2 App Router, React 19, Tailwind v4, hand-rolled inline styles | Working. **No shared app shell / no persistent nav** — every surface re-implements its own header. |
| **Backend** | Next.js Route Handlers (40 routes), plain TS in `lib/` | Working. 100% deterministic. |
| **Database** | Neon Postgres (`@neondatabase/serverless`, raw SQL, no ORM) | **Dormant.** File-JSON is the live store. |
| **Auth** | Hand-rolled signed session cookie (`meridian_session`), plaintext tenant passwords in `config/tenants.ts` | Working but **insecure** (see debt #1). |
| **Hosting** | Vercel (`.vercel/`, OIDC token present) | Deployed. **FS read-only risk unaddressed.** |
| **Storage** | Flat JSON files + `/tmp` fallback (crm-import only) | **Not durable on serverless.** |
| **AI** | None in-repo. External Claude drives via MCP. | Deterministic templates only. |
| **Automation** | GitHub Actions (1 daily heartbeat) | Only real cron; observer-only, no delivery. |
| **APIs (internal)** | 40 route handlers | Working; 3 have missing auth guards. |
| **External integrations** | Google Places, Yelp, Hunter, Meta Ad Library (wired); BBB/Facebook/Ads-Transparency (stub/brittle) | Degrade gracefully — genuine design strength. |

---

## 3. Feature Inventory

Legend — **State:** ✅ Working · 🟡 Needs Refactor · 🟥 Broken/Hollow · 💤 Unused/Dead ·
**Reuse:** ♻️ Reuse · 🔧 Refactor · 🗑️ Delete · ⭐ Core Module.
**Align** = alignment to Meridian Command (0–100).

| Feature | State | Reuse | Priority | Align | Relationship to Meridian Command |
|---|---|---|---|---|---|
| **Career Brief** (`lib/ae-jobs/career-brief.ts`, `/operator/jobs/brief`) | ✅ | ⭐ | **P0** | **92** | **This IS Command.** Generalize its model from jobs → attention items. |
| **AE Job Operating System** (`/operator/jobs`) | ✅ | ⭐ | P1 | 70 | The pipeline drill-down behind the brief. Keep; rename "opportunities" generically later. |
| **Career calendar sync** (`lib/ae-jobs/calendar-store.ts`, `/api/ae-jobs/calendar/sync`) | ✅ | ⭐ | P0 | 88 | "Upcoming meetings" panel of Command. Wire to real Google Calendar. |
| **AE job email ingestion** (`lib/ae-jobs/ingestion.ts`, `/api/ae-jobs/ingest`) | 🟡 | ♻️ | P1 | 75 | Inbound signal → opportunities. Parsing is external (Claude POSTs JSON); not auto-wired. |
| **Heartbeat morning brief** (`scripts/heartbeat/`, `/heartbeat`, `lib/heartbeat/briefReader.ts`) | 🟥 | 🔧 | P0 | 85→ | Right taxonomy (CEO Decisions / What Needs Dylan / Not Covered Yet), **hollow body** (no generator). Merge into Career Brief. |
| **Recovery brief engine** (`lib/recovery/*`, `scripts/generate-brief.ts`, `/brief/[..]`) | ✅ | ♻️ | P1 | 74 | "Which dormant relationships to revisit." Deterministic. Feed into Command's relationships section. |
| **Resurfacing engine** (`lib/relationship-intelligence/resurfacing.ts`) | ✅ | ♻️ | P1 | 68 | 6 buckets of attention-worthy relationships. Needs a live contact source. |
| **Insight / Workflow / Learning engines** (`lib/calendar/insightEngine.ts`, `workflowEngine.ts`, `patternLearning.ts`) | ✅ | ♻️ | P1 | 70 | Evidence-gated insights + action re-ranking + outcome learning. Reusable calibration layer. |
| **Scoring core** (`lib/scoring/{decision,companyDecision,closeability}.ts`) | ✅ | 🔧 | P1 | 62 | Strong deterministic ranking; hardwired to roofing signals — retarget to Dylan's deals. |
| **MCP tool surface** (`app/api/mcp`, `lib/mcp/` — 32 tools) | ✅ | 🔧 | P1 | 58 | Excellent agent plumbing, wrong domain (all company/lead CRM). Add a founder-action tool set. |
| **CRM import wizard** (`lib/crm-import/*`, `components/crm-import`) | ✅ | ♻️ | P2 | 60 | Vision-neutral ingestion; usable to load Dylan's real contacts. |
| **Company snapshots + contact resolution** (`lib/state/companySnapshotStore.ts`, `lib/contacts/*`) | ✅ | ♻️ | P2 | 55 | The "which companies deserve attention" substrate; retarget from trades to Dylan's target companies. |
| **LaborTech Operator Console** (`OperatorConsole.jsx` 11.6k lines) | ✅ | 🔧 | P3 | 15 | Pure B2B. Mine `CalendarCommandCenter` + scheduling + outcome-logging for reuse; otherwise leave as separate B2B product. |
| **Relationship-priority desk** (`/operator/relationship-priority`) | ✅ | ♻️ | P2 | 35 | B2B UI; expose its *engine* to Command via API, not its screen. |
| **Relationship Engine** (`lib/relationship-engine/` — 59 files) | 🟥 | 🔧 | P3 | 45 | Ambitious event-sourcing skeleton that **returns `[]`** (placeholders, mutations throw). Future bet, near-zero current value. Do not let its surface area imply function. |
| **LaborTech Daily Pipeline** (`lib/pipeline/dailyJob.ts`, `/api/pipeline/daily`) | ✅ | 🔧 | P3 | 30 | The B2B cron engine. Keep for the B2B product; not Command. |
| **Public marketing site** (`/`, `/about`, `/roofing-intelligence`, `/showcase`, `/intake`) | ✅ | ♻️ | P3 | 5 | B2B go-to-market. Correctly separate. Leave alone. |
| **Admin ops** (`/admin/{prospects,outreach,runs}`) | ✅ | ♻️ | P3 | 20 | B2B founder GTM tooling. Leave alone. |
| **Personal Workspace** (`/personal`, `PersonalWorkspace`) | ✅ | 🔧 | P2 | 30 | B2B-shaped desk **hardwired to "Nicole Lonergan"** — wrong subject. Retarget to Dylan or delete. |
| **Simulation engine** (`lib/simulation/*`) | ✅ | ♻️ | P3 | 35 | Read-only synthetic pressure testing. Useful for QA, not daily use. |
| **`components/WelcomePage.jsx`** (580 lines) | 💤 | 🗑️ | P2 | — | **Orphan, 0 imports. Delete.** |
| **`components/public/ui/SectionCta.tsx`** | 💤 | 🗑️ | P2 | — | **Orphan, 0 imports. Delete.** |
| **`data/alerts.json`** ("watches/Rolex" vertical) | 💤 | 🗑️ | P2 | — | Residue from a *third, unrelated product.* Delete. |
| **`lib/modulePrompts.ts`** (roofing LLM prompt) | 💤 | 🗑️ | P2 | — | Unused prompt string, never sent. Delete. |
| **Empty stub stores** (`negotiation_state.json` `{}`, `pipelineJobHistory.json` `[]`, `reviews.json` `{}`) | 💤 | 🗑️ | P3 | — | Reserved-but-empty. Delete or document. |

---

## 4. Database Audit

### 4.1 The headline

**The advertised Postgres database is provisioned but not the active store.**
`getTruthStoreMode()` defaults to `"file"` because `MERIDIAN_TRUTH_STORE` is
unset. **~100% of live persistence is flat JSON** written via `safeWriteJson`
atomic rename. The two Postgres-mirror files the file adapters point at
(`data/executionOutcomes.json`, `data/domainEvents.json`) **do not exist on
disk** — the durable outcome/event ledger has never recorded anything in this
checkout.

### 4.2 Postgres tables (dormant)

| Table | Purpose | Status |
|---|---|---|
| `idempotency_keys` | Dedup guard for outcome writes | Dead in file mode |
| `execution_outcomes` (+ `execution_outcome_latest`) | Durable outcome ledger + latest projection | Dead in file mode |
| `company_current_state` | JSONB mirror of `companySnapshots.json` (stores whole snapshot twice) | Dead in file mode; only table with a real adapter |
| `domain_events` | Append-only event stream | Dead in file mode |

### 4.3 File-backed stores (the *actual* database)

| Store | File | Purpose | Status |
|---|---|---|---|
| Company snapshots | `data/companySnapshots.json` (~975 KB, 72 cos) | Per-company operational truth | ✅ Live (B2B core) |
| CRM activities | `data/crmActivities.json` | Outreach + calendar log | ✅ Live (B2B) |
| Raw company pool | `data/rawCompanies.json` (~68 KB) | Pre-filter ingestion pool | ✅ Live (B2B) |
| CRM contacts | `data/crm-contacts/<ws>.json` | Imported per-tenant contacts w/ `dataTrust` | ✅ Live (test-ws mixed in) |
| CRM import jobs / rollbacks | `data/crm-import-jobs/*`, `data/crmImportRollbacks/*` | Import state + undo snapshots | ✅ Live, sprawling (no TTL) |
| **AE-jobs opportunities** | `data/ae-jobs/opportunities.json` | **Career pipeline** | ⭐ Live (Command core) |
| **AE-jobs calendar** | `data/ae-jobs/calendar-events.json` | Interview/recruiter events | ⭐ Live (Command) |
| **Founder brief** | `data/founder-brief/*.md` | Morning narrative artifact | 🟡 Generated, **no code accessor** |
| **Weekly state** | `data/weekly-state/<ws>/<week>.json` | Weekly ROI rollup + activation email | 🟡 Generated, **no code accessor** |
| Recovery briefs | `data/recovery-briefs/<cust>/<week>.{json,html}` | Weekly recovery memos | ✅ Generated artifact |
| Execution outcomes / domain events (file) | `data/executionOutcomes.json`, `data/domainEvents.json` | Ledger mirrors | 🟥 **Referenced but absent — never written** |
| `data/alerts.json` | — | **"watches/Rolex" — foreign product residue** | 🗑️ Delete |
| Empty stubs | `negotiation_state.json`, `pipelineJobHistory.json`, `reviews.json` | Reserved | 🗑️ Delete/document |
| `generated/*` | exports, heartbeat, reports, snapshots | Runtime output dirs | Empty `.gitkeep` |

### 4.4 Core entity model & missing relationships

```
LEGACY B2B (join key = companyKey):
  RawCompany ──► CompanySnapshot ◄─mirror─ company_current_state (PG, off)
                      │
                      ├─ CrmActivity[]   (crmActivities.json)   ⚠ duplicates dealActions[]
                      └─ FollowUpTask[]  (followUps.json)
  CrmContactRecord ──workspaceId──► Workspace ◄── Tenant
        ⚠ crm-contacts and crmActivities are DISJOINT keyspaces (two disconnected CRMs)

PERSONAL OS (scoped by ownerId="dylan", NOT workspace):
  JobOpportunity ──matchedOpportunityId──► CareerCalendarEvent
        │
        └──► CareerBriefModel (in-memory) ──► founder-brief/*.md
        ⚠ shares NO keys with the B2B estate — a clean island
```

**Critical integrity findings:**
- **CRM contacts ↔ activities ↔ snapshots are three disjoint keyspaces.** No FK
  enforcement (file mode); join keys are string-derived and can silently
  mismatch.
- **`dealActions[]` duplicates `CrmActivity[]`** by design ("backward
  compatibility") → dual write paths, drift risk.
- **`company_current_state` stores each snapshot twice** (decomposed columns +
  full JSONB blob).
- **No schema versioning** on `companySnapshots.json`, `crmActivities.json`,
  `knowledge.json` (only ae-jobs / weekly-state / calendar carry `version`).

### 4.5 Storage verdict & durability risk

**This is a local-dev/demo persistence architecture masquerading as
production.** It works on a single long-lived Node process; it is **not durable
on Vercel serverless**:

1. **Read-only FS.** All stores write under `process.cwd()/data/`. On Vercel the
   bundle FS is read-only; `safeWriteJson` **swallows the error and returns
   `false`** — reads return committed seed data, **all writes are silently
   lost.** Only `crm-import` has a `/tmp` fallback (ephemeral across cold starts).
2. **No cross-instance concurrency safety.** In-process `writeQueue` is useless
   across serverless instances; concurrent Lambdas clobber whole-file writes.
3. **O(n) whole-file rewrites.** `companySnapshots.json` is ~975 KB and rewritten
   in full on every mutation.
4. **The one durable path (Postgres) is switched off** and its file mirrors don't
   exist.

### 4.6 Data already ready for Meridian Command

The morning-surface thesis is *already backed by real data*: `JobOpportunity[]`
(stage, priority, next action, 9-item checklist), `CareerCalendarEvent[]`
(typed, with reminders), `founder-brief/latest.md`, and `weekly-state`
(`outcomeRollup`, `priorities[]`, `resurfacedRelationship`, ready-to-send
`activationEmail`). **What's missing is a single unified read model joining
them** — today they live in disjoint keyspaces.

---

## 5. AI Audit

### 5.1 The defining fact

**There is no live AI in this codebase.** A global search for `api.anthropic.com`,
`messages.create`, `@ai-sdk`, `generateText`, `openai` across `lib/` and `app/`
returns **nothing**. Every "engine," "intelligence," "AI," and "decision" module
is deterministic rule logic. `ANTHROPIC_API_KEY` is documented but read by zero
files. A removed `/api/ai/chat` endpoint (still referenced in
`.claude/settings.local.json`) confirms an AI-chat feature was built and deleted.

**The intended AI architecture is external and agent-driven:** a Claude session
(you, in Claude Code / Cursor) drives Meridian through the **MCP tool surface**
and POSTs parsed results back (e.g. AE-jobs `parsedBy: "claude-gmail"`). This is
philosophically correct — it keeps the *product* deterministic and explainable
while letting an agent do the fuzzy work at the edges.

### 5.2 AI/decision capability inventory

| Capability | File | Verdict | Maps to "what do I do today?" |
|---|---|---|---|
| **Career-brief builder** | `lib/ae-jobs/career-brief.ts` | ⭐ **Reuse — core** | **The daily command center itself** |
| Lead decision engine | `lib/scoring/decision.ts` | ♻️ Reuse (retarget) | Ranks *who* to contact |
| Company scoring | `lib/scoring/companyDecision.ts` | ♻️ Reuse | Revenue-opportunity sizing |
| Closeability model | `lib/scoring/closeability.ts` | ♻️ Reuse | Priority axis inputs |
| Recovery decision scorer | `lib/recovery/decisionScore.ts` | ♻️ Reuse | Which dormant relationships to revisit |
| whyNow generator | `lib/recovery/whyNow.ts` | ♻️ Reuse | Explains *why* an item surfaced now |
| Insight engine | `lib/calendar/insightEngine.ts` | ♻️ Reuse | "What changed / what to watch" |
| Workflow engine | `lib/calendar/workflowEngine.ts` | ♻️ Reuse | Re-ranks today's actions |
| Pattern/outcome learning | `lib/calendar/{patternLearning,outcomeLearning}.ts` | ♻️ Reuse | Learns what converts (frequentist, not ML) |
| Resurfacing engine | `lib/relationship-intelligence/resurfacing.ts` | ♻️ Reuse | Which relationships deserve attention |
| Relationship-intelligence score | `lib/relationship-engine/scoring/*` | 🔧 Future | Shadow/not-production health scoring |
| MCP tool set (32) | `lib/mcp/tools/*` | 🔧 Refactor | Agent plumbing; wrong domain (company/lead CRM) |
| Simulation engine | `lib/simulation/*` | ♻️ QA-only | Forecasting/testing |
| LaborTech scan / intelligence | `lib/scan/*`, `lib/intelligence/*` | 🔧 Rewrite | Roofing-specific; some code disabled ("EMERGENCY ROLLBACK") |
| `modulePrompts.ts` roofing prompt | `lib/modulePrompts.ts` | 🗑️ **Delete** | Dead unused prompt |
| Heartbeat brief reader | `lib/heartbeat/briefReader.ts` | ♻️ Reuse | Reads a brief nothing writes (generator missing) |

### 5.3 Decision-engine analysis — the four fragmented briefs

There are **four working "daily brief" surfaces that must become one:**

- **(A) Career Brief** — `lib/ae-jobs/career-brief.ts`. **Live, the real command
  center.** Deterministic composite ranking
  (`priorityScore*100 + STAGE_RANK*10 + dueScore*5 + actionableScore`). Scoped to
  the job search.
- **(B) Heartbeat Brief** — `lib/heartbeat/briefReader.ts`. **Best taxonomy**
  (CEO Decisions / What Changed / What Needs Dylan / Not Covered Yet) but the
  markdown generator is **not in the repo.**
- **(C) Recovery Brief** — `lib/recovery/*`. Offline weekly HTML memo of dormant
  relationships worth revisiting.
- **(D) LaborTech Daily Pipeline** — `lib/pipeline/dailyJob.ts`. The B2B cron
  engine (ingest → score → rank). The original Meridian.

**All four rank deterministically over observable signals — no ML, no black
box.** This is exactly the philosophy's mandate and exactly what Meridian
Command needs. The work is *unification*, not invention.

### 5.4 The AI north star for Command

Keep the deterministic core. Use an **external Claude agent over MCP** for the
fuzzy edges only: parsing inbound email/calendar into structured items, drafting
outreach, and narrating the brief. Never let the agent *decide priority* — the
deterministic engine does that, and it must remain explainable
("Deterministic counts only — no AI scoring," as Career Brief already prints).

---

## 6. Technical Debt Report

### HIGH (fix before trusting Command daily)

1. **Plaintext tenant passwords** (`config/tenants.ts`, `passwordsMatch()`) on a
   Vercel *production* deploy. Session cookie's only validity check is "has 3
   dot-separated parts." → Hash credentials; verify cookie signature.
2. **Serverless persistence illusion.** All `data/` writes silently fail on
   Vercel (read-only FS; `safeWriteJson` swallows errors). **Command cannot be
   trusted with daily data until this is fixed** — activate Postgres or move
   Command's stores to Neon/Blob.
3. **Public briefs by obscurity.** `proxy.ts` makes `/brief/*` fully public;
   access control is the unguessability of the slug, not auth.
4. **Live secrets in plaintext `.env.local`** (real Hunter key, live Neon URL,
   Vercel OIDC JWT, weak known `SESSION_SECRET=local-dev-session-secret-32chars`).
   Not committed (good) but a compromised laptop = prod DB. Rotate; ensure prod
   `SESSION_SECRET` ≠ the dev literal.
5. **Three API routes with no auth guard** — `internal/relationship-engine/*`,
   `integrations/hunter/find-email`, `outcomes/list`. Low risk today; close them.

### MEDIUM

6. **`check_paid_presence` scrapes an undocumented Google RPC**
   (`/anji/_/rpc/SearchService/SearchCreatives`) — brittle; well-guarded but will
   break. Also not wired to scoring (per `MEMORY.md`).
7. **Dead `/api/ai/chat`** referenced in `.claude/settings.local.json`; orphaned
   `ANTHROPIC_API_KEY` slot. Prune.
8. **In-process cron is dead on serverless** (`lib/pipeline/cron.ts` `setInterval`);
   `/api/pipeline/daily` has no caller; **no `vercel.json`/`vercel.ts` → no Vercel
   Cron.** The heartbeat runs only in GitHub Actions and delivers to a CI artifact,
   **not to you.**
9. **`.env.example` omits ~16 real env vars** including `DATABASE_URL` and all
   `PIPELINE_*`/`MERIDIAN_*` keys. Onboarding/ops gap.
10. **Two parallel product visions in one tree** = ongoing maintenance drag. The
    entire B2B relationship-engine (8 `check-relationship-engine-*` scripts, 59
    `lib/relationship-engine/**` files) is deferred by the heartbeat manifest
    ("12 deferred") yet still carried.
11. **Duplicate Hunter adapters** — `lib/integrations/hunter.ts` (296 lines) and
    `lib/contacts/sources/hunter.ts` (126 lines). Confirm one is dead; delete it.
12. **Duplicate write paths** — `dealActions[]` vs `CrmActivity[]`; drift risk.

### LOW

13. Orphaned components: `components/WelcomePage.jsx` (580 lines),
    `components/public/ui/SectionCta.tsx` — delete.
14. Foreign residue: `data/alerts.json` ("watches/Rolex"); empty stub stores.
15. `archive/` convention exists but is empty/unused.
16. `README.md` is untouched `create-next-app` boilerplate (real docs in `docs/`).
17. `google-places-test` route self-labels "Temporary test endpoint" but ships in
    prod.
18. `@deprecated` cruft in `lib/ae-jobs/ingestion.ts`, `lib/scheduling/leadSchedule.ts`,
    `lib/recovery/staleness.ts`.
19. `.claude/settings.local.json` allowlist bloat (~130 accreted rules).

---

## 7. UX Audit

### 7.1 The shape of the frontend

**Mid-pivot and physically split down the middle, with no shared app shell.**
`app/layout.tsx` injects only fonts + `SessionProvider`. Every surface is an
independent full-page `<main>` with its own hand-rolled header. Navigation is a
handful of hardcoded `<Link>`s plus `/workspace-select` (the real routing hub).
**The founder `dylan` is hardcoded to land on `/operator/jobs/brief`** after
login (`lib/auth/postLoginRouting.ts:14-20`).

### 7.2 Surface verdicts

| Surface | Align | Verdict |
|---|---:|---|
| **Career Brief** (`/operator/jobs/brief`) | 78 | **Useful → grow into THE command center** |
| AE Job OS (`/operator/jobs`) | 70 | Useful — keep as pipeline drill-down |
| Heartbeat (`/heartbeat`) | 45 | **Needs-Merge** — fold its taxonomy into Career Brief; kill the empty page |
| Personal Workspace (`/personal`) | 30 | **Needs-Refactor** — retarget from "Nicole" to Dylan, or delete |
| LaborTech Console (`/operator`) | 15 | **Needs-Refactor/carve up** — mine `CalendarCommandCenter`; keep as separate B2B product |
| Relationship-priority desk | 35 | Useful (B2B) — expose engine via API, not its UI |
| Public site / showcase / intake | 5 | Useful (B2B) — leave alone |
| Admin (prospects/outreach/runs) | 20 | Useful (B2B ops) — leave alone |
| `WelcomePage.jsx`, `SectionCta.tsx` | — | **Delete (orphans)** |

### 7.3 The single UX finding

**`components/operator/CareerBrief.tsx` is already the "every-morning command
center."** It renders a Morning Brief hero (active / needs-Dylan / waiting-on /
upcoming), an **"Execute now"** table with live Mark-done / Snooze / Log-touch
handlers, career momentum, and a top-opportunities ranking — and it prints
"Deterministic counts only — no AI scoring," matching the philosophy's tone
exactly. It is missing only: (a) breadth beyond job-hunting, (b) data-driven
quick actions (currently hardcoded to Clipboard/SafetyCulture/Ronco in
`career-brief.ts:433`), and (c) bridges to the recovery/resurfacing/calendar
engines. **Promote it to the canonical Command shell; demote `/heartbeat` and
`/personal` into it.**

---

## 8. Reuse Plan

> Reuse first. Refactor second. Rebuild last. This section is the proof that
> almost nothing needs rebuilding.

### 8.1 What you already own (and it works)

- A **deterministic morning-brief engine** (`ae-jobs/career-brief.ts`) that
  already answers all six Command questions for one domain.
- A **library of deterministic ranking engines** (scoring, recovery, resurfacing,
  insight, workflow, learning) — the exact "priority/ROI/why-now" logic Command
  needs, just pointed at trades instead of you.
- A **calendar model with reminders and opportunity linkage**
  (`CareerCalendarEvent`) — the meetings pillar.
- A **32-tool MCP surface + HTTP transport** — a ready foundation for an agent to
  drive Command.
- A **graceful-degradation integration layer** (Places/Yelp/Hunter/Meta) — real,
  wired, and honest.
- A **code-complete Postgres schema + dual-write adapters** — the durability fix
  is already built; it just needs to be switched on.
- **Real morning data** (opportunities, calendar, founder-brief, weekly-state).

### 8.2 What becomes Meridian Command immediately

`CareerBrief` (UI) + `career-brief.ts` (engine) + `ae-jobs` stores +
`calendar-sync`, generalized from `JobOpportunity` → a unified **`AttentionItem`**.

### 8.3 What should remain unchanged (keep as the separate B2B product)

Public marketing site, LaborTech operator console, relationship-priority desk,
admin ops, the daily pipeline, CRM import. These are a *real product* reachable
from `/workspace-select`. Do not delete them; just stop treating them as the
center of gravity.

### 8.4 What should move / become modules / become private-vs-public

- **Move:** the reusable engines (`scoring`, `recovery`, `resurfacing`,
  `calendar/insight`) behind a single `lib/command/` read model that Career Brief
  consumes.
- **Private (Command):** everything under `ae-jobs`/`command`, founder-brief,
  weekly-state, heartbeat — Dylan-only, `ownerId`-scoped, behind auth.
- **Public (B2B):** the marketing site, `/brief/*` (currently public-by-slug —
  keep public but add real auth or accept the tradeoff explicitly).

---

## 9. Module Plan

Reorganize *conceptually* (not necessarily a big folder move) into two clean
products sharing one engine core:

```
lib/command/            ← NEW thin layer (mostly re-exports; ~little new code)
  attentionModel.ts     ← generalize JobOpportunity → AttentionItem
  dailyReadModel.ts     ← joins ae-jobs + recovery + resurfacing + calendar
  briefBuilder.ts       ← re-uses buildCareerBriefModel() logic, domain-agnostic

CORE ENGINES (already exist — reused as-is, retargeted by data, not rewritten):
  lib/scoring/*                    (ranking)
  lib/recovery/*                   (dormant relationships)
  lib/relationship-intelligence/*  (resurfacing buckets)
  lib/calendar/{insight,workflow,learning}  (insights + calibration)
  lib/ae-jobs/*                    (pipeline + calendar + brief)

B2B PRODUCT (unchanged, separately navigated):
  lib/pipeline/*, lib/scan/*, lib/intelligence/*, OperatorConsole.jsx,
  public marketing, admin, relationship-priority

AGENT SURFACE:
  lib/mcp/*  + NEW founder-action tools (mark-done, snooze, log-touch,
             draft-outreach, schedule-meeting) alongside the 32 CRM tools

SKELETON (quarantine, don't extend):
  lib/relationship-engine/*  ← label clearly "read-only skeleton, empty data"
```

**Rule:** the two products share the engine core but not the surfaces. Command is
private and `ownerId`-scoped. B2B is tenant-scoped. Neither imports the other's
UI.

---

## 10. Migration Plan

The smallest architectural evolution that turns today's code into Meridian
Command. **No rebuild.** Five moves, in order:

1. **Make persistence durable (unblocks everything).** Turn on Postgres for
   Command's stores: set `MERIDIAN_TRUTH_STORE`, run
   `scripts/backfill-phase1-neon.ts`, and route `ae-jobs`/`command` writes
   through Neon (or Vercel Blob). Until this ships, Command loses data on Vercel.
2. **Generalize the model, not the code.** Introduce `AttentionItem` as a superset
   of `JobOpportunity`; make `buildCareerBriefModel()` accept a list of attention
   items from multiple sources. `JobOpportunity` becomes one source.
3. **Wire the existing engines as sources.** Feed `recovery`, `resurfacing`, and
   `calendar/insight` outputs into the unified `dailyReadModel`. They already emit
   compatible ranked, explained items.
4. **Unify the four briefs into one.** Have the daily job write the Heartbeat
   taxonomy (`CEO Decisions / What Changed / What Needs Dylan / Not Covered Yet`)
   from the unified read model. Retire the empty `/heartbeat` page and fold
   `/personal` into Command.
5. **Schedule + deliver.** Add `vercel.json`/`vercel.ts` cron (or keep GitHub
   Actions) to run the daily job, and add a **delivery path** (email/push) —
   today the brief goes to a CI artifact you never see.

Each step is independently shippable and reversible. None require touching the
B2B product.

---

## 11. 90-Day Roadmap

### Days 1–30 — Foundation & Trust (make it real, make it safe)

- **P0** Fix serverless persistence: activate Postgres for Command stores; verify
  writes survive on Vercel. (Debt #2)
- **P0** Security pass: hash tenant passwords, verify cookie signatures, close the
  3 unguarded routes, rotate the live Hunter key + Neon creds, set a strong prod
  `SESSION_SECRET`. (Debt #1, #3, #4, #5)
- **P0** Delete the dead weight: `WelcomePage.jsx`, `SectionCta.tsx`,
  `modulePrompts.ts`, `data/alerts.json`, empty stub stores, dead `/api/ai/chat`
  references. Quarantine-label `lib/relationship-engine/`.
- **P1** Complete `.env.example`; write a real `README.md`.

### Days 31–60 — Unify the Command surface

- **P0** Introduce `AttentionItem` and `lib/command/dailyReadModel.ts`; make
  `buildCareerBriefModel()` domain-agnostic.
- **P0** Wire `recovery` + `resurfacing` + `calendar/insight` engines as sources.
- **P1** Merge Heartbeat taxonomy into Career Brief; retire `/heartbeat`; fold or
  delete `/personal`.
- **P1** Make quick actions data-driven (kill the hardcoded company list).
- **P1** Give Command a minimal shared app shell + nav (the only genuinely
  missing UI primitive).

### Days 61–90 — Schedule, deliver, and connect real signals

- **P0** Wire a scheduled daily job (Vercel Cron) + a real delivery channel
  (morning email/push).
- **P1** Connect real inbound signals via the external-agent pattern: Gmail →
  Claude parse → `/api/ae-jobs/ingest` (already built); real Google Calendar →
  `calendar/sync`.
- **P1** Add a founder-action MCP tool set so an agent can execute the brief.
- **P2** Load your real contacts/companies (CRM import already works) so
  recovery/resurfacing operate on *your* network.

---

## 12. What I Should Build First

**One thing:** the unified `lib/command/dailyReadModel.ts` + `AttentionItem`
generalization, plus turning on durable persistence. This is the keystone —
everything else (delivery, more sources, agent actions) hangs off it, and it
reuses `buildCareerBriefModel()` almost verbatim.

Do **not** start with new UI, a new AI integration, or the relationship-engine.
Start by making the brief you already have (a) durable and (b) able to accept
more than one kind of item.

---

## 13. What I Should Never Build Again

- **A second dashboard / operating surface.** You have five briefs already.
  Never add a sixth; unify. Every new surface is a tax.
- **Black-box or ML scoring.** The deterministic, explainable core is the moat
  and the philosophy. Never replace it with a model that can't show its work.
- **An autonomous agent that acts without you.** Command ranks and explains; you
  decide. The AI drives *tools* and *parsing*, never *priority*.
- **File-based "databases" for anything you need to trust.** The JSON stores are
  a demo pattern. Never add another `data/*.json` write path for durable state —
  use Postgres/Blob.
- **A big speculative architecture ahead of a live use case.** The 59-file
  relationship-engine returns `[]`. Never again build that much surface area
  before there is data flowing through it.
- **A third product domain in the same tree** (cf. the "watches/Rolex" residue).
  Command and the B2B product are already one too many to carry casually.
- **Hardcoded personalization** (the Nicole workspace, the Clipboard/SafetyCulture
  quick actions). Data-drive it or don't ship it.

---

## 14. Vision Alignment Scoreboard

Consolidated 0–100 alignment to **Meridian Command**. Anything **< 60** carries a
reason.

| Module / Feature | Align | If < 60, why |
|---|---:|---|
| `lib/ae-jobs/*` (career brief, calendar, store) | 92 | — |
| Career calendar sync | 88 | — |
| Heartbeat taxonomy (`briefReader.ts`) | 85 | — (generator missing, but design is right) |
| AE email ingestion | 75 | — |
| Recovery engine (`lib/recovery/*`) | 74 | — |
| Calendar insight/workflow/learning | 70 | — |
| AE Job OS surface | 70 | — |
| Resurfacing (`relationship-intelligence`) | 68 | — |
| Scoring core (`lib/scoring/*`) | 62 | — |
| CRM import | 60 | — |
| **MCP tool surface** | **58** | Great plumbing, wrong domain — all 32 tools operate on company/lead CRM, none on the founder's actions/calendar/revenue. |
| **Company snapshots + contacts** | **55** | The substrate is reusable but hardwired to trade businesses; needs retargeting to your target companies. |
| **Relationship Engine (59 files)** | **45** | Read-only skeleton returning `[]`; all mutations throw. High future value, near-zero current value; risk of a maintenance sink. |
| **Relationship-priority desk (UI)** | **35** | B2B tenant-facing screen; only its engine is relevant to Command. |
| **Simulation engine** | **35** | Read-only synthetic forecasting; QA/testing, not a daily-decision surface. |
| **Personal Workspace (`/personal`)** | **30** | B2B-shaped desk hardwired to "Nicole Lonergan" — wrong subject entirely. |
| **LaborTech Daily Pipeline** | **30** | The B2B revenue engine; correct for that product, orthogonal to Command. |
| **LaborTech Console (`OperatorConsole.jsx`)** | **15** | 13k+ lines of roofing/HVAC sales-floor ops; it is "an AI running a *business*," the opposite of a personal OS. |
| **`lib/scan/*`, `lib/intelligence/*`** | **30** | Roofing pitch generation; some paths disabled ("EMERGENCY ROLLBACK"). Off-vision. |
| **Public marketing / showcase / intake** | **5** | B2B go-to-market; correctly separate from a personal OS. |
| **Admin ops** | **20** | B2B GTM tooling; not a personal life OS. |
| `modulePrompts.ts` roofing prompt | 0 | Dead, unused, never sent. Delete. |
| `data/alerts.json` ("watches") | 0 | Residue from an unrelated product. Delete. |

---

## 15. Amendment Log

| Date | Author | Change |
|------|--------|--------|
| 2026-07-06 | CTO (audit) | Initial constitution. Established Meridian Command = a deterministic personal decision-support OS; identified `lib/ae-jobs/career-brief.ts` as the existing command-center seed; mandated reuse-over-rebuild, durable persistence before daily trust, and unification of the five briefs. |

---

> **Reminder for every future PR, feature, and agent:** open this file, find the
> governing question at the top, and answer it honestly. If the change doesn't
> move Meridian closer to being your calm, explainable, every-morning personal
> operating system — it's the wrong change.
