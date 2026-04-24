// Meridian AI — Next Action engine.
//
// Single deterministic function: CompanyDecision → NextAction. The UI reads
// `decision.nextAction` directly; no branching in view code. Uses only
// signals the engine already produced (labortechFit, contacts, bucket,
// verifiedIssue, verifiedContact, callAttempts, whyThisCloses,
// serviceRecommendations, websiteProof). No fabricated data.
//
// Action precedence (walked top-to-bottom; first match wins):
//   1) blocked (closed/archived)                 → SKIP FOR NOW
//   2) already-touched + still-qualified          → FOLLOW UP
//   3) strong-fit + phone + verified issue        → CALL NOW
//   4) no phone + email + fit                     → EMAIL FIRST
//   5) fit + website scan + no verified contact   → REVIEW SITE FIRST
//   6) weak fit / no contact path / low evidence  → SKIP FOR NOW
//   7) phone exists + some fit signal             → CALL NOW (medium conf)
//   8) fallback                                   → REVIEW SITE FIRST

import type { CompanyDecision } from "./companyDecision";

export type NextActionLabel =
  | "CALL NOW"
  | "EMAIL FIRST"
  | "REVIEW SITE FIRST"
  | "FOLLOW UP"
  | "SKIP FOR NOW";

export type NextActionConfidence = "LOW" | "MEDIUM" | "HIGH";

export type NextAction = {
  action: NextActionLabel;
  confidence: NextActionConfidence;
  reason: string;
  supportDetail?: string;
};

function strongFit(fit: string | undefined): boolean {
  return fit === "STRONG FIT" || fit === "GOOD FIT";
}

export function computeNextAction(decision: CompanyDecision): NextAction {
  // 1) Closed / archived / blocked — nothing to do.
  if (decision.blocked) {
    return {
      action: "SKIP FOR NOW",
      confidence: "HIGH",
      reason: `Status = ${decision.blocked.toLowerCase().replace(/_/g, " ")}. Not an active opportunity.`,
    };
  }

  const fit = decision.labortechFit?.overall;
  const hasPhone = !!decision.contacts?.primaryPhone;
  const hasEmail = !!decision.contacts?.primaryEmail;
  const verifiedContact = !!decision.verifiedContact;
  const verifiedIssue = !!decision.verifiedIssue;
  const hasWebsiteScan = !!decision.websiteProof;
  const alreadyTouched = (decision.callAttempts ?? 0) > 0;
  const notPass = decision.bucket !== "PASS";
  const fitStrongOrGood = strongFit(fit);
  const topService = decision.serviceRecommendations?.[0];

  // 2) Already touched and still qualified — follow-up is the smartest move.
  if (alreadyTouched && notPass) {
    const attempts = decision.callAttempts ?? 0;
    return {
      action: "FOLLOW UP",
      confidence: attempts >= 2 ? "HIGH" : "MEDIUM",
      reason: `Contacted ${attempts} time${attempts === 1 ? "" : "s"} — still qualified, overdue for another touch.`,
      supportDetail: decision.nextMoveCommand?.replace(/^Next move:\s*/i, "") || undefined,
    };
  }

  // 3) CALL NOW — strong fit + phone + verified issue.
  if (fitStrongOrGood && hasPhone && verifiedIssue) {
    return {
      action: "CALL NOW",
      confidence: verifiedContact ? "HIGH" : "MEDIUM",
      reason: decision.whyThisCloses
        || "Strong fit, reachable phone, and a clear website issue worth calling on.",
      supportDetail: topService
        ? `Lead the pitch with ${topService}.`
        : undefined,
    };
  }

  // 4) EMAIL FIRST — no phone path but email + fit still good.
  if (!hasPhone && hasEmail && fitStrongOrGood) {
    return {
      action: "EMAIL FIRST",
      confidence: "MEDIUM",
      reason: "Email available but no reliable phone path on file yet.",
      supportDetail: topService
        ? `Anchor the email on ${topService.toLowerCase()}.`
        : undefined,
    };
  }

  // 5) REVIEW SITE FIRST — fit is there but no verified contact to act on.
  if (fitStrongOrGood && hasWebsiteScan && !verifiedContact) {
    return {
      action: "REVIEW SITE FIRST",
      confidence: "MEDIUM",
      reason: "Fit looks good but no verified contact yet — open View Scan and qualify before dialling.",
      supportDetail: topService
        ? `Likely pitch: ${topService}.`
        : undefined,
    };
  }

  // 6) SKIP — truly weak or no actionable path.
  if (fit === "WEAK FIT") {
    return {
      action: "SKIP FOR NOW",
      confidence: "HIGH",
      reason: "Already strong online — limited LaborTech upside until something changes.",
    };
  }
  if (!hasPhone && !hasEmail && !hasWebsiteScan) {
    return {
      action: "SKIP FOR NOW",
      confidence: "MEDIUM",
      reason: "No contact path and no site scan on file — not enough evidence to act.",
    };
  }

  // 7) Medium-confidence fallback — phone + some signal.
  if (hasPhone) {
    return {
      action: "CALL NOW",
      confidence: "MEDIUM",
      reason: "Phone on file and evidence is partial — quick qualification call.",
      supportDetail: topService
        ? `Lead the pitch with ${topService}.`
        : undefined,
    };
  }

  // 8) Fallback.
  return {
    action: "REVIEW SITE FIRST",
    confidence: "LOW",
    reason: "Run the scan first — contact path is thin and evidence is incomplete.",
  };
}
