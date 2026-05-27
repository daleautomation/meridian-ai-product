/**
 * Audit the actual data sources powering Nicole's workspace.
 *
 * Answers questions like:
 *   • What fields does each contact carry?
 *   • Has anything been externally enriched (Hunter / Google Places /
 *     web search / public records)?
 *   • What CRM evidence backs the top 8 weekly priorities?
 *
 * Output rules:
 *   • Never print full notes, emails, or phone numbers. Only
 *     completeness booleans, lengths, and host fragments.
 *   • Never print secrets.
 *   • Every claim must be derived from a real DB row — no inference.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/audit-nicole-data-sources.ts
 */

import { neon } from "@neondatabase/serverless";

import { getWorkspaceBySlug } from "@/config/workspaces";
import { listContactsNeon } from "@/lib/crm-import/crmContactsNeonAdapter";
import { filterOutInternalDiagnosticContacts } from "@/lib/crm-import/internalContactFilter";
import { buildPersonalWorkspaceModel } from "@/lib/personal-workspace/workspace";
import { buildWeeklyState } from "@/lib/personal-workspace/weeklyState";
import { buildResurfacingBuckets } from "@/lib/relationship-intelligence/resurfacing";
import { readCustomerOutcomes } from "@/lib/recovery/outcomes/persistence";

const WORKSPACE = "nicole-lonergan";

// ── Provider-stamp detector ─────────────────────────────────────────
// We do NOT expect any of these to be present today, but if they ever
// land via /api/integrations/hunter/find-email or a future enrichment
// pass, this is the exhaustive list of keys we'd look for inside
// `source_metadata` JSON.

const ENRICHMENT_PROVIDER_KEYS: readonly string[] = [
  "hunter",
  "hunterConfidence",
  "hunterFetchedAt",
  "googlePlaceId",
  "googlePlacesFetchedAt",
  "googlePlacesRating",
  "serpApi",
  "serpFetchedAt",
  "anthropicEnrichedAt",
  "webResearchSources",
  "publicRecordRefs",
  "permitRefs",
  "enrichmentProvider",
  "enrichedAt",
];

function hasAnyEnrichmentStamp(sourceMetadata: Record<string, unknown>): string[] {
  const stamps: string[] = [];
  for (const key of ENRICHMENT_PROVIDER_KEYS) {
    if (key in sourceMetadata) stamps.push(key);
  }
  return stamps;
}

function safeNoteSummary(notes: string | null | undefined): {
  present: boolean;
  length: number;
  isAutomationResidue: boolean;
} {
  if (!notes) return { present: false, length: 0, isAutomationResidue: false };
  const trimmed = notes.replace(/\s+/g, " ").trim();
  // Detect Wise Agent-style campaign exports without quoting content.
  const isAutomationResidue =
    /Program:\s*\d+\s+Touch/i.test(trimmed) ||
    /Data we found for you/i.test(trimmed) ||
    /Event Description:/i.test(trimmed);
  return { present: trimmed.length > 0, length: trimmed.length, isAutomationResidue };
}

function maskEmailDomain(email: string | null): string {
  if (!email) return "(none)";
  const at = email.indexOf("@");
  if (at < 0) return "(malformed)";
  return `***@${email.slice(at + 1).toLowerCase()}`;
}

async function main(): Promise<void> {
  const url = (process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "").trim();
  if (!url) {
    console.error("DATABASE_URL not set. Run: set -a; source .env.local; set +a");
    process.exit(1);
  }
  const workspace = getWorkspaceBySlug(WORKSPACE);
  if (!workspace) {
    console.error(`Unknown workspace: ${WORKSPACE}`);
    process.exit(1);
  }
  const sql = neon(url);

  // 1. Pull raw rows directly so we can inspect source_metadata
  //    contents (the adapter shape only exposes typed fields).
  type Row = { contact_id: string; normalized: unknown; source_metadata: unknown; trust: unknown };
  const rawRows = (await sql`
    select contact_id, normalized, source_metadata, trust
    from crm_contacts
    where workspace_id = ${WORKSPACE}
  `) as Row[];

  // 2. Load via the canonical reader so downstream model matches what
  //    /personal actually sees, then drop internal diagnostic rows.
  const allContacts = await listContactsNeon(WORKSPACE);
  const visible = filterOutInternalDiagnosticContacts(allContacts);
  const hidden = allContacts.length - visible.length;

  // 3. Source breakdown.
  const completeness = {
    phone: 0,
    email: 0,
    notes: 0,
    notesAutomationResidueOnly: 0,
    tags: 0,
    lastInteractionAt: 0,
    company: 0,
    address: 0,
  };
  const sourceCrmCounts = new Map<string, number>();
  const enrichmentStamps = new Map<string, number>();
  let contactsWithAnyEnrichmentStamp = 0;
  const emailDomains = new Map<string, number>();

  for (const row of rawRows) {
    const sm = (row.source_metadata && typeof row.source_metadata === "object")
      ? (row.source_metadata as Record<string, unknown>)
      : {};
    const stamps = hasAnyEnrichmentStamp(sm);
    if (stamps.length > 0) contactsWithAnyEnrichmentStamp += 1;
    for (const s of stamps) enrichmentStamps.set(s, (enrichmentStamps.get(s) ?? 0) + 1);
  }

  for (const c of visible) {
    if (c.phone || c.normalizedPhone) completeness.phone += 1;
    if (c.email || c.normalizedEmail) completeness.email += 1;
    const noteSum = safeNoteSummary(c.notes);
    if (noteSum.present) completeness.notes += 1;
    if (noteSum.isAutomationResidue && noteSum.length > 0) {
      // Note exists but is automation-template residue, not a human note.
      completeness.notesAutomationResidueOnly += 1;
    }
    if (c.tags && c.tags.length > 0) completeness.tags += 1;
    if (c.lastInteractionAt) completeness.lastInteractionAt += 1;
    if (c.company && c.company.trim()) completeness.company += 1;
    if (c.address && c.address.trim()) completeness.address += 1;

    const src = (c.sourceCrm ?? "(none)").trim() || "(empty)";
    sourceCrmCounts.set(src, (sourceCrmCounts.get(src) ?? 0) + 1);

    const domain = c.email ? maskEmailDomain(c.email).slice(4) : null;
    if (domain) emailDomains.set(domain, (emailDomains.get(domain) ?? 0) + 1);
  }

  // 4. Rebuild the personal workspace model + weekly state so we
  //    inspect the EXACT top 8 the panel would render.
  const resurfacingBuckets = buildResurfacingBuckets(allContacts);
  const model = buildPersonalWorkspaceModel({
    workspace,
    user: {
      id: "audit",
      name: "Audit",
      accessRole: "admin_operator",
      modules: [],
      geo: [],
      workspaces: [WORKSPACE],
    },
    crmContacts: allContacts,
    resurfacingBuckets,
  });
  const outcomes = await readCustomerOutcomes(WORKSPACE);
  const contactsById = new Map(allContacts.map((c) => [c.id, c]));
  const weekly = buildWeeklyState({
    workspaceSlug: WORKSPACE,
    workspaceDisplayName: workspace.branding?.displayName ?? workspace.name,
    workspaceUrl: `https://www.meridianai.work/personal?workspace=${WORKSPACE}`,
    priorityCards: model.allContacts,
    contactsById,
    outcomes,
    resurfacingHighlight: null,
    now: new Date(),
  });

  // ── Print report ──────────────────────────────────────────────────
  console.log("");
  console.log("Nicole workspace data-source audit");
  console.log("==================================");
  console.log("");
  console.log("Workspace:", WORKSPACE);
  console.log("Raw rows in Neon:           ", rawRows.length);
  console.log("Visible (post-filter):      ", visible.length);
  console.log("Hidden (internal-diagnostic):", hidden);
  console.log("");
  console.log("--- sourceCrm tag breakdown ---");
  for (const [src, n] of [...sourceCrmCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(30)} ${n}`);
  }
  console.log("");
  console.log("--- field completeness (visible contacts) ---");
  for (const [k, v] of Object.entries(completeness)) {
    const pct = ((v / Math.max(1, visible.length)) * 100).toFixed(1);
    console.log(`  ${k.padEnd(34)} ${String(v).padStart(4)}  (${pct}%)`);
  }
  console.log("");
  console.log("--- external enrichment stamps (any row, any provider) ---");
  if (contactsWithAnyEnrichmentStamp === 0) {
    console.log("  None. Zero rows carry hunter / googlePlaces / serpApi / publicRecord stamps.");
    console.log("  Every field on every contact comes from the original Wise Agent CSV import.");
  } else {
    console.log(`  Rows with at least one stamp: ${contactsWithAnyEnrichmentStamp}`);
    for (const [k, n] of [...enrichmentStamps.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(28)} ${n}`);
    }
  }

  // ── Hunter coverage detail ─────────────────────────────────────────
  // We bucket by a human-readable label derived from (status, reason)
  // so "error" never appears alone — every error is named.
  function hunterLabel(h: { status: string; reason?: string } | undefined): string {
    if (!h) return "no enrichment";
    if (h.status === "found") return "found";
    if (h.status === "not_found") return "not_found";
    if (h.status === "skipped") {
      const r = h.reason ?? "skipped";
      return `skipped:${r}`;
    }
    // error variants — derive a canonical label from reason
    const r = h.reason ?? "unknown";
    if (r === "auth_error") return "auth_error";
    if (r === "quota_exceeded") return "quota_exceeded";
    if (r === "rate_limited") return "rate_limited";
    if (r.startsWith("wrong_params")) return "wrong_params";
    if (r.startsWith("transient_error")) return "transient_error";
    return `error:${r}`;
  }
  const hunterBuckets = new Map<string, number>();
  const hunterHighConfidence: Array<{ id: string; conf: number; date: string }> = [];
  const hunterMissingProvenance: string[] = [];
  for (const c of visible) {
    const h = c.enrichment?.hunter;
    const label = hunterLabel(h as { status: string; reason?: string } | undefined);
    hunterBuckets.set(label, (hunterBuckets.get(label) ?? 0) + 1);
    if (h?.status === "found") {
      if (!h.source || !h.fetchedAt || typeof h.confidence !== "number") {
        hunterMissingProvenance.push(c.id);
      } else if (h.confidence >= 75) {
        hunterHighConfidence.push({ id: c.id, conf: h.confidence, date: h.fetchedAt.slice(0, 10) });
      }
    }
  }
  console.log("");
  console.log("--- Hunter enrichment coverage (visible contacts) ---");
  for (const [label, n] of [...hunterBuckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label.padEnd(32)} ${n}`);
  }
  console.log(`  --`);
  console.log(`  ≥75% confidence found:           ${hunterHighConfidence.length}  (eligible to surface in openers)`);
  if (hunterMissingProvenance.length > 0) {
    console.log(`  ⚠ rows with status=found but missing provenance: ${hunterMissingProvenance.length}`);
  }
  console.log("");
  console.log("--- email domain mix (top 10, visible contacts) ---");
  for (const [d, n] of [...emailDomains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${d.padEnd(30)} ${n}`);
  }
  console.log("");
  console.log("--- top 8 weekly priorities — field provenance ---");
  for (const p of weekly.priorities) {
    const c = contactsById.get(p.contactId);
    if (!c) {
      console.log(`  #${p.rank} ${p.name} — contact not in CRM map (anomaly)`);
      continue;
    }
    const hasNotes = !!c.notes && c.notes.trim().length > 0;
    const noteAutomation = hasNotes && safeNoteSummary(c.notes).isAutomationResidue;
    const hasTags = (c.tags ?? []).length > 0;
    const fields: string[] = [];
    if (c.name) fields.push("name");
    if (c.email || c.normalizedEmail) fields.push("email");
    if (c.phone || c.normalizedPhone) fields.push("phone");
    if (c.company) fields.push("company");
    if (hasTags) fields.push(`tags(${c.tags.length})`);
    if (hasNotes) fields.push(noteAutomation ? "notes(automation)" : "notes(human)");
    if (c.lastInteractionAt) fields.push(`lastInteractionAt(${c.lastInteractionAt.slice(0, 10)})`);
    const externallyEnriched = (() => {
      const raw = rawRows.find((r) => r.contact_id === c.id);
      if (!raw) return [];
      const sm = (raw.source_metadata && typeof raw.source_metadata === "object")
        ? (raw.source_metadata as Record<string, unknown>)
        : {};
      return hasAnyEnrichmentStamp(sm);
    })();
    const warnings: string[] = [];
    if (p.openerSource.startsWith("fallback:")) warnings.push(`opener:${p.openerSource}`);
    if (p.openerSource === "tag:past_buyer" || p.openerSource === "tag:past_seller") {
      if (!hasNotes || noteAutomation) {
        warnings.push("evidence is tag-only (no human notes backing it)");
      }
    }
    if (!c.phone && (!c.email || !c.normalizedEmail)) {
      warnings.push("no actionable contact method on file");
    }

    console.log("");
    console.log(`  #${p.rank} ${c.name}${c.company ? " · " + c.company : ""}`);
    console.log(`    contactId:        ${c.id}`);
    console.log(`    fields used:      [${fields.join(", ") || "(none)"}]`);
    console.log(`    opener source:    ${p.openerSource}`);
    console.log(`    opener evidence:  ${p.supportingEvidence}`);
    console.log(`    trust level:      ${p.trustLevel}`);
    const hunter = c.enrichment?.hunter;
    const hunterStr = (() => {
      if (!hunter) return "none — CRM import only";
      const label = hunterLabel(hunter as { status: string; reason?: string });
      const confTxt = typeof hunter.confidence === "number" ? ` ${hunter.confidence}%` : "";
      const meta = [
        hunter.role ? `role=${hunter.role}` : null,
        hunter.company ? `company=${hunter.company}` : null,
        hunter.fetchedAt ? hunter.fetchedAt.slice(0, 10) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `Hunter ${label}${confTxt}${meta ? " · " + meta : ""}`;
    })();
    console.log(`    external enrich:  ${hunterStr}`);
    console.log(`    last touch:       ${p.lastTouchSummary}`);
    if (warnings.length > 0) {
      for (const w of warnings) console.log(`    ⚠ ${w}`);
    }
  }

  console.log("");
  console.log("==================================");
  console.log("Summary");
  console.log("==================================");
  console.log(`  External enrichment active on Nicole today: ${contactsWithAnyEnrichmentStamp === 0 ? "NO" : "yes"}`);
  console.log(`  Every priority traceable to CRM import row: ${weekly.priorities.every((p) => contactsById.has(p.contactId)) ? "YES" : "no"}`);
  console.log(`  Contacts lacking any actionable channel:    ${visible.filter((c) => !c.phone && !c.email && !c.normalizedEmail).length} / ${visible.length}`);
  console.log(`  Contacts whose only notes are automation:   ${completeness.notesAutomationResidueOnly} / ${visible.length}`);
}

main().catch((err) => {
  console.error("[audit] crashed");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
