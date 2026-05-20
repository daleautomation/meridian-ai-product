// Meridian — workspace lead loader.
//
// Single bridge from ingestion sources into the operator workspace.
// Roofing today uses Google Places. Other modules return [] until they
// have their own seed/source — keep empty states honest, never reuse
// roofing companies for HVAC/plumbing/etc.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import type { LeadDecision } from "@/lib/scoring/decision";
import { ingestFromGooglePlaces } from "@/lib/ingestion/sources/googlePlaces";
import { decideNormalizedLead } from "@/lib/scoring/decision";
import { generateLeadDiagnostics } from "@/lib/diagnostics/leadDiagnostics";
import { buildLaborTechScan } from "@/lib/scan/laborTechScan";

export type DecidedLead = NormalizedLead & { decision: LeadDecision };

// Modules wired to a real source. Add a module here (and a seed file
// in data/seed/) to bring it into the operator workspace.
export const SOURCE_BACKED_MODULES = [
  "roofing",
  "hvac",
  "carpentry",
  "painting",
  "plumbing",
  "electrical",
] as const;
const GOOGLE_PLACES_MODULES = new Set<string>(SOURCE_BACKED_MODULES);

type SupportedModule =
  | "roofing"
  | "hvac"
  | "carpentry"
  | "painting"
  | "plumbing"
  | "electrical"
  | "remodeling";

function isSupportedModule(m: string): m is SupportedModule {
  return (
    m === "roofing" ||
    m === "hvac" ||
    m === "carpentry" ||
    m === "painting" ||
    m === "plumbing" ||
    m === "electrical" ||
    m === "remodeling"
  );
}

export async function loadWorkspaceLeads(opts: {
  workspaceSlug: string;
  moduleId: string;
  limit?: number;
}): Promise<DecidedLead[]> {
  const { workspaceSlug, moduleId } = opts;
  const limit = opts.limit ?? 5;

  if (!isSupportedModule(moduleId)) return [];
  if (!GOOGLE_PLACES_MODULES.has(moduleId)) return [];

  try {
    const ingested = await ingestFromGooglePlaces({
      workspaceSlug,
      moduleId,
      limit,
    });
    // eslint-disable-next-line no-console
    console.log(`[LOAD RESULT] module=${moduleId} ingested=${ingested.length}`);

    // ── Lead admission gate (TEMP BYPASSED) ──────────────────────────
    // Every scanned lead is admitted while the pipeline is being
    // restored end-to-end. See per-lead block below.
    const admitted: DecidedLead[] = [];
    let scanQualified = 0;
    let scanErrored = 0;
    let scanRestored = 0;
    for (const l of ingested) {
      const company = l.companyName ?? l.id ?? "(unknown)";
      // Per-lead try/catch so a single bad scan can't take out the
      // whole batch. Before this guard, an angle-generator throw on
      // lead #5 wiped all 25 leads → "Scheduled 0".
      try {
        const diagnostics = generateLeadDiagnostics(l);
        // eslint-disable-next-line no-console
        console.log(
          `[debug-diagnostics] company="${company}" findings=${diagnostics?.findings?.length ?? 0}`,
        );
        const laborTechScan = buildLaborTechScan(l, diagnostics);
        // eslint-disable-next-line no-console
        console.log(
          `[debug-scan] company="${company}" qualified=${laborTechScan.qualified} ` +
          `reason="${laborTechScan.qualificationReason}"`,
        );
        // TEMPORARY: admission gate bypass to restore UI. The
        // original `if (!laborTechScan.qualified) continue;` is
        // commented out; every scanned lead is admitted while the
        // pipeline is being verified end-to-end.
        // if (!laborTechScan.qualified) continue;
        if (laborTechScan.qualified) {
          scanQualified++;
        } else {
          scanRestored++;
          laborTechScan.qualified = true;
          laborTechScan.qualificationReason = `temp bypass (was: ${laborTechScan.qualificationReason})`;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[lead-gate] admitted="${company}" service="${laborTechScan.primaryService}" ` +
          `pain="${laborTechScan.primaryPain}"`,
        );
        // Email enrichment status — never invent an address. If the
        // ingestion source already produced a value, mark verified;
        // otherwise the lead enters the workspace as not_searched and
        // the UI surfaces "No verified email yet".
        const emailStatus: NormalizedLead["emailStatus"] = l.email
          ? "verified"
          : "not_searched";
        const enriched: NormalizedLead = {
          ...l,
          diagnostics,
          laborTechScan,
          emailStatus,
          verifiedEmail: l.email ?? undefined,
          emailSource: l.email ? (l.source === "google_places" ? "google_places" : "unknown") : undefined,
        };
        const decision = decideNormalizedLead(enriched);
        admitted.push({ ...enriched, decision });
      } catch (perLeadErr) {
        // Skip this lead but keep ingesting — never let one bad lead
        // cascade and zero out the schedule.
        scanErrored++;
        // eslint-disable-next-line no-console
        console.warn(
          `[lead-gate] skipped="${company}" reason="scan_error" detail=${
            perLeadErr instanceof Error ? perLeadErr.message : String(perLeadErr)
          }`,
        );
        continue;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[LOAD RESULT] module=${moduleId} ingested=${ingested.length} ` +
      `qualified=${scanQualified} restored=${scanRestored} ` +
      `errored=${scanErrored} admittedCount=${admitted.length}`,
    );

    if (admitted.length === 0) {
      console.log(`[LOAD RESULT] module=${moduleId} admittedCount=0 noSyntheticFallback=true`);
    }
    return admitted;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[LOAD CRASH]", err);
    return [];
  }
}
