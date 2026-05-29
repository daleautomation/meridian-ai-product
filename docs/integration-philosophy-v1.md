# Meridian Integration Philosophy v1

> Strategic correction issued 2026-05-27. Meridian is an **intelligence
> layer across existing real estate systems**, not a CRM/MLS/transaction
> replacement. Locks in integration-first architecture before scope
> drifts toward becoming "another tool agents have to learn."

---

## The Core Realization

A residential real estate agent in 2026 already lives inside:

- **A CRM** they trust (Wise Agent for veterans, Follow Up Boss for newer agents, Boomtown for teams)
- **MLS systems** they pay for (Heartland MLS in KC, BrightMLS, CRMLS, etc.)
- **Transaction management** they trust (Dotloop, dotloop's competitors, Skyslope)
- **Zillow / Realtor.com** for lead intake + listing presence
- **Gmail** for everything else
- **Google Calendar** for showings and meetings
- **Spreadsheets** for ad-hoc tracking
- **County recorder portals** for ownership lookups (when they bother)

These tools each have an institutional moat:
- Brokerages mandate them
- Friends + agent groups use them
- The agent has 2–10 years of muscle memory in them
- Their existing pipeline is parked inside them

**Meridian does not displace any of this.** The integration battle is not winnable — replacing a CRM the agent already pays $99/mo for would cost more switching effort than Meridian's whole price point.

The opportunity is the gap **between** these tools: the agent currently lacks any system that ties CRM identity to MLS market events to ownership history to actual recent communication to operator memory. Today the only system doing that mental glue is the agent's brain, weekly, badly.

**Meridian is the glue layer.** Not the CRM. Not the MLS. Not the transaction system. The thing that says "your CRM has this contact tagged Seller; the MLS shows their address is now listed by another agent; county records show they've owned 12 years; you last talked to them 14 months ago — call this Tuesday."

---

## The Integration Philosophy

Four rules govern every integration decision:

### 1. Ingest, don't replace

If integrating a system creates pressure to replace it, abandon the integration. Operators will not migrate. Meridian's value depends on the agent keeping their existing tooling and Meridian sitting beside it.

### 2. The CSV is the MVP integration

For every system in scope, the first integration is a CSV the founder hand-ingests. If the integration produces visible weekly-brief value over 2–3 weeks, graduate it to a webhook or API. If not, kill it before sinking engineering hours. CSVs cost zero infrastructure; webhooks cost real engineering.

### 3. Identity resolution is the moat

The same person appears in CRM as `"Greg"`, in Gmail as `gregsmith@gmail.com`, in MLS as the listing party on `4321 Main St`, in county records as `Smith, Gregory A`, on Dotloop as a deal-counterparty named `Greg Smith` from 2022. Meridian's unique value is the deterministic, provenance-preserving link across these representations. Every integration must contribute to identity resolution, not multiply identity fragmentation.

### 4. Operator continuity is the intelligence dimension no integration replicates

Even after every integration above, the system still doesn't know what the operator decided. Outcome capture (Sprint 2 work) is the irreplaceable layer because it lives inside Meridian's reasoning, not in any external system. Operator memory is the part of the moat that compounds.

---

## System-by-System Analysis

### Dotloop — Transaction Management

| Dimension | Notes |
|---|---|
| What real-world signals matter | Active deals (don't bother these contacts for outreach); deal status (under contract / closed / fell through); close dates (anniversary timing); deal counterparties (the OTHER agent + buyer + seller on prior deals — Nicole's actual sphere) |
| What Meridian uniquely does with them | Excludes active-deal contacts from priority lists; flips closed-deal anniversaries into resurfacing opportunities; identifies counterparty agents as adjacent-sphere contacts worth tagging |
| Integration types available | OAuth API (requires broker approval; documented but gated); CSV export of transaction history (operator-runnable) |
| Realistic v1 path | **CSV export of closed transactions, founder-ingested.** Same pattern as MLS CSV. Dotloop transactions are sparse per agent (~12-30/yr) so the CSV is small. |
| Defer | API integration. Wait until ≥ 3 paying customers want it. |
| Trap | Building a "deal pipeline" view inside Meridian. That's transaction-management territory; you can't compete on UI there. Surface deal status only as evidence on existing cards. |

### Zillow — Lead Source + Listings + Property Reference

| Dimension | Notes |
|---|---|
| What real-world signals matter | Inbound buyer/seller leads (often poorly qualified); Zillow Zestimate (proprietary, useful as a context point, not authoritative); listing presence (the agent's listings on Zillow) |
| What Meridian uniquely does with them | Surface stale/cold Zillow leads worth re-engaging; show "Zillow shows this contact's home value has moved X%" as evidence (when sourced); identify which leads converted vs dropped |
| Integration types available | Zillow Premier Agent has a tightly-restricted partner API; CSV export of leads from Zillow dashboards exists but is manual; **email parsing** of "[Zillow] New Lead" emails is the cleanest path |
| Realistic v1 path | **Gmail-forwarded lead emails to a dedicated Meridian inbox.** Founder configures a Gmail filter; operator forwards or auto-forwards Zillow lead emails to `leads-<workspace>@<meridian-domain>`. Parser extracts contact + property + interest. |
| Defer | Direct Zillow API. Too gated, too expensive, too ToS-restrictive. |
| Trap | Replicating Zillow listing UI. They own that experience; don't try to add property thumbnails or maps. |

### Follow Up Boss — Modern CRM

| Dimension | Notes |
|---|---|
| What real-world signals matter | Contact rows + tags + lead source + last activity timestamp + action-plan status |
| What Meridian uniquely does with them | Treats FUB as the upstream identity layer; reads last-activity timestamps that are FRESHER than what's in the operator's memory; identifies contacts in active drip campaigns to avoid duplicate outreach |
| Integration types available | Public REST API + webhooks ($50–$100/mo plan-dependent); CSV export robust and free |
| Realistic v1 path | **CSV export, founder-ingested.** Same pipeline as Wise Agent. |
| Defer | API integration until ≥ 2 paying FUB-based customers and stable weekly cadence. Then graduate. |
| Trap | Trying to write back to FUB ("Meridian updated this contact's tags"). One-way ingestion only in v1. Bidirectional sync is a forever-bug machine. |

### Wise Agent — Veteran CRM (Nicole's system)

| Dimension | Notes |
|---|---|
| What real-world signals matter | Same shape as FUB (contacts, tags, notes, last interaction, lead source) but older data model — more text-heavy notes, less structured tagging, automation residue dominates the notes field |
| What Meridian uniquely does with them | Same as FUB. Plus: surfaces the "automation residue" problem visibly so the operator sees how much of their notes are actually generic campaign exports (Sprint 4 audit work). |
| Integration types available | API exists but is sparsely documented; CSV export is robust |
| Realistic v1 path | **CSV. Already shipped.** Nicole's pipeline runs on this today. |
| Defer | API integration. Wise Agent customers are typically older and more comfortable with CSVs anyway. |
| Trap | None new — Wise Agent is the path already proven |

### Gmail — Communication Hub

| Dimension | Notes |
|---|---|
| What real-world signals matter | **Enormous.** Actual last-contact dates per person (always fresher than CRM); inbound interest signals; forwarded Zillow leads; MLS listing-alert emails; Dotloop status emails; calendar invites for showings; transaction emails from title companies |
| What Meridian uniquely does with them | Replace stale CRM last-touch with real Gmail-derived last-touch; detect "this contact emailed you 6 days ago about a Brookside property" → automatic context for Monday brief |
| Integration types available | Gmail API via Google OAuth (read-only `gmail.readonly` scope). Real engineering, real OAuth flow, real privacy considerations. Alternative: forwarded-emails-to-a-dedicated-inbox pattern (no OAuth, no per-customer scope grant). |
| Realistic v1 path | **Phase 1: forwarded-email parser only.** Operator forwards Zillow leads + Dotloop notifications + MLS alerts to a dedicated inbox per workspace. Parser extracts structured signals deterministically. **Phase 2 (v2): OAuth + read-only Gmail API integration** for last-touch detection across the entire inbox. |
| Defer | Full Gmail OAuth integration. The yield is real but the engineering cost is real too — 2-3 weeks for OAuth + signal extraction + privacy-compliant storage. Pay for this only after 3+ paying customers want it. |
| Trap | Treating Gmail as a CRM replacement ("we'll show you your inbox here"). The integration value is signal extraction, not UI replication. |

### Google Calendar — Showings + Meetings

| Dimension | Notes |
|---|---|
| What real-world signals matter | Showings (which address, which buyer); listing appointments (which seller, which property); buyer/seller consultations |
| What Meridian uniquely does with them | "You met with X last week at Y address" → automatic context chip on next Monday's card |
| Integration types available | Google Calendar API via OAuth. Same engineering cost as Gmail. |
| Realistic v1 path | **Defer.** Lower per-contact yield than Gmail. A showing at 4321 Main St is useful, but the inbox signal `client@email.com replied yesterday about 4321 Main` is more useful. |
| Defer | All Calendar integration until Gmail Phase 2 is shipped and stable. |
| Trap | Building a calendar view in Meridian. Operators have Google Calendar. They don't want another. |

### MLS — Market Activity Layer (Heartland MLS for KC)

| Dimension | Notes |
|---|---|
| What real-world signals matter | Active listings (who currently has property on the market); listing agent attribution (Nicole vs other agents); recent sales (sold within 90 days); withdrawn / expired listings (potential re-list); price changes |
| What Meridian uniquely does with them | Already designed in `docs/property-intelligence-v1.md` — combines listing status + listing agent + CRM identity into the opportunity score |
| Integration types available | RESO Web API (requires broker authorization + ~$300/mo for IDX feeds via Bridge Interactive / Trestle); MLS dashboard CSV export (free, operator-runnable) |
| Realistic v1 path | **Heartland MLS CSV export by Nicole, founder-ingested.** Same pattern as everything else. |
| Defer | RESO API integration. Wait until ≥ 3 paying customers AND verified that the listing intelligence produces visible weekly-brief value. |
| Trap | Building a listing search UI. MLS systems already have the search interface; Meridian's value is the cross-system join, not the discovery surface. |

### County / Public Records — Ownership Anchor

| Dimension | Notes |
|---|---|
| What real-world signals matter | Owner of record per parcel; ownership start date; last transfer date; mailing address; assessed value; permit activity |
| What Meridian uniquely does with them | Match contacts to properties; surface ownership-duration as a buyer/seller intent context; verify whether the CRM contact actually still owns the property they did 5 years ago |
| Integration types available | County recorder portals (Jackson County MO, Johnson County KS, Wyandotte County KS) — most have CSV downloads of recent transfers; some require FOIA; Regrid/Estated/ATTOM provide aggregated API access at $0.05-$0.50/lookup |
| Realistic v1 path | **CSV per-county, founder-ingested.** Already designed. Same pipeline as MLS. |
| Defer | Regrid/Estated integration. Wait until Nicole's data has enough surnames + addresses to justify per-lookup cost. |
| Trap | Building a county-records search UI. There's no operator workflow there; surface only as evidence on contact cards. |

---

## Integration Priority Ranking

By the formula **(operator value) × (ingestion feasibility) ÷ (engineering cost)**, ranked top-to-bottom:

| Rank | Integration | Operator value | Feasibility | Engineering cost | Net |
|---|---|---|---|---|---|
| 1 | **Wise Agent / FUB CSV** (CRM identity layer) | Foundational — required for the workspace to exist | ✅ Done | Zero (already done) | ∞ |
| 2 | **Heartland MLS CSV** (listing layer) | Very high (active listings change the opportunity score directly) | ✅ Operator can export | Low (~300 LOC) | High |
| 3 | **Jackson County MO + Johnson County KS public records CSV** (property anchor) | High (ownership duration + last sale unlock the property layer) | ✅ County portals export | Low (existing csvAdapter handles it) | High |
| 4 | **Dotloop CSV** (transaction history + active deals) | High (active-deal exclusion + closed-deal anniversaries) | ✅ Operator can export | Low (~200 LOC for new csvAdapter) | High |
| 5 | **Forwarded Zillow lead emails** (lead intake layer) | Medium (cold-lead re-engagement) | ✅ Operator can configure a Gmail filter | Medium (parser + dedicated inbox setup, ~400 LOC) | Medium |
| 6 | **Forwarded Dotloop notification emails** | Medium (real-time deal status) | ✅ Operator can configure | Medium (parser, ~200 LOC) | Medium |
| 7 | **Forwarded MLS alert emails** (saved-search hits) | Low–Medium (mostly redundant with Heartland MLS CSV) | ✅ Operator can configure | Medium | Low |
| 8 | **Gmail OAuth read-only — last-touch extraction** | High but defer-able | Real engineering | High (OAuth + privacy + per-customer scope) | Medium |
| 9 | **Calendar OAuth — showing/meeting extraction** | Low–Medium | Real engineering | High | Low |
| 10 | **Wise Agent API webhooks** | Low (operators don't update Wise Agent often enough) | Sparsely documented | Medium | Low |
| 11 | **FUB API webhooks** (real-time contact updates) | Medium for FUB-based customers | Well documented | Medium | Medium |
| 12 | **MLS RESO API integration** | Medium (data is the same as CSV, just fresher) | Broker auth required, ~$300/mo | Medium | Low |
| 13 | **Direct Zillow Premier Agent API** | Medium for Premier Agent customers | Restricted | High | Low |
| 14 | **Direct Dotloop OAuth API** | High but only after pattern proven via CSV | Broker auth required | High | Low |

---

## What Stays CSV / Manual in v1

Everything ranked 1–4 above:
- CRM CSV (already shipped)
- MLS CSV (Property Intelligence v1 plan)
- Public records CSV (Property Intelligence v1 plan)
- Dotloop CSV (new — propose for Sprint 6)

These four cover ~80% of the intelligence value of a fully integrated stack. Every one is operator-runnable + founder-ingestable. None requires OAuth, paid API access, or per-customer credentials.

## What Should Become True Integrations Later

In order of graduation priority once v1 customers are stable and demanding it:

1. **FUB API + webhooks** — for FUB-based customers who want freshness without weekly CSV exports
2. **Gmail OAuth read-only** — last-touch extraction at scale
3. **Dotloop OAuth API** — replaces the CSV when the CSV pattern is proven valuable
4. **MLS RESO API** — replaces the MLS CSV when the listing-freshness gap matters operationally

Each graduation is a separate strategic decision after the CSV version has demonstrated value with real customers. None graduates speculatively.

---

## Where Meridian Creates Unique Value vs Existing Extensions

There are dozens of Chrome extensions and bolt-on tools in the real estate space (Quicklister, Sierra Interactive, Brivity, Realeflow, etc.). Most attempt to add one feature to one tool. Meridian's unique position is in **the cross-system join**:

| Other tools | Meridian |
|---|---|
| Extend a single system with one feature | Sit beside all systems and join them |
| Live inside the system's UI | Live in a separate weekly cadence |
| Generate AI-flavored predictions | Generate source-cited deterministic priorities |
| Try to own daily workflow | Own Monday morning + brief delivery |
| Charge per-seat for marginal feature | Charge per-workspace for cross-system intelligence |

The unique value is structural, not feature-based. No competing product is positioned as "the weekly intelligence layer across the operator's existing tools." That category is open because most product teams chase per-tool integration depth.

---

## The Ideal Meridian Integration Philosophy

**Stated in one sentence**: *Meridian ingests structured exports from the systems the operator already uses, deterministically joins them by identity, applies transparent weighted prioritization, and surfaces the result as a calm weekly brief — never as a workflow replacement.*

**Five tactical rules**:

1. **CSV-first.** Every integration starts as a founder-ingested CSV. No integration enters the codebase without passing through this stage.
2. **Read-only.** Meridian never writes back to source systems in v1. Bidirectional sync is a class-2 hazard for a single-founder operation.
3. **Source-cited.** Every piece of intelligence in the workspace traces to a named source string (e.g. `heartland_mls_export_2026-05-27`).
4. **Operator-runnable export, not OAuth.** When the operator can export the data themselves, the system stays in the operator's locus of control. OAuth shifts custody to Meridian and adds compliance burden.
5. **Earned graduation.** Integrations graduate from CSV → email parser → OAuth API only after 3+ paying customers explicitly need the freshness or volume that CSV can't provide.

---

## The Minimum Viable Intelligence Stack

For Nicole's workspace today:

1. **CRM identity** — Wise Agent CSV ✅ live
2. **CRM rehab** — founder-led session with `list:weak` + `repair:contacts` ✅ live
3. **Property anchor** — Jackson County MO CSV (proposed in Property Intelligence v1)
4. **Listing layer** — Heartland MLS CSV (proposed in Property Intelligence v1)
5. **Outcome continuity** — `/personal` weekly briefing panel + outcome capture ✅ live

That is the v1 stack. Five layers, all founder-ingestible, all source-cited, all in scope for the next 30 days.

Everything else is post-v1.

---

## The Top 3 Integrations to Pursue Immediately

| Integration | Why now | Cost |
|---|---|---|
| **1. Heartland MLS CSV (Property Intelligence v1, Commit 1)** | The opportunity score needs current-listing data to differentiate seller-tagged contacts. Without it, the score is mostly historical. | ~3 days engineering (see Property Intelligence v1 plan) |
| **2. Jackson County MO public-records CSV (Property Intelligence v1, Commit 2)** | Property identity + ownership anchor. Required for the surname+address joining the rehab session is producing. | ~2 days engineering (substrate already exists) |
| **3. Dotloop CSV (closed transactions retrospective)** | Identifies (a) Nicole's actual prior-seller and prior-buyer counts (more accurate than CRM tags), (b) prior-deal counterparty agents as adjacent sphere. Closes the "who actually transacted with this person" question. | ~2 days engineering (new csvAdapter mirroring public-records pattern) |

---

## The Top 3 Integrations to Delay

| Integration | Why later | When to revisit |
|---|---|---|
| **Gmail OAuth integration** | The yield is real but the engineering + privacy compliance cost is 2-3 weeks. Forwarded-email-MVP captures 70% of value at 20% of cost. | After 3+ paying customers explicitly need the freshness |
| **Calendar OAuth integration** | Lower per-contact yield than Gmail. Showings and meetings are signal-light because the address is already on the contact. | After Gmail Phase 2 is shipped + stable |
| **Direct MLS RESO API** | Real-time MLS data is operationally identical to CSV-exported MLS data for a weekly-cadence product. The freshness gap doesn't show up on a Monday brief. | After ≥ 3 paying customers + MLS CSV proven valuable for ≥ 8 weeks |

---

## The Biggest Integration Trap to Avoid

**Building bidirectional sync with any system.**

The reasoning: as soon as Meridian writes back to Wise Agent / FUB / Dotloop, two failure modes emerge:
1. **Data consistency bugs are forever.** Conflict resolution between "agent edited X in FUB at 10:03" and "Meridian wrote X' from a weekly snapshot at 10:05" is a class of bug that single-founder operations cannot maintain.
2. **Operator trust collapse.** If Meridian writes something wrong back to the CRM the agent paid for, the agent's data is corrupted. One incident ends the relationship.

**Hard rule**: Meridian reads from external systems. Operators write to external systems. Outcome capture writes to Meridian-internal storage only. No exceptions until at least customer 10.

Related traps to avoid:
- **Building an MLS search UI** — Heartland's interface is the operator's home; don't recreate it.
- **Building a calendar view** — Google Calendar is the operator's home.
- **Building a transaction-pipeline UI** — Dotloop's interface is the operator's home.
- **Building a generic "all my data in one place" dashboard** — operators don't want that. They want one priority Monday morning. The Friday-summary mode is already the right amount of "all my data" surface.
- **Building OAuth flows for self-serve operator-onboarding** — until customer 10, founder-led onboarding handles credentials.

---

## The Cleanest Founder-Led Integration Path

For each new integration, follow the four-stage maturity ladder:

**Stage 1 — One-off CSV (week 1)**
- Operator exports CSV from the source system manually
- Founder writes a one-off csvAdapter
- Founder runs the import script once
- Verify: does the Monday brief get visibly better?

**Stage 2 — Recurring CSV (weeks 2–4)**
- Operator exports CSV weekly (or as needed)
- Founder ingests during Sunday-night generation
- Verify: does the operator notice + capture more outcomes against the new signals?

**Stage 3 — Forwarded-email parser (months 2–3)**
- Operator configures email forwarding (Zillow leads, Dotloop notifications)
- Dedicated parser extracts structured signals
- Verify: do real-time signals produce different operator behavior than weekly CSVs would?

**Stage 4 — Read-only API integration (month 6+)**
- OAuth flow + per-customer credential storage
- Webhook receiver (where source supports)
- Founder reviews each webhook event before it influences a priority
- Verify: does the freshness gain justify the engineering + compliance cost?

**Hard rule**: an integration cannot skip stages. If it can't survive Stage 1, it doesn't graduate to Stage 2. If it doesn't measurably improve operator behavior at Stage 2, it doesn't graduate to Stage 3.

---

## Revised 30-Day Execution Plan (Integration-First)

Based on the bifurcation framing (CRM Intelligence Layer = Product 1) + this integration philosophy:

**Days 1–7 — Property Intelligence v1, Commits 1+2**
- Heartland MLS CSV ingestion (`lib/enrichment/listings/*`)
- Jackson County MO public-records CSV ingestion (substrate exists)
- Opportunity scoring model with transparent weights
- All work CSV-first; no OAuth, no provider APIs

**Day 8 — Nicole CRM rehab session**
- The session that converts WEAK → MED/HIGH (Sprint 4 work)
- Now lands against Property Intelligence so the resulting workspace shows opportunity tiers + property linkage

**Days 9–10 — Property Intelligence v1, Commit 3 (audit + opener + render)**
- Audit visibility for opportunity tiers
- Opener extractor for property/listing evidence
- First post-Property-v1 Monday brief generated for Nicole

**Day 11 (Monday) — First post-Property Monday brief lands**
- Nicole receives a brief that ranks priorities by transparent opportunity score, citing CRM identity + property + active listing per priority

**Day 12 (Tuesday) — Pricing conversation with Nicole**
- Reference the brief she just received
- $499/mo + $500 onboarding + 60-day commit + ACH

**Days 13–14 — First invoice + Dotloop CSV adapter design**
- If Nicole signed Tuesday: send invoice
- Design Dotloop CSV ingestion (closed-transactions retrospective + active-deal exclusion)

**Days 15–18 — Dotloop CSV ingestion (Commit 1)**
- New `lib/enrichment/transactions/{types.ts, csvAdapter.ts, transactionIndex.ts}`
- Same pattern as Listings + Public Records layers
- Validator: synthetic Dotloop fixtures
- No new opener extractor yet — let Sprint 8 add that

**Days 19–21 — Dotloop integration into Opportunity scoring**
- Add `prior_dotloop_seller_transaction` and `prior_dotloop_buyer_transaction` factors to the scoring model
- These OVERRIDE CRM-tag-derived `prior_seller_relationship` / `prior_buyer_relationship` when present (transaction record is more reliable than tag)
- Add `active_deal_in_progress` factor that EXCLUDES the contact from priorities entirely (caps tier at REVIEW with reason: "active deal in Dotloop")
- Validator extension + audit section

**Day 22 (Monday) — Second post-Dotloop Monday brief**
- Now the workspace knows which contacts are in active deals and excludes them
- Knows real prior-seller/buyer counts (verified by transactions, not just tags)

**Days 23–25 — Begin second-customer outreach**
- One Tier 1 prospect outside residential RE (insurance broker, RIA, recruiter)
- Founder-led, 90-minute trial onboarding

**Days 26–28 — Forwarded Zillow lead email parser design**
- Dedicated inbox per workspace (`leads-<slug>@<meridian-domain>`)
- Operator configures Gmail filter
- Parser extracts contact + property + interest
- No OAuth, no Gmail API integration

**Days 29–30 — Retro + second-customer-onboarding decision**
- Honest assessment: are the three integrations (MLS, public-records, Dotloop) producing measurable Monday-brief value?
- Does Nicole engage at higher rates than before Property v1?
- Is the second customer worth pursuing or should focus stay on Nicole's depth?

**No new architecture work in this 30-day window.** No OAuth flows. No webhooks. No bidirectional anything. Pure CSV-first integration discipline.

---

## What This Philosophy Will NOT Do

- It will not produce real-time alerts. Meridian is a Monday-morning weekly product.
- It will not replace the operator's existing tools. They keep paying $99/mo for Wise Agent.
- It will not become a CRM. The unit of competition is the weekly brief + workspace, not the contact-record-of-record.
- It will not chase enterprise-tier integrations (Salesforce / Microsoft Dynamics). Wrong category.
- It will not build a generic API for third parties to push data into. v1 is closed CSV ingestion.
- It will not auto-discover signals from web scraping or social platforms. Constitution §6 bans surveillance aggregation; this philosophy reinforces it.
- It will not pre-build any integration before a paying customer asks for it. Each integration must trace to a specific operator need.

---

## Final Strategic Note

The agent-tooling market is full of products that became their own silos because they tried to own the workflow. The opportunity Meridian is positioned for is the opposite: become the calm intelligence layer that joins the silos the operator already pays for.

The integration philosophy is the architectural commitment to that positioning. Every future engineering decision routes through these rules.

If a future commit ever proposes:
- A direct Wise Agent replacement
- A built-in MLS search
- An in-product transaction pipeline
- Bidirectional sync with anything
- A self-serve OAuth flow for general operator onboarding before customer 10

...stop and re-scope. Meridian drifted.

---

## Amendment process

Same as Product Constitution. `[canon-amend]` PR. Founder review. No silent amendments.
---
