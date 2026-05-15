export type DemoBrief = {
  title: string;
  vertical: string;
  briefUrl: string;
  bestUseCase: string;
  strongestCardSummary: string;
  positioningNote: string;
};

export const demoBriefs: DemoBrief[] = [
  {
    title: "Contractor Growth Recovery",
    vertical: "Contractors and local service firms",
    briefUrl: "/brief/contractor-growth-recovery/2026-W20",
    bestUseCase: "Show how a stale pipeline can be turned into a short founder call list with a specific reason to reopen each relationship.",
    strongestCardSummary:
      "Harbor Ridge Roofing ties a 98-day stale relationship to a newly relevant storm-financing follow-up.",
    positioningNote:
      "Use as an internal fictional sample only; do not imply the companies, contacts, or contact paths are real customers.",
  },
  {
    title: "Staffing Pipeline Recovery",
    vertical: "Boutique staffing and recruiting firms",
    briefUrl: "/brief/staffing-pipeline-recovery/2026-W20",
    bestUseCase: "Lead outreach to recruiters who understand warm desks, dormant searches, and timing-sensitive follow-up.",
    strongestCardSummary:
      "Mason Hill Search shows a CFO-search thread that can be reopened with finalist-stage timing instead of a generic check-in.",
    positioningNote:
      "Recommended first vertical; frame this as relationship recovery support for owner-led recruiting teams.",
  },
  {
    title: "B2B Services Recovery",
    vertical: "Small B2B services firms",
    briefUrl: "/brief/b2b-services-recovery/2026-W20",
    bestUseCase: "Explain how Meridian turns old notes and public timing signals into a practical next-call memo.",
    strongestCardSummary:
      "Veridian Logistics Group connects a new vertical page to a dormant partner-referral campaign conversation.",
    positioningNote:
      "Good for service-business examples; keep the claim limited to prioritization and founder handoff.",
  },
];
