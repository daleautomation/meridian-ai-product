# Meridian — No-Drift Rules

> Concrete anti-patterns. If an agent finds itself doing any item in this
> document, the agent must **stop, leave the work unmerged, and escalate**.
>
> This document lives below the Constitution and above all other docs in
> precedence. Conflicts with this document are bugs, not judgment calls.

---

## 1. Frozen surfaces (do not extend, do not redesign)

These surfaces are intentionally frozen. They still exist for demos, but no
agent may add features, refactor architecture, or improve their UX. If you
find yourself opening a frozen file with intent to add something, close the
file.

| Surface | Status |
| --- | --- |
| `components/OperatorConsole.jsx` | **Frozen** — no new features |
| `components/CalendarCommandCenter.jsx` | **Frozen** — no new features |
| `app/showcase/**` | **Frozen** — sales artifact |
| `app/roofing-intelligence/**` | **Frozen — scheduled sunset** |
| `app/operator/relationship-priority/**` | **Frozen** — duplicates the brief |
| `app/admin/runs`, `app/admin/prospects` | **Frozen** — collapse into founder-ops |
| `app/api/mcp/**` + `lib/mcp/tools/**` | **Frozen** — internal tooling |
| `app/api/relationship-engine/**` + `lib/relationship-engine/**` | **Frozen** — speculative platform |
| `app/demo/**` routes | **Frozen** — sales artifact |
| `lib/calendar/{market,global,team}Intelligence*` | **Frozen** — speculative platform |
| Multi-trade LaborTech (`hvac`, `plumbing`, `painting`, `electrical`, `carpentry`) | **Frozen** until 3 paying customers on roofing |

To un-freeze any item: requires a `[canon-amend]` PR and founder approval.

## 2. Banned features (do not build)

- Real-time anything (alerts, push, websockets, polling cadence < 24h)
- Notifications (email, SMS, push, in-app toast for "new lead")
- Daily emails (only weekly cadence)
- "Smart" automation (auto-send, auto-schedule, auto-assign)
- "AI" assistant chat / copilot / sales coach / deal coach
- Predictive ML models with opaque outputs
- A platform tier / marketplace / public API
- White-label / multi-tenant API
- Mobile app
- Slack / Teams / Discord integration
- Webhooks
- Workflow engines / rule builders
- A "command center" / "control room" / "ops dashboard"
- Charts / graphs / gauges
- KPI tiles, score gauges, status leaderboards
- Activity feeds, social-style timelines

## 3. Banned phrases (in customer-facing copy)

If any of these appear in a brief, a UI element, an email, or copy on a
public page, the PR is rejected.

- "AI suggests", "AI believes", "AI recommends", "AI predicts"
- "Likely to close", "Likely to buy", "Likely to sell"
- "Smart score", "Intelligent score", "Confidence score" (use the explicit
  HIGH/MED/WEAK label instead)
- "Magic", "magical", "delight", "delightful"
- "Game-changing", "revolutionary", "10x", "growth hacking"
- "Autonomous", "agentic", "self-driving"
- "AI-powered", "AI-driven", "AI-enabled"
- "Recommended for you", "Curated for you"
- "Hot lead", "warm lead", "cold lead" (use timing + signal language)

Prefer instead:
- "Recently active", "Dormant", "Resurfacing"
- "Last touched N days ago"
- "Permit pulled Mar 12 · county record #..."
- "Weak signal — judgment call"
- "Verified contact path"

(See `docs/copywriting-principles.md` for the canonical list.)

## 4. Banned data sources

Sources in this list may not enter the signal pipeline. They cannot appear
on a brief card. They cannot be cited as a "why now" reason.

- Any vendor "predicted likelihood to convert / sell / buy" score
- LinkedIn job-change feeds for residential brokerage cards
- Apollo, Clearbit, ZoomInfo firmographics for sub-$5M trade companies
- Bombora, 6sense, G2, or any "intent vendor" black-box output
- Social media sentiment scores
- Any signal labeled "proprietary intelligence" with no record-level paper trail
- Any internal ML model output without a record-level provenance trail

(See `autonomy/SIGNAL_TRUST_RULES.md` for the full taxonomy.)

## 5. Banned patterns (architecture)

- **Autonomous writes to a customer's CRM.** Read-only ingestion only.
- **Auto-send emails, SMS, calls.** The operator sends. Always.
- **Background jobs that mutate user-visible data without operator action.**
- **Hidden weight multipliers, "tier bonuses", "uplift factors".** Every weight
  is named and visible.
- **Random / stochastic scoring.** Same inputs → same outputs, always.
- **Time-of-day variance, A/B variants in scoring, geo-randomization.**
- **In-place edits to recorded outcomes.** Continuity memory is append-only.
- **Cross-workspace data leaks.** A brief for customer A never references
  customer B's records.

## 6. Banned changes without explicit approval

These are out of bounds even with a PR. Founder must approve in writing
(commit co-author, GitHub comment, or doc amendment).

- Auth / session / cookie / tenant boundary changes
- Pricing / billing / payment integration changes
- Workspace credential or `config/tenants.ts` / `config/workspaces.ts` changes
- Schema changes to recorded outcomes (`lib/recovery/outcomes/types.ts`)
- Direct commits to `main` (use PR)
- Force pushes
- Deletion of historical artifacts (use freeze + archive instead)
- Renaming the canonical session cookie or its flags

## 7. Tripwires — if you find yourself…

| You catch yourself… | Stop. Do this instead. |
| --- | --- |
| Writing "AI suggests…" in a brief card | Replace with the named signal + observedAt |
| Adding a chart to summarize outcomes | Replace with a one-line deterministic count |
| Building a notification system | Replace with the weekly brief's "what changed since last week" line |
| Adding a vendor for "intent data" | Reject. Cite an alternative public-record source. |
| Polling a CRM in real time | Use the weekly ingestion cycle |
| Renaming a workspace surface to "command center" | Stop. Read the Constitution §2. |
| Building a "smart" rule engine | Stop. Use the explicit weighting config. |
| Setting `Cache-Control: max-age` on an auth surface | Use `applyAuthNoStoreHeaders` |
| Auto-deleting outcome records | Stop. Outcome history is append-only. |

## 8. Escalation

When in doubt:

1. Re-read `autonomy/PRODUCT_CONSTITUTION.md` §8 (the single governing question).
2. If still in doubt, leave the work unmerged and write a comment on the
   relevant PR or issue describing the ambiguity.
3. **Refuse and ask.** It is always better to wait than to drift.

Refusal does not require apology. Drift requires rework.
