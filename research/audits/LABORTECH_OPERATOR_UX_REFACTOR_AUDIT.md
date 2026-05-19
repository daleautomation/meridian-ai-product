# LaborTech Operator UX Refactor Audit

## SERP ranking integration opportunities

- Scoring hook: `lib/intelligence/leadSignals.ts`, `lib/intelligence/leadDecision.ts`, and `lib/scoring/companyDecision.ts` are the right insertion points for future SERP rank signals because they already feed deterministic lead quality and why-now output.
- Service-fit hook: `lib/scan/serviceFit.ts` already maps ranking/search language to SEO and ads service buckets; SERP rank should enrich those existing signals rather than create a parallel score.
- Calendar UI hook: `components/CalendarCommandCenter.jsx` now renders compact service/fit/status cards, so SERP should appear only as a selected-lead explanation or a service chip tooltip, not as another calendar column.
- Scheduling UI hook: `components/AllLeadsBucketOverview.tsx` is the right place to filter/drill into SEO-ranked opportunities by service bucket.
- Market-fit hook: SERP should modify market-fit context and evidence lines, not scheduling dates or queue mutation paths.

## Hunter.io recommendation

- Keep Hunter secondary to phone-first workflows. `lib/contacts/contactStrategy.ts` correctly states that Hunter is click-only and guarded before API spend.
- Preserve `LeadEmailAction.jsx` as the manual enrichment choke point; do not auto-fire Hunter from calendar cards, queues, or scheduling filters.
- Treat Hunter as a follow-up enhancer after phone relevance is established. It is useful for verified email confidence, but not strong enough to drive execution order.
- If Hunter remains enabled, continue surfacing eligibility reasons and failed-session suppression so operators understand why a lookup is unavailable.

## Guardrails preserved

- No Neon write mode changes.
- No scheduling date logic changes.
- No relationship-engine writes, automation, reminders, or queue execution introduced.
- Queue and projection surfaces remain deterministic/read-only.
