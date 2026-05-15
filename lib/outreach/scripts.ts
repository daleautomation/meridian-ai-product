export type OutreachScript = {
  id: string;
  title: string;
  channel: string;
  intent: string;
  body: string[];
};

export const outreachScripts: OutreachScript[] = [
  {
    id: "cold-linkedin-dm",
    title: "Cold LinkedIn DM",
    channel: "LinkedIn",
    intent: "Start a manual conversation without pitching a platform.",
    body: [
      "Hi [Name] - I am building Meridian for owner-led firms that have good relationships sitting dormant in old notes, spreadsheets, or CRM exports.",
      "I made a short fictional Recovery Brief for staffing firms. It shows how a founder can spot which relationships are worth reopening and why now.",
      "Would it be useful if I sent the sample link?",
    ],
  },
  {
    id: "warm-intro-ask",
    title: "Warm intro ask",
    channel: "Text or email to a mutual contact",
    intent: "Ask for a lightweight introduction with no pressure.",
    body: [
      "Could you introduce me to [Name] at [Company]?",
      "I am looking for feedback from boutique staffing owners on a simple Recovery Brief: a short memo that turns stale relationship data into a prioritized call list.",
      "No ask beyond feedback. If it looks relevant, I can make them a first sample brief from a CSV they control.",
    ],
  },
  {
    id: "cold-email",
    title: "Cold email",
    channel: "Email",
    intent: "Offer a sample brief manually; do not imply scale or automation.",
    body: [
      "Subject: Recovery Brief idea for [Company]",
      "Hi [Name],",
      "I am working on Meridian, a simple Recovery Brief for founder-led teams with old prospects, past clients, or dormant searches that deserve a better follow-up reason than just checking in.",
      "The brief ranks relationships, explains why each one may be worth reopening now, and gives a suggested opener for a human call.",
      "I have a fictional staffing sample I can send over. If it feels relevant, I can make a free first brief from a small CSV you choose.",
      "Worth a look?",
    ],
  },
  {
    id: "call-opener",
    title: "Call opener",
    channel: "Phone",
    intent: "Lead with the business problem, not product language.",
    body: [
      "Hi [Name], this is [Founder] with Meridian.",
      "I am calling because many boutique firms have good relationships buried in old notes or spreadsheets, and the follow-up gets stale because nobody has a clear reason to reopen the thread.",
      "I have a short sample Recovery Brief for staffing firms. It shows a ranked call list, why-now context, and a suggested opener.",
      "Is this the kind of problem you run into with past clients, candidates, or paused searches?",
    ],
  },
  {
    id: "voicemail",
    title: "Voicemail",
    channel: "Phone",
    intent: "Leave a calm reason to call back.",
    body: [
      "Hi [Name], this is [Founder] with Meridian.",
      "I am reaching out because I am testing a Recovery Brief for boutique firms with dormant client or candidate relationships.",
      "It is a short manual brief that helps a founder decide who is worth calling back and what to say.",
      "I will send a quick note with a fictional sample. If it is not relevant, no worries.",
    ],
  },
  {
    id: "csv-request",
    title: "CSV request",
    channel: "Email or call follow-up",
    intent: "Request only the minimum data needed and keep control with the prospect.",
    body: [
      "If you want a free first brief, send a small CSV that you are comfortable sharing.",
      "The useful columns are company, contact name, last touch date, last note, relationship type, and any public signal you already track.",
      "Please remove anything sensitive. Do not send passwords, private customer details, compensation data, or confidential candidate notes.",
      "I will use it only to produce the sample brief we discussed.",
    ],
  },
  {
    id: "brief-delivery-email",
    title: "Brief delivery email",
    channel: "Email",
    intent: "Deliver the brief with clear limits and next steps.",
    body: [
      "Subject: Your sample Recovery Brief",
      "Hi [Name],",
      "Here is the sample Recovery Brief from the CSV you shared: [Brief link]",
      "I would review the top three cards first. The goal is not to replace judgment; it is to give you a cleaner starting point for who to call and why now.",
      "If helpful, I can walk through it with you and decide whether a small paid pilot makes sense.",
    ],
  },
  {
    id: "pricing-close",
    title: "Pricing close",
    channel: "Call",
    intent: "Keep pricing clear without pretending to be an enterprise rollout.",
    body: [
      "I do not want to oversell this.",
      "The first sample brief is free so you can judge whether the output is useful.",
      "If it is useful, the next step is a fixed-scope paid pilot: one controlled data export, one brief, and a clear review call.",
      "I will quote the pilot before you send anything sensitive or commit to ongoing work.",
    ],
  },
  {
    id: "follow-up-no-response",
    title: "Follow-up after no response",
    channel: "LinkedIn or email",
    intent: "Follow up without fake urgency.",
    body: [
      "Hi [Name] - quick follow-up on the Recovery Brief sample.",
      "The idea is simple: find dormant relationships that may still be worth a call, and give the founder a clearer opener.",
      "If this is not a current priority, no problem. If it is, I can send the fictional staffing sample.",
    ],
  },
  {
    id: "follow-up-brief-delivered",
    title: "Follow-up after brief delivered",
    channel: "Email",
    intent: "Ask for concrete feedback and one next step.",
    body: [
      "Hi [Name] - did the Recovery Brief surface any relationship you would actually call?",
      "The two questions I care about most: did the ranking feel useful, and did the suggested openers stay grounded in the data you provided?",
      "If yes, we can discuss a small paid pilot. If no, I would value the feedback.",
    ],
  },
];
