export type SocialPostDraft = {
  id: string;
  title: string;
  draft: string[];
};

export const socialPostDrafts: SocialPostDraft[] = [
  {
    id: "concept-announcement",
    title: "Announce the Recovery Brief concept",
    draft: [
      "I am working on a simple Meridian Recovery Brief.",
      "It is for founder-led teams with good relationships sitting dormant in notes, spreadsheets, or old CRM exports.",
      "The brief answers three questions: who is worth reopening, why now, and what should the first human message say?",
      "The point is not more outreach. The point is better judgment before the founder picks up the phone.",
    ],
  },
  {
    id: "staffing-use-case",
    title: "Show the staffing use case",
    draft: [
      "Boutique staffing firms are a strong first use case for Recovery Briefs.",
      "A paused search, a past client, or a candidate conversation can go quiet for months even when the relationship is still valuable.",
      "A good brief turns that stale list into a few specific calls: this relationship, this timing reason, this opener.",
      "That is the kind of founder-controlled workflow Meridian is built to support.",
    ],
  },
  {
    id: "dormant-relationship-pain",
    title: "Name the dormant relationship pain",
    draft: [
      "Most dormant relationships do not die in one dramatic moment.",
      "They fade because the next follow-up is vague, the note is buried, and nobody wants to send another generic check-in.",
      "Recovery Briefs are meant to make the next step smaller and more grounded.",
      "Not a campaign. A short list of relationships worth reconsidering.",
    ],
  },
  {
    id: "never-invent-context",
    title: "Explain that Meridian never invents context",
    draft: [
      "A rule for Meridian Recovery Briefs: never invent context.",
      "If the note does not explain why a relationship matters, the brief should say that.",
      "If the timing signal is weak, the brief should say that too.",
      "Trust comes from restraint. A useful brief is allowed to be incomplete.",
    ],
  },
  {
    id: "free-first-brief",
    title: "Offer a free first brief",
    draft: [
      "I am offering a few free first Recovery Briefs for founder-led service firms and boutique staffing teams.",
      "You control the CSV. Remove anything sensitive. I will turn it into a short brief that ranks dormant relationships and suggests practical next steps.",
      "If it is useful, we can talk about a small paid pilot.",
      "If it is not useful, I would still value the feedback.",
    ],
  },
];
