// Meridian Command — deterministic identity + id helpers for the Opportunity Graph.
//
// Every id is a pure function of observable fields. Same input → same id, on
// every machine, forever. This is what makes the projection replayable and the
// graph idempotent (re-running the backfill produces byte-identical ids).

import crypto from "node:crypto";
import { companyKey, type CompanyRef } from "@/lib/mcp/types";
import type { EdgeType, ProvenanceRef, SourceSystem } from "./types";

export const SELF_OWNER = "dylan";
export const SELF_NODE_ID = `self:${SELF_OWNER}`;

/** Lowercased, trimmed, whitespace-collapsed. */
export function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = norm(value);
  return v.includes("@") ? v : null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D+/g, "");
  return digits.length >= 7 ? digits : null;
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// ── Node ids ────────────────────────────────────────────────────────────────

/** Company node id — reuses the existing companyKey() so the ae-jobs, snapshot,
 *  contact, and outcome islands all resolve to the SAME company node. */
export function companyNodeId(ref: CompanyRef): string {
  return `company:${companyKey(ref)}`;
}

/** Company node id from a bare company name (contacts / opportunities). */
export function companyNodeIdFromName(name: string): string {
  return `company:${companyKey({ name })}`;
}

/** Person node id — email is the strongest key, then phone, then name+company. */
export function personNodeId(input: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  company?: string | null;
}): string {
  const email = normalizeEmail(input.email);
  if (email) return `person:email:${email}`;
  const phone = normalizePhone(input.phone);
  if (phone) return `person:phone:${phone}`;
  const key = sha256(`${norm(input.name)}|${norm(input.company)}`).slice(0, 16);
  return `person:name:${key}`;
}

export function opportunityNodeId(opportunityId: string): string {
  return `opportunity:${norm(opportunityId)}`;
}

export function meetingNodeId(eventId: string): string {
  return `meeting:${norm(eventId)}`;
}

export function outcomeNodeId(eventId: string): string {
  return `revenue_outcome:${norm(eventId)}`;
}

// ── Edge ids ──────────────────────────────────────────────────────────────

/** Natural-key edge id → idempotent upserts. */
export function edgeId(src: string, type: EdgeType, dst: string): string {
  return `${src}|${type}|${dst}`;
}

// ── Source records ──────────────────────────────────────────────────────────

export function sourceRecordId(system: SourceSystem, type: string, id: string): string {
  return `${system}:${type}:${norm(id)}`;
}

export function provenance(
  system: SourceSystem,
  type: string,
  id: string,
): ProvenanceRef {
  return {
    sourceRecordId: sourceRecordId(system, type, id),
    sourceSystem: system,
    sourceType: type,
    sourceId: id,
  };
}
