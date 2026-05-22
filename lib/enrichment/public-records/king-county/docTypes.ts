// Meridian — King County recorder document-type classifier.
//
// Only documents that REPRESENT an ownership transfer are usable as
// `ownershipStartDate` evidence. Mortgages (DOT), releases (REL),
// notices of default (NOD), liens, and other instruments are ignored
// when looking for the latest transfer.
//
// The whitelist is intentionally narrow. New document codes must be
// added explicitly here (and reviewed against King County recorder
// documentation) — we do not infer transfer intent from free text.

const OWNERSHIP_TRANSFER_NORMALIZED: ReadonlySet<string> = new Set([
  // Short codes
  "wd",
  "swd",
  "qcd",
  "bsd",
  "ed",
  "td",
  "prd",
  "spwd",
  "deed",
  // Long forms
  "warranty_deed",
  "statutory_warranty_deed",
  "quit_claim_deed",
  "quitclaim_deed",
  "bargain_and_sale_deed",
  "executor_deed",
  "executors_deed",
  "trustees_deed",
  "trustee_deed",
  "personal_representatives_deed",
  "personal_representative_deed",
  "special_warranty_deed",
]);

/**
 * Return true when the raw document type represents an ownership
 * transfer per King County recorder conventions. Case- and separator-
 * insensitive. Returns false for every non-transfer document type
 * (DOT, REL, NOD, lien, lis pendens, easement, etc.).
 */
export function isOwnershipTransferDoc(
  rawType: string | null | undefined,
): boolean {
  if (typeof rawType !== "string") return false;
  const norm = rawType.trim().toLowerCase().replace(/[\s'\-.]+/g, "_");
  return OWNERSHIP_TRANSFER_NORMALIZED.has(norm);
}
