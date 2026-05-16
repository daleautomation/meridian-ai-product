# Product Principles

How Meridian decides what to build. Derived from `meridian-philosophy.md`.

---

## The five acceptance questions

Every PR, every product proposal, every roadmap entry must answer **yes** to all five:

1. **Does this increase operator trust?**
2. **Does this remain explainable to the operator and the customer?**
3. **Does this improve commercial prioritization?**
4. **Does this reduce operator noise (not add to it)?**
5. **Does this avoid AI theater?**

If any answer is no — or unclear — the proposal is rejected, deferred, or rescoped until all five are yes.

---

## Build / don't build matrix

### Build

- A weekly Recovery Brief that surfaces dormant accounts worth revisiting
- A founder-curated calibration file per customer (deterministic weights, ≤5 dimensions)
- Read-only CSV ingestion
- Verified contact resolution from public sources, with evidence
- Explainable "why now" lines anchored on observable signals
- Suggested openers that quote a real prior thread or fall back honestly
- Manual outreach support (mailto, dial-tap, copy-paste)
- Internal admin tooling for the founder to QA briefs (`/admin/runs`, etc.)

### Don't build (now or ever, unless this doc is amended)

- Autonomous outreach (auto-send, auto-reply, scheduled drips)
- Predictive scoring backed by ML
- A CRM replacement workflow (lead management, deal pipeline, full activity log as primary surface)
- Workflow orchestration (multi-step automations, branching workflows)
- Enterprise dashboards (large metric grids, KPI walls, "intelligence dashboards")
- Real-time CRM write access
- Multi-seat / team features before a paying customer has explicitly asked twice
- Any feature whose value depends on operator-invisible behavior

### Defer (build when pulled, not pushed)

- HubSpot / Pipedrive / Salesforce read-only sync (build when 3 customers request the same one)
- Multi-user workspace (build when a paying customer has explicit need for a second seat)
- Vertical-specific calibration packs (build when 5 customers in the same vertical exist)
- Self-serve onboarding (build after the founder-delivered model has 6+ paying customers)
- Public agent API on the MCP surface (build after the brief workflow has 60 days of internal stability)

---

## Scope discipline

A proposal that satisfies the five acceptance questions but expands scope is still a candidate for rejection. The bar:

- A feature must serve the **one governing question**: *"Does this help businesses focus attention on the relationships most connected to commercial opportunity in a calm, trustworthy, explainable way?"*
- A feature that serves a different question, however good, belongs to a different product. Reject it or note it as a future-product idea.

---

## Reversibility preference

When in doubt, choose the reversible option:
- A feature behind a flag > a feature shipped to all customers
- A founder-edited config file > a customer-facing settings page
- A single deterministic rule > a layered configuration system
- A markdown note in `docs/` > a database schema
- A read path > a write path

Reversible decisions buy back agency. Irreversible decisions burn it.

---

## Customer feedback handling

When a customer asks for a feature:

1. **Acknowledge** — "Thanks, that's a good observation."
2. **Probe** — "What specifically would that solve for you?"
3. **Document** — write it in `customer-feedback.md` in front of them.
4. **Defer** — "I'll think on it."
5. **Trigger** — build only when at least **two** other customers have asked for the same thing, or when the founder has independently concluded it's load-bearing.

Never commit on the call. Never ship a single-customer custom build.

---

## Anti-drift rules

These are the failure modes most likely to surface; resist them explicitly.

| Drift toward | Looks like | Why it's banned |
|---|---|---|
| AI theater | "powered by AI", "intelligent recommendations", chat surfaces, model-name mentions | Misaligns with the no-fabrication promise; sets wrong expectations |
| CRM replacement | A "deals" tab, a pipeline board, contact records as the primary surface | Meridian is read-only on top of existing CRMs; replacement is a different product |
| Enterprise bloat | Multi-seat IAM, audit-log UIs, admin permission matrices, SSO setup pages | Wrong customer; wrong stage |
| Over-automation | Auto-send, scheduled outreach, autopilot mode | The brief is a memo; the operator acts |
| Orchestration complexity | Workflow builders, conditional automation, "if X then Y" surfaces | Meridian compresses workflow, doesn't author it |
| Black-box scoring | A number with no explanation; a model file we can't read | Every score must trace to an observable signal |

---

## Decision examples

To make the rules concrete:

**"Should we add a chat assistant to the operator screen?"** → No. Fails questions 2 (explainable), 4 (reduces noise), 5 (avoids AI theater).

**"Should we let customers edit their calibration weights in a settings UI?"** → No, for now. Inverts the founder-led promise. Build when ≥3 customers explicitly request self-service AND the founder has accumulated cross-customer pattern knowledge to inform a sensible default schema.

**"Should we add a leaderboard of best-performing operators?"** → No. Fails questions 1 (operator trust) and 5 (theater).

**"Should we let the brief include a Slack-out-button?"** → Defer. Fits the philosophy but expands distribution scope. Build when ≥2 customers say their team uses Slack as the primary channel.

**"Should we generate a why-now line when the CSV has no notes column?"** → Yes, with calmer language. Already in place via the dataQuality LOW tier.

**"Should we add HubSpot live sync?"** → Defer. Build when 3 customers request the same integration. Until then, CSV.
