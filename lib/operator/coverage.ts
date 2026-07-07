// Meridian Command — connector coverage audit (for the status page).
//
// Answers "which outreach/reply channels are actually being scanned right now?" by
// checking each connector's input source. A connector is never crash-blocking: a
// missing input surfaces as amber ("no data yet"), not red, and the scan continues.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface CoverageItem {
  id: string;
  channel: string; // human label
  scans: string; // what it observes
  source: string; // where reality comes from
  state: "ok" | "empty" | "manual";
  detail: string;
}

async function fileExists(rel: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), rel), "utf8");
    return raw.trim().length;
  } catch {
    return null;
  }
}

async function dirCount(rel: string): Promise<number> {
  try {
    return (await fs.readdir(path.join(process.cwd(), rel))).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export async function getConnectorCoverage(): Promise<CoverageItem[]> {
  const gmail = await fileExists("data/gmail/inbox-batch.json");
  const cal = await fileExists("data/calendar/inbox-batch.json");
  const contacts = await dirCount("data/crm-contacts");
  const liObs = await fileExists("data/linkedin/observations.json");
  const liMsg = await fileExists("data/linkedin/messages.json");

  return [
    {
      id: "gmail",
      channel: "Gmail (inbox + sent + threads)",
      scans: "inbound & outbound messages, no-response, meeting invites, lifecycle (offer/reject/referral)",
      source: "data/gmail/inbox-batch.json (MCP-produced batch)",
      state: gmail ? "ok" : "empty",
      detail: gmail ? "batch present — direction-aware (who owes whom)" : "no batch yet — refresh via Gmail MCP",
    },
    {
      id: "google-calendar",
      channel: "Google Calendar",
      scans: "meetings scheduled / completed / approaching / canceled",
      source: "data/calendar/inbox-batch.json (MCP-produced batch)",
      state: cal ? "ok" : "empty",
      detail: cal ? "batch present" : "no batch yet — refresh via Calendar MCP",
    },
    {
      id: "google-contacts",
      channel: "Google Contacts",
      scans: "identity / company enrichment on relationships",
      source: "data/crm-contacts/*.json (imported contacts)",
      state: contacts > 0 ? "ok" : "empty",
      detail: contacts > 0 ? `${contacts} contact file(s)` : "no contacts imported yet (optional, non-blocking)",
    },
    {
      id: "linkedin",
      channel: "LinkedIn (manual, no scraping)",
      scans: "sent & received DMs, connection/job/company signals, manual notes",
      source: "data/linkedin/observations.json + messages.json",
      state: liObs || liMsg ? "ok" : "manual",
      detail: liObs || liMsg ? "notes/messages present" : "paste notes/threads to include (intentionally manual)",
    },
    {
      id: "manual",
      channel: "Manual notes / opportunity updates",
      scans: "hand-entered signals about any relationship",
      source: "data/linkedin/observations.json (any linkedin_* / manual note)",
      state: liObs ? "ok" : "manual",
      detail: "add an entry to record an update the connectors can't see (e.g. a phone call)",
    },
  ];
}
