// Meridian Command — Gmail search strategy.
//
// NOT one broad query. A set of focused Gmail-syntax queries covering seeds,
// intent keywords, sent-with-no-reply, and unanswered inbox. The Gmail reader
// (Claude via MCP, or a future API client) runs each with pagination and the
// scanner deduplicates by thread id.
//
// These are DATA, not logic — extend freely without touching the pipeline.

import { SEED_ENTITIES } from "./seeds";

export interface GmailQuery {
  id: string;
  purpose: string;
  query: string; // Gmail search syntax
}

/** Build the full query plan. `graphNames` are extra people/company names pulled
 *  from the existing Opportunity Graph so we search what Meridian already knows. */
export function buildQueryPlan(graphNames: string[] = []): GmailQuery[] {
  const seedTerms = SEED_ENTITIES.flatMap((s) => s.match)
    .filter((m) => m.length > 2 && !m.includes(".")) // drop bare domains for OR readability
    .map((m) => (m.includes(" ") ? `"${m}"` : m));
  const seedOr = Array.from(new Set(seedTerms)).join(" OR ");

  const graphOr = Array.from(new Set(graphNames.map((n) => (n.includes(" ") ? `"${n}"` : n))))
    .slice(0, 40)
    .join(" OR ");

  const plan: GmailQuery[] = [
    { id: "seeds", purpose: "known relationship + company seeds", query: `{${seedOr}} newer_than:1y` },
    { id: "career", purpose: "recruiter / interview / hiring", query: `{recruiter interview "hiring manager" "account executive" "thank you for applying" offer} newer_than:1y` },
    { id: "founders", purpose: "founder / partnership / intro", query: `{founder "co-founder" partnership "introduce you" "connected with" referral} newer_than:1y` },
    { id: "proposals", purpose: "proposal / estimate / bid / contract", query: `{proposal estimate quote bid "scope of work" contract invoice} newer_than:1y` },
    { id: "meetings", purpose: "calendar invites + scheduling", query: `{"invitation:" "google meet" reschedule availability "book a time"} newer_than:6m` },
    { id: "sent_no_reply", purpose: "sent mail awaiting a reply", query: `in:sent newer_than:60d` },
    { id: "inbox_unanswered", purpose: "inbound needing my response", query: `in:inbox is:important newer_than:60d` },
  ];

  if (graphOr.length > 0) {
    plan.push({ id: "graph_entities", purpose: "people/companies already in the graph", query: `{${graphOr}} newer_than:1y` });
  }
  return plan;
}

/** Focused single-entity query for a deep dive (e.g., confirming Clue status). */
export function entityQuery(tokens: string[]): string {
  const or = tokens.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ");
  return `{${or}} in:anywhere newer_than:1y`;
}
