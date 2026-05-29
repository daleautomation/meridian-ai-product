// Meridian CRM import — intelligent deduplication (never silent merge).

import type {
  CrmContactRecord,
  DedupePair,
  DedupeVerdict,
  MergeRecommendation,
  NormalizedCrmContact,
} from "./types";
import {
  resolveExistingContactForRow,
  type IdentityMatchReason,
} from "./identityKey";

const SAFE_MERGE_THRESHOLD = 0.92;
const LIKELY_DUPLICATE_THRESHOLD = 0.78;
const MANUAL_REVIEW_THRESHOLD = 0.55;

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  const distance = matrix[b.length][a.length];
  return 1 - distance / Math.max(a.length, b.length);
}

function fuzzyNameScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  return levenshteinRatio(a, b);
}

function fuzzyCompanyScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.88;
  return levenshteinRatio(a, b);
}

function exactMatchScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  return a === b ? 1 : 0;
}

export function scoreDuplicatePair(
  incoming: NormalizedCrmContact,
  existing: CrmContactRecord,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  let signals = 0;

  const phoneScore = exactMatchScore(incoming.normalizedPhone, existing.normalizedPhone);
  if (phoneScore === 1) {
    score += 0.45;
    signals += 1;
    reasons.push("Normalized phone matches exactly.");
  }

  const emailScore = exactMatchScore(incoming.normalizedEmail, existing.normalizedEmail);
  if (emailScore === 1) {
    score += 0.4;
    signals += 1;
    reasons.push("Normalized email matches exactly.");
  }

  const companyScore = fuzzyCompanyScore(incoming.normalizedCompany, existing.normalizedCompany);
  if (companyScore >= 0.85) {
    score += companyScore * 0.2;
    signals += 1;
    reasons.push(`Company similarity ${Math.round(companyScore * 100)}%.`);
  }

  const nameScore = fuzzyNameScore(incoming.normalizedName, existing.normalizedName);
  if (nameScore >= 0.8) {
    score += nameScore * 0.15;
    signals += 1;
    reasons.push(`Name similarity ${Math.round(nameScore * 100)}%.`);
  }

  if (signals === 0) {
    reasons.push("No strong identity signals matched.");
  }

  return { score: Math.min(1, score), reasons };
}

export function verdictFromScore(score: number): DedupeVerdict {
  if (score >= SAFE_MERGE_THRESHOLD) return "safe_merge";
  if (score >= LIKELY_DUPLICATE_THRESHOLD) return "likely_duplicate";
  if (score >= MANUAL_REVIEW_THRESHOLD) return "manual_review_required";
  return "unique";
}

function identityReasonLabel(reason: IdentityMatchReason): string {
  switch (reason) {
    case "email":
      return "Exact normalized-email match — same contact.";
    case "phone":
      return "Exact normalized-phone match — same contact.";
    case "name_and_address":
      return "Same surname AND same canonical address — same household contact.";
    default:
      return "";
  }
}

export function findDedupePairs(
  incomingRows: NormalizedCrmContact[],
  existingContacts: CrmContactRecord[],
): DedupePair[] {
  const pairs: DedupePair[] = [];

  for (const row of incomingRows) {
    if (row.validationErrors.length > 0) continue;

    // ── Step 1: EXACT identity match → unambiguous safe_merge ────
    // The identity resolver (lib/crm-import/identityKey.ts) implements
    // the only rules under which two rows are KNOWN to be the same
    // contact: same normalized email, same normalized phone, OR same
    // surname + same canonical address. First-name-only is never a
    // basis for merge.
    const resolution = resolveExistingContactForRow(row, existingContacts);
    if (resolution.existing && resolution.reason) {
      const existing = resolution.existing;
      pairs.push({
        incomingRowIndex: row.rowIndex,
        existingContactId: existing.id,
        verdict: "safe_merge",
        score: 1,
        reasons: [identityReasonLabel(resolution.reason)],
        incomingPreview: {
          name: row.name,
          company: row.company,
          phone: row.phone,
          email: row.email,
        },
        existingPreview: {
          name: existing.name,
          company: existing.company,
          phone: existing.phone,
          email: existing.email,
        },
      });
      continue;
    }

    // ── Step 2: fuzzy fall-through for ambiguity ────────────────
    // When no exact identity signal matches, fall back to the legacy
    // fuzzy scorer. Results SURFACE for operator review but never
    // produce a safe_merge automatically — only the rules above can.
    let best: DedupePair | null = null;
    for (const existing of existingContacts) {
      const { score, reasons } = scoreDuplicatePair(row, existing);
      let verdict = verdictFromScore(score);
      // Fuzzy scorer is NEVER allowed to claim safe_merge — only the
      // exact-identity path does. Downgrade to likely_duplicate.
      if (verdict === "safe_merge") verdict = "likely_duplicate";
      if (verdict === "unique") continue;

      const candidate: DedupePair = {
        incomingRowIndex: row.rowIndex,
        existingContactId: existing.id,
        verdict,
        score,
        reasons,
        incomingPreview: {
          name: row.name,
          company: row.company,
          phone: row.phone,
          email: row.email,
        },
        existingPreview: {
          name: existing.name,
          company: existing.company,
          phone: existing.phone,
          email: existing.email,
        },
      };

      if (!best || candidate.score > best.score) best = candidate;
    }

    if (best) pairs.push(best);
  }

  return pairs.sort((a, b) => b.score - a.score);
}

export function buildMergeRecommendations(pairs: DedupePair[]): MergeRecommendation[] {
  return pairs
    .filter((pair) => pair.verdict !== "unique")
    .map((pair) => ({
      pairId: `${pair.incomingRowIndex}:${pair.existingContactId}`,
      verdict: pair.verdict,
      suggestedAction:
        pair.verdict === "safe_merge"
          ? "merge"
          : pair.verdict === "likely_duplicate"
            ? "review"
            : "review",
      fieldResolutions: [
        {
          field: "phone" as const,
          incomingValue: pair.incomingPreview.phone,
          existingValue: pair.existingPreview.phone,
          recommendation: pair.verdict === "safe_merge" ? "use_incoming" : "manual",
          reason: pair.reasons.join(" "),
        },
        {
          field: "email" as const,
          incomingValue: pair.incomingPreview.email,
          existingValue: pair.existingPreview.email,
          recommendation: pair.verdict === "safe_merge" ? "use_incoming" : "manual",
          reason: "Email requires operator confirmation before overwrite.",
        },
      ],
    }));
}

export function dedupeSummary(pairs: DedupePair[], totalRows: number) {
  const matchedRows = new Set(pairs.map((p) => p.incomingRowIndex));
  const safeMerge = pairs.filter((p) => p.verdict === "safe_merge").length;
  const likelyDuplicate = pairs.filter((p) => p.verdict === "likely_duplicate").length;
  const manualReview = pairs.filter((p) => p.verdict === "manual_review_required").length;
  const unique = totalRows - matchedRows.size;

  return { unique, safeMerge, likelyDuplicate, manualReview };
}
