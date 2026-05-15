import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminOperator } from "@/lib/workspaceAccess";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sample Brief Prospects | Meridian Admin",
  description: "Founder-only prospect research and sample Recovery Brief preparation.",
};

const columns = [
  "company",
  "vertical",
  "city",
  "state",
  "website",
  "linkedin",
  "founder_or_partner",
  "estimated_team_size",
  "signs_of_relationship_sales",
  "likely_crm_usage",
  "visible_followup_gap",
  "recent_signal",
  "outreach_priority",
  "personalization_angle",
  "sample_brief_status",
  "notes",
] as const;

type ProspectColumn = (typeof columns)[number];
type OutreachPriority = "High" | "Medium" | "Low";
type Prospect = Record<ProspectColumn, string> & {
  outreach_priority: OutreachPriority;
};

const priorityOrder: Record<OutreachPriority, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
};

const safeBriefWorkflow = [
  "Use only public information: company website pages, public LinkedIn pages, public posts, podcasts, job pages, and founder bios.",
  "Label every Recovery Brief as a sample and state that it is hypothetical unless the prospect provides data.",
  "Never imply CRM, ATS, inbox, calendar, candidate, or client access.",
  "Never fabricate private details such as live searches, open reqs, client names, candidate names, compensation, revenue, or pipeline status.",
  "Never overclaim outcomes. The sample shows how Meridian could organize a founder-reviewed follow-up list.",
  "Use realistic hypothetical dormant-account situations: paused search, prior candidate runner-up, warm hiring manager, old niche client, or delayed project.",
  "Anchor every recommendation on public signals and clearly separate observed facts from hypothetical examples.",
];

const scoringGuidance = [
  {
    label: "High outreach priority",
    copy: "Founder-led or partner-led firms with narrow specialization, clear relationship sales motion, likely dormant account volume, visible follow-up complexity, and enough CRM maturity to understand the pain.",
  },
  {
    label: "Medium outreach priority",
    copy: "Good niche fit with public relationship signals, but either the team may be more mature, the surface area is narrower, or the follow-up gap needs a more careful founder read.",
  },
  {
    label: "Low outreach priority",
    copy: "Still relevant, but best kept for later because the firm looks very small, less urgent, or harder to personalize without additional public research.",
  },
];

const ethicalSafeguards = [
  "Founder-only page behind the existing admin session check.",
  "Static CSV fixture only; no crawler, scraper, enrichment job, sequence builder, or sender.",
  "Priority labels are editorial guidance, not a prediction model.",
  "Prep copy repeatedly says sample, hypothetical, public-signal-only, and founder-reviewed.",
];

export default async function ProspectsPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/admin/prospects");
  if (!isAdminOperator(user)) {
    return <AccessDenied />;
  }

  const prospects = orderProspects(await readProspects());
  const firstPass = prospects.slice(0, 10);

  return (
    <main style={styles.root}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Founder prospect research</div>
        <h1 style={styles.title}>Sample Brief prospecting system.</h1>
        <p style={styles.heroCopy}>
          A manual working list for researching boutique recruiting firms, preparing believable sample Recovery Briefs, and choosing thoughtful first-contact angles.
        </p>
        <div style={styles.heroBadges}>
          {["30 firms", "Manual prep only", "Public signals only", "No scraping", "No sending automation"].map((label) => (
            <span style={styles.badge} key={label}>{label}</span>
          ))}
        </div>
      </section>

      <Section title="Recommended first pass" kicker="Start here">
        <div style={styles.cardGrid}>
          {firstPass.map((prospect, index) => (
            <ProspectPrepCard prospect={prospect} index={index + 1} key={prospect.company} />
          ))}
        </div>
      </Section>

      <Section title="How to create a sample brief safely" kicker="Workflow">
        <List items={safeBriefWorkflow} />
      </Section>

      <TwoColumnSection
        leftTitle="Prospect priority guidance"
        left={<GuidanceList />}
        rightTitle="Ethical safeguards"
        right={<List items={ethicalSafeguards} />}
      />

      <Section title="All outreach targets" kicker="Manual worklist">
        <p style={styles.sectionCopy}>
          Outreach order is a founder review aid. It groups public high-fit prospects first, then medium and low priorities; it does not predict conversion.
        </p>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["Order", "Firm", "Priority", "Founder/partner", "Public gap", "First-contact angle", "Sample status", "Links"].map((heading) => (
                  <th style={styles.th} key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prospects.map((prospect, index) => (
                <tr style={styles.tr} key={prospect.company}>
                  <td style={styles.tdStrong}>{index + 1}</td>
                  <td style={styles.td}>
                    <strong>{prospect.company}</strong>
                    <span style={styles.mutedBlock}>{prospect.vertical} · {prospect.city}, {prospect.state} · {prospect.estimated_team_size}</span>
                  </td>
                  <td style={styles.td}><PriorityBadge priority={prospect.outreach_priority} /></td>
                  <td style={styles.td}>{prospect.founder_or_partner}</td>
                  <td style={styles.td}>{prospect.visible_followup_gap}</td>
                  <td style={styles.td}>{getPrepHelpers(prospect).bestFirstContact}</td>
                  <td style={styles.td}>{prospect.sample_brief_status}</td>
                  <td style={styles.td}>
                    <div style={styles.linkStack}>
                      <ExternalLink href={prospect.website}>Website</ExternalLink>
                      <ExternalLink href={prospect.linkedin}>LinkedIn</ExternalLink>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}

async function readProspects(): Promise<Prospect[]> {
  const filePath = path.join(process.cwd(), "fixtures", "sample-brief-prospects.csv");
  const raw = await fs.readFile(filePath, "utf8");
  const [headerLine, ...rows] = raw.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const hasExpectedColumns = columns.every((column, index) => headers[index] === column);
  if (!hasExpectedColumns) {
    throw new Error("sample-brief-prospects.csv columns do not match the expected admin prospect schema.");
  }

  return rows.map((row) => {
    const values = row.split(",");
    const prospect = Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""])) as Prospect;
    if (!isOutreachPriority(prospect.outreach_priority)) {
      throw new Error(`Invalid outreach priority for ${prospect.company}.`);
    }
    return prospect;
  });
}

function orderProspects(prospects: Prospect[]) {
  return [...prospects].sort((a, b) => {
    const priorityDelta = priorityOrder[a.outreach_priority] - priorityOrder[b.outreach_priority];
    return priorityDelta || a.company.localeCompare(b.company);
  });
}

function isOutreachPriority(value: string): value is OutreachPriority {
  return value === "High" || value === "Medium" || value === "Low";
}

function getPrepHelpers(prospect: Prospect) {
  const text = `${prospect.vertical} ${prospect.personalization_angle}`.toLowerCase();
  const base = {
    bestFirstContact: `Founder-to-founder note to ${prospect.founder_or_partner} referencing ${prospect.personalization_angle.toLowerCase()}.`,
    sampleBriefAngle: `A labeled sample brief about a hypothetical dormant relationship in ${prospect.vertical.toLowerCase()}.`,
    socialProofAngle: "Meridian helps a founder review who to follow up with, why now, and what to say first without sending anything automatically.",
    likelyPainPoint: "Useful relationships sit across ATS notes, LinkedIn, inbox memory, and old searches without a clear next step.",
    likelyObjection: "We already have a CRM or ATS.",
    recommendedBriefType: "Dormant client and candidate reactivation brief",
  };

  if (text.includes("legal")) {
    return {
      ...base,
      sampleBriefAngle: "A sample legal-search brief showing hypothetical dormant lateral or in-house counsel relationships.",
      likelyPainPoint: "Attorney and client conversations are valuable but timing-sensitive, especially after bonus cycles or paused searches.",
      recommendedBriefType: "Dormant legal relationship brief",
    };
  }

  if (text.includes("construction") || text.includes("aec")) {
    return {
      ...base,
      sampleBriefAngle: "A sample construction-search brief around delayed projects and dormant superintendent, estimator, or executive contacts.",
      likelyPainPoint: "Project timing changes can scatter follow-up across clients, candidates, and old reqs.",
      recommendedBriefType: "Project-delay relationship recovery brief",
    };
  }

  if (text.includes("life sciences") || text.includes("biopharma") || text.includes("healthcare")) {
    return {
      ...base,
      sampleBriefAngle: "A sample health or life-sciences brief tied to a public hiring theme and hypothetical paused search.",
      likelyPainPoint: "Long search cycles and specialized candidates make it easy for warm relationships to go quiet.",
      recommendedBriefType: "Long-cycle specialist search brief",
    };
  }

  if (text.includes("finance") || text.includes("asset") || text.includes("fund") || text.includes("financial")) {
    return {
      ...base,
      sampleBriefAngle: "A sample finance-search brief showing dormant buy-side, compliance, or accounting relationships without naming private funds.",
      likelyPainPoint: "Market timing shifts quickly, and old candidate conversations may become relevant again before anyone notices.",
      recommendedBriefType: "Market-timing follow-up brief",
    };
  }

  if (text.includes("marketing") || text.includes("consumer") || text.includes("fashion")) {
    return {
      ...base,
      sampleBriefAngle: "A sample GTM or consumer-brand brief around dormant hiring managers and high-fit candidates from prior searches.",
      likelyPainPoint: "Creative, marketing, and leadership searches produce strong runner-up candidates who can disappear after a role pauses.",
      recommendedBriefType: "GTM relationship recovery brief",
    };
  }

  if (text.includes("tech") || text.includes("saas") || text.includes("startup")) {
    return {
      ...base,
      sampleBriefAngle: "A sample tech-search brief about hypothetical dormant leadership candidates after a funding or hiring-plan change.",
      likelyPainPoint: "Startup hiring changes fast, so warm candidates and founders need context-rich reactivation.",
      recommendedBriefType: "Startup hiring timing brief",
    };
  }

  return base;
}

function ProspectPrepCard({ prospect, index }: { prospect: Prospect; index: number }) {
  const helpers = getPrepHelpers(prospect);
  return (
    <article style={styles.prepCard}>
      <div style={styles.cardTopline}>
        <span>#{index}</span>
        <PriorityBadge priority={prospect.outreach_priority} />
      </div>
      <h2 style={styles.cardTitle}>{prospect.company}</h2>
      <p style={styles.cardCopy}>{prospect.personalization_angle}</p>
      <PrepItem label="Best first contact" value={helpers.bestFirstContact} />
      <PrepItem label="Sample brief angle" value={helpers.sampleBriefAngle} />
      <PrepItem label="Social proof angle" value={helpers.socialProofAngle} />
      <PrepItem label="Likely pain point" value={helpers.likelyPainPoint} />
      <PrepItem label="Likely objection" value={helpers.likelyObjection} />
      <PrepItem label="Recommended brief type" value={helpers.recommendedBriefType} />
      <div style={styles.linkRow}>
        <ExternalLink href={prospect.website}>Website</ExternalLink>
        <ExternalLink href={prospect.linkedin}>LinkedIn</ExternalLink>
      </div>
    </article>
  );
}

function PrepItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.prepItem}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: OutreachPriority }) {
  const style = {
    ...styles.priorityBadge,
    ...(priority === "High" ? styles.priorityHigh : priority === "Medium" ? styles.priorityMedium : styles.priorityLow),
  };
  return <span style={style}>{priority}</span>;
}

function GuidanceList() {
  return (
    <div style={styles.guidanceList}>
      {scoringGuidance.map((item) => (
        <article style={styles.guidanceItem} key={item.label}>
          <strong>{item.label}</strong>
          <p>{item.copy}</p>
        </article>
      ))}
    </div>
  );
}

function Section({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <span style={styles.eyebrow}>{kicker}</span>
        <h2 style={styles.sectionTitle}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function TwoColumnSection({
  leftTitle,
  left,
  rightTitle,
  right,
}: {
  leftTitle: string;
  left: ReactNode;
  rightTitle: string;
  right: ReactNode;
}) {
  return (
    <section style={styles.twoColumn}>
      <article style={styles.panel}>
        <h2 style={styles.panelTitle}>{leftTitle}</h2>
        {left}
      </article>
      <article style={styles.panel}>
        <h2 style={styles.panelTitle}>{rightTitle}</h2>
        {right}
      </article>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul style={styles.list}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} rel="noreferrer" target="_blank" style={styles.link}>
      {children}
    </a>
  );
}

function AccessDenied() {
  return (
    <main style={styles.root}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Admin</div>
        <h1 style={styles.title}>Access denied</h1>
        <p style={styles.heroCopy}>Founder/admin access is required for prospect research and sample brief preparation.</p>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    minHeight: "100dvh",
    background: "#F8FAFC",
    color: "#0F172A",
    padding: "32px 20px 64px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
  },
  hero: {
    maxWidth: "1180px",
    margin: "0 auto 18px",
    border: "1px solid #E2E8F0",
    borderRadius: "22px",
    background: "#FFFFFF",
    padding: "30px",
    boxShadow: "0 18px 50px rgba(15, 23, 42, 0.06)",
  },
  eyebrow: {
    color: "#64748B",
    fontSize: "11px",
    fontWeight: 850,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    maxWidth: "840px",
    margin: "8px 0 12px",
    fontSize: "clamp(36px, 6vw, 62px)",
    lineHeight: 0.96,
    letterSpacing: "-0.055em",
  },
  heroCopy: {
    maxWidth: "780px",
    margin: 0,
    color: "#475569",
    fontSize: "16px",
    lineHeight: 1.65,
  },
  heroBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "22px",
  },
  badge: {
    border: "1px solid #CBD5E1",
    borderRadius: "999px",
    background: "#F8FAFC",
    color: "#334155",
    padding: "8px 10px",
    fontSize: "12px",
    fontWeight: 800,
  },
  section: {
    maxWidth: "1180px",
    margin: "18px auto 0",
    border: "1px solid #E2E8F0",
    borderRadius: "18px",
    background: "#FFFFFF",
    padding: "24px",
  },
  sectionHeading: {
    marginBottom: "16px",
  },
  sectionTitle: {
    margin: "6px 0 0",
    fontSize: "28px",
    letterSpacing: "-0.035em",
  },
  sectionCopy: {
    maxWidth: "760px",
    margin: "0 0 16px",
    color: "#475569",
    fontSize: "14px",
    lineHeight: 1.6,
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
    gap: "14px",
  },
  prepCard: {
    display: "grid",
    alignContent: "start",
    gap: "12px",
    border: "1px solid #E2E8F0",
    borderRadius: "16px",
    background: "#FAFBFC",
    padding: "18px",
  },
  cardTopline: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    color: "#64748B",
    fontSize: "11px",
    fontWeight: 850,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  cardTitle: {
    margin: 0,
    fontSize: "22px",
    lineHeight: 1.1,
    letterSpacing: "-0.03em",
  },
  cardCopy: {
    margin: 0,
    color: "#475569",
    fontSize: "14px",
    lineHeight: 1.55,
  },
  prepItem: {
    display: "grid",
    gap: "5px",
    borderLeft: "3px solid #2563EB",
    paddingLeft: "12px",
  },
  linkRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "4px",
  },
  linkStack: {
    display: "grid",
    gap: "6px",
  },
  link: {
    display: "inline-flex",
    width: "fit-content",
    borderRadius: "999px",
    background: "#0F172A",
    color: "#FFFFFF",
    padding: "8px 11px",
    fontSize: "12px",
    fontWeight: 800,
    textDecoration: "none",
  },
  priorityBadge: {
    display: "inline-flex",
    width: "fit-content",
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "11px",
    fontWeight: 850,
    textTransform: "uppercase",
  },
  priorityHigh: {
    border: "1px solid rgba(220, 38, 38, 0.18)",
    background: "#FEF2F2",
    color: "#991B1B",
  },
  priorityMedium: {
    border: "1px solid rgba(245, 158, 11, 0.22)",
    background: "#FFFBEB",
    color: "#92400E",
  },
  priorityLow: {
    border: "1px solid rgba(100, 116, 139, 0.22)",
    background: "#F8FAFC",
    color: "#475569",
  },
  twoColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "18px",
    maxWidth: "1180px",
    margin: "18px auto 0",
  },
  panel: {
    border: "1px solid #E2E8F0",
    borderRadius: "18px",
    background: "#FFFFFF",
    padding: "22px",
  },
  panelTitle: {
    margin: "0 0 12px",
    fontSize: "22px",
    letterSpacing: "-0.03em",
  },
  list: {
    display: "grid",
    gap: "10px",
    margin: 0,
    paddingLeft: "20px",
    color: "#334155",
    fontSize: "14px",
    lineHeight: 1.55,
  },
  guidanceList: {
    display: "grid",
    gap: "10px",
  },
  guidanceItem: {
    border: "1px solid #E2E8F0",
    borderRadius: "14px",
    background: "#FAFBFC",
    padding: "14px",
    color: "#334155",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #E2E8F0",
    borderRadius: "16px",
  },
  table: {
    width: "100%",
    minWidth: "1120px",
    borderCollapse: "collapse",
    background: "#FFFFFF",
  },
  th: {
    padding: "12px",
    borderBottom: "1px solid #E2E8F0",
    background: "#F8FAFC",
    color: "#64748B",
    fontSize: "11px",
    fontWeight: 850,
    letterSpacing: "0.08em",
    textAlign: "left",
    textTransform: "uppercase",
  },
  tr: {
    verticalAlign: "top",
  },
  td: {
    padding: "12px",
    borderBottom: "1px solid #E2E8F0",
    color: "#334155",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  tdStrong: {
    padding: "12px",
    borderBottom: "1px solid #E2E8F0",
    color: "#0F172A",
    fontSize: "13px",
    fontWeight: 850,
  },
  mutedBlock: {
    display: "block",
    marginTop: "5px",
    color: "#64748B",
    fontSize: "12px",
    lineHeight: 1.4,
  },
};
