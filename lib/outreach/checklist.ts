export type ReadinessChecklistItem = {
  id: string;
  label: string;
  detail: string;
};

export const readinessChecklist: ReadinessChecklistItem[] = [
  {
    id: "demo-links-load",
    label: "Demo links load",
    detail: "Open every sample Recovery Brief link before sending or posting.",
  },
  {
    id: "fictional-samples",
    label: "Sample briefs are fictional/internal samples",
    detail: "Say they are samples; never imply the listed companies or contacts are customers.",
  },
  {
    id: "no-private-data",
    label: "No private customer data",
    detail: "Do not publish or forward any real customer, candidate, deal, or compensation detail.",
  },
  {
    id: "no-example-artifacts",
    label: "No .example-looking artifacts",
    detail: "Use clean internal sample links and files; avoid placeholder domains or throwaway-looking filenames.",
  },
  {
    id: "no-fake-phone-patterns",
    label: "No fake phone patterns",
    detail: "Review visible contact paths and redact numbers that look placeholder-like, real, or distracting.",
  },
  {
    id: "no-overclaims",
    label: "No overclaims",
    detail: "Do not claim automation, guaranteed revenue, customer proof, or enterprise readiness.",
  },
  {
    id: "pricing-clear",
    label: "Pricing language clear",
    detail: "Use free first brief, then fixed-scope paid pilot quoted before sensitive data is shared.",
  },
  {
    id: "csv-handling-clear",
    label: "CSV data handling language clear",
    detail: "Ask prospects to remove sensitive data and send only a small CSV they control.",
  },
  {
    id: "call-script-ready",
    label: "Call script ready",
    detail: "Keep the opener grounded in dormant relationships and a manually reviewed sample brief.",
  },
  {
    id: "social-post-ready",
    label: "Social post ready",
    detail: "Use plain posts with no fake traction, no invented customer proof, and no AI-powered framing.",
  },
  {
    id: "next-step-cta-clear",
    label: "Next-step CTA clear",
    detail: "Offer to send a sample link, review a free first brief, or schedule a feedback call.",
  },
];
